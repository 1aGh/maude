// acp/agent-path.ts — one spelling of a tool's path for every ACP gate (V2-8.9 re-check H1, decision
// maude/v2-p8-one-agent-path-normalizer).
//
// The bridge and Claude Code must name the SAME file, or a gate approves one path while Claude Code
// opens another. Claude Code 2.1.x `expandPath` trims the string, turns `~` into the home folder and
// `~/x` into `<home>/x`, and resolves anything else that is not absolute against the session's cwd.
// The bridge used to resolve `~/Documents/x` as `<repo>/~/Documents/x` (inside the project → read
// approved) while Claude Code read `~/Documents/x`; a Grep with path `~` searched the whole home; and
// `' ~/.SSH/id_rsa'` slipped past the credential check (no trim, `~` only expanded with a slash).
//
// `agentPath` mirrors that expansion. On top of it, `odd` marks a path written so that two readers
// may disagree on it — surrounding whitespace, or any leading `~` — and every allow decision treats
// an odd path as OUTSIDE (the card), never inside. A NUL byte (or an empty path) names nothing
// judgeable: null, which every caller treats as "ask".
//
// Used by: may-scope.ts `readTargets` + `credentialRefusal`, write-scope.ts `resolveWriteTargets`,
// audience.ts `readPathsOf`.

import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface AgentPath {
  /** Absolute, lexically resolved (`..` collapsed; symlinks NOT followed — callers realpath). */
  abs: string;
  /** Spelled so readers may disagree (whitespace around it, a leading `~`): never "inside". */
  odd: boolean;
}

/** `raw` as Claude Code opens it, from a session started in `cwd`. Null: NUL or empty → ask. */
export function agentPath(raw: string, cwd: string, home: string = homedir()): AgentPath | null {
  if (typeof raw !== 'string' || raw.includes('\0')) return null;
  const t = raw.trim();
  if (!t) return null;
  const odd = t !== raw || t.startsWith('~');
  let p = t;
  if (t === '~') p = home;
  else if (t.startsWith('~/')) p = join(home, t.slice(2));
  return { abs: isAbsolute(p) ? resolve(p) : resolve(cwd, p), odd };
}
