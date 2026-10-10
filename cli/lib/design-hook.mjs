// design-hook.mjs — `maude design hook <event>`, the design plugin's hooks (contract V2-1.11 §5.4;
// lifted from apps/studio/test/agent-evals/harness/hook.mjs, the prototype V2-1.18 measured).
//
//   prompt      UserPromptSubmit  POST /_api/agent/run/begin                       → nothing
//   pre-edit    PreToolUse        snapshot · whole-file-rewrite · POST edit/check   → deny or nothing
//   post-edit   PostToolUse       check (studio, else local) · rollback · touched   → block or nothing
//   stop        Stop              stop-tier check of the run's files · run/end      → block or nothing
//
// DENY-ONLY and FAIL-OPEN: never `ask`, never `allow`; bad stdin, no project, a path outside
// designRoot, any internal error → exit 0 with no output. Without a studio (no `_server.json`,
// refused, timeout, non-2xx) the studio parts are skipped; snapshot, check and rollback still run.
//
// State per Claude Code session in <designRoot>/_runs/<session>/ (runtime, DDR-115):
//   snap/<tool_use_id>       bytes before that edit (`.new` marker: the file did not exist)
//   base/<sha(path)>         bytes before the run first touched the file (stop-tier `against`)
//   touched.json             files this run changed
//   stop-last.json           the last Stop block (so a re-stop with the same list lets it end)
//
// Leaf module: node built-ins + studio-locate.mjs.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { DESIGN_REL, findProjectRoot, locateStudio, postStudio } from './studio-locate.mjs';

export const HOOK_EVENTS = ['prompt', 'pre-edit', 'post-edit', 'stop'];
const KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CANVAS_RE = /\.(?:tsx|jsx)$/;
/** V2-1.11 §9 Q5: a Write over an existing canvas longer than this is a lazy rewrite. */
export const LAZY_WRITE_LINES = 40;
const LOCATE_MS = 300;

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
/** Claude Code's ids are safe segments; anything else is hashed into one. */
export const hookKey = (raw) =>
  typeof raw === 'string' && KEY_RE.test(raw) ? raw : raw ? sha(String(raw)).slice(0, 32) : null;

function readOr(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}
function writeAt(abs, text) {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}
const readJson = (abs, dflt) => {
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return dflt;
  }
};
const deny = (reason) => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
  },
});

/** What the tool writes, replayed on `cur`. null = can't tell (MultiEdit misses, NotebookEdit). */
export function replayEdit(tool, ti, cur) {
  if (tool === 'Write') return typeof ti.content === 'string' ? ti.content : null;
  const one = (s, e) => {
    if (s === null || typeof e?.old_string !== 'string' || !e.old_string) return null;
    if (!s.includes(e.old_string)) return null;
    const next = e.new_string ?? '';
    return e.replace_all ? s.split(e.old_string).join(next) : s.replace(e.old_string, () => next);
  };
  if (tool === 'Edit') return one(cur, ti);
  if (tool === 'MultiEdit' && Array.isArray(ti.edits)) {
    let s = cur;
    for (const e of ti.edits) s = one(s, e);
    return s;
  }
  return null;
}

function context(input) {
  const root = findProjectRoot(typeof input.cwd === 'string' ? input.cwd : process.cwd());
  if (!root) return null;
  const designRoot = join(root, DESIGN_REL);
  const session = hookKey(input.session_id) ?? 'no-session';
  return { root, designRoot, session, run: join(designRoot, '_runs', session) };
}

