// client/v2/assets/tile-drag.js — an Assets tile that can be dragged onto a frame (S2.15; artboard ed-img).
//
// `tileDragProps(asset, name)` is spread onto a picture tile: it makes the tile draggable and, at drag start, puts
// `{asset, w?, h?}` under the tile's own MIME type (editing/asset-drag.ts). The canvas (editing/image-drop.tsx) receives it, rings
// the picture / frame / artboard under the pointer and asks `image.place`. The payload is a path, never bytes; a forged one is
// refused by the canvas parser and by the server. Only pictures drag (video and sound are placed by S7's clip door).

import { ASSET_DRAG_MIME, assetDragData, isAssetPath } from '../../../editing/asset-drag.ts';

export { ASSET_DRAG_MIME };

/** Start a drag of `asset` (`assets/<name>`); `img` is the tile's picture, for the natural size. */
export function startAssetDrag(e, asset, img) {
  const dt = e?.dataTransfer;
  if (!dt || !isAssetPath(asset)) {
    e?.preventDefault?.();
    return false;
  }
  dt.effectAllowed = 'copy';
  dt.setData(
    ASSET_DRAG_MIME,
    assetDragData({ asset, w: img?.naturalWidth, h: img?.naturalHeight })
  );
  // a plain-text twin so a drop on a text field says what it is, and nothing richer leaks
  dt.setData('text/plain', asset);
  if (img && typeof dt.setDragImage === 'function') {
    try {
      dt.setDragImage(img, 24, 24);
    } catch {
      /* a detached image: the browser draws its own */
    }
  }
  return true;
}

/** Props for a picture tile's element. */
export function tileDragProps(asset) {
  return {
    draggable: true,
    onDragStart: (e) => {
      const img = e.currentTarget?.querySelector?.('img') ?? null;
      startAssetDrag(e, asset, img);
    },
  };
}
