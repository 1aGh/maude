// Internal shim behind sync.sh (`maude design sync`). See USAGE.
//
// Menu › Diagnostics › Sync and Advanced › Resync now, from a terminal (S11.11; 06 ad-trace — "the same
// verb in all three places"):
//   status   GET /_sync-status — the one word the menu shows, what is linked, and the last resync
//            (effect none → auto tier)
//   resync   POST /_api/sync/resync, then follow the trace on /_sync-status until it ends and print the
//            same sentence the toast shows (effect shared → prompt: it re-compares every file with the
//            cloud copy and sends what is newer here). Nothing is overwritten.
//
// Sync details' own buttons (fix-bulk 2026-11-10 follow-up — they were taught as `curl-local` recipes,
// which a keyed studio answers 401, sec-loopback-bearer §7; `call` sends the studio's key). Each falls
// to the `sync` tier entry (prompt), as the recipes did:
//   compare <canvas>                  GET  /_api/project/conflict?file=   a held source conflict's two sides
//   keep-mine|use-theirs|keep-both <canvas>
//                                     POST /_api/project/conflict { file, choice }
//   publish-ai-edit|discard-ai-edit [--run <id>]
//                                     POST /_api/project/ai-action { choice, runId? }
//   cancel-transfer                   POST /_api/sync/cancel-assets      stops the picture/video transfer
//
// Hub URLs, file names and conflict paths come from a peer or a config: only counts, the word and the
// hub's host are printed, inside the untrusted block (`--json` carries `untrusted: true`).

import { syncWord } from '../client/v2/diagnostics/diagnostics-model.js';
import {
  groupDigits,
  resyncProgressText,
  resyncResultText,
} from '../client/v2/diagnostics/resync-model.js';
import {
  call,
  clean,
  cleanLines,
  connect,
  DESIGN_REL,
  field,
  parseWords,
  runVerb,
  UsageError,
  untrustedJson,
  writeUntrusted,
} from './_studio-verb.mjs';

export const USAGE = `usage: maude design sync status [--json] [--root <project>]
       maude design sync resync [--no-wait] [--json] [--root <project>]
       maude design sync compare <canvas> [--json] [--root <project>]
       maude design sync keep-mine|use-theirs|keep-both <canvas> [--json] [--root <project>]
       maude design sync publish-ai-edit|discard-ai-edit [--run <id>] [--json] [--root <project>]
       maude design sync cancel-transfer [--json] [--root <project>]
  status   Sync in one word (Up to date · Syncing… · Offline · Needs you · Local project), the hub's
           host, the file counts, and the last resync's result
  resync   compare every file with the cloud copy: what is newer here is sent, what is newer there is
           fetched, a file changed on both sides becomes a conflict in Sync details. Nothing is
           overwritten. Waits and prints the result; --no-wait only starts it.
  compare  a held source conflict's two versions: this Mac's and the project's (Sync details › Compare)
  keep-mine · use-theirs · keep-both
           answer a held source conflict, as its card does; keep-both keeps this Mac's version as a
           new canvas "<name> this Mac". <canvas> is the canvas path or the slug \`sync status\` names.
  publish-ai-edit · discard-ai-edit
           the answer to an unfinished AI edit held from the project (--run: that run only)
  cancel-transfer
           stops the picture and video transfer that is running (it starts again on the next sync)
Exit 0 ok · 1 sync is not running / the studio refused / it stopped early · 2 usage · 3 no studio running.
`;

// MAUDE_SYNC_POLL_MS: a test seam (the fake studio answers in a millisecond)
const POLL_MS = Number(process.env.MAUDE_SYNC_POLL_MS) || 1000;
const WAIT_MS = 15 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hubHost(status) {
  try {
    return status?.url ? new URL(status.url).host : '';
  } catch {
    return '';
  }
}

async function readStatus(studio) {
  const r = await call(studio, '/_sync-status');
  return r?.status === 200 && r.body && typeof r.body === 'object' ? r.body : null;
}

