// Internal shim behind history.sh (`maude design history`). See USAGE.
//
// Versions of this project, from its running studio (contract V2-1.11 §5.3, V2-1.9 §5.11):
//   synced project  — the accepted history rows (`GET /_api/project/history`, revisions `r<n>`);
//   local project   — the route answers `{ ok:false, reason:'legacy' }`, so the git log / diff
//                     routes answer instead (`/_api/git/log`, `/_api/git/diff`; commit shas).
// list / show / diff read only (effect none → auto tier). Labels, actors, commit subjects and file
// text are other people's: printed inside the one untrusted block (`--json`: `untrusted: true`).

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  call,
  canvasRepoRel,
  clean,
  cleanLines,
  connect,
  field,
  parseWords,
  runVerb,
  UsageError,
  untrustedJson,
  writeUntrusted,
} from './_studio-verb.mjs';

export const USAGE = `usage: maude design history list [<canvas>] [--limit N] [--json] [--root <project>]
       maude design history show <ref> [<canvas>] [--json] [--root <project>]
       maude design history diff [<canvas>] [--from <ref>] [--json] [--root <project>]
       maude design history restore <canvas> <ref> [--json] [--root <project>]
       maude design history undo --action <id> | --chat <id> [--redo] [--json] [--root <project>]
  <canvas>  design-root-relative (ui/home.tsx), .design/…, or absolute
  <ref>     r<n> (a synced project's version) or a commit sha (a local project's)
  list      the versions, newest first
  show      one version: who, when, what it was, the canvases it touched
  diff      what changed since <ref> (default: the last commit) — local projects
  restore   the whole canvas back to <ref>, as a NEW version (Now stays in the history) — synced
  undo      undo (or --redo) one action, or every action your AI made in a chat (--chat), as ONE new version
list / show / diff read only; restore / undo change the project and ask first.
Exit 0 ok · 1 not found / refused / not available · 2 usage · 3 no studio running.
`;

const SHA = /^[0-9a-f]{7,40}$/i;
const REV = /^r?(\d{1,12})$/;

/** The project's kind: 'synced' with its rows, or 'git'. Throws on an unreachable team server. */
async function versions(studio, { repoRel, limit = 50, before = null }) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before != null) q.set('before', String(before));
  if (repoRel) q.set('path', repoRel);
  const r = await call(studio, `/_api/project/history?${q}`);
  if (r?.status !== 200 || !r.body) throw new Error('the studio did not answer');
  if (r.body.ok) return { kind: 'synced', rows: r.body.history ?? [] };
  if (r.body.reason === 'unreachable')
    throw new Error('the team server is unreachable — try again in a moment');
  return { kind: 'git' };
}

async function gitLog(studio, { repoRel, limit = 50 }) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (repoRel) q.set('path', repoRel);
  const r = await call(studio, `/_api/git/log?${q}`);
  if (r?.status !== 200) throw new Error(clean(r?.body?.error ?? 'the git log did not answer'));
  return r.body?.entries ?? [];
}