/** The designRoot-relative POSIX path of the tool's target, or null (outside / runtime). */
function targetOf(ctx, input) {
  const ti = input.tool_input ?? {};
  const p = ti.file_path ?? ti.notebook_path;
  if (typeof p !== 'string' || !p) return null;
  const abs = resolve(typeof input.cwd === 'string' ? input.cwd : process.cwd(), p);
  const rel = relative(ctx.designRoot, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  const posix = rel.split(sep).join('/');
  if (posix.startsWith('_') || posix.split('/').some((s) => s.startsWith('.'))) return null;
  return { abs, rel: posix };
}

const snapRel = (ctx, toolUseId) => `_runs/${ctx.session}/snap/${toolUseId}`;
const baseRel = (ctx, rel) => `_runs/${ctx.session}/base/${sha(rel).slice(0, 16)}`;

/** Save `cur` (or the "did not exist" marker) at `rel` under designRoot. */
function saveSnapshot(ctx, rel, cur) {
  const abs = join(ctx.designRoot, rel);
  if (cur === null) writeAt(`${abs}.new`, '');
  else writeAt(abs, cur);
}
/** { existed, content } of a saved snapshot, or null when there is none. */
function loadSnapshot(ctx, rel) {
  const abs = join(ctx.designRoot, rel);
  const content = readOr(abs);
  if (content !== null) return { existed: true, content, rel };
  if (existsSync(`${abs}.new`)) return { existed: false, content: null, rel };
  return null;
}

const findingLine = (e) => `error [${e.code}] ${e.where} · ${e.what} · ${e.fix}`;

/**
 * `maude design check` of one designRoot file → { ok, errors } or null (could not run: fail open).
 * The studio's warm validator when it is up, else a local run of the verb.
 */
async function check(ctx, studio, rel, tier, snapshot, self) {
  if (studio) {
    const r = await postStudio(
      studio,
      '/_api/agent/check',
      { path: rel, tier, strict: true, ...(snapshot?.existed ? { snapshot: snapshot.rel } : {}) },
      { timeoutMs: 900 }
    );
    if (r?.status === 200 && r.body && typeof r.body.ok === 'boolean')
      return { ok: r.body.ok, errors: Array.isArray(r.body.errors) ? r.body.errors : [] };
  }
  if (!self) return null;
  const args = [
    join(ctx.designRoot, rel),
    '--strict',
    '--tier',
    tier,
    '--json',
    '--root',
    ctx.root,
  ];
  if (snapshot?.existed) args.push('--against', join(ctx.designRoot, snapshot.rel));
  const p = spawnSync(self[0], [...self.slice(1), 'design', 'check', ...args], {
    encoding: 'utf8',
    timeout: tier === 'stop' ? 20000 : 1200,
    env: { ...process.env, MAUDE_NO_UPDATE_CHECK: '1' },
  });
  try {
    const results = JSON.parse(p.stdout);
    const errors = results.flatMap((x) => x.errors ?? []);
    return { ok: errors.length === 0, errors };
  } catch {
    return null;
  }
}

async function prompt(ctx, input) {
  const studio = await locateStudio(ctx.root, { timeoutMs: LOCATE_MS });
  if (!studio) return null;
  const promptId = hookKey(input.prompt_id);
  // No label: the prompt text stays on this machine (a run label is shown to collaborators).
  await postStudio(
    studio,
    '/_api/agent/run/begin',
    { session: ctx.session, ...(promptId ? { promptId } : {}), actor: 'claude-code' },
    { timeoutMs: 600 }
  );
  return null;
}

async function preEdit(ctx, input) {
  if (!EDIT_TOOLS.has(input.tool_name)) return null;
  const t = targetOf(ctx, input);
  if (!t) return null;
  const ti = input.tool_input ?? {};
  const cur = readOr(t.abs);
  const toolUseId = hookKey(input.tool_use_id);
  // 1. snapshots (no studio needed): this edit's, and the run's first sight of the file
  if (toolUseId) saveSnapshot(ctx, snapRel(ctx, toolUseId), cur);
  const base = baseRel(ctx, t.rel);
  if (!loadSnapshot(ctx, base)) saveSnapshot(ctx, base, cur);
  // 2. the lazy whole-file rewrite
  if (input.tool_name === 'Write' && cur !== null && CANVAS_RE.test(t.rel)) {
    const lines = cur.split('\n').length;
    if (lines > LAZY_WRITE_LINES)
      return deny(
        `whole-file-rewrite: ${t.rel} already exists (${lines} lines). Use Edit on existing canvases — it keeps element ids and locked elements.`
      );
  }
  // 3. the studio's view: busy artboards (A4), read-only sessions
  if (!toolUseId) return null;
  const studio = await locateStudio(ctx.root, { timeoutMs: LOCATE_MS });
  if (!studio) return null;
  const edit =
    input.tool_name === 'Write'
      ? { content: String(ti.content ?? '') }
      : input.tool_name === 'Edit' && typeof ti.old_string === 'string'
        ? {
            old: ti.old_string,
            new: String(ti.new_string ?? ''),
            replaceAll: ti.replace_all === true,
          }
        : undefined;
  const r = await postStudio(
    studio,
    '/_api/agent/edit/check',
    {
      session: ctx.session,
      toolUseId,
      tool: input.tool_name,
      path: t.rel,
      ...(edit ? { edit } : {}),
    },
    { timeoutMs: 600 }
  );
  if (r?.status === 200 && r.body?.decision === 'deny' && typeof r.body.reason === 'string')
    return deny(r.body.reason);
  return null;
}

async function postEdit(ctx, input, self) {
  if (!EDIT_TOOLS.has(input.tool_name)) return null;
  const t = targetOf(ctx, input);
  if (!t) return null;
  const toolUseId = hookKey(input.tool_use_id);
  const snap = toolUseId ? loadSnapshot(ctx, snapRel(ctx, toolUseId)) : null;
  const studio = await locateStudio(ctx.root, { timeoutMs: LOCATE_MS });
  const res = await check(ctx, studio, t.rel, 'fast', snap, self);
  if (res && !res.ok) {
    // roll back ONLY if the file still holds exactly what the tool wrote
    let restored = false;
    if (snap) {
      const wrote = replayEdit(input.tool_name, input.tool_input ?? {}, snap.content);
      if (wrote !== null && readOr(t.abs) === wrote) {
        try {
          if (snap.existed) writeFileSync(t.abs, snap.content);
          else unlinkSync(t.abs);
          restored = true;
        } catch {
          /* leave it */
        }
      }
    }
    return {
      decision: 'block',
      reason: `${res.errors.map(findingLine).join('\n')}\n${
        restored
          ? 'The file was restored to before this edit — make the change again without these problems.'
          : 'The file was left as it is (it changed after this edit) — fix these problems.'
      }`,
    };
  }
  const touchedP = join(ctx.run, 'touched.json');
  const touched = readJson(touchedP, {});
  touched[t.rel] = { at: Date.now(), by: input.agent_type ?? 'main' };
  writeAt(touchedP, JSON.stringify(touched));
  if (studio && toolUseId)
    await postStudio(
      studio,
      '/_api/agent/edit/touched',
      { session: ctx.session, toolUseId, path: t.rel, via: 'tool' },
      { timeoutMs: 300 }
    );
  return null;
}

async function stop(ctx, input, self) {
  const touched = readJson(join(ctx.run, 'touched.json'), {});
  const studio = await locateStudio(ctx.root, { timeoutMs: LOCATE_MS });
  const problems = [];
  for (const rel of Object.keys(touched)) {
    if (!existsSync(join(ctx.designRoot, rel))) continue;
    const res = await check(ctx, studio, rel, 'stop', loadSnapshot(ctx, baseRel(ctx, rel)), self);
    if (res && !res.ok) problems.push(...res.errors.map(findingLine));
  }
  if (problems.length) {
    const sig = sha(problems.join('\n'));
    const lastP = join(ctx.run, 'stop-last.json');
    if (!(input.stop_hook_active === true && readJson(lastP, null)?.sig === sig)) {
      writeAt(lastP, JSON.stringify({ sig, at: Date.now() }));
      return {
        decision: 'block',
        reason: `These files don't pass the check:\n${problems.join('\n')}`,
      };
    }
  }
  // the run ends (with warnings when the same problems are still there)
  if (studio)
    await postStudio(
      studio,
      '/_api/agent/run/end',
      { session: ctx.session, outcome: problems.length ? 'warnings' : 'done' },
      { timeoutMs: 600 }
    );
  rmSync(ctx.run, { recursive: true, force: true });
  return null;
}

/**
 * Run one hook event. `self` = argv prefix that runs this `maude` (for the local check), or null.
 * Returns the stdout text ('' = no decision). Never throws.
 */
export async function runHook({ event, stdinText, self = null }) {
  try {
    if (!HOOK_EVENTS.includes(event)) return '';
    const input = JSON.parse(stdinText || '{}');
    if (!input || typeof input !== 'object') return '';
    const ctx = context(input);
    if (!ctx) return '';
    const fn = { prompt, 'pre-edit': preEdit, 'post-edit': postEdit, stop }[event];
    const out = await fn(ctx, input, self);
    return out ? JSON.stringify(out) : '';
  } catch {
    return '';
  }
}

/** The CLI entry: stdin → runHook → stdout. Always exit 0 (fail-open). */
export async function runHookCli({ words, self }) {
  let stdinText = '';
  try {
    if (!process.stdin.isTTY) stdinText = readFileSync(0, 'utf8');
  } catch {
    /* no stdin */
  }
  const out = await runHook({ event: words[0], stdinText, self });
  if (out) process.stdout.write(out);
  return 0;
}
