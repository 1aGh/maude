// edit-ops/artboard-resize.ts — S2.8 `artboard.resize`: size an artboard through the versioned file.
//
//   params { artboard: string, width?: number, height?: number, fixed?: boolean }
//
// The numbers go into the JSX `width` / `height` props (DDR-027: size is JSX-authoritative, never the per-user
// `_canvas-state` camera); `fixed: true` pins the height (the bare `fixed` prop — a bottom-edge drag), `fixed: false`
// puts it back to "Fits content". Position is NOT here: an artboard's x/y live in the layout lane
// (`meta.layout.artboards[]`), which the canvas writes through its own commit. One request = one write.
//
// Same result by hand: `canvas-tsx.md` § "Resize an artboard". Registry action: `artboard.resize`.

import { applyResizeArtboard, applySetArtboardHug, CanvasEditError } from '../canvas-edit.ts';
import type { EditOp } from './types.ts';

export const ARTBOARD_ID_RE = /^[A-Za-z][\w-]{0,63}$/;
/** What the resize route has always accepted (api.ts `dim`). */
export const MIN_ARTBOARD = 64;
export const MAX_ARTBOARD = 8192;

function dim(v: unknown, what: string, file: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n))
    throw new CanvasEditError(`The ${what} is not a number.`, { canvas: file, id: '' });
  return Math.max(MIN_ARTBOARD, Math.min(MAX_ARTBOARD, Math.round(n)));
}

export const artboardResize: EditOp = {
  id: 'artboard.resize',
  // S2.10b — an AI run holding the artboard refuses its resize
  artboards: (req) => (typeof req.params.artboard === 'string' ? [req.params.artboard] : []),
  apply(source, req) {
    const id = req.params.artboard;
    if (typeof id !== 'string' || !ARTBOARD_ID_RE.test(id))
      throw new CanvasEditError('That artboard is not on this canvas.', {
        canvas: req.file,
        id: '',
      });
    const width = dim(req.params.width, 'width', req.file);
    const height = dim(req.params.height, 'height', req.file);
    const fixed = typeof req.params.fixed === 'boolean' ? req.params.fixed : undefined;
    if (width === undefined && height === undefined && fixed === undefined)
      throw new CanvasEditError('Nothing to resize.', { canvas: req.file, id });
    let out = source;
    if (width !== undefined || height !== undefined)
      out = applyResizeArtboard(req.file, out, id, width, height).source;
    if (fixed !== undefined) out = applySetArtboardHug(req.file, out, id, fixed).source;
    return { source: out };
  },
};
