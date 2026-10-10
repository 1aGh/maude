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
//   - the allowed roots are the cwd, $CLAUDE_PROJECT_DIR and the OS temp dir (plus /tmp), each
//     realpath'd, and the candidate is realpath'd through its deepest existing ancestor, so a
//     symlink inside the project that points out of it does not pass.
//
// Leaf module: node built-ins only (helper-deps.mjs stages runtime-spawned imports).

import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const OUTPUT_FLAGS = ['--out', '--out-dir', '--output'];

/** realpath of `p`, walking up to the deepest existing ancestor for a path that doesn't exist yet. */
export function realpathDeep(p) {
  let cur = resolve(p);
  const tail = [];
  for (;;) {
    if (existsSync(cur)) {
      try {
        return join(realpathSync(cur), ...tail.reverse());
      } catch {
        return join(cur, ...tail.reverse());
      }
    }
    const parent = dirname(cur);
    if (parent === cur) return join(cur, ...tail.reverse());
    tail.push(basename(cur));
    cur = parent;
  }
}

function inside(child, root) {
  const rel = relative(root, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** The realpath'd roots an output may land under. */
export function allowedRoots({
  cwd = process.cwd(),
  projectDir = process.env.CLAUDE_PROJECT_DIR,
} = {}) {
  const roots = [cwd, projectDir, tmpdir(), '/tmp'].filter(Boolean);
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
  const roots = allowedRoots({
    cwd,
    projectDir: opts.projectDir ?? process.env.CLAUDE_PROJECT_DIR,
  });
  const root = flagValue(args, '--root');
  for (const { flag, value } of outputArgs(args)) {
    if (value === '' || value === '-') continue; // empty / stdout
    const bases = isAbsolute(value) ? [cwd] : [cwd, ...(root ? [resolve(cwd, root)] : [])];
    for (const base of bases) {
      const resolved = realpathDeep(resolve(base, value));
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
