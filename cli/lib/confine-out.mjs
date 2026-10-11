// confine-out.mjs — every `maude design` output flag resolves inside the project or the OS temp
// dir (contract V2-1.11 §5.3 "Output confinement", V2-2.8 S4).
//
// Auto-tier verbs run without a prompt in the AI chat (apps/studio/actions/verbs.ts). Before this,
// `--out ~/.zshenv` on any of them wrote wherever the caller said. The dispatcher calls
// `outputViolation()` before it spawns a helper and exits 2 on a hit.
//
// Rules:
//   - flags: --out, --out-dir, --output, in both `--flag value` and `--flag=value` forms;
//   - a relative path is resolved against the cwd AND against `--root` when given, and both
//     candidates must pass (helpers differ in which one they use);
//   - the allowed roots are the project root of the cwd (findProjectRoot — not the cwd itself: a
//     cwd of ~ is no root), the project root of `--root`, $CLAUDE_PROJECT_DIR and the OS temp dir
//     (plus /tmp), each realpath'd;
//   - the candidate is resolved the way the kernel opens it, segment by segment: a symlink is
//     followed before a later `..` pops (so `link/..` is the parent of the link's target, not the
//     project), and a dangling link resolves to the target it would create.
//
// Leaf module: node built-ins + studio-locate.mjs (helper-deps.mjs stages runtime-spawned imports).

import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { findProjectRoot } from './studio-locate.mjs';

export const OUTPUT_FLAGS = ['--out', '--out-dir', '--output'];

const LINK_HOPS = 40;
/** Outside every root: what an unresolvable path (a symlink loop) resolves to. */
const UNRESOLVABLE = `${sep}\0unresolvable`;

/**
 * The path `p` names, resolved as the kernel walks it: each existing segment realpath'd before the
 * next one (so `link/..` pops from the link's TARGET), a dangling symlink followed to the target a
 * write would create, a missing tail kept as written. `p` must NOT be normalised first — resolve()
 * / join() collapse `link/..` lexically, which is the bug this exists for. Relative → against cwd.
 */
export function realpathDeep(p, hops = 0) {
  const abs = isAbsolute(p) ? p : `${process.cwd()}${sep}${p}`;
  let cur = realpathSync(sep);
  for (const seg of abs.split(/[\\/]+/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      cur = dirname(cur);
      continue;
    }
    const next = join(cur, seg);
    try {
      cur = realpathSync(next);
      continue;
    } catch {
      /* missing, dangling or unreadable */
    }
    let link = null;
    try {
      link = lstatSync(next).isSymbolicLink() ? readlinkSync(next) : null;
    } catch {
      /* missing */
    }
    if (link === null) cur = next;
    else if (hops >= LINK_HOPS) return UNRESOLVABLE;
    else cur = realpathDeep(isAbsolute(link) ? link : `${cur}${sep}${link}`, hops + 1);
  }
  return cur;
}

function inside(child, root) {
  const rel = relative(root, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** The realpath'd roots an output may land under (`root`: the verb's `--root`, when given). */
export function allowedRoots({
  cwd = process.cwd(),
  projectDir = process.env.CLAUDE_PROJECT_DIR,
  root = null,
} = {}) {
  const roots = [
    findProjectRoot(cwd),
    root ? findProjectRoot(resolve(cwd, root)) : null,
    projectDir,
    tmpdir(),
    '/tmp',
  ].filter(Boolean);
  return [...new Set(roots.map((r) => realpathDeep(r)))];
}

/** Every `{ flag, value }` output pair in `args`. */
export function outputArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    for (const f of OUTPUT_FLAGS) {
      if (a === f && i + 1 < args.length) out.push({ flag: f, value: String(args[i + 1]) });
      else if (a.startsWith(`${f}=`)) out.push({ flag: f, value: a.slice(f.length + 1) });
    }
  }
  return out;
}

function flagValue(args, name) {
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === name && i + 1 < args.length) return String(args[i + 1]);
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return null;
}

/**
 * The first output flag in `args` that lands outside the allowed roots, or null.
 * @returns {{ flag: string, value: string, resolved: string } | null}
 */
export function outputViolation(args, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const root = flagValue(args, '--root');
  const roots = allowedRoots({
    cwd,
    projectDir: opts.projectDir ?? process.env.CLAUDE_PROJECT_DIR,
    root,
  });
  for (const { flag, value } of outputArgs(args)) {
    if (value === '' || value === '-') continue; // empty / stdout
    const bases = isAbsolute(value) ? [cwd] : [cwd, ...(root ? [resolve(cwd, root)] : [])];
    for (const base of bases) {
      // joined, not resolve()d: `..` must pop after the symlinks before it are followed
      const resolved = realpathDeep(isAbsolute(value) ? value : `${base}${sep}${value}`);
      if (!roots.some((r) => inside(resolved, r))) return { flag, value, resolved };
    }
  }
  return null;
}

export function violationMessage(verb, v) {
  return (
    `maude design ${verb}: ${v.flag} ${v.value} is outside the project (${v.resolved}).\n` +
    '  Pick a path inside the project, or the temp dir.\n'
  );
}
