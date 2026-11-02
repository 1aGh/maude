// The one way the photo UI compares "the open canvas" with a canvas a use names.
//
// The shell hands the open canvas repo-relative (`.design/ui/Smoke.tsx`); the server names every use
// design-root-relative (`ui/Smoke.tsx`). Compared raw, the open canvas counts as another canvas
// ("is in 2 more canvases" for a picture used in one other). Both sides go through here.

import { normalizeOpenPath } from '../../share-link.js';

/** A canvas path in its design-root-relative form (`.design/ui/a.tsx` and `ui/a.tsx` both give `ui/a.tsx`). */
export function canvasRel(path, designRel = '.design') {
  if (typeof path !== 'string' || !path) return '';
  const clean = path.replace(/^\.\//, '');
  return normalizeOpenPath(clean, designRel) ?? clean;
}

/** Is `a` the same canvas as `b`, whichever form each arrived in? */
export function sameCanvas(a, b, designRel) {
  const x = canvasRel(a, designRel);
  return x !== '' && x === canvasRel(b, designRel);
}
