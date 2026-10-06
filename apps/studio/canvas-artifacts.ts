// The canonical inventory of every on-disk artifact belonging to a canvas,
// derived from its `rel` path (designRoot-relative, POSIX, e.g. "ui/Foo.tsx").
// Pure — no `Bun.*` / `node:fs`, so it's fully unit-testable. `deleteCanvas`
// and `moveCanvas` (api.ts) both consume this instead of hand-listing sidecars,
// so the DDR-115 runtime-state taxonomy is expressed in exactly one place.
//
// Deliberately NOT included: `_photo/` (asset-keyed, not canvas-slug-keyed —
// see photo-store.ts) and `_draw/<slug>.proof.tsx` (mark-slug-keyed, a
// different slug namespace). Adding either here would silently relocate/trash
// something that isn't actually addressed by this canvas's slug.

import path from 'node:path';

import { canvasSlugFromRel } from './canvas-slug.ts';
import type { Paths } from './context.ts';

export interface CanvasArtifact {
  /** Absolute on-disk path. */
  abs: string;
  /** The primary `.tsx`, a same-basename sibling, or a slug-keyed sidecar. */
  kind: 'primary' | 'sibling' | 'slug-keyed';
  /**
   * True when the artifact's on-disk NAME is derived from the canvas's slug
   * (so a rename — not just a directory change — requires renaming this
   * artifact too). False for primary/sibling, whose name tracks the canvas's
   * own basename and is otherwise untouched by a pure directory move.
   */
  rekey: boolean;
  /** True when the artifact is git-tracked (vs. gitignored runtime state —
   *  see DDR-115). Informational only; callers don't need to branch on it
   *  today, but it keeps the taxonomy legible at the one place it's listed. */
  versioned: boolean;
  /**
   * May this artifact follow the canvas to a new path? Absent means yes.
   *
   * Only the `.ydoc.bin` cache says no, and for a specific reason — see the
   * comment at its entry. A `false` here means the mover DELETES it rather than
   * renaming it: it belongs to the slug that is going away.
   */
  carryOnMove?: boolean;
}

/**
 * Every on-disk artifact belonging to the canvas at `rel`. Does not check
 * existence — callers `stat`/`rename` best-effort, since most canvases don't
 * have every sidecar (a fresh brief-board has no history, no comments, …).
 */