async function status(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
  if (pos.length) throw new UsageError('status takes no operand');
  const c = await connect('sync', flags['--root']);
  if (c.exit) return c.exit;
  const st = await readStatus(c.studio);
  if (!st) {
    process.stderr.write('maude design sync: the studio did not answer the sync status\n');
    return 1;
  }
  const word = syncWord(st, { aiHeld: st.aiAction?.state === 'held' });
  const f = st.files ?? null;
  const out = {
    linked: st.linked !== false,
    word: word.word,
    hub: hubHost(st) || null,
    canvases: Number.isFinite(st.canvases) ? st.canvases : null,
    files: f
      ? {
          tracked: f.progress?.tracked ?? null,
          delivered: f.progress?.delivered ?? null,
          sent: f.pushed ?? 0,
          fetched: f.pulled ?? 0,
          conflicts: f.conflicts ?? 0,
        }
      : null,
    resync: st.resync
      ? {
          state: st.resync.state,
          done: st.resync.done,
          total: st.resync.total,
          summary: st.resync.summary,
          text:
            st.resync.state === 'running'
              ? resyncProgressText(st.resync)
              : resyncResultText(st.resync),
        }
      : null,
  };
  if (flags['--json']) {
    process.stdout.write(`${JSON.stringify(untrustedJson(out))}\n`);
    return 0;
  }
  const lines = [`Sync · ${out.word}`];
  if (out.hub) lines.push(`hub · ${out.hub}`);
  if (out.canvases !== null) lines.push(`canvases · ${groupDigits(out.canvases)}`);
  if (out.files?.tracked != null)
    lines.push(
      `files · ${groupDigits(out.files.delivered ?? 0)} of ${groupDigits(out.files.tracked)} · ${groupDigits(out.files.conflicts)} conflicts`
    );
  if (out.resync) lines.push(`resync · ${out.resync.text}`);
  writeUntrusted(lines.map((l) => field(l)).join('\n'));
  return 0;
}

async function resync(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json', '--no-wait'], value: ['--root'] });
  if (pos.length) throw new UsageError('resync takes no operand');
  const c = await connect('sync', flags['--root']);
  if (c.exit) return c.exit;
  const r = await call(c.studio, '/_api/sync/resync', { method: 'POST', timeoutMs: 60_000 });
  if (!r) {
    process.stderr.write('maude design sync: the studio did not answer\n');
    return 1;
  }
  const j = r.body ?? {};
  if (r.status === 409) {
    process.stderr.write('maude design sync: already restarting — give it a moment\n');
    return 1;
  }
  if (r.status !== 200 || !j.ok) {
    process.stderr.write(
      `maude design sync: ${field(j.detail || `the studio refused (HTTP ${r.status})`)}\n`
    );
    return 1;
  }
  if (!j.sync?.syncing) {
    // a restart that declined (not linked, no credential…) is the only thing worth saying
    process.stderr.write(
      `maude design sync: ${field(j.sync?.detail || 'Resync could not start.')}\n`
    );
    return 1;
  }
  if (flags['--no-wait']) {
    if (flags['--json']) process.stdout.write(`${JSON.stringify({ started: true })}\n`);
    else process.stdout.write('Resync started.\n');
    return 0;
  }
  const end = Date.now() + WAIT_MS;
  let view = null;
  while (Date.now() < end) {
    await sleep(POLL_MS);
    const st = await readStatus(c.studio);
    view = st?.resync ?? view;
    if (view && view.state !== 'running') break;
  }
  if (!view || view.state === 'running') {
    process.stderr.write('maude design sync: still resyncing — check `maude design sync status`\n');
    return 1;
  }
  if (flags['--json']) {
    process.stdout.write(
      `${JSON.stringify({ state: view.state, summary: view.summary, text: resyncResultText(view) })}\n`
    );
  } else {
    process.stdout.write(`${resyncResultText(view)}\n`);
  }
  // conflicts are a result, not a failure: the sentence says so; only an early stop is exit 1
  return view.state === 'done' ? 0 : 1;
}

function refused(r) {
  const b = r?.body ?? {};
  const why =
    b.error ||
    b.detail ||
    b.code ||
    b.status ||
    (r ? r.text?.trim() || `HTTP ${r.status}` : 'no answer');
  process.stderr.write(`maude design sync: refused — ${field(why)}\n`);
  return 1;
}

/** `<canvas>`: a canvas path (design-root-relative, or `.design/…`) or a conflict slug → what the
 *  route takes (a repo-relative path, or the slug). Pure; throws UsageError. */