const when = (iso) => (iso ? field(iso).replace('T', ' ').slice(0, 16) : '');
const canvasesOf = (row) => (row.canvases ?? []).map((c) => field(c).replace(/^\.design\//, ''));

function syncedLine(row) {
  const who = `${field(row.actor ?? '?')}${row.mine ? ' (you)' : ''}`;
  const where = canvasesOf(row).join(', ');
  return `r${field(row.revision)}  ${when(row.committedAt)}  ${who}  ${field(row.kind ?? '')}  ${field(row.label ?? '')}${where ? `  · ${where}` : ''}`;
}
const gitLine = (e) =>
  `${field(e.sha).slice(0, 9)}  ${when(e.date)}  ${field(e.author)}  ${field(e.message)}`;

function canvasArg(root, raw) {
  if (raw === undefined) return null;
  const rel = canvasRepoRel(root, raw);
  if (!rel) throw new UsageError(`${raw} is not a canvas inside .design/`);
  return rel;
}

async function list(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--limit', '--root'] });
  if (pos.length > 1) throw new UsageError('list takes at most one canvas');
  const limit = flags['--limit'] === undefined ? 50 : Number(flags['--limit']);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new UsageError('--limit is 1–200');
  const c = await connect('history', flags['--root']);
  if (c.exit) return c.exit;
  const repoRel = canvasArg(c.root, pos[0]);
  const v = await versions(c.studio, { repoRel, limit });
  if (v.kind === 'synced') {
    if (flags['--json']) out({ kind: 'synced', canvas: repoRel, versions: v.rows });
    else if (v.rows.length === 0) process.stdout.write('no versions yet\n');
    else writeUntrusted(v.rows.map((row) => `${syncedLine(row)}\n`).join(''));
    return 0;
  }
  const entries = await gitLog(c.studio, { repoRel, limit });
  if (flags['--json']) out({ kind: 'git', canvas: repoRel, versions: entries });
  else if (entries.length === 0) process.stdout.write('no commits yet\n');
  else writeUntrusted(entries.map((e) => `${gitLine(e)}\n`).join(''));
  return 0;
}

async function show(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
  if (pos.length < 1 || pos.length > 2) throw new UsageError('show takes <ref> [<canvas>]');
  const c = await connect('history', flags['--root']);
  if (c.exit) return c.exit;
  const [ref, canvas] = /\.(tsx|html)$/i.test(pos[0]) ? [pos[1], pos[0]] : pos;
  if (!ref) throw new UsageError('show takes <ref> [<canvas>]');
  const repoRel = canvasArg(c.root, canvas);
  const v = await versions(c.studio, { repoRel, limit: 1 });
  if (v.kind === 'synced') {
    const m = REV.exec(ref);
    if (!m) throw new UsageError(`${ref} is not a version of this synced project (r<n>)`);
    const rev = Number(m[1]);
    const { rows } = await versions(c.studio, { repoRel, limit: 1, before: rev + 1 });
    const row = rows.find((r) => r.revision === rev);
    if (!row) return notFound(`r${rev}`, repoRel);
    if (flags['--json']) out({ kind: 'synced', version: row });
    else
      writeUntrusted(
        `${syncedLine(row)}\n${row.undoes?.length ? `  undoes ${row.undoes.map((u) => field(u)).join(', ')}\n` : ''}  action ${field(row.actionId)}\n`
      );
    return 0;
  }
  if (!SHA.test(ref)) throw new UsageError(`${ref} is not a commit of this project (a sha)`);
  const entry = (await gitLog(c.studio, { repoRel, limit: 200 })).find((e) =>
    String(e.sha).toLowerCase().startsWith(ref.toLowerCase())
  );
  if (!entry) return notFound(ref, repoRel);
  if (flags['--json']) out({ kind: 'git', version: entry });
  else writeUntrusted(`${gitLine(entry)}\n  commit ${field(entry.sha)}\n`);
  return 0;
}

async function diff(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--from', '--root'] });
  if (pos.length > 1) throw new UsageError('diff takes at most one canvas');
  const c = await connect('history', flags['--root']);
  if (c.exit) return c.exit;
  const repoRel = canvasArg(c.root, pos[0]);
  const v = await versions(c.studio, { repoRel, limit: 1 });
  if (v.kind === 'synced') {
    process.stderr.write(
      'maude design history diff: a synced project’s changes are not diffable from here yet — `maude design history show r<n>` says what a version touched\n'
    );
    return 1;
  }
  const from = flags['--from'] ?? 'HEAD';
  if (from !== 'HEAD' && !SHA.test(from)) throw new UsageError('--from is a commit sha');
  const r = await call(c.studio, `/_api/git/diff?${new URLSearchParams({ sha: from })}`);
  if (r?.status !== 200) throw new Error('the git diff did not answer');
  const files = [];
  for (const e of r.body?.entries ?? []) {
    const file = String(e.file ?? '');
    if (repoRel && file !== repoRel) continue;
    const abs = resolve(c.root, file);
    const rel = relative(c.root, abs);
    if (!rel || rel.startsWith('..')) continue; // never read outside the project
    let now = null;
    try {
      now = readFileSync(abs, 'utf8');
    } catch {
      /* deleted since */
    }
    const before = typeof e.before === 'string' ? e.before : '';
    files.push({
      file,
      status: now === null ? 'deleted' : before ? 'modified' : 'added',
      before,
      now,
    });
  }
  if (flags['--json']) {
    out({
      kind: 'git',
      from,
      files: files.map((f) => ({ file: f.file, status: f.status, diff: unified(f) })),
    });
    return 0;
  }
  if (files.length === 0) process.stdout.write(`no changes since ${from}\n`);
  else writeUntrusted(files.map((f) => cleanLines(unified(f))).join(''));
  return 0;
}

// ── writes (prompt tier: `history` is destructive in verbs.ts) ──────────────────────────────

/** `restore <canvas> <ref>` — the WHOLE canvas back to a version, landed as a NEW version (C5):
 *  Now stays in the history. One-artboard / one-element restore is S1's, so no flag for it. */
async function restore(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
  if (pos.length !== 2) throw new UsageError('restore takes <canvas> <ref>');
  const [canvas, ref] = /\.(tsx|html)$/i.test(pos[0]) ? pos : [pos[1], pos[0]];
  const m = REV.exec(ref);
  if (!m) throw new UsageError(`${ref} is not a version (r<n>)`);
  const c = await connect('history', flags['--root']);
  if (c.exit) return c.exit;
  const repoRel = canvasArg(c.root, canvas);
  const revision = Number(m[1]);
  const r = await call(c.studio, '/_api/project/restore', {
    method: 'POST',
    json: { path: repoRel, revision },
  });
  return landed(r, flags['--json'], {
    legacy:
      'restoring a version needs a synced project — this one keeps its history in git, and Maude does not rewrite it',
    ok: () =>
      `→ restored ${repoRel.replace(/^\.design\//, '')} to r${revision} as a new version (the version before it stays in the history)`,
  });
}

/** A chat id (V2-1.5 §5.1 `chatId`). */
const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `undo --action <id> | --chat <id> [--redo]` — undo (or redo) one accepted action, or every
 *  action this person's AI made in one chat, as ONE new version (V2-1.5 §5.3; V2-1.9 §5.11). */
async function undo(words) {
  const { flags, pos } = parseWords(words, {
    bool: ['--json', '--redo'],
    value: ['--action', '--chat', '--root'],
  });
  if (pos.length) throw new UsageError('undo takes --action <id> or --chat <id>');
  const actionId = flags['--action'];
  const chatId = flags['--chat'];
  if ((actionId === undefined) === (chatId === undefined))
    throw new UsageError('undo takes --action <id> or --chat <id>');
  if (chatId !== undefined && !CHAT_ID.test(chatId))
    throw new UsageError('--chat takes a chat id ([A-Za-z0-9_-], ≤ 64)');
  const c = await connect('history', flags['--root']);
  if (c.exit) return c.exit;
  const redo = flags['--redo'] === true;
  const r = await call(c.studio, '/_api/project/undo', {
    method: 'POST',
    json: chatId !== undefined ? { chatId, redo, via: 'panel' } : { actionId, redo },
  });
  // An old team server has no multi-target undo: the route answers 409 with the line.
  if (r?.status === 409 && r.body?.reason === 'needs-hub-update') {
    process.stderr.write(`maude design history: ${clean(r.body.line ?? 'needs-hub-update')}\n`);
    return 1;
  }
  return landed(r, flags['--json'], {
    legacy: 'undoing an action needs the project’s version history',
    ok: (b) =>
      `→ ${redo ? 'redid' : 'undid'} ${chatId !== undefined ? `chat ${clean(chatId)}` : clean(actionId)}${b.actionId ? ` (new version ${clean(b.actionId)})` : ''}`,
  });
}

function landed(r, asJson, say) {
  if (!r) throw new Error('the studio did not answer');
  const b = r.body ?? {};
  if (r.status === 200 && b.ok) {
    process.stdout.write(asJson ? `${JSON.stringify(b)}\n` : `${say.ok(b)}\n`);
    return 0;
  }
  if (r.status === 200 && b.reason === 'legacy') {
    process.stderr.write(`maude design history: ${say.legacy}\n`);
    return 1;
  }
  if (r.status === 400) throw new UsageError(clean(r.text).slice(0, 200));
  const why = b.code ?? b.reason ?? (r.text ? clean(r.text).slice(0, 200) : `HTTP ${r.status}`);
  process.stderr.write(
    `maude design history: refused (${clean(why)})${b.queued ? ' — queued' : ''}\n`
  );
  return 1;
}

function notFound(ref, repoRel) {
  process.stderr.write(
    `maude design history: no version ${ref}${repoRel ? ` of ${repoRel.replace(/^\.design\//, '')}` : ''} — \`maude design history list\` lists them\n`
  );
  return 1;
}

/** `--json` for list / show / diff: every field is someone else's text (a diff keeps its lines). */
const out = (v) =>
  process.stdout.write(`${JSON.stringify(untrustedJson(v, { multiline: ['diff'] }))}\n`);

/** A unified line diff of one file (LCS; context 2). Big files get a summary line instead. */
export function unified({ file, before, now }) {
  const a = before ? before.split('\n') : [];
  const b = now ? now.split('\n') : [];
  const head = `--- ${file} (then)\n+++ ${file} (now)\n`;
  if (a.length * b.length > 4_000_000)
    return `${head}@@ ${a.length} lines → ${b.length} lines (too large to diff here) @@\n`;
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push([' ', a[i++], j++]);
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) ops.push(['+', b[j++]]);
    else ops.push(['-', a[i++]]);
  }
  const keep = ops.map(
    (o, k) => o[0] !== ' ' || ops.slice(Math.max(0, k - 2), k + 3).some((x) => x[0] !== ' ')
  );
  let s = head;
  let gap = false;
  for (let k = 0; k < ops.length; k++) {
    if (!keep[k]) {
      gap = true;
      continue;
    }
    if (gap || k === 0) s += '@@\n';
    gap = false;
    s += `${ops[k][0]}${ops[k][1]}\n`;
  }
  return s;
}

const SUBS = { list, show, diff, restore, undo };

if (import.meta.main) {
  runVerb('history', USAGE, async (words) => {
    const sub = words[0];
    if (!sub || !Object.hasOwn(SUBS, sub))
      throw new UsageError(sub ? `unknown sub-verb ${sub}` : 'name a sub-verb');
    return SUBS[sub](words.slice(1));
  });
}
