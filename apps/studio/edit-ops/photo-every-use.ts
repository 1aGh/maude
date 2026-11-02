// S8.15 — `photo.every-use`: every use of one picture in this canvas goes back to the every-use look.
//
// The second half of Apply to every use (contract S8-asset-sidecars §5.1): `POST /_api/photo-every-use`
// first writes `assets/<img8>.photo.json`, then runs this op once per canvas that uses the picture. It
// removes `data-photo-edit` from every `<img>` / `<image>` / tiled picture whose file is `assets/<img8>.*`,
// so each of them shows the every-use edit again. One undo step per canvas. A locked picture keeps its
// own edit (a lock means "do not change this"); a picture whose file or edit the code computes is left
// as the code says. The per-use files stay (they are tiny, and Version history may point at them).
//
// `params.asset` is the picture: `assets/<img8>.<ext>`. Artboard-scoped with no artboard named, so an
// AI run's lease on any artboard of the file refuses the op (dispatch.ts, one check).

import { applyRemove, readAttributeState } from '../canvas-edit.ts';
import { refuse } from './constraints.ts';
import { isPicture, stampElement, walkOrRefuse } from './image-fit.ts';
import type { EditOp } from './types.ts';

const ATTR = 'data-photo-edit';
/** `assets/<img8>.<ext>` — a content-addressed picture (the photo store's own shape). */
const ASSET_RE = /^assets\/([0-9a-f]{8,64})\.[A-Za-z0-9]{1,16}$/;

/** The file a picture element shows (its `src`, `href`, or a tile's `data-image-tile`). */
function fileOf(attrs: ReadonlyArray<readonly [string, string]>): string | null {
  for (const [k, v] of attrs)
    if (k === 'src' || k === 'href' || k === 'xlinkHref' || k === 'data-image-tile') return v;
  return null;
}

/** The `<img8>` of a picture's file, or null (`./assets/…` and `/assets/…` count too). */
export function pictureBase(file: string | null): string | null {
  if (!file) return null;
  const m = ASSET_RE.exec(file.replace(/^\.?\/+/, ''));
  return m ? (m[1] as string) : null;
}

export const photoEveryUse: EditOp = {
  id: 'photo.every-use',
  scope: 'artboard',
  apply(source, req) {
    const asset = req.params.asset;
    const base = typeof asset === 'string' ? pictureBase(asset) : null;
    if (!base) return refuse(req, 'That is not a picture this project keeps.');
    let out = source;
    // Re-walk after every change: each removal (and a stamp) moves the offsets after it.
    for (let guard = 0; guard < 500; guard++) {
      const walk = walkOrRefuse(out, req);
      const next = walk.elements.find(
        (e) =>
          (isPicture(e) || e.tag === 'image') &&
          !e.locked &&
          e.attrs.some(([k]) => k === ATTR) &&
          pictureBase(fileOf(e.attrs)) === base
      );
      if (!next) break;
      const stamped = stampElement(out, req, next);
      out = stamped.source;
      const state = readAttributeState(req.file, out, stamped.id, ATTR);
      // the code chooses this use's edit: leave it as the code says (and stop looking at it)
      if (state.kind !== 'literal') break;
      out = applyRemove(req.file, out, stamped.id, ATTR).source;
    }
    return { source: out };
  },
};
