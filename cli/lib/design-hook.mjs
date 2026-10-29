// design-hook.mjs — `maude design hook <event>`, the design plugin's hooks (contract V2-1.11 §5.4;
// lifted from apps/studio/test/agent-evals/harness/hook.mjs, the prototype V2-1.18 measured).
//
//   prompt      UserPromptSubmit  POST /_api/agent/run/begin; names the run folder once per session
//                                                                                 → additionalContext or nothing
//   pre-edit    PreToolUse        snapshot · whole-file-rewrite · POST edit/check   → deny or nothing
//                                 (a sub-agent: its hand-off `owns`, outside .design/ too; S12.7)
//   post-edit   PostToolUse       check (studio, else local) · rollback · touched · `ds` warnings
//                                 (ds-check --hook, S12.4/D9)  → block, or additionalContext, or nothing
//   pre-bash    PreToolUse Bash   use-trash · use-verb · not-a-writer · human-only · out-of-project (bash-guard)
//                                 · an untrusted-content reader has no shell (S12.7)
//                                                                                     → deny or nothing
//   post-bash   PostToolUse Bash  what a write verb / any not-provably-read call wrote → touched → nothing
//   stop        Stop              stop-tier check of the run's files · run/end      → block or nothing
//               SubagentStop      (same command) hand-off result + the files it owns → block or nothing
//   subagent-start SubagentStart  records agent_id → {type, at, handoffs}           → nothing
//   session-start SessionStart    exports MAUDE_HOOK_SESSION to Bash (CLAUDE_ENV_FILE); §5.6
//                                 handshake: warns when the plugin's manifest is older than
//                                 the app's; names the active canvas      → additionalContext or nothing
//
// DENY-ONLY and FAIL-OPEN: never `ask`, never `allow`; bad stdin, no project, a path outside
// designRoot, any internal error → exit 0 with no output. Without a studio (no `_server.json`,
// refused, timeout, non-2xx) the studio parts are skipped; snapshot, check and rollback still run.
//
// State per Claude Code session in <designRoot>/_runs/<session>/ (runtime, DDR-115):
//   snap/<tool_use_id>       bytes before that edit (`.new` marker: the file did not exist)
//   base/<sha(path)>         bytes before the run first touched the file (stop-tier `against`);
//                            `.bash`: an AI shell call wrote it first — no base, Stop checks it whole
// Only the hooks write base/, snap/, bash/, touched.json and stop-last* — main agent included (D1).
//   touched.json             files this run changed ({at, by, via, artboards}: artboards the
//                            studio mapped the edits to; null = unknown → any capture of the canvas)
//   shots.jsonl              captures `maude design screenshot` made under this session (Stop's
//                            screenshot gate; <designRoot>/_runs/shots.jsonl when no session is known)
//   bash/<tool_use_id>.json  a write verb's start ({at, snaps}) — post-bash binds what changed since;
//                            a call that leaves a process running ({bg, by, seen}) keeps it until
//                            the run ends, and every Stop binds what changed since `seen`
//   stop-last.json           the last Stop block (so a re-stop with the same list lets it end)
//   agents.json              sub-agent starts: agent_id → {type, at, handoffs: [{rel, sha}]}
//                            (SubagentStart records each hand-off with its content hash; the
//                            agent is held to THAT copy — gone or changed → its writes are denied)
//   handoff/*.in.json        maude.agent-handoff/1 role "in", written by the main agent before a
//                            spawn: a sub-agent of that type writes ONLY its `owns` (V2-1.18)
// A sub-agent never writes the run folder's control files (agents.json, *.in.json, the hooks'
// snapshots): under _runs/ it writes only its hand-off `output` and what it `owns`. Nobody — the
// main agent included — writes the local harnesses (_draw/*.proof.tsx, _photo/*.bgremove.tsx):
// their verbs generate them from their own process.
// and <designRoot>/_runs/sessions/<session>.json marks a session whose run folder was named.
//
// Leaf module: node built-ins + studio-locate.mjs + bash-guard.mjs + finding-text.mjs.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  bashBackgrounds,
  bashMayWrite,
  classifyBash,
  designVerbOf,
  designWritesSince,
  maudeWords,
  parseBash,
} from './bash-guard.mjs';
import { realpathDeep } from './confine-out.mjs';
import { sessionRoot } from './confine-root.mjs';
import { cleanFinding, cleanText, fileText, findingLine } from './finding-text.mjs';
import { DESIGN_REL, findProjectRoot, locateStudio, postStudio } from './studio-locate.mjs';

export const HOOK_EVENTS = [
  'prompt',
  'pre-edit',
  'post-edit',
  'pre-bash',
  'post-bash',
  'stop',
  'subagent-start',
  'session-start',
];
const KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CANVAS_RE = /\.(?:tsx|jsx)$/;
const BOARD_RE = /\.annotations\.json$/;
/** V2-1.11 §9 Q5: a Write over an existing canvas longer than this is a lazy rewrite. */
export const LAZY_WRITE_LINES = 40;
const LOCATE_MS = 300;
/** A bash snapshot is skipped above this (no exact artboard map for it — fail-open). */
const SNAP_MAX_BYTES = 4 * 1024 * 1024;

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

// ── hand-offs (maude.agent-handoff/1, V2-1.18 §5.2) ──────────────────────────────────────────
// A structural check of the shape until cli/lib/handoff.mjs (p2-ai-paths-4b, the JSON Schema)
// lands; validateHandoff / ownsPath keep that module's signatures so the swap is an import.

export const HANDOFF_CONTRACT = 'maude.agent-handoff/1';
const REL_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\\]{1,512}$/;
const OUT_STATUS = ['done', 'partial', 'blocked', 'refused'];
const CHANGE_KINDS = ['new-file', 'edit', 'proposal', 'draft', 'brief', 'report'];
const SEVERITIES = ['blocker', 'warning', 'info'];
const IN_KEYS = [
  'contract',
  'role',
  'runId',
  'agent',
  'n',
  'task',
  'scope',
  'owns',
  'reads',
  'context',
  'checks',
  'budget',
  'output',
];
const OUT_KEYS = [
  'contract',
  'role',
  'runId',
  'agent',
  'n',
  'status',
  'summary',
  'changed',
  'evidence',
  'decisions',
  'findings',
  'open_questions',
  'result',
  'next',
];
const bareAgent = (a) => String(a ?? '').replace(/^.*:/, '');

/** `{ ok, role, errors: [{where, what, fix}] }` — never throws, ≤ 20 errors. */
export function validateHandoff(doc, { role } = {}) {
  const errors = [];
  const err = (where, what, fix) => errors.length < 20 && errors.push({ where, what, fix });
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    err('$', 'is not a JSON object', `Write a ${HANDOFF_CONTRACT} object.`);
    return { ok: false, role: null, errors };
  }
  const r = doc.role === 'in' || doc.role === 'out' ? doc.role : null;
  if (doc.contract !== HANDOFF_CONTRACT)
    err('contract', `is not "${HANDOFF_CONTRACT}"`, `Set "contract": "${HANDOFF_CONTRACT}".`);
  if (!r) err('role', 'is not "in" or "out"', 'Set "role".');
  if (role && r && r !== role)
    err('role', `is "${r}", this file must be "${role}"`, `Set "role": "${role}".`);
  const str = (k, max, req = true) => {
    if (doc[k] === undefined) return req && err(k, 'is missing', `Add "${k}".`);
    if (typeof doc[k] !== 'string' || !doc[k] || doc[k].length > max)
      err(k, `is not a string of 1–${max} chars`, `Fix "${k}".`);
  };
  const arr = (k, req = true) => {
    if (doc[k] === undefined) return req && err(k, 'is missing', `Add "${k}" (an array).`);
    if (!Array.isArray(doc[k])) err(k, 'is not an array', `Make "${k}" an array.`);
  };
  str('agent', 200);
  if (
    (r === 'in' || doc.runId !== undefined) &&
    (typeof doc.runId !== 'string' || !/^r_[A-Za-z0-9_-]{4,64}$/.test(doc.runId))
  )
    err('runId', 'is not r_<4–64 id chars>', 'Use the run id from the run folder line.');
  if (r === 'in') {
    str('task', 4000);
    if (
      !Array.isArray(doc.owns) ||
      !doc.owns.length ||
      !doc.owns.every((g) => typeof g === 'string' && REL_PATH_RE.test(g))
    )
      err(
        'owns',
        'is not a non-empty array of repo-relative paths',
        'List the paths this agent may write.'
      );
    else if (!doc.owns.every(globFits))
      err(
        'owns',
        `has a glob over ${GLOB_MAX_CHARS} chars or with more than ${GLOB_MAX_WILDCARDS} wildcards`,
        'Name the paths more plainly.'
      );
    if (typeof doc.output !== 'string' || !REL_PATH_RE.test(doc.output))
      err('output', 'is not a repo-relative path', 'Name where the agent writes its result.');
  }
  if (r === 'out') {
    if (!OUT_STATUS.includes(doc.status))
      err('status', `is not one of ${OUT_STATUS.join(' | ')}`, 'Set "status".');
    str('summary', 2000);
    arr('changed');
    if (Array.isArray(doc.changed))
      doc.changed.forEach((c, i) => {
        if (
          !c ||
          typeof c.file !== 'string' ||
          !REL_PATH_RE.test(c.file) ||
          !CHANGE_KINDS.includes(c.kind)
        )
          err(
            `changed[${i}]`,
            `needs a repo-relative "file" and "kind" ${CHANGE_KINDS.join(' | ')}`,
            'Fix the entry.'
          );
      });
    arr('decisions');
    arr('findings');
    if (Array.isArray(doc.findings))
      doc.findings.forEach((f, i) => {
        if (!f || !SEVERITIES.includes(f.severity) || typeof f.what !== 'string')
          err(
            `findings[${i}]`,
            `needs "severity" (${SEVERITIES.join(' | ')}) and "what"`,
            'Fix the entry.'
          );
      });
    arr('open_questions');
    if (Array.isArray(doc.open_questions) && doc.open_questions.length > 20)
      err('open_questions', 'has more than 20 entries', 'Keep the 20 that matter.');
    if (doc.result !== undefined && JSON.stringify(doc.result).length > 64 * 1024)
      err('result', 'is over 64 KB', 'Put the bulk in a file and name it.');
  }
  if (r) {
    const known = r === 'in' ? IN_KEYS : OUT_KEYS;
    for (const k of Object.keys(doc))
      if (!known.includes(k)) err(k, 'is not a field of this role', `Remove "${k}".`);
  }
  return { ok: errors.length === 0, role: r, errors };
}

