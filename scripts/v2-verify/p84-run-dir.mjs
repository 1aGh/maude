// V2-8.4 rig — which run directory p84-up.mjs may wipe (final-3 defender I6). It starts with
// `rmSync(RUN, { recursive: true })`, so a mistyped argument (`~`, `.`, the repo) would delete it.
//
// A run dir is accepted only when it is strictly inside a throwaway root — the OS temp dir, /tmp
// (/private/tmp on macOS, where an agent's scratchpad lives) or the repo's `.ai/device/` — at least three
// segments deep, never `/`, `$HOME`, the repo or an ancestor of either, never a symlink or a file, and,
// when it already holds something, only a previous rig run (`rig.json`, `home/` or `cell/`).
// Symlinks in the path are resolved first, so `/tmp/link -> ~` does not pass as a temp dir.

import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

/** `p` with its longest existing prefix resolved through symlinks (the rest appended as written). */
function realish(p) {
  let head = resolve(p);
  const rest = [];
  while (!existsSync(head)) {
    const up = dirname(head);
    if (up === head) break;
    rest.unshift(head.slice(up.length).replace(/^[\\/]+/, ''));
    head = up;
  }
  let real = head;
  try {
    real = realpathSync(head);
  } catch {
    /* keep it as written */
  }
  return rest.length ? join(real, ...rest) : real;
}

const inside = (child, root) =>
  child !== root && child.startsWith(root.endsWith(sep) ? root : root + sep);
const segments = (p) => p.split(sep).filter(Boolean).length;

/**
 * Why `run` must not be wiped, or null when it may be.
 * @param {string} run
 * @param {{ home?: string, repo: string, roots?: string[] }} o
 */
export function runDirRefusal(run, o) {
  if (typeof run !== 'string' || run.trim() === '') return 'no run dir given';
  const abs = resolve(run);
  // A symlink AT the run dir: refuse before resolving it (rmSync would follow the target's contents).
  try {
    if (lstatSync(abs).isSymbolicLink()) return `${abs} is a symlink`;
  } catch {
    /* does not exist yet: fine */
  }
  const real = realish(abs);
  if (real === sep || segments(real) < 3) return `${real} is too shallow to wipe`;
  for (const [name, p] of [
    ['$HOME', o.home],
    ['the repo', o.repo],
  ]) {
    if (!p) continue;
    const pr = realish(p);
    if (real === pr || inside(pr, real)) return `${real} is ${name} or holds it`;
  }
  const roots = (o.roots ?? [tmpdir(), '/tmp', '/private/tmp', join(o.repo, '.ai', 'device')]).map(
    realish
  );
  if (!roots.some((r) => inside(real, r)))
    return `${real} is not inside a throwaway root (${roots.join(', ')})`;
  if (existsSync(real)) {
    const st = lstatSync(real);
    if (!st.isDirectory()) return `${real} is not a directory`;
    const names = readdirSync(real);
    if (names.length && !names.some((n) => n === 'rig.json' || n === 'home' || n === 'cell'))
      return `${real} is not empty and does not look like a previous rig run`;
  }
  return null;
}
