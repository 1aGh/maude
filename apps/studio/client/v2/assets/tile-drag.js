// client/v2/assets/tile-drag.js — an Assets tile that can be dragged onto a frame (S2.15; artboard ed-img).
//
// `tileDragProps(asset, name)` is spread onto a picture tile: it makes the tile draggable and, at drag start, records the drag
// in the shell's `assetDragSession` (asset-drop-session.js) and puts only the session's opaque token under the tile's own
// MIME type (editing/asset-drag.ts; #168 F6 — never the path, which a frame reached directly could read). The CANVAS never reads the drag: WebKit gives a shell-started drag no event
// in the canvas origin (r3), so the shell's catcher over the frame takes the drop, the canvas names what lies under it and the
// shell asks `image.place` with this path. Pictures AND clips drag (r5-1: a clip lands as a `<video>` in Edit, as an annotation video in Preview); sound does not.

import { ASSET_DRAG_MIME, isAssetPath } from '../../../editing/asset-drag.ts';
import { assetDragSession } from './asset-drop-session.js';

export { ASSET_DRAG_MIME };

/** The natural size of a tile's picture (`naturalWidth`) or clip (`videoWidth`); 0 until it has loaded. */
function naturalOf(el) {
  return { w: el?.naturalWidth || el?.videoWidth, h: el?.naturalHeight || el?.videoHeight };
}

/** Start a drag of `asset` (`assets/<name>`); `img` is the tile's picture or clip, for the natural size. */
export function startAssetDrag(e, asset, img) {
  const dt = e?.dataTransfer;
  if (!dt || !isAssetPath(asset)) {
    e?.preventDefault?.();
    return false;
  }
  dt.effectAllowed = 'copy';
  const { w, h } = naturalOf(img);
  if (!assetDragSession.begin({ asset, w, h })) {
    e?.preventDefault?.();
    return false;
  }
  // #168 F6 — the drag data carries only the session's opaque token: a drop that reaches a canvas frame directly
  // (Chromium delivers one across origins) reads no name. The path and size stay in the shell's session, which the
  // catcher reads; there is no plain-text twin for the same reason.
  dt.setData(ASSET_DRAG_MIME, assetDragSession.token() ?? '');
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
      const img = e.currentTarget?.querySelector?.('img, video') ?? null;
      startAssetDrag(e, asset, img);
    },
    // a drop, an esc or a release anywhere else: the catcher goes away (the drop already took its copy)
    onDragEnd: () => assetDragSession.end(),
  };
}