/** An `owns` glob the hook will match: short, few wildcards (the main agent writes them). */
const GLOB_MAX_CHARS = 256;
const GLOB_MAX_WILDCARDS = 8;
const GLOB_TOKEN = /(\*\*\/|\*\*|\*|\?)/;
const globFits = (g) =>
  typeof g === 'string' &&
  g.length <= GLOB_MAX_CHARS &&
  (g.match(/\*\*\/|\*\*|\*|\?/g) ?? []).length <= GLOB_MAX_WILDCARDS;

/**
 * `path` against `glob` (`*` one segment, `**` across, `**` + `/` zero or more segments, `?` one
 * char) as a set-of-states walk: O(path × glob), never a backtracking RegExp over agent text.
 */
export function globMatch(glob, path) {
  const S = 1;
  const DS = 2;
  const DSS = 3;
  const Q = 4;
  const toks = [];
  for (const part of glob.split(GLOB_TOKEN))
    if (part === '**/') toks.push(DSS);
    else if (part === '**') toks.push(DS);
    else if (part === '*') toks.push(S);
    else if (part === '?') toks.push(Q);
    else for (const ch of part) toks.push(ch);
  const T = toks.length; // the accept state; T + 1 + i = "inside the `**` + `/` at i"
  const close = (set, i) => {
    if (i >= T) {
      set.add(T);
      return;
    }
    if (set.has(i)) return;
    set.add(i);
    if (toks[i] === S || toks[i] === DS) close(set, i + 1);
    else if (toks[i] === DSS) {
      set.add(T + 1 + i);
      close(set, i + 1);
    }
  };
  let cur = new Set();
  close(cur, 0);
  for (const c of path) {
    const next = new Set();
    for (const st of cur) {
      if (st === T) continue;
      if (st > T) {
        next.add(st);
        if (c === '/') close(next, st - T);
        continue;
      }
      const k = toks[st];
      if (k === S) {
        if (c !== '/') close(next, st);
      } else if (k === DS) close(next, st);
      else if (k === Q) {
        if (c !== '/') close(next, st + 1);
      } else if (k === c) close(next, st + 1);
    }
    if (!next.size) return false;
    cur = next;
  }
  return cur.has(T);
}
/** Does the hand-off's `owns` cover `repoRel` (POSIX, repo-relative)? `*` one segment, `**` across. */
export function ownsPath(doc, repoRel) {
  return (
    Array.isArray(doc?.owns) && doc.owns.some((g) => globFits(g) && globMatch(g, String(repoRel)))
  );
}

/**
 * The run's role-"in" hand-offs for a sub-agent of `agentType` (bare names compared): `{ hs,
 * invalid }`. A file that names this agent but is not a valid hand-off is `invalid` (its rel) --
 * the fence fails closed on it (gate-b-sec2 finding 3b) instead of skipping it, which left the
 * agent with no fence at all.
 */
function handoffScan(ctx, agentType) {
  const dir = join(ctx.run, 'handoff');
  let names = [];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.in.json'));
  } catch {
    return { hs: [], invalid: [] };
  }
  const want = bareAgent(agentType);
  const hs = [];
  const invalid = [];
  for (const f of names.sort()) {
    const rel = `_runs/${ctx.session}/handoff/${f}`;
    const text = readOr(join(dir, f));
    const doc = parseOr(text);
    // a file named for this agent (`<agent>-<n>.in.json`) or one whose `agent` is this agent
    const named = f.replace(/-[^-]*\.in\.json$/, '') === want;
    if (doc?.role !== 'in' || bareAgent(doc.agent) !== want) {
      if (named) invalid.push(rel);
      continue;
    }
    if (!validateHandoff(doc, { role: 'in' }).ok) {
      invalid.push(rel);
      continue;
    }
    hs.push({ rel, doc, text });
  }
  return { hs, invalid };
}

/**
 * gate-b-sec2 finding 3 (decision v2-gate-b-sec2-bounded-writer-verbs). The bounded writers are
 * spawned on a hand-off (V2-1.18 §5.5): without a valid one they write nothing. Each one — and the
 * S8.10 Handoff to production run — runs only the `maude` verbs its own body names; any other maude
 * verb (and every non-`design` maude command) is denied. An entry is a verb (`check`: any sub-verb)
 * or a verb + sub-verb (`ds convert`). Derived from each agent's body (`plugins/design/agents/*`);
 * hooks.test.mjs holds every `maude design ...` an agent body names to its list.
 */
export const HANDOFF_REQUIRED = new Set([
  'ds-migrator',
  'draw-agent',
  'footage-director',
  'reconstruct-agent',
]);
export const AGENT_VERBS = {
  'ds-migrator': ['ds convert', 'ds status', 'ds check-system', 'check', 'screenshot'],
  'draw-agent': ['check', 'draw-build', 'draw-proof', 'svg-optimize', 'server-up'],
  'footage-director': ['check'],
  // no shell at all (frontmatter, and UNTRUSTED_READERS for the readers): no maude verb either
  'reconstruct-agent': [],
  'asset-describer': [],
  'media-generation-director': [],
};
/** S8.10 — a Handoff to production run (MAUDE_CHAT_ID `handoff-<id>`, handoff/write-scopes.ts). */
export const HANDOFF_CHAT_RE = /^handoff-[a-z0-9]{6,40}$/;
/** Mirrors apps/studio/handoff/write-scopes.ts HANDOFF_RUN_VERBS (a studio test pins the two). */
export const HANDOFF_RUN_VERBS = ['handoff', 'to-lottie', 'bootstrap-check', 'check'];

const parseOr = (text) => {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
};
const isSubagent = (input) => Boolean(input.agent_id || input.agent_type);

/**
 * S12.7 — the agents that read untrusted content (a source image, a clip's frames, an asset;
 * DDR-174 Decision 1, DDR-183 F2). Their frontmatter already has no Bash/Web*; the hooks hold
 * them to it at run time as well (an override, a widened copy): no Bash at all, and no write
 * outside the design root — the DDR-174 Addendum gap (`.claude/settings.json`, a CLAUDE.md, a
 * shell rc) that a tool list alone cannot close. `plugin-name-namespace.test.mjs` keeps this set
 * equal to the agents it selects as readers.
 */
export const UNTRUSTED_READERS = new Set([
  'footage-analyst',
  'reconstruct-agent',
  'reconstruct-critic',
  'asset-describer',
]);
const isUntrustedReader = (input) =>
  isSubagent(input) && UNTRUSTED_READERS.has(bareAgent(input.agent_type));