export function canvasArtifacts(input: { rel: string; paths: Paths }): CanvasArtifact[] {
  const { rel, paths } = input;
  const dir = path.posix.dirname(rel.replace(/\\/g, '/'));
  const groupDirAbs = path.join(paths.designRoot, dir === '.' ? '' : dir);
  const base = path.basename(rel).replace(/\.tsx$/i, '');
  const slug = canvasSlugFromRel(rel, paths.designRel);

  const out: CanvasArtifact[] = [];

  // Same-dir siblings — same basename, dir tracks the canvas's own dir. Only
  // the primary `.tsx` is guaranteed to exist; the rest are best-effort.
  for (const ext of ['.tsx', '.meta.json', '.css', '.registry.json']) {
    out.push({
      abs: path.join(groupDirAbs, `${base}${ext}`),
      kind: ext === '.tsx' ? 'primary' : 'sibling',
      rekey: false,
      versioned: true,
    });
  }

  // Slug-keyed sidecars.
  out.push({
    abs: path.join(paths.historyDir, slug),
    kind: 'slug-keyed',
    rekey: true,
    versioned: false,
  });
  out.push({
    abs: path.join(paths.canvasStateDir, `${slug}.json`),
    kind: 'slug-keyed',
    rekey: true,
    versioned: false,
  });
  out.push({
    // DDR-115 — the per-machine camera view file.
    abs: path.join(paths.canvasStateDir, `${slug}.view.json`),
    kind: 'slug-keyed',
    rekey: true,
    versioned: false,
  });
  out.push({
    abs: path.join(paths.commentsDir, `${slug}.json`),
    kind: 'slug-keyed',
    rekey: true,
    versioned: false,
  });
  out.push({
    // collab/persistence.ts ydocBinPath — the `.ydoc.bin` cache under `_state/`.
    //
    // DROPPED ON A MOVE, NEVER CARRIED (`carryOnMove: false`). This file is the
    // OLD document's CRDT state, and a move's last act before the rename is to
    // stamp that document retired (`retireForMove` → `movedTo`) and flush it —
    // so carrying it to the new slug hands the NEW document a cache whose first
    // word is "I have moved away". Every peer that opened it released the canvas
    // as retired, the destination path therefore never appeared anywhere else,
    // and the move looked like "folders don't sync": each machine showed its own
    // move and the other's canvas still sitting at the root.
    //
    // Nothing is lost by dropping it. `flushAndDropRoom` has already written the
    // canvas to disk, and the new document is seeded from those bytes.
    abs: path.join(paths.designRoot, '_state', `${slug}.ydoc.bin`),
    kind: 'slug-keyed',
    rekey: true,
    versioned: false,
    carryOnMove: false,
  });
  out.push({
    // Versioned — a real git rename on move, which is correct and expected.
    // DDR-242: the annotations board.
    abs: path.join(paths.designRoot, `${slug}.annotations.json`),
    kind: 'slug-keyed',
    rekey: true,
    versioned: true,
  });
  out.push({
    // A not-yet-migrated v1 sidecar travels with its canvas until the boot
    // migration converts it (annotations/migrate-boot.ts).
    abs: path.join(paths.designRoot, `${slug}.annotations.svg`),
    kind: 'slug-keyed',
    rekey: true,
    versioned: true,
  });
  out.push({
    // Footage EDL (feature-footage-analysis-director) — also versioned.
    abs: path.join(paths.designRoot, `${slug}.edl.json`),
    kind: 'slug-keyed',
    rekey: true,
    versioned: true,
  });

  return out;
}

/**
 * `_locator.json`'s top-level key for a canvas at `rel` — POSIX,
 * extension-less, but NOT lowercased or dash-flattened (unlike
 * `canvasSlugFromRel`). Matches `locator.ts`'s `canvasSlug()`. Kept OUT of
 * `canvasArtifacts()`'s slug-keyed list on purpose: folding it in would let
 * the two divergent slug shapes get confused for each other, which the plan
 * calls out as the single most likely bug in this feature.
 */
export function locatorKeyFor(rel: string): string {
  const p = rel.replace(/\\/g, '/');
  const dot = p.lastIndexOf('.');
  return dot > 0 ? p.slice(0, dot) : p;
}

/**
 * Where `artifact` lands after the canvas at `fromRel` moves to `toRel`.
 * Primary/sibling artifacts track the destination's directory + basename;
 * slug-keyed artifacts stay in their fixed directory but swap the old slug
 * for the new one in their filename (the `_history/<slug>` dir included —
 * there the "filename" IS the slug).
 */
export function relocatedName(
  artifact: CanvasArtifact,
  fromRel: string,
  toRel: string,
  paths: Paths
): string {
  if (artifact.kind === 'slug-keyed') {
    const fromSlug = canvasSlugFromRel(fromRel, paths.designRel);
    const toSlug = canvasSlugFromRel(toRel, paths.designRel);
    const dir = path.dirname(artifact.abs);
    const name = path.basename(artifact.abs);
    if (name === fromSlug) return path.join(dir, toSlug);
    return path.join(dir, name.replace(fromSlug, toSlug));
  }
  const fromBase = path.basename(fromRel).replace(/\.tsx$/i, '');
  const toBase = path.basename(toRel).replace(/\.tsx$/i, '');
  const oldName = path.basename(artifact.abs);
  const suffix = oldName.slice(fromBase.length); // '.tsx' | '.meta.json' | '.css' | '.registry.json'
  const toDir = path.posix.dirname(toRel.replace(/\\/g, '/'));
  const newDirAbs = path.join(paths.designRoot, toDir === '.' ? '' : toDir);
  return path.join(newDirAbs, `${toBase}${suffix}`);
}
