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

import { ASSET_DRAG_MIME, isAssetPath } from '../../../editing/asset-drag.ts';

const MAX_PX = 100_000;
export const DROP_ANSWER_MS = 3000;
/** A drag that has said nothing (no dragover) for this long is over, whatever the tile did: the catcher must never stay. */
export const DRAG_IDLE_MS = 60_000;

/** Is this DOM drag event carrying an Assets tile (its own MIME type)? A Finder drag, text or a link is not. */
export function isAssetDrag(e) {
  const types = e?.dataTransfer?.types;
  if (!types) return false;
  try {
    return Array.from(types).includes(ASSET_DRAG_MIME);
  } catch {
    return false;
  }
}

/**
 * The one drag in flight (module state: the tile and the catcher are in different trees).
 *
 * The session ends by itself when the tile cannot say so (its element unmounted mid-drag, so React never sees
 * `dragend`): a window capture-phase `dragend` / `drop`, a `pointerdown` (no pointer events fire during a native
 * drag, so one means it is over), or DRAG_IDLE_MS without a dragover. A drop ends it one tick later, so the
 * catcher's own drop handler still reads it.
 */
function createSession(opts = {}) {
  let drag = null;
  let idle = null;
  let detach = null;
  const subs = new Set();
  const emit = () => {
    for (const fn of subs) fn();
  };
  const end = () => {
    if (idle) clearTimeout(idle);
    idle = null;
    if (detach) detach();
    detach = null;
    if (!drag) return;
    drag = null;
    emit();
  };
  const touch = () => {
    if (!drag) return;
    if (idle) clearTimeout(idle);
    idle = setTimeout(end, opts.idleMs ?? DRAG_IDLE_MS);
  };
  const attach = () => {
    const win = opts.target ?? (typeof window !== 'undefined' ? window : null);
    if (!win?.addEventListener) return null;
    const onEnd = () => end();
    const onDrop = () => setTimeout(end, 0);
    win.addEventListener('dragend', onEnd, true);
    win.addEventListener('pointerdown', onEnd, true);
    win.addEventListener('drop', onDrop, true);
    return () => {
      win.removeEventListener('dragend', onEnd, true);
      win.removeEventListener('pointerdown', onEnd, true);
      win.removeEventListener('drop', onDrop, true);
    };
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
      if (detach) detach();
      drag = d;
      detach = attach();
      touch();
      // after the dragstart handler returns: a DOM change inside dragstart can cancel the drag in some engines.
      // Only if this drag is still the one in flight (an end() in between must not bring a catcher back).
      setTimeout(() => {
        if (drag === d) emit();
      }, 0);
      return d;
    },
    end,
    /** The drag is still alive (a dragover): push the idle timeout out. */
    touch,
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
 * @param deps.preview  () => boolean — the canvas is in Preview: a drop adds an annotation, never a design edit
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
      deps.session.touch?.();
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
      // r4 #2 — Preview never edits the design: the picture goes on the board as an annotation, where it was
      // dropped (the point first, then the ask; the canvas's annotation layer places it there)
      if (deps.preview?.()) {
        deps.post({ dgn: 'asset-drag-over', x: Math.round(x), y: Math.round(y) });
        deps.post({ dgn: 'insert-annotation-media', paths: [drag.asset] });
        return null;
      }
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