/**
 * A sub-agent's write OUTSIDE the design root (`d` = null): an untrusted-content reader never
 * makes one; an agent held to a hand-off makes one only into a path its `owns` names (repo-
 * relative, so nothing outside the project ever qualifies). Anything else is not ours to judge.
 */
function outsideGuard(ctx, input, fenceOf) {
  if (!isSubagent(input)) return null;
  const p = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof p !== 'string' || !p || p.includes('\0')) return null;
  const abs = realpathDeep(isAbsolute(p) ? p : `${ctx.cwd}${sep}${p}`);
  const rel = relative(realpathDeep(ctx.root), abs);
  const inRepo = rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  const repoRel = inRepo ? rel.split(sep).join('/') : null;
  const shown = repoRel ? shownPath(repoRel) : fileText(abs, 200);
  if (isUntrustedReader(input))
    return `out-of-scope: ${input.agent_type} reads untrusted content (DDR-174/DDR-183) — it writes nothing outside ${DESIGN_REL}/, and ${shown} is outside it. Write only the files your inputs name.`;
  const f = fenceOf();
  if (f.error) return fenceReason(input, f.error);
  if (!f.hs.length || (repoRel && f.hs.some((h) => ownsPath(h.doc, repoRel)))) return null;
  return `out-of-scope: ${input.agent_type ?? 'this agent'} writes only what its hand-off owns — ${shown} is not in it. Put the change in your hand-off result and let the main agent apply it.`;
}

/**
 * The fence a sub-agent is held to: `{ hs: [{rel, doc}], error }`. The hand-offs SubagentStart
 * recorded (path + content hash), re-read and re-hashed — one gone or changed is an `error` and
 * every write the agent makes is denied (fail closed). No record (SubagentStart did not run: an
 * older plugin, a lost write race) → the directory as it is now, the pre-record behaviour.
 */
function agentFence(ctx, input) {
  const f = agentFenceOf(ctx, input);
  if (f.error) return f;
  // gate-b-sec2 3b: a bounded writer with no valid hand-off writes nothing (fail closed)
  if (!f.hs.length && HANDOFF_REQUIRED.has(bareAgent(input.agent_type)))
    return { hs: [], error: 'it was spawned without a valid hand-off' };
  return f;
}
function agentFenceOf(ctx, input) {
  const id = hookKey(input.agent_id);
  const rec = id ? readJson(join(ctx.run, 'agents.json'), {})?.[id] : null;
  const invalidError = (rels) =>
    `${DESIGN_REL}/${rels[0]}, a hand-off for it, is not a valid hand-off`;
  if (!rec || typeof rec !== 'object') {
    const { hs, invalid } = handoffScan(ctx, input.agent_type);
    return invalid.length ? { hs: [], error: invalidError(invalid) } : { hs, error: null };
  }
  if (!Array.isArray(rec.handoffs)) return { hs: [], error: 'its spawn record lists no hand-offs' };
  if (Array.isArray(rec.invalid) && rec.invalid.length)
    return { hs: [], error: invalidError(rec.invalid.map(String)) };
  const hs = [];
  for (const h of rec.handoffs) {
    const rel = typeof h?.rel === 'string' ? h.rel : '';
    const m = /^_runs\/([^/]+)\/handoff\/[^/]+\.in\.json$/.exec(rel);
    if (!m || m[1] !== ctx.session || typeof h.sha !== 'string')
      return { hs: [], error: 'its spawn record is not one the hooks wrote' };
    const text = readOr(join(ctx.designRoot, rel));
    if (text === null)
      return { hs: [], error: `${DESIGN_REL}/${rel}, the hand-off it was spawned with, is gone` };
    if (sha(text) !== h.sha)
      return { hs: [], error: `${DESIGN_REL}/${rel} changed after it was spawned` };
    const doc = parseOr(text);
    if (!validateHandoff(doc, { role: 'in' }).ok)
      return { hs: [], error: `${DESIGN_REL}/${rel} is no longer a valid hand-off` };
    hs.push({ rel, doc });
  }
  return { hs, error: null };
}

const fenceReason = (input, error) =>
  `out-of-scope: ${input.agent_type ?? 'this agent'} can't write — ${error}. Stop here and report it in your hand-off result; the main agent re-spawns you with a new hand-off.`;

/** The local harnesses Maude's own verbs generate (V2-2.8 isLocalHarness): never an AI write. */
const HARNESS_RE = /^_(?:draw\/[^/]+\.proof|photo\/[^/]+\.bgremove)\.tsx$/;
/** Run-folder files (and the dirs that hold them) only the hooks and the main agent write. */
const RUN_CONTROL_RE =
  /^_runs(?:\/[^/]+)?(?:\/handoff)?\/?$|^_runs\/(?:[^/]+\/)*(?:agents\.json[^/]*|handoff\/[^/]+\.in\.json)$/;
/** The hooks' own state under a run folder — nobody else writes it (D1). */
const HOOK_STATE_RE =
  /^_runs(?:\/[^/]+)?\/?$|^_runs\/[^/]+\/(?:(?:base|snap|bash)(?:\/.*)?|touched\.json|stop-last[^/]*)$/;

/**
 * The guard for a runtime (`_*`) design path a tool would write: `{ code, reason }` or null.
 * `fenceOf` is a thunk (agents.json is read only for a sub-agent writing under _runs/).
 */
function runtimeGuard(input, rel, fenceOf) {
  // Names compared case-insensitively (F2): on a case-insensitive file system `_RUNS/AGENTS.JSON`
  // IS `_runs/agents.json`, and a name not on disk yet keeps the case it was typed in. An allow
  // (`output`, `owns`) stays exact — only the refusals widen.
  const lc = rel.toLowerCase();
  if (HARNESS_RE.test(lc)) {
    const verb = lc.startsWith('_draw/') ? 'draw-proof' : 'photo-bg-remove';
    return {
      code: 'not-a-writer',
      reason: `not-a-writer: ${shownRel(rel)} is a local harness \`maude design ${verb}\` generates — it is never written by hand or by Bash. Run \`maude design ${verb}\` instead.`,
    };
  }
  // p8-secfix-hook D1 — the hooks' own run state (the run base Stop checks against, the snapshots,
  // the bash marks, touched.json, the last Stop block) and the folders that hold it are written by
  // the hooks alone, main agent included: a planted base equal to the bad file made every error
  // "pre-existing" at Stop; an emptied touched.json leaves nothing for Stop to check.
  if (HOOK_STATE_RE.test(lc))
    return {
      code: 'not-a-writer',
      reason: `not-a-writer: ${shownRel(rel)} is the design hooks' own run state (the run base, snapshots, touched files) — only the hooks write it. Edit the design file itself.`,
    };
  if (!isSubagent(input) || !(lc === '_runs' || lc.startsWith('_runs/'))) return null;
  const f = fenceOf();
  if (f.error) return { code: 'out-of-scope', reason: fenceReason(input, f.error) };
  const repoRel = `${DESIGN_REL}/${rel}`;
  if (f.hs.some((h) => h.doc.output === repoRel)) return null;
  if (!RUN_CONTROL_RE.test(lc) && f.hs.some((h) => ownsPath(h.doc, repoRel))) return null;
  const outs = f.hs.map((h) => h.doc.output);
  return {
    code: 'out-of-scope',
    reason: `out-of-scope: ${input.agent_type ?? 'a sub-agent'} never writes ${shownRel(rel)} — the run folder's hand-offs, agents.json and snapshots belong to the main agent and the hooks.${outs.length ? ` Write your result to ${outs.slice(0, 3).map(shownPath).join(' or ')}.` : ''}`,
  };
}

/**
 * S10.3b — a design system's `revisions/*` (content-addressed, immutable) and `revisions/head.json`
 * (the pointer the ⌘Z hook moves) are written only by the DS engine (V2-1.6 §5.15; S10.2's
 * `ds/head.ts` is the sole head.json writer). A hand edit would fork the history the review and
 * every peer read, so the hook refuses it BEFORE the write — anyone, main agent included. The
 * systems are the config's `designSystems[].path` plus the `system/<ds>/` convention
 * (check/index.ts `kindOf` 'ds-managed', which still blocks a write that got past this).
 */
