// confine-read.mjs — in the Maude AI chat, a `maude design` verb that reads a file the caller names
// reads only inside the chat's read boundary (V2-8.9 re-check H2, decision
// maude/v2-p8-verb-sources-inside-read-roots).
//
// The M2 read boundary held Claude Code's Read / Glob / Grep, but the auto-tier import verbs read
// whatever path they were given: `ingest-footage <any dir> --recursive` copied media into assets/
// and printed the source listing, `import-asset` copied any image/PDF, `import-tokens` any JSON/CSS,
// `svg-optimize` printed any SVG — and the copies synced to the hub. Claude Code's read rules never
// see a subprocess's reads, so the dispatcher checks the verb's arguments before it runs.
//
// The roots come from the bridge, per chat (acp/bridge.ts):
//   - MAUDE_READ_ROOTS — the fixed boundary (project, design root, bundled plugins, Maude's package,
//     this chat's scratch), `path.delimiter`-joined;
//   - MAUDE_GRANTS_FILE + MAUDE_CHAT_ID — the app-owned consent store (ai/attach-grants.ts), read
//     live so a folder attached mid-chat counts at once and Remove takes it back.
// Env is the agent's to change only through its own command line, which the bash guard refuses for
// these keys (SESSION_ENV_KEYS, R2-L1). In a Maude chat with no MAUDE_READ_ROOTS, the verbs refuse
// (fail closed). Outside the Maude chat nothing is checked: in a terminal, Claude Code asks for each
// command and a person may name any file.
//
// What is checked: every argument that is not a flag, and every `--flag=value` value — except the
// output flags (confine-out.mjs owns them) and --root / --design-root (confine-root.mjs). Each is
// spelled as a shell would open it (`~`, `~/x`; relative to the cwd) and resolved as the kernel walks
// it (realpathDeep). A word that is not a path at all (`--bpm 120`'s 120) resolves inside the cwd's
// project and passes.
//
// Leaf module: node built-ins + confine-out.mjs + confine-root.mjs.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, relative, sep } from 'node:path';

import { OUTPUT_FLAGS, realpathDeep } from './confine-out.mjs';
import { DESIGN_ROOT_FLAGS, ROOT_FLAGS } from './confine-root.mjs';

/** The verbs that read a file or folder the caller names. */
export const SOURCE_VERBS = new Set([
  'import-asset',
  'import-tokens',
  'ingest-footage',
  'svg-optimize',
  'check',
  'beats',
  'smart-frames',
  'transcribe-local',
  'probe-footage',
  'photo-adjust',
]);

const CHAT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The Maude AI chat (the bridge's markers) — not a terminal Claude Code session. */
export function isMaudeChat(env = process.env) {
  return (
    env.MAUDE_AGENT_ACTOR === 'maude-chat' ||
    (typeof env.MAUDE_CHAT_ID === 'string' && CHAT_ID_RE.test(env.MAUDE_CHAT_ID))
  );
}

/** This chat's consented folders from the app-owned store: granted, attached, still the same. */
export function chatGrantRoots(env = process.env) {
  const file = env.MAUDE_GRANTS_FILE;
  const chat = env.MAUDE_CHAT_ID;
  if (!file || !isAbsolute(file) || !chat || !CHAT_ID_RE.test(chat)) return [];
  try {
    const g = JSON.parse(readFileSync(file, 'utf8'));
    const granted = new Set(
      (Array.isArray(g?.folders) ? g.folders : [])
        .map((f) => f?.root)
        .filter((r) => typeof r === 'string')
    );
    const attached = Array.isArray(g?.chats?.[chat]) ? g.chats[chat] : [];
    return attached.filter((r) => {
      if (typeof r !== 'string' || !isAbsolute(r) || !granted.has(r)) return false;
      try {
        return realpathSync.native(r) === r && statSync(r).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

const inside = (child, root) => {
  const rel = relative(root, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/** The words of `args` (after the verb) that name a source: see the header. */
export function sourceWords(args) {
  const skipValue = new Set([...OUTPUT_FLAGS, ...ROOT_FLAGS, ...DESIGN_ROOT_FLAGS]);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === '--') {
      out.push(...args.slice(i + 1).map(String));
      break;
    }
    if (a.startsWith('-')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        if (!skipValue.has(a.slice(0, eq))) out.push(a.slice(eq + 1));
      } else if (skipValue.has(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * The first source word of `args` outside this chat's read roots, or null. Null outside the Maude
 * chat and for a verb that reads nothing it is given.
 * @returns {{ value: string, resolved: string | null, why: 'outside' | 'no-roots' } | null}
 */
export function readViolation(
  verb,
  args,
  { env = process.env, cwd = process.cwd(), home = homedir() } = {}
) {
  if (!SOURCE_VERBS.has(verb) || !isMaudeChat(env)) return null;
  const fixed = (env.MAUDE_READ_ROOTS ?? '').split(delimiter).filter((r) => isAbsolute(r));
  if (!fixed.length) return { value: '', resolved: null, why: 'no-roots' };
  const fixedReal = fixed.map((r) => realpathDeep(r));
  // A store the agent could write (inside the project or its scratch) is never read (B1's rule).
  const store = env.MAUDE_GRANTS_FILE ? realpathDeep(env.MAUDE_GRANTS_FILE) : null;
  const grants = store && !fixedReal.some((r) => inside(store, r)) ? chatGrantRoots(env) : [];
  const roots = [...fixedReal, ...grants.map((r) => realpathDeep(r))];
  for (const w of sourceWords(args)) {
    if (w.includes('\0')) return { value: w, resolved: null, why: 'outside' };
    const t = w.trim();
    if (!t) continue;
    const spelled = t === '~' ? home : t.startsWith('~/') ? join(home, t.slice(2)) : t;
    // joined, not resolve()d: `..` must pop after the symlinks before it are followed
    const resolved = realpathDeep(isAbsolute(spelled) ? spelled : `${cwd}${sep}${spelled}`);
    if (!roots.some((r) => inside(resolved, r))) return { value: w, resolved, why: 'outside' };
  }
  return null;
}

/** The plain-words refusal the dispatcher prints (exit 2). */
export function readViolationMessage(verb, v) {
  if (v.why === 'no-roots')
    return (
      `maude design ${verb}: this AI chat has no read boundary (MAUDE_READ_ROOTS is missing), so ` +
      'the verb reads nothing. Run it yourself in a terminal, or restart the chat.\n'
    );
  return (
    `maude design ${verb}: ${JSON.stringify(v.value)} is outside what this AI chat may read. ` +
    'Attach the folder to the chat first (it asks you once), or run the command yourself in a terminal.\n'
  );
}
