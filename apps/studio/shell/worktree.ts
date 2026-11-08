// #206 §5 (DDR-250) — this server serves a git WORKTREE of a project the desktop app knows.
//
// The app decides that (it reads the main repo's back-reference; `project_resolve::worktree_of`) and
// hands the spawned server `MAUDE_WORKTREE_OF=<the main project's display name>`. A worktree is never
// linked: the Share sheet says "Syncs from <main>" with no button, and the Connect route refuses, so a
// person cannot make it a second linked copy by hand either. Absent env ⇒ an ordinary project (every
// `maude design serve`, every cell).
//
// The name reaches the browser, so it is treated as display input like the profile label: controls
// and bidi overrides stripped, trimmed, ≤ 64 code points; empty ⇒ not a worktree.

import { sanitizeProfileLabel } from './profile.ts';

export const WORKTREE_ENV = 'MAUDE_WORKTREE_OF';

/** The main project's name when this server serves a worktree tab, else null. */
export function worktreeOf(env: Record<string, string | undefined> = process.env): string | null {
  return sanitizeProfileLabel(env[WORKTREE_ENV]) ?? null;
}