function dsManagedGuard(ctx, rel) {
  const lc = rel.toLowerCase();
  const segs = lc.split('/');
  let hit =
    segs[0] === 'system' &&
    segs.length >= 3 &&
    (segs[2] === 'revisions' || segs[segs.length - 1] === 'head.json');
  if (!hit) {
    const cfg = readJson(join(ctx.designRoot, 'config.json'), {});
    const systems = Array.isArray(cfg?.designSystems) ? cfg.designSystems : [];
    hit = systems.some((s) => {
      if (typeof s?.path !== 'string') return false;
      const root = s.path
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .toLowerCase();
      return !!root && (lc.startsWith(`${root}/revisions/`) || lc === `${root}/head.json`);
    });
  }
  if (!hit) return null;
  return `ds-managed: ${shownRel(rel)} is design-system history Maude keeps — revisions and head.json are never written by hand. Change the system with \`maude design ds\` (pending --set, publish, keep, undo, pick); \`maude design ds status --json\` shows where it stands.`;
}

/** The run id the hand-offs carry: stable per session, no studio needed (V2-1.18 §5.1 shape). */
const runIdOf = (ctx) => `r_${sha(ctx.session).slice(0, 16)}`;
/** A design path as a reason names it: plain when it is plain, else cleaned + quoted (F3). */
const PLAIN_REL_RE = /^[A-Za-z0-9 _./()*-]{1,240}$/;
const shownPath = (r) => (PLAIN_REL_RE.test(r) ? r : fileText(r, 200));
const shownRel = (rel) => shownPath(`${DESIGN_REL}/${rel}`);
/** An artboard id as a reason names it (the studio's AGENT_ID_RE, else cleaned + quoted). */
const shownId = (id) =>
  typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id) ? id : fileText(id);
/** The studio's pre-edit deny reason as it is forwarded: one line, capped (F3 second net). */
export const STUDIO_REASON_MAX = 800;
export const studioReason = (reason) => cleanText(reason, STUDIO_REASON_MAX);

/** semver `a` < `b` (x.y.z, a prerelease before its release). Unparseable → false. */
export function versionOlder(a, b) {
  const parse = (v) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v ?? '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? null] : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  if (x[3] === y[3] || x[3] === null) return false;
  if (y[3] === null) return true;
  return x[3].localeCompare(y[3], 'en', { numeric: true }) < 0;
}

const SAFE_CANVAS_RE = /^[A-Za-z0-9 _./()-]{1,240}\.(?:tsx|jsx)$/;

/**
 * SessionStart: export the hook session to this session's Bash commands (Claude Code's
 * CLAUDE_ENV_FILE), so `maude design screenshot` files its captures under this run. Then the
 * §5.6 handshake: the plugin's bundled actions.manifest.json against the app's — /_health
 * `manifestVersion` when the studio is up, else this CLI's own manifest — and one line when the
 * plugin is the older side. Never blocks.
 */
