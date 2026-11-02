// Relative-import rewriting for a canvas that CHANGES FOLDER (issue #114).
//
// THE BUG THIS MODULE EXISTS TO FIX. `moveCanvas` / `moveFolder` relocated a
// canvas with a bare `rename()` — bytes moved, specifiers didn't. A canvas
// dragged from `ui/` into `ui/print/` kept
//
//     import { … } from "../system/alligators/preview/_kit";
//     import "../system/alligators/preview/_layout.css";
//
// which is only correct one level up, so the canvas 500s on the next build with
// `Could not resolve`. Nothing anywhere in the tree rewrote imports; the
// capability simply did not exist. It reads like a sync bug from the outside
// (the broken file shows up on every peer), which is how it got reported
// alongside one — but it is entirely local to the move.
//
// Deliberately regex-over-known-vocabulary rather than a parser: it matches the
// house style of the other static readers (`_canvas-rects-static.mjs`), it
// cannot fail closed on a canvas whose syntax a parser would reject, and the
// vocabulary is small and fixed. Only `./`- and `../`-prefixed specifiers are
// touched — a bare or aliased specifier (`react`, `@maude/canvas-lib`) is
// resolved by the bundler, not by depth, and rewriting one would break it.

import path from 'node:path';

/**
 * Every shape that can carry a module specifier in a canvas body, as
 * [pattern, index of the capture group holding the quoted specifier].
 *
 *   from "…"      — `import x from`, `export … from`
 *   import "…"    — side-effect import (this is the one that carries `_layout.css`)
 *   import("…")   — dynamic import
 *
 * `require("…")` is deliberately absent: canvases are ESM (Bun.build), and a
 * `require` in one is not something this should quietly rewrite.
 */
const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /(\bfrom\s*)(["'])([^"']+)\2/g,
  /(\bimport\s*)(["'])([^"']+)\2/g,
  /(\bimport\s*\(\s*)(["'])([^"']+)\2/g,
];

/** Is this a path-relative specifier (the only kind whose meaning depends on
 *  which folder the importing file sits in)? */
export function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../');
}

/**
 * Re-root one relative specifier from `fromDir` to `toDir`.
 *
 * Both dirs are POSIX, design-root-relative (`''` = the design root itself).
 * Returns the specifier unchanged when it isn't relative.
 */
export function rerootSpecifier(spec: string, fromDir: string, toDir: string): string {
  if (!isRelativeSpecifier(spec)) return spec;
  // What the specifier pointed AT, as a design-root-relative path. `join` +
  // `normalize` collapse the `..` segments; a target above the design root stays
  // expressed with leading `..` and re-roots just as correctly.
  const target = path.posix.normalize(path.posix.join(fromDir, spec));
  let next = path.posix.relative(toDir, target);
  // `relative` drops the leading `./` that makes a same-dir specifier relative
  // rather than bare — without it `sibling.css` would resolve as a PACKAGE.
  if (!next.startsWith('.')) next = `./${next}`;
  // A trailing slash in the source (`from "../lib/"`) is meaningful to a
  // resolver; `normalize`/`relative` drop it, so put it back.
  if (spec.endsWith('/') && !next.endsWith('/')) next = `${next}/`;
  return next;
}

/**
 * Rewrite every relative import in `source` for a file that moved from
 * `fromDir` to `toDir` (both POSIX, design-root-relative).
 *
 * `relocate` answers for the files that moved WITH the canvas (issue #153): a target it maps — the canvas's own
 * `<name>.css` renamed to `<new>.css`, a sibling inside a moved folder — is pointed at where that file went,
 * not re-rooted back to where it was. Every other relative specifier re-roots for the new folder depth.
 *
 * Returns the source unchanged when nothing relative needed a change, so a caller can cheaply skip the write.
 */
export function rewriteRelativeImports(
  source: string,
  fromDir: string,
  toDir: string,
  relocate?: (target: string) => string | null
): string {
  const from = path.posix.normalize(fromDir === '' ? '.' : fromDir);
  const to = path.posix.normalize(toDir === '' ? '.' : toDir);
  if (from === to && !relocate) return source;
  let out = source;
  for (const pattern of SPECIFIER_PATTERNS) {
    out = out.replace(pattern, (whole, lead: string, quote: string, spec: string) => {
      if (!isRelativeSpecifier(spec)) return whole;
      const moved = relocate?.(path.posix.normalize(path.posix.join(from, spec)));
      if (moved) return `${lead}${quote}${specifierTo(moved, to, spec.endsWith('/'))}${quote}`;
      if (from === to) return whole;
      return `${lead}${quote}${rerootSpecifier(spec, from, to)}${quote}`;
    });
  }
  return out;
}

/** The relative specifier from `dir` to the design-root-relative `target` (`./` kept, a trailing `/` kept). */
function specifierTo(target: string, dir: string, trailingSlash: boolean): string {
  let next = path.posix.relative(dir, target);
  if (!next.startsWith('.')) next = `./${next}`;
  if (trailingSlash && !next.endsWith('/')) next = `${next}/`;
  return next;
}
