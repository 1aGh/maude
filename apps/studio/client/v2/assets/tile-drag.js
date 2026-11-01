// client/v2/assets/tile-drag.js — an Assets tile that can be dragged onto a frame (S2.15; artboard ed-img).
//
// `tileDragProps(asset, name)` is spread onto a picture tile: it makes the tile draggable and, at drag start, records the drag
// in the shell's `assetDragSession` (asset-drop-session.js) and puts `{asset, w?, h?}` under the tile's own MIME type
// (editing/asset-drag.ts) for same-origin targets. The CANVAS never reads the drag: WebKit gives a shell-started drag no event
// in the canvas origin (r3), so the shell's catcher over the frame takes the drop, the canvas names what lies under it and the
// shell asks `image.place` with this path. Only pictures drag (video and sound are placed by S7's clip door).

import { ASSET_DRAG_MIME, assetDragData, isAssetPath } from '../../../editing/asset-drag.ts';
import { assetDragSession } from './asset-drop-session.js';

export { ASSET_DRAG_MIME };

/** Start a drag of `asset` (`assets/<name>`); `img` is the tile's picture, for the natural size. */
export function startAssetDrag(e, asset, img) {
  const dt = e?.dataTransfer;
  if (!dt || !isAssetPath(asset)) {
    e?.preventDefault?.();
    return false;
  }
  dt.effectAllowed = 'copy';
  assetDragSession.begin({ asset, w: img?.naturalWidth, h: img?.naturalHeight });
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
    // a drop, an esc or a release anywhere else: the catcher goes away (the drop already took its copy)
    onDragEnd: () => assetDragSession.end(),
  };
}