async function sessionStart(ctx) {
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (envFile && isAbsolute(envFile) && ctx.session !== 'no-session') {
    try {
      // gate-b-sec2: and the project this session is held to (cli/lib/confine-root.mjs)
      const q = `'${ctx.root.replaceAll("'", `'\\''`)}'`;
      appendFileSync(
        envFile,
        `export MAUDE_HOOK_SESSION=${ctx.session}\nexport MAUDE_SESSION_ROOT=${q}\n`
      );
    } catch {
      /* no env file: captures go to _runs/shots.jsonl */
    }
  }
  const lines = [];
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const studio = await locateStudio(ctx.root, { timeoutMs: LOCATE_MS });
  if (pluginRoot && isAbsolute(pluginRoot)) {
    const plugin = {
      mv: readJson(join(pluginRoot, 'actions.manifest.json'), null)?.manifestVersion,
      version: readJson(join(pluginRoot, '.claude-plugin', 'plugin.json'), null)?.version,
    };
    const cli = ctx.pkgRoot
      ? {
          mv: readJson(join(ctx.pkgRoot, 'apps', 'studio', 'actions.manifest.json'), null)
            ?.manifestVersion,
          version: readJson(join(ctx.pkgRoot, 'package.json'), null)?.version,
        }
      : {};
    const h = studio?.health;
    const app =
      typeof h?.manifestVersion === 'string'
        ? {
            mv: h.manifestVersion,
            version: typeof h.version === 'string' ? h.version : cli.version,
          }
        : cli;
    if (
      typeof plugin.mv === 'string' &&
      typeof app.mv === 'string' &&
      plugin.mv !== app.mv &&
      versionOlder(plugin.version, app.version)
    )
      lines.push(
        `The Maude design plugin (${plugin.version}) is older than Maude (${app.version}), so its skills may not know every action. Tell the person to update the plugin: /plugin marketplace update maude, then /reload-plugins.`
      );
  }
  if (studio) {
    const active = readJson(join(ctx.designRoot, '_active.json'), null)?.active;
    const rel = typeof active === 'string' ? active.replace(/^\.design\//, '') : null;
    if (rel && SAFE_CANVAS_RE.test(rel) && !rel.split('/').includes('..'))
      lines.push(`Maude is showing ${rel} (the active canvas).`);
    // V2-8.16 S1 — a terminal session rarely loads the design skill for "put it back", and re-typed
    // the old text by hand (a new change: no restore version, no one-step undo). Told once, here.
    lines.push(
      'Put a canvas back to an earlier version with `maude design history restore <canvas> <ref>` (refs: `history list`), never by re-typing it.'
    );
  }
  if (!lines.length) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lines.join(' ').slice(0, 400),
    },
  };
}

function subagentStart(ctx, input) {
  const id = hookKey(input.agent_id);
  if (!id) return null;
  const p = join(ctx.run, 'agents.json');
  const agents = readJson(p, {});
  agents[id] = {
    type: typeof input.agent_type === 'string' ? input.agent_type : null,
    at: Date.now(),
    ...(() => {
      const { hs, invalid } = handoffScan(ctx, input.agent_type);
      return { handoffs: hs.map((h) => ({ rel: h.rel, sha: sha(h.text) })), invalid };
    })(),
  };
  // tmp + rename: a torn agents.json would read as "no record" for every agent
  const tmp = `${p}.${process.pid}.tmp`;
  writeAt(tmp, JSON.stringify(agents));
  renameSync(tmp, p);
  return null;
}

function context(input, pkgRoot) {
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const root = findProjectRoot(cwd);
  if (!root) return null;
  const designRoot = join(root, DESIGN_REL);
  const session = hookKey(input.session_id) ?? 'no-session';
  return { root, designRoot, session, cwd, pkgRoot, run: join(designRoot, '_runs', session) };
}

/** The generated manifest's verb table (`{verb, effect}` rows), or null when it can't be read. */
function manifestVerbs(ctx) {
  if (!ctx.pkgRoot) return null;
  const m = readJson(join(ctx.pkgRoot, 'apps', 'studio', 'actions.manifest.json'), null);
  return Array.isArray(m?.verbs) ? m.verbs : null;
}

/**
 * The `maude design` verbs in `command` that write (effect other than `none`). An unknown table
 * counts every design verb as a writer: binding finds nothing when nothing changed.
 */
function writeVerbs(ctx, command) {
  if (typeof command !== 'string' || !command.includes('maude')) return [];
  const cmds = parseBash(command);
  if (!cmds) return [];
  const verbs = manifestVerbs(ctx);
  const out = [];
  for (const c of cmds) {
    const v = designVerbOf(c, verbs);
    if (v && v.verb !== 'hook' && v.effect !== 'none') out.push({ ...v, cmd: c });
  }
  return out;
}

/** The design root as the kernel names it (symlinks followed, on-disk case), once per ctx. */
const designReal = (ctx) => {
  ctx.designReal ??= realpathDeep(ctx.designRoot);
  return ctx.designReal;
};

/**
 * The designRoot-relative POSIX path of the tool's target, runtime ones included; null outside.
 * Classified by the file the kernel opens, not by the text (F2): every existing segment
 * realpath'd — symlinks followed, `..` popped after them, the on-disk case on a case-insensitive
 * file system — the missing tail kept as written, relative to the realpath'd design root.
 */
function designTarget(ctx, input) {
  const ti = input.tool_input ?? {};
  const p = ti.file_path ?? ti.notebook_path;
  if (typeof p !== 'string' || !p || p.includes('\0')) return null;
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const abs = realpathDeep(isAbsolute(p) ? p : `${cwd}${sep}${p}`);
  const rel = relative(designReal(ctx), abs);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  const posix = rel.split(sep).join('/');
  const runtime = posix.startsWith('_') || posix.split('/').some((s) => s.startsWith('.'));
  return { abs, rel: posix, runtime };
}
/** The designRoot-relative POSIX path of the tool's target, or null (outside / runtime). */
function targetOf(ctx, input) {
  const t = designTarget(ctx, input);
  return t && !t.runtime ? { abs: t.abs, rel: t.rel } : null;
}

const snapRel = (ctx, toolUseId) => `_runs/${ctx.session}/snap/${toolUseId}`;
const baseRel = (ctx, rel) => `_runs/${ctx.session}/base/${sha(rel).slice(0, 16)}`;

/** Save `cur` (or the "did not exist" marker) at `rel` under designRoot. */
function saveSnapshot(ctx, rel, cur) {
  const abs = join(ctx.designRoot, rel);
  if (cur === null) writeAt(`${abs}.new`, '');
  else writeAt(abs, cur);
}
/**
 * p8-secfix-hook F4 — the run base is the file as it was before the run first wrote it. A shell
 * call the hook can't read (a python heredoc, `nohup … &`) writes without a snapshot, so the next
 * edit's first sight of the file would be AFTER that write and every finding the shell call planted
 * would read as "pre-existing". Such a file gets a `.bash` marker instead of a base: no base is
 * ever saved for it in this run, and Stop checks it with none (every finding counts as the run's).
 */
const shellMarkAbs = (ctx, rel) => join(ctx.designRoot, `${baseRel(ctx, rel)}.bash`);
const shellWrote = (ctx, rel) => existsSync(shellMarkAbs(ctx, rel));

/** Did an AI shell call still in flight (or left running) possibly write `rel` since it began? */
function shellMayHaveWritten(ctx, rel) {
  let mtime;
  try {
    mtime = statSync(join(ctx.designRoot, rel)).mtimeMs;
  } catch {
    return false;
  }
  let names = [];
  try {
    names = readdirSync(join(ctx.run, 'bash'));
  } catch {
    return false;
  }
  return names.some((n) => {
    const m = readJson(join(ctx.run, 'bash', n), null);
    return typeof m?.at === 'number' && mtime >= m.at;
  });
}

/** Save the run's base of `rel` (= `cur`) unless it has one, or a shell call wrote it first. */
function ensureBase(ctx, rel, cur) {
  const base = baseRel(ctx, rel);
  if (loadSnapshot(ctx, base) || shellWrote(ctx, rel)) return;
  if (shellMayHaveWritten(ctx, rel)) writeAt(shellMarkAbs(ctx, rel), '');
  else saveSnapshot(ctx, base, cur);
}

/** A shell call wrote `rel` before the run had a base of it: mark it (see ensureBase). */
function markShellWrite(ctx, rel) {
  if (!loadSnapshot(ctx, baseRel(ctx, rel)) && !shellWrote(ctx, rel))
    writeAt(shellMarkAbs(ctx, rel), '');
}

/** { existed, content } of a saved snapshot, or null when there is none. */
function loadSnapshot(ctx, rel) {
  const abs = join(ctx.designRoot, rel);
  const content = readOr(abs);
  if (content !== null) return { existed: true, content, rel };
  if (existsSync(`${abs}.new`)) return { existed: false, content: null, rel };
  return null;
}

/**
 * `maude design check` of one designRoot file → { ok, errors, existing } or null (could not run:
 * fail open). The studio's warm validator when it is up, else a local run of the verb. Michal
 * 2026-10-29 (kg maude/v2-michal-gate-blocks-only-introduced-findings): `errors` are only the
 * findings this write INTRODUCED against `snapshot` (none = a new file: all of them), `existing`
 * the ones the file already had — those never block. A studio too old to split answers without
 * `existing`: every error then blocks, as before.
 */
async function check(ctx, studio, rel, tier, snapshot, self) {
  if (studio) {
    const r = await postStudio(
      studio,
      '/_api/agent/check',
      {
        path: rel,
        tier,
        strict: true,
        introduced: true,
        ...(snapshot?.existed ? { snapshot: snapshot.rel } : {}),
      },
      { timeoutMs: 900 }
    );
    if (r?.status === 200 && r.body && typeof r.body.ok === 'boolean')
      return {
        ok: r.body.ok,
        errors: Array.isArray(r.body.errors) ? r.body.errors : [],
        existing: Array.isArray(r.body.existing) ? r.body.existing : [],
      };
  }
  if (!self) return null;
  const args = [
    join(ctx.designRoot, rel),
    '--strict',
    '--tier',
    tier,
    '--json',
    '--introduced',
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
    const existing = results.flatMap((x) => (Array.isArray(x.existing) ? x.existing : []));
    return { ok: errors.length === 0, errors, existing };
  } catch {
    return null;
  }
}

/**
 * Who is driving this session: the Maude chat's ACP bridge marks the adapter it spawns with
 * MAUDE_AGENT_ACTOR=maude-chat (the adapter hands its env to `claude`, and `claude` to every hook);
 * anything else is a terminal Claude Code. Attribution only, never a permission.
 */
export const hookActor = (env = process.env) =>
  env.MAUDE_AGENT_ACTOR === 'maude-chat' ? 'maude-chat' : 'claude-code';

/**
 * V2-1.15 §5.4 "Binding the hook run key": the ACP bridge spawns each chat's `claude` with
 * MAUDE_CHAT_ID=<chatId> (acp/env.ts `chatSpawnEnv`); every `/_api/agent/*` call sends it as
 * `chat`, so the hook's run IS that chat's `starting` run — one turn is never two runs. A value
 * that is not a chat id is ignored (the call binds by session alone). Attribution and run
 * binding only, never a permission: the studio's checks are the same either way.
 */
export const hookChat = (env = process.env) => {
  const v = env.MAUDE_CHAT_ID;
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
};
/** The hook key the studio resolves a run by: the session, plus the chat when there is one. */
const runKey = (ctx) => {
  const chat = hookChat();
  return chat ? { session: ctx.session, chat } : { session: ctx.session };
};

async function prompt(ctx, input) {
  // V2-1.18 §5.4: the main agent needs its run folder to write hand-offs — named once a session
  const marker = join(ctx.designRoot, '_runs', 'sessions', `${ctx.session}.json`);
  let out = null;
  if (ctx.session !== 'no-session' && !existsSync(marker)) {
    writeAt(marker, JSON.stringify({ at: Date.now() }));
    out = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `Maude run folder for this conversation: ${DESIGN_REL}/_runs/${ctx.session}/ (run id ${runIdOf(ctx)}; sub-agent hand-offs go in its handoff/).`,
      },
    };
  }
  const studio = await locateStudio(ctx.root, { timeoutMs: LOCATE_MS });
  if (!studio) return out;
  const promptId = hookKey(input.prompt_id);
  // No label: the prompt text stays on this machine (a run label is shown to collaborators).
  await postStudio(
    studio,
    '/_api/agent/run/begin',
    { ...runKey(ctx), ...(promptId ? { promptId } : {}), actor: hookActor() },
    { timeoutMs: 600 }
  );
  return out;
}

/**
 * S12.16 — a new canvas is made by the app's own create (`POST /_api/canvas`), never written by
 * hand: a hand-made one differs from the app's in its name, its `.meta.json` and its scaffold, and
 * its first version is not the AI's. Not canvases: a design system's files (its folder, the
 * `system/` tree), a component (a `newComponentDir`, top level or per system), a `_`-prefixed
 * helper module. Returns the deny reason, or null.
 */
export function handMadeCanvasReason(designRoot, rel) {
  if (!/\.tsx$/i.test(rel)) return null;
  const segs = rel.split('/');
  if (segs[segs.length - 1].startsWith('_') || segs[0] === 'system') return null;
  const cfg = readJson(join(designRoot, 'config.json'), {});
  const dirs = [
    typeof cfg?.newComponentDir === 'string' ? cfg.newComponentDir : 'ui/project/components',
  ];
  for (const s of Array.isArray(cfg?.designSystems) ? cfg.designSystems : []) {
    if (typeof s?.path === 'string') dirs.push(s.path);
    if (typeof s?.newComponentDir === 'string') dirs.push(s.newComponentDir);
  }
  const under = (d) => {
    const dir = String(d).replace(/^\.?\/+|\/+$/g, '');
    return dir !== '' && (rel === dir || rel.startsWith(`${dir}/`));
  };
  if (dirs.some(under)) return null;
  return `new-canvas: ${rel} does not exist yet, and a canvas is never written by hand. Make it with the app's own create — \`maude design curl-local "http://127.0.0.1:<port>/_api/canvas" --method POST --header "Content-Type: application/json" --data '{"kind":"blank","name":"<name>"}'\` (the port is in ${DESIGN_REL}/_server.json; the answer's \`rel\` is the file) — then Edit the file it made. A component goes in the newComponentDir instead.`;
}

async function preEdit(ctx, input) {
  if (!EDIT_TOOLS.has(input.tool_name)) return null;
  const d = designTarget(ctx, input);
  let fence = null;
  const fenceOf = () => {
    fence ??= agentFence(ctx, input);
    return fence;
  };
  if (!d) {
    const outside = outsideGuard(ctx, input, fenceOf);
    return outside ? deny(outside) : null;
  }
  // S10.3b: a design system's managed files (revisions, the review's own state) are written by the
  // DS verbs, never by an editing tool.
  if (!d.runtime) {
    const managed = dsManagedGuard(ctx, d.rel);
    if (managed) return deny(managed);
  }
  if (isSubagent(input) && fenceOf().error) return deny(fenceReason(input, fence.error));
  if (d.runtime) {
    const g = runtimeGuard(input, d.rel, fenceOf);
    return g ? deny(g.reason) : null;
  }
  const t = { abs: d.abs, rel: d.rel };
  // 0. a sub-agent spawned with a hand-off writes only what it `owns` (V2-1.18 §5.4 (a))
  if (isSubagent(input)) {
    const hs = fenceOf().hs;
    const repoRel = `${DESIGN_REL}/${t.rel}`;
    if (hs.length && !hs.some((h) => ownsPath(h.doc, repoRel))) {
      const owns = [...new Set(hs.flatMap((h) => h.doc.owns))]
        .slice(0, 6)
        .map(shownPath)
        .join(', ');
      return deny(
        `out-of-scope: ${input.agent_type ?? 'this agent'} writes only what its hand-off owns (${owns}) — ${shownRel(t.rel)} is not in it. Put the change in your hand-off result and let the main agent apply it.`
      );
    }
  }
  // 0b. a new canvas is made by the create (S12.16) — a sub-agent held to a hand-off that owns
  //     the path (checked above) makes the file it was handed
  if (
    input.tool_name === 'Write' &&
    !existsSync(t.abs) &&
    !(isSubagent(input) && fenceOf().hs.length)
  ) {
    const made = handMadeCanvasReason(ctx.designRoot, t.rel);
    if (made) return deny(made);
  }
  const ti = input.tool_input ?? {};
  const cur = readOr(t.abs);
  const toolUseId = hookKey(input.tool_use_id);
  // 1. snapshots (no studio needed): this edit's, and the run's first sight of the file — never
  //    after an AI shell write it could not snapshot (F4, ensureBase)
  if (toolUseId) saveSnapshot(ctx, snapRel(ctx, toolUseId), cur);
  ensureBase(ctx, t.rel, cur);
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
      ...runKey(ctx),
      toolUseId,
      tool: input.tool_name,
      path: t.rel,
      ...(edit ? { edit } : {}),
    },
    { timeoutMs: 600 }
  );
  if (r?.status === 200 && r.body?.decision === 'deny' && typeof r.body.reason === 'string')
    return deny(studioReason(r.body.reason));
  return null;
}

