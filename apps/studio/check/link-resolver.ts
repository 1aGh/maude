// check/link-resolver.ts — what a `data-cd-link` canvas target resolves to on disk (S3.10a).
//
// `maude design check` (link-dangling) and `GET /_api/links` (state + label) both ask: is
// `<canvas>.tsx` in the project, and which artboards does it have? The canvas part of a link is
// designRoot-relative and already passed the grammar (bridge/link-target.ts: no `..`, no leading
// `/`, no `_` runtime dir); this module still realpath-checks containment, so a symlink out of the
// design root is "not in the project". One parse per canvas per resolver (cached).

import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { walkIdElements } from '../element-ids.ts';

export interface CanvasArtboard {
  id: string;
  /** the DCArtboard's literal `label`, or null */
  label: string | null;
}

/** The artboards of a canvas's source, in source order. */
export function artboardsOfSource(source: string, file = 'canvas.tsx'): CanvasArtboard[] | null {
  const walk = walkIdElements(source, file);
  if (!walk.ok) return null;
  const out: CanvasArtboard[] = [];
  for (const e of walk.elements) {
    if (e.tag !== 'DCArtboard' || !e.artboard) continue;
    const label = e.attrs.find(([k]) => k === 'label')?.[1];
    out.push({ id: e.artboard, label: label && label !== '{expr}' ? label : null });
  }
  return out;
}

/** The repo file a designRoot-relative canvas path names, or null when it is not a canvas in the design root. */
export function canvasFileIn(designRoot: string, rel: string): string | null {
  if (
    !rel.endsWith('.tsx') ||
    rel.split('/').some((s) => !s || s === '.' || s === '..' || s.startsWith('_'))
  )
    return null;
  try {
    const root = realpathSync(designRoot);
    const real = realpathSync(path.join(designRoot, ...rel.split('/')));
    if (!real.startsWith(root + path.sep) || !statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

/** A cached `(canvas) → artboards | null` over the design root on disk. */
export function diskCanvasArtboards(
  designRoot: string
): (canvas: string) => CanvasArtboard[] | null {
  const cache = new Map<string, CanvasArtboard[] | null>();
  return (canvas) => {
    if (cache.has(canvas)) return cache.get(canvas) ?? null;
    const file = canvasFileIn(designRoot, canvas);
    let out: CanvasArtboard[] | null = null;
    if (file) {
      try {
        out = artboardsOfSource(readFileSync(file, 'utf8'), canvas) ?? [];
      } catch {
        out = null;
      }
    }
    cache.set(canvas, out);
    return out;
  };
}

/** The id-only shape `checkFile`'s `canvasArtboards` option takes. */
export function diskCanvasArtboardIds(designRoot: string): (canvas: string) => string[] | null {
  const of = diskCanvasArtboards(designRoot);
  return (canvas) => of(canvas)?.map((a) => a.id) ?? null;
}
