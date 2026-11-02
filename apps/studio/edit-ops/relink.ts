// edit-ops/relink.ts — `asset.relink` (S8.19c): re-point every reference to a missing picture at a copy
// the person imported (the relink sheet imports first, then runs this).
//
// params { from, to }
//   from  the rel the canvas names today (designRoot-relative, `assets/c1658844.png`); it must appear
//         in this canvas as a string literal, or the op refuses — a stale sheet writes nothing.
//   to    `assets/<sha8>.<ext>`, a file that EXISTS in this project (the import route's own name shape,
//         so no traversal and no runtime-state path can be spelled), not `from` itself.
//
// Each reference keeps its own spelling: a `/` or `./` prefix and a `?query` / `#hash` tail stay. One
// write, so one undo (`revert {writeId}` restores every reference at once). No elements are targeted.

import { CanvasEditError } from '../canvas-edit.ts';
import { isAssetStateRel, normaliseAssetRef } from '../sync/asset-state.ts';
import type { EditOp } from './types.ts';

/** What the asset import route writes: content-addressed, 8 hex of the sha, a sniffed extension. */
export const RELINK_TO_RE = /^assets\/[0-9a-f]{8}\.[a-z0-9]{2,5}$/;

/** Same literal scan as `assetRefsInSource` (sync/asset-state.ts): the shell and this op agree on what a reference is. */
const LITERAL = /(["'`])([^"'`\n\r${}]{1,512})(["'`])/g;

const fail = (message: string): never => {
  throw new CanvasEditError(message, { canvas: '', id: '' });
};

export const assetRelink: EditOp = {
  id: 'asset.relink',
  apply(source, req) {
    const { from, to } = req.params;
    if (typeof from !== 'string' || !isAssetStateRel(from) || normaliseAssetRef(from) !== from)
      return fail('That picture is not on this canvas.');
    if (typeof to !== 'string' || !RELINK_TO_RE.test(to) || to === from)
      return fail('Pick a picture from this project to relink to.');
    if (!req.exists)
      return fail('This build cannot check the picture; relinking is not available.');
    if (!req.exists(to)) return fail('That picture is not in this project.');
    let hits = 0;
    const out = source.replace(LITERAL, (whole, open: string, raw: string, close: string) => {
      if (normaliseAssetRef(raw) !== from) return whole;
      hits += 1;
      const prefix = /^(?:\.\/|\/)*/.exec(raw)?.[0] ?? '';
      const tail = /[?#].*$/.exec(raw)?.[0] ?? '';
      return `${open}${prefix}${to}${tail}${close}`;
    });
    if (hits === 0) return fail('That picture is not on this canvas.');
    return { source: out };
  },
};