/** touched.json: the latest touch of `rel`, its artboards unioned (null = unknown, sticky). */
function recordTouch(ctx, rel, { by, via, artboards, at = Date.now() }) {
  const p = join(ctx.run, 'touched.json');
  const touched = readJson(p, {});
  const prev = touched[rel];
  const known = prev && prev.artboards === null ? null : artboards;
  touched[rel] = {
    at: Math.max(at, prev?.at ?? 0),
    by,
    via,
    artboards: known === null ? null : [...new Set([...(prev?.artboards ?? []), ...(known ?? [])])],
  };
  writeAt(p, JSON.stringify(touched));
}

/** Captures of `rel` at or after `since`: this session's shots, plus session-less ones. */
function shotsOf(ctx, rel, since) {
  const out = [];
  for (const p of [join(ctx.run, 'shots.jsonl'), join(ctx.designRoot, '_runs', 'shots.jsonl')]) {
    const text = readOr(p);
    if (!text) continue;
    for (const line of text.split('\n')) {
      try {
        const s = JSON.parse(line);
        if (s?.canvas === rel && typeof s.at === 'number' && s.at >= since) out.push(s);
      } catch {
        /* a torn line */
      }
    }
  }
  return out;
}

const ARTBOARD_ID_RE = /<DCArtboard\b[^>]*?\bid=["']([^"']+)["']/g;

/**
 * §5.4 stop step 2 — touched artboards without a capture newer than their last edit, as
 * `canvas › artboard` (or `canvas` when its artboards are unknown). A removed artboard needs none.
 */
function missingShots(ctx, touched) {
  const missing = [];
  for (const [rel, t] of Object.entries(touched)) {
    if (!CANVAS_RE.test(rel)) continue;
    const src = readOr(join(ctx.designRoot, rel));
    if (src === null) continue;
    const shots = shotsOf(ctx, rel, t.at ?? 0);
    if (shots.some((s) => s.all === true)) continue;
    if (!Array.isArray(t.artboards)) {
      if (!shots.length) missing.push(shownPath(rel));
      continue;
    }
    const exist = new Set([...src.matchAll(ARTBOARD_ID_RE)].map((m) => m[1]));
    for (const id of t.artboards)
      if (exist.has(id) && !shots.some((s) => s.artboard === id))
        missing.push(`${shownPath(rel)} › ${shownId(id)}`);
  }
  return missing;
}

async function postEdit(ctx, input, self) {
  const t0 = performance.now();
  if (!EDIT_TOOLS.has(input.tool_name)) return null;
  const t = targetOf(ctx, input);
  if (!t) return null;
  const toolUseId = hookKey(input.tool_use_id);
  const snap = toolUseId ? loadSnapshot(ctx, snapRel(ctx, toolUseId)) : null;
  const studio = await locateStudio(ctx.root, { timeoutMs: LOCATE_MS });
  const res = await check(ctx, studio, t.rel, 'fast', snap, self);
  const had = alreadyThere(res?.existing, { shell: shellWrote(ctx, t.rel) });
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
      reason: `${res.errors.map((f) => findingLine(f)).join('\n')}\n${
        restored
          ? 'The file was restored to before this edit — make the change again without these problems.'
          : 'The file was left as it is (it changed after this edit) — fix these problems.'
      }${had ? `\n${had.brief}` : ''}`,
    };
  }
  let artboards = null; // unknown without the studio's map
  if (studio && toolUseId) {
    const r = await postStudio(
      studio,
      '/_api/agent/edit/touched',
      { ...runKey(ctx), toolUseId, path: t.rel, via: 'tool' },
      { timeoutMs: 900 }
    );
    if (r?.status === 200 && Array.isArray(r.body?.artboards)) artboards = r.body.artboards;
  }
  recordTouch(ctx, t.rel, { by: input.agent_type ?? 'main', via: 'tool', artboards });
  const notes = [
    had?.full,
    syncedBoardHint(ctx, t.rel),
    dsWarnings(ctx, t.rel, input, self, t0),
  ].filter(Boolean);
  return notes.length
    ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n') } }
    : null;
}

const EXISTING_SHOWN = 5;
/**
 * The errors a file already had before this write, for the agent: `full` (pre-existing only — the
 * edit is kept; additionalContext) and `brief` (beside a block, one line). Null when there are none.
 */
function alreadyThere(existing, { shell = false } = {}) {
  if (!Array.isArray(existing) || !existing.length) return null;
  const n = existing.length;
  if (shell) {
    // F4 — this run wrote the file through the shell before any copy of it was kept: what was
    // there before THIS edit may be the run's own, so it is never called pre-existing
    const lines = existing.slice(0, EXISTING_SHOWN).map((f) => findingLine(f, 'error'));
    if (n > EXISTING_SHOWN) lines.push(`… and ${n - EXISTING_SHOWN} more`);
    const what = n === 1 ? 'This finding is' : `These ${n} findings are`;
    return {
      full: `${what} in the file, which this run changed through the shell. This edit did not add ${n === 1 ? 'it' : 'them'}, so it is kept, but ${n === 1 ? 'it counts' : 'they count'} as this run's: fix ${n === 1 ? 'it' : 'them'} before you finish (Stop checks the file):\n${lines.join('\n')}`,
      brief: `${n === 1 ? 'One more finding is' : `${n} more findings are`} in the file this run changed through the shell; fix ${n === 1 ? 'it' : 'them'} before you finish (${[...new Set(existing.map((f) => cleanFinding(f).code))].join(', ')}).`,
    };
  }
  const lines = existing.slice(0, EXISTING_SHOWN).map((f) => findingLine(f, 'pre-existing'));
  if (n > EXISTING_SHOWN) lines.push(`… and ${n - EXISTING_SHOWN} more`);
  return {
    full: `${n === 1 ? 'This finding was' : `These ${n} findings were`} already in the file before this edit, so they do not block it (fix them only if the task asks for it):\n${lines.join('\n')}`,
    brief: `${n === 1 ? 'One more finding was' : `${n} more findings were`} already in the file before this edit and do not block (${[...new Set(existing.map((f) => cleanFinding(f).code))].join(', ')}).`,
  };
}

