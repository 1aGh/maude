// confine-root.mjs — inside an AI session every `maude design` verb works on that session's project
// and no other (gate-b-sec2 finding 1, decision v2-gate-b-sec2-session-root).
//
// The AI chat auto-approves `Bash(maude design <verb>:*)` (actions/verbs.ts autoAllowRules), and the
// helpers take the project from `--root`, else $CLAUDE_PROJECT_DIR, else the cwd. So an injected
// agent could read project B (`read-annotations … --root /B`) and write into A's synced board, or
// plant files in B, without a prompt. The dispatcher (cli/commands/design.mjs) calls
// `rootViolation()` before any verb runs, read-only verbs included, and exits 2 on a hit.
//
// An AI session is what the bridge and the design plugin mark:
//   - MAUDE_AGENT_ACTOR=maude-chat and MAUDE_CHAT_ID (acp/bridge.ts, acp/env.ts chatSpawnEnv);
//   - MAUDE_HOOK_SESSION (the plugin's SessionStart hook writes it to CLAUDE_ENV_FILE, so every
//     Bash command of a terminal Claude Code session carries it).
// The session's project is MAUDE_SESSION_ROOT (the bridge sets it to the chat's project, the
// SessionStart hook exports it next to MAUDE_HOOK_SESSION), else $CLAUDE_PROJECT_DIR, else the
// project of the cwd. Outside an AI session nothing is checked: a person in a terminal may pass
// any root.
//
// Checked, each realpath'd (symlinks followed — a link that resolves to the session project is the
// session project):
//   - `--root <p>` / `--root=<p>`: the project at or above <p> is the session project;
//   - `--design-root <p>`: lands inside the session project (it is resolved against --root);
//   - $CLAUDE_PROJECT_DIR, when set: its project is the session project;
//   - the cwd, when it is inside a project: that project is the session project.
//
// Leaf module: node built-ins + studio-locate.mjs + confine-out.mjs.

import { isAbsolute, relative, resolve, sep } from 'node:path';

import { realpathDeep } from './confine-out.mjs';
import { findProjectRoot } from './studio-locate.mjs';

export const ROOT_FLAGS = ['--root'];
export const DESIGN_ROOT_FLAGS = ['--design-root'];
/** The env a command could set to steer a verb at another project or out of the AI session. */
export const SESSION_ENV_KEYS = [
  'MAUDE_SESSION_ROOT',
  'MAUDE_AGENT_ACTOR',
  'MAUDE_CHAT_ID',
  'MAUDE_HOOK_SESSION',
  'CLAUDE_PROJECT_DIR',
  // V2-8.9 H2 — the chat's read boundary for the verbs that read a given path (confine-read.mjs).
  'MAUDE_READ_ROOTS',
  'MAUDE_GRANTS_FILE',
];

const CHAT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Is this process part of an AI session (the Maude chat, or a Claude Code session with the plugin)? */
export function isAiSession(env = process.env) {
  if (env.MAUDE_AGENT_ACTOR === 'maude-chat') return true;
  if (typeof env.MAUDE_CHAT_ID === 'string' && CHAT_ID_RE.test(env.MAUDE_CHAT_ID)) return true;
  return typeof env.MAUDE_HOOK_SESSION === 'string' && env.MAUDE_HOOK_SESSION.length > 0;
}

/** The session's project root (not realpath'd), or null when none can be named. */
export function sessionRoot(env = process.env, cwd = process.cwd()) {
  // a named folder counts only when it is (inside) a Maude project: Claude Code started in ~/git
  // names no project, and the cwd's project is then the session's
  for (const named of [env.MAUDE_SESSION_ROOT, env.CLAUDE_PROJECT_DIR]) {
    if (typeof named !== 'string' || !isAbsolute(named)) continue;
    const p = findProjectRoot(named);
    if (p) return p;
  }
  return findProjectRoot(cwd);
}

function inside(child, root) {
  const rel = relative(root, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Every `{ flag, value }` pair of `flags` in `args` (`--flag value` and `--flag=value`). */
export function flagValues(args, flags) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === '--') break;
    for (const f of flags) {
      if (a === f && i + 1 < args.length) out.push({ flag: f, value: String(args[i + 1]) });
      else if (a.startsWith(`${f}=`)) out.push({ flag: f, value: a.slice(f.length + 1) });
    }
  }
  return out;
}

/** The project a path names (the nearest `.design/config.json` at or above it), realpath'd. */
const projectOf = (p) => {
  const real = realpathDeep(p);
  const found = findProjectRoot(real);
  return found ? realpathDeep(found) : real;
};

/**
 * The first way `args` (and the env) reach a project other than the session's, or null. Null
 * outside an AI session.
 * @returns {{ what: string, value: string, project: string } | null}
 */
export function rootViolation(args, { env = process.env, cwd = process.cwd() } = {}) {
  if (!isAiSession(env)) return null;
  const session = sessionRoot(env, cwd);
  if (!session) {
    // an AI session with no project to name: any explicit root is a guess we refuse
    const first = flagValues(args, ROOT_FLAGS)[0];
    return first ? { what: first.flag, value: first.value, project: null } : null;
  }
  const real = realpathDeep(session);
  const roots = flagValues(args, ROOT_FLAGS);
  for (const r of roots) {
    if (!r.value) return { what: r.flag, value: r.value, project: real };
    if (projectOf(resolve(cwd, r.value)) !== real)
      return { what: r.flag, value: r.value, project: real };
  }
  const base = roots.length ? resolve(cwd, roots[roots.length - 1].value) : real;
  for (const d of flagValues(args, DESIGN_ROOT_FLAGS)) {
    if (!inside(realpathDeep(resolve(base, d.value)), real))
      return { what: d.flag, value: d.value, project: real };
  }
  const dir = env.CLAUDE_PROJECT_DIR;
  // (a CLAUDE_PROJECT_DIR in no project — Claude Code started in ~/git — names none: the helpers
  // then find no project there either)
  if (
    typeof dir === 'string' &&
    dir &&
    findProjectRoot(resolve(cwd, dir)) &&
    projectOf(resolve(cwd, dir)) !== real
  )
    return { what: 'CLAUDE_PROJECT_DIR', value: dir, project: real };
  const here = findProjectRoot(cwd);
  if (!roots.length && here && realpathDeep(here) !== real)
    return { what: 'the current folder', value: cwd, project: real };
  return null;
}

/** The plain-words refusal the dispatcher prints (exit 2). */
export function rootViolationMessage(verb, v) {
  const where = v.project ? ` (${v.project})` : '';
  return (
    `maude design ${verb}: ${v.what} ${JSON.stringify(v.value)} points at a different project. ` +
    `In an AI session a maude verb works only on this session's project${where}. ` +
    'To work on another project, open it in Maude or run the command yourself in a terminal.\n'
  );
}