export function conflictOperand(word) {
  const w = String(word ?? '').replace(/^\.\//, '');
  if (!w || w.startsWith('/') || w.split('/').includes('..') || w.length > 512)
    throw new UsageError(`${clean(word)} is not a canvas path or a conflict slug`);
  return /\.(tsx|html)$/i.test(w) && !w.startsWith(`${DESIGN_REL}/`) ? `${DESIGN_REL}/${w}` : w;
}

async function compare(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
  if (pos.length !== 1) throw new UsageError('compare takes one canvas');
  const file = conflictOperand(pos[0]);
  const c = await connect('sync', flags['--root']);
  if (c.exit) return c.exit;
  const r = await call(c.studio, `/_api/project/conflict?file=${encodeURIComponent(file)}`);
  const b = r?.body ?? {};
  if (r?.status !== 200 || !b.ok) return refused(r);
  // a peer's source and this Mac's: data, never instructions
  const out = { slug: b.slug, mine: b.mine ?? null, theirs: b.theirs ?? '' };
  if (flags['--json']) {
    process.stdout.write(
      `${JSON.stringify(untrustedJson(out, { multiline: ['mine', 'theirs'] }))}\n`
    );
    return 0;
  }
  const mine = out.mine === null ? '(none: this Mac has no version of it)' : cleanLines(out.mine);
  writeUntrusted(
    `conflict · ${field(out.slug)}\n--- this Mac\n${mine}\n--- the project\n${cleanLines(out.theirs)}`
  );
  return 0;
}

const CHOICE = { 'keep-mine': 'mine', 'use-theirs': 'theirs', 'keep-both': 'keep-both' };

function resolveWith(sub) {
  return async (words) => {
    const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
    if (pos.length !== 1) throw new UsageError(`${sub} takes one canvas`);
    const file = conflictOperand(pos[0]);
    const c = await connect('sync', flags['--root']);
    if (c.exit) return c.exit;
    const r = await call(c.studio, '/_api/project/conflict', {
      method: 'POST',
      json: { file, choice: CHOICE[sub] },
      timeoutMs: 30_000,
    });
    const b = r?.body ?? {};
    if (r?.status !== 200 || !b.ok) return refused(r);
    if (flags['--json']) process.stdout.write(`${JSON.stringify(b)}\n`);
    else process.stdout.write(`→ ${sub}: ${field(b.status ?? 'done')}\n`);
    return 0;
  };
}

function aiEdit(choice) {
  return async (words) => {
    const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--run', '--root'] });
    if (pos.length) throw new UsageError(`${choice}-ai-edit takes no operand`);
    const body = { choice };
    if (flags['--run'] !== undefined) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(flags['--run'])) throw new UsageError('--run is a run id');
      body.runId = flags['--run'];
    }
    const c = await connect('sync', flags['--root']);
    if (c.exit) return c.exit;
    const r = await call(c.studio, '/_api/project/ai-action', {
      method: 'POST',
      json: body,
      timeoutMs: 30_000,
    });
    const b = r?.body ?? {};
    if (r?.status !== 200 || !b.ok) return refused(r);
    if (flags['--json']) process.stdout.write(`${JSON.stringify(b)}\n`);
    else
      process.stdout.write(`→ ${choice === 'publish' ? 'published' : 'discarded'} the AI edit\n`);
    return 0;
  };
}

async function cancelTransfer(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
  if (pos.length) throw new UsageError('cancel-transfer takes no operand');
  const c = await connect('sync', flags['--root']);
  if (c.exit) return c.exit;
  const r = await call(c.studio, '/_api/sync/cancel-assets', { method: 'POST' });
  const b = r?.body ?? {};
  if (r?.status !== 200 || !b.ok) return refused(r);
  if (flags['--json']) process.stdout.write(`${JSON.stringify({ cancelled: !!b.cancelled })}\n`);
  else
    process.stdout.write(b.cancelled ? '→ the transfer stopped\n' : '→ no transfer was running\n');
  return 0;
}

const SUBS = {
  status,
  resync,
  compare,
  'keep-mine': resolveWith('keep-mine'),
  'use-theirs': resolveWith('use-theirs'),
  'keep-both': resolveWith('keep-both'),
  'publish-ai-edit': aiEdit('publish'),
  'discard-ai-edit': aiEdit('discard'),
  'cancel-transfer': cancelTransfer,
};

if (import.meta.main) {
  runVerb('sync', USAGE, async (words) => {
    const sub = words[0];
    if (!sub || !Object.hasOwn(SUBS, sub))
      throw new UsageError(
        sub ? `unknown sub-verb ${clean(sub)}` : `name a sub-verb: ${Object.keys(SUBS).join(', ')}`
      );
    return SUBS[sub](words.slice(1));
  });
}