/** The files the `ds` checker reads S-rules / system structure from (the old hook's filter). */
const DS_FILE_RE = /(?:\.tsx|\.css|(?:^|\/)components\.json)$/;
/** V2-1.18 §5.3: the `ds` checker's share of the fast tier, and post-edit's whole budget. */
export const DS_CHECK_MS = 400;
export const POST_EDIT_BUDGET_MS = 1500;
const DS_LINES = 16;
const DS_LINE_MAX = 240;

/**
 * S12.4 (D9) — `maude design ds-check --hook` on the file just written: its S-rule / system
 * findings as warnings (additionalContext text), never a decision. Fail-open: no `self`, a crash,
 * a timeout, garbage or a forged decision → only the child's `additionalContext` string is ever
 * read, cleaned per line and capped; anything else → nothing. Bounded by what is left of the
 * post-edit budget (≤ DS_CHECK_MS); skipped when too little is left.
 */
function dsWarnings(ctx, rel, input, self, t0) {
  if (!self || !DS_FILE_RE.test(rel)) return null;
  const left = Math.min(DS_CHECK_MS, POST_EDIT_BUDGET_MS - 150 - (performance.now() - t0));
  if (left < 100) return null;
  try {
    const p = spawnSync(
      self[0],
      [...self.slice(1), 'design', 'ds-check', '--hook', '--root', ctx.root],
      {
        input: JSON.stringify(input),
        encoding: 'utf8',
        timeout: Math.round(left),
        killSignal: 'SIGKILL',
        maxBuffer: 256 * 1024,
        env: { ...process.env, MAUDE_NO_UPDATE_CHECK: '1' },
      }
    );
    if (p.error || p.status !== 0 || !p.stdout) return null;
    const text = JSON.parse(p.stdout)?.hookSpecificOutput?.additionalContext;
    if (typeof text !== 'string' || !text.trim()) return null;
    const lines = text
      .split('\n')
      .map((l) => cleanText(l, DS_LINE_MAX))
      .filter((l) => l.trim());
    return lines.slice(0, DS_LINES).join('\n') || null;
  } catch {
    return null;
  }
}

/** §5.4 post-edit 4: a synced board edited directly gets one hint a run (no studio needed) — its text. */
function syncedBoardHint(ctx, rel) {
  if (!BOARD_RE.test(rel)) return null;
  const cfg = readJson(join(ctx.designRoot, 'config.json'), {});
  if (!cfg?.linkedHub && !existsSync(join(ctx.designRoot, '_sync.json'))) return null;
  const marker = join(ctx.run, 'board-hint');
  if (existsSync(marker)) return null;
  writeAt(marker, '');
  return `${rel} is a board this project syncs with collaborators. For board changes prefer \`maude design annotate <canvas> --ops <ops.json>\`: it applies them as element ops that merge with other people's edits.`;
}

function preBash(ctx, input) {
  if (input.tool_name !== 'Bash') return null;
  if (isUntrustedReader(input))
    return deny(
      `out-of-scope: ${input.agent_type} reads untrusted content (DDR-174/DDR-183) — it has no shell. Do the work with Read (and Write for the files your inputs name); the orchestrator runs every command.`
    );
  const command = input.tool_input?.command;
  let fence = null;
  const fenceOf = () => {
    fence ??= agentFence(ctx, input);
    return fence;
  };
  const verbs = verbFence(ctx, input, command, fenceOf);
  if (verbs) return deny(verbs);
  const verdict = classifyBash(command, {
    cwd: ctx.cwd,
    designRoot: ctx.designRoot,
    root: ctx.root,
    // gate-b-sec2: a maude verb's --root / cwd is held to the session's project, not the cwd's
    sessionRoot: sessionRoot(process.env, ctx.root) ?? ctx.root,
    guard: (rel) => runtimeGuard(input, rel, fenceOf),
  });
  if (verdict) return deny(verdict.reason);
  // a `maude design` write verb: remember when it started, and snapshot the design files it names
  // (post-bash and edit/touched {via:'bash'} bind what changed in this tool call's window)
  const toolUseId = hookKey(input.tool_use_id);
  const writers = toolUseId ? writeVerbs(ctx, command) : [];
  // V2-8.16 S7 — and any other call that is not provably a read (a python heredoc, node -e, awk …):
  // the guard can't read every language, so post-bash binds what changed during the call. No
  // snapshot for those (no named file): the studio maps the change to every artboard it touched.
  if (!writers.length && !(toolUseId && bashMayWrite(command, manifestVerbs(ctx)))) return null;
  const snaps = {};
  for (const w of writers) {
    for (const word of w.cmd.words) {
      if (Object.keys(snaps).length >= 8) break;
      const t = word.literal
        ? targetOf(ctx, { cwd: ctx.cwd, tool_input: { file_path: word.text } })
        : null;
      const rel = t ? t.rel : designRel(ctx, word);
      if (!rel || snaps[rel] || !CANVAS_RE.test(rel)) continue;
      const cur = readOr(join(ctx.designRoot, rel));
      if (cur === null || cur.length > SNAP_MAX_BYTES) continue;
      const name = `${toolUseId}.${sha(rel).slice(0, 16)}`;
      saveSnapshot(ctx, `_runs/${ctx.session}/snap/${name}`, cur);
      ensureBase(ctx, rel, cur);
      snaps[rel] = name;
    }
  }
  // p8-secfix-hook F2 — a call that leaves a process running (`nohup … &`, `run_in_background`)
  // keeps its mark until the turn ends: Stop binds what that process wrote after the call returned
  const bg =
    input.tool_input?.run_in_background === true || bashBackgrounds(command)
      ? { bg: true, by: input.agent_type ?? 'main' }
      : {};
  writeAt(
    join(ctx.run, 'bash', `${toolUseId}.json`),
    JSON.stringify({ at: Date.now(), snaps, ...bg })
  );
  return null;
}

/** Does `words` (after `maude`) run one of `allowed` (`check`, or `ds convert`)? */
function verbAllowed(words, allowed) {
  if (!words[0]?.literal || words[0].text !== 'design' || !words[1]?.literal) return false;
  const verb = words[1].text;
  const sub = words[2]?.literal ? words[2].text : null;
  return allowed.some((a) => {
    const [v, s] = a.split(' ');
    return v === verb && (!s || s === sub);
  });
}

/**
 * gate-b-sec2 finding 3: the maude verbs a bounded writer (AGENT_VERBS) or the S8.10 Handoff to
 * production run (HANDOFF_RUN_VERBS) may run — any other maude command is denied, read-only ones
 * included (a fenced agent reads peer-written content). A sub-agent whose fence failed (no valid
 * hand-off, or one that changed) runs no write-tier verb at all. A command the reader can't
 * follow is denied for them when it names maude: their fence is not fail-open.
 */
