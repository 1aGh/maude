// client/v2/assets/asset-drop-session.js — r3: the SHELL owns an Assets tile's drag onto the canvas.
//
// Why the shell: the tile lives on the shell's origin and the canvas on its own (DDR-054). WebKit (the app's
// WKWebView, and Safari) never hands a drag a page started to a frame of another origin — no dragenter, no
// dragover, no drop reach the canvas, whatever the drag carries (measured with a real WebKit drag, r3). So:
//
//   dragstart on a tile   → `assetDragSession.begin({asset, w, h})`; the shell lays a catcher over the canvas frame
//   dragover the catcher  → `asset-drag-over {x, y}` (frame coordinates): the canvas rings what it would land on
//   drop on the catcher   → `asset-drop-at {requestId, x, y}`; the canvas answers `asset-drop-target` with the
//                           picture / frame / artboard there (never an asset), and the SHELL asks `image.place`
//                           with the path IT started dragging; `asset-drop-done` lets the canvas select the result
//
// The canvas can only name a target for a drop the shell asked about (one pending requestId, short-lived); it can
// never make the shell place a path the person did not drag. The server still re-checks the path (image-fit.ts).

import { isAssetPath } from '../../../editing/asset-drag.ts';

const MAX_PX = 100_000;
export const DROP_ANSWER_MS = 3000;

/** The one drag in flight (module state: the tile and the catcher are in different trees). */
function createSession() {
  let drag = null;
  const subs = new Set();
  const emit = () => {
    for (const fn of subs) fn();
  };
  return {
    /** A tile's drag started; null when `asset` is not an `assets/<name>` path. */
    begin(a) {
      if (!a || !isAssetPath(a.asset)) return null;
      const d = { asset: a.asset };
      if (
        Number.isFinite(a.w) &&
        Number.isFinite(a.h) &&
        a.w > 0 &&
        a.h > 0 &&
        a.w <= MAX_PX &&
        a.h <= MAX_PX
      ) {
        d.w = Math.round(a.w);
        d.h = Math.round(a.h);
      }
      drag = d;
      // after the dragstart handler returns: a DOM change inside dragstart can cancel the drag in some engines
      setTimeout(emit, 0);
      return d;
    },
    end() {
      if (!drag) return;
      drag = null;
      emit();
    },
    current: () => drag,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export const assetDragSession = createSession();
export const _createSessionForTest = createSession;

/** `placeAsset`'s request for `drag` landing on the canvas's `target` (the same ask the canvas's own drop made). */
export function placeRequestFor(drag, target, canvas) {
  if (!drag || !isAssetPath(drag.asset) || !target || typeof canvas !== 'string' || !canvas)
    return null;
  if (typeof target.artboard !== 'string' || !target.artboard) return null;
  if (target.kind === 'artboard') {
    return {
      asset: drag.asset,
      target: { canvas, artboardId: target.artboard },
      mode: 'loose',
      ...(drag.w && drag.h ? { natural: { w: drag.w, h: drag.h } } : {}),
    };
  }
  if ((target.kind !== 'frame' && target.kind !== 'picture') || typeof target.element !== 'string')
    return null;
  return {
    asset: drag.asset,
    target: {
      canvas,
      artboardId: target.artboard,
      frameId: target.element,
      ...(Number.isInteger(target.occurrence) && target.occurrence > 0
        ? { occurrence: target.occurrence }
        : {}),
    },
    mode: 'fill',
  };
}

/**
 * The catcher's lane (pure: everything it touches is a function, so a test drives it).
 *
 * @param deps.session  the drag session (`assetDragSession`)
 * @param deps.post     (msg) => void — to the ACTIVE canvas frame, on the canvas origin
 * @param deps.accept   (e) => message | null — `acceptFromCanvas` with the active frame as the gate
 * @param deps.canvas   () => string | null — the open canvas (the file `image.place` writes)
 * @param deps.place    (req) => Promise<{ok, created?, message?}> — `placeAsset`
 */
export function createCatcherLane(deps) {
  let seq = 0;
  let pending = null; // { requestId, drag, canvas, timer }
  const clearPending = () => {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
  };
  return {
    over(x, y) {
      if (!deps.session.current()) return false;
      deps.post({ dgn: 'asset-drag-over', x: Math.round(x), y: Math.round(y) });
      return true;
    },
    leave() {
      deps.post({ dgn: 'asset-drag-over', x: null });
    },
    /** The tile was dropped at (x, y) in frame coordinates. Returns the requestId asked, or null. */
    drop(x, y) {
      const drag = deps.session.current();
      const canvas = deps.canvas();
      if (!drag || !canvas) return null;
      clearPending();
      const requestId = `ad_${Date.now().toString(36)}_${++seq}`;
      pending = {
        requestId,
        drag: { ...drag },
        canvas,
        timer: setTimeout(() => {
          if (pending?.requestId === requestId) pending = null;
        }, DROP_ANSWER_MS),
      };
      deps.post({ dgn: 'asset-drop-at', requestId, x: Math.round(x), y: Math.round(y) });
      return requestId;
    },
    /** A window message; only the active canvas's answer to the pending drop does anything. */
    async onMessage(e) {
      if (e?.data?.dgn !== 'asset-drop-target' || !pending) return false;
      const m = deps.accept(e);
      if (m?.dgn !== 'asset-drop-target' || m.requestId !== pending.requestId) return false;
      const { requestId, drag, canvas } = pending;
      clearPending();
      if (!m.target) return true;
      // the canvas may have been switched while the answer was in flight: place only on the canvas dropped on
      if (deps.canvas() !== canvas) return true;
      const req = placeRequestFor(drag, m.target, canvas);
      if (!req) return true;
      let r;
      try {
        r = await deps.place(req);
      } catch {
        r = { ok: false, message: 'Not placed; try again.' };
      }
      deps.post(
        r?.ok
          ? {
              dgn: 'asset-drop-done',
              requestId,
              ok: true,
              created: Array.isArray(r.created) ? r.created : [],
            }
          : {
              dgn: 'asset-drop-done',
              requestId,
              ok: false,
              message: r?.message || 'Not placed; try again.',
            }
      );
      return true;
    },
    pendingId: () => pending?.requestId ?? null,
    dispose: clearPending,
  };
}