function verbFence(ctx, input, command, fenceOf) {
  if (typeof command !== 'string' || !command.includes('maude')) return null;
  const agent = isSubagent(input) ? bareAgent(input.agent_type) : null;
  const allowed =
    agent && Object.hasOwn(AGENT_VERBS, agent)
      ? AGENT_VERBS[agent]
      : HANDOFF_CHAT_RE.test(hookChat() ?? '')
        ? HANDOFF_RUN_VERBS
        : null;
  const who = agent ? `${input.agent_type}` : 'this Handoff to production run';
  const cmds = parseBash(command);
  if (allowed) {
    const list = allowed.length
      ? `only ${allowed.map((a) => `\`maude design ${a}\``).join(', ')}`
      : 'no maude verb';
    const refuse = `out-of-scope: ${who} runs ${list}. Put what else you need in your hand-off result and let the main agent run it.`;
    if (!cmds) return refuse;
    for (const c of cmds) {
      const w = maudeWords(c);
      if (w && !verbAllowed(w, allowed)) return refuse;
    }
  }
  if (!agent) return null;
  const f = fenceOf();
  if (!f.error) return null;
  if (!cmds) return fenceReason(input, f.error);
  return writeVerbs(ctx, command).length ? fenceReason(input, f.error) : null;
}

/** A verb argument written designRoot-relative (`ui/C.tsx`, as the verbs take it) → that rel. */
function designRel(ctx, word) {
  if (!word.literal || !word.text || word.text.startsWith('-')) return null;
  const t = targetOf(ctx, { cwd: ctx.designRoot, tool_input: { file_path: word.text } });
  return t && existsSync(t.abs) ? t.rel : null;
}

async function postBash(ctx, input) {
  if (input.tool_name !== 'Bash') return null;
  const toolUseId = hookKey(input.tool_use_id);
  if (!toolUseId) return null;
  const markP = join(ctx.run, 'bash', `${toolUseId}.json`);
  const mark = readJson(markP, null);
  if (!mark || typeof mark.at !== 'number') return null; // not a write verb
  await bindBashWrites(ctx, toolUseId, mark, input.agent_type ?? 'main', mark.at);
  if (mark.bg) writeAt(markP, JSON.stringify({ ...mark, seen: Date.now() }));
  else rmSync(markP, { force: true });
  return null;
}

/**
 * Bind the design files changed since `since` to the run: touched.json (`via: 'bash'`) and the
 * studio's `edit/touched` for the call's window (from `mark.at`).
 */
async function bindBashWrites(ctx, toolUseId, mark, by, since) {
  const files = designWritesSince(ctx.designRoot, since);
  if (!files.length) return;
  for (const rel of files) {
    let at;
    try {
      at = statSync(join(ctx.designRoot, rel)).mtimeMs;
    } catch {
      /* gone again */
    }
    recordTouch(ctx, rel, { by, via: 'bash', artboards: null, at });
    markShellWrite(ctx, rel); // F4 — no base taken after this write
  }
  const studio = await locateStudio(ctx.root, { timeoutMs: LOCATE_MS });
  if (studio)
    await postStudio(
      studio,
      '/_api/agent/edit/touched',
      { ...runKey(ctx), toolUseId, via: 'bash', since: mark.at },
      { timeoutMs: 900 }
    );
}

/**
 * p8-secfix-hook F2 — at the turn's end (Stop / SubagentStop), what every still-running background
 * call (`bg` mark) wrote since it was last looked at. The marks stay until the run folder goes, so
 * a blocked Stop looks again at the next one.
 */
async function drainBackground(ctx) {
  const dir = join(ctx.run, 'bash');
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    const toolUseId = n.endsWith('.json') ? hookKey(n.slice(0, -5)) : null;
    if (!toolUseId) continue;
    const mark = readJson(join(dir, n), null);
    if (!mark?.bg || typeof mark.at !== 'number') continue;
    const since = typeof mark.seen === 'number' ? mark.seen : mark.at;
    const by = typeof mark.by === 'string' ? mark.by : 'main';
    await bindBashWrites(ctx, toolUseId, mark, by, since);
    writeAt(join(dir, n), JSON.stringify({ ...mark, seen: Date.now() }));
  }
}

/** SubagentStop: the hand-off result, then the stop-tier check of the run's files it owns. */
async function subagentStop(ctx, input, self) {
  const fence = agentFence(ctx, input);
  const hs = fence.hs;
  const id = hookKey(input.agent_id);
  const problems = [];
  if (fence.error) problems.push(`handoff-changed: ${fence.error} — say so in your result.`);
  else if (!hs.length) return null; // spawned without a hand-off: nothing to hold it to
  const started = (id && readJson(join(ctx.run, 'agents.json'), {})[id]?.at) || 0;
  // its result: one of its hand-offs' `output` files, written after it started, valid as "out"
  const outs = hs
    .map((h) => ({ rel: h.doc.output, abs: resolve(ctx.root, h.doc.output) }))
    .filter((o) => !relative(ctx.root, o.abs).startsWith('..'));
  const fresh = outs.filter((o) => {
    try {
      return statSync(o.abs).mtimeMs >= started - 1000;
    } catch {
      return false;
    }
  });
  if (!fresh.length && !fence.error)
    problems.push(
      `handoff-missing: write your result (${HANDOFF_CONTRACT}, role "out") to ${outs.map((o) => o.rel).join(' or ')} before you finish.`
    );
  for (const o of fresh) {
    const v = validateHandoff(readJson(o.abs, null), { role: 'out' });
    for (const e of v.errors)
      problems.push(
        `handoff-invalid ${cleanText(o.rel, 200)} · ${cleanText(e.where, 80)} ${cleanText(e.what, 200)} · ${cleanText(e.fix, 200)}`
      );
  }
  const touched = readJson(join(ctx.run, 'touched.json'), {});
  const studio = await locateStudio(ctx.root, { timeoutMs: LOCATE_MS });
  for (const rel of Object.keys(touched)) {
    if (!hs.some((h) => ownsPath(h.doc, `${DESIGN_REL}/${rel}`))) continue;
    if (!existsSync(join(ctx.designRoot, rel))) continue;
    const res = await check(ctx, studio, rel, 'stop', loadSnapshot(ctx, baseRel(ctx, rel)), self);
    if (res && !res.ok) problems.push(...res.errors.map((f) => findingLine(f)));
  }
  if (!problems.length) return null;
  const sig = sha(problems.join('\n'));
  const lastP = join(ctx.run, `stop-last.${id ?? 'agent'}.json`);
  if (input.stop_hook_active === true && readJson(lastP, null)?.sig === sig) return null; // let it end
  writeAt(lastP, JSON.stringify({ sig, at: Date.now() }));
  return { decision: 'block', reason: `Before you finish:\n${problems.join('\n')}` };
}

async function stop(ctx, input, self) {
  await drainBackground(ctx);
  if (input.hook_event_name === 'SubagentStop') return subagentStop(ctx, input, self);
  const touched = readJson(join(ctx.run, 'touched.json'), {});
  const studio = await locateStudio(ctx.root, { timeoutMs: LOCATE_MS });
  const problems = [];
  for (const rel of Object.keys(touched)) {
    if (!existsSync(join(ctx.designRoot, rel))) continue;
    const res = await check(ctx, studio, rel, 'stop', loadSnapshot(ctx, baseRel(ctx, rel)), self);
    if (res && !res.ok) problems.push(...res.errors.map((f) => findingLine(f)));
  }
  // 2. the screenshot gate — only with a studio: `maude design screenshot` needs one to render
  const missing = studio ? missingShots(ctx, touched) : [];
  if (problems.length || missing.length) {
    const sig = sha(JSON.stringify({ problems, missing }));
    const lastP = join(ctx.run, 'stop-last.json');
    if (!(input.stop_hook_active === true && readJson(lastP, null)?.sig === sig)) {
      writeAt(lastP, JSON.stringify({ sig, at: Date.now() }));
      const parts = [];
      if (problems.length) parts.push(`These files don't pass the check:\n${problems.join('\n')}`);
      if (missing.length)
        parts.push(
          `Screenshot each artboard you changed and look at it before you finish (\`maude design screenshot --canvas "<path>" --screen <artboard id> --out <png>\`, or --full for every artboard). Missing: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ` (+${missing.length - 20})` : ''}`
        );
      return { decision: 'block', reason: parts.join('\n\n') };
    }
  }
  // the run ends (with warnings when the same problems are still there)
  if (studio)
    await postStudio(
      studio,
      '/_api/agent/run/end',
      {
        ...runKey(ctx),
        outcome: problems.length || missing.length ? 'warnings' : 'done',
      },
      { timeoutMs: 600 }
    );
  rmSync(ctx.run, { recursive: true, force: true });
  return null;
}

/**
 * Run one hook event. `self` = argv prefix that runs this `maude` (for the local check), or null.
 * Returns the stdout text ('' = no decision). Never throws.
 */
export async function runHook({ event, stdinText, self = null, pkgRoot = null }) {
  try {
    if (!HOOK_EVENTS.includes(event)) return '';
    const input = JSON.parse(stdinText || '{}');
    if (!input || typeof input !== 'object') return '';
    const ctx = context(input, pkgRoot);
    if (!ctx) return '';
    const fn = {
      prompt,
      'pre-edit': preEdit,
      'post-edit': postEdit,
      'pre-bash': preBash,
      'post-bash': postBash,
      stop,
      'subagent-start': subagentStart,
      'session-start': sessionStart,
    }[event];
    const out = await fn(ctx, input, self);
    return out ? JSON.stringify(out) : '';
  } catch {
    return '';
  }
}

/** The CLI entry: stdin → runHook → stdout. Always exit 0 (fail-open). */
export async function runHookCli({ words, self, pkgRoot = null }) {
  let stdinText = '';
  try {
    if (!process.stdin.isTTY) stdinText = readFileSync(0, 'utf8');
  } catch {
    /* no stdin */
  }
  const out = await runHook({ event: words[0], stdinText, self, pkgRoot });
  if (out) process.stdout.write(out);
  return 0;
}
