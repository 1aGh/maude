// client/v2/inspector/live-size.js — P8 c6 (14 ed-ab-resize): the inspector follows an artboard edge drag.
//
// While the person drags an artboard's edge the canvas says the size the drag asks for (`artboard-live-size`,
// world px + the snap's name). The shell believes it only from the ACTIVE canvas's frame (a background or synced
// canvas is untrusted, DDR-054), validated by the dgn table, then clamped here; the selection the inspector reads is
// shown with that size while the drag lasts (`overlayLiveSize`) — "Preset: Laptop · 1280" lights up the moment the
// width clicks onto it. Pure (window, frame and the store are injected) so the rule is a unit test.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';

const MAX_PX = 100000;
const clampPx = (n) => (Number.isFinite(n) ? Math.min(MAX_PX, Math.max(1, Math.round(n))) : null);

/** @param {{ canvasOrigin: () => string, activePath: () => string|null, frameOf: (path: string) => { contentWindow: Window|null }|undefined }} deps */
export function createLiveSizeLane(deps) {
  let state = null;
  const subs = new Set();
  const set = (next) => {
    state = next;
    for (const fn of subs) fn();
  };
  const activeWin = () => {
    const p = deps.activePath();
    return p && p !== SYSTEM_TAB ? (deps.frameOf(p)?.contentWindow ?? null) : null;
  };
  return {
    /** `{ id, w, h, preset }` while an edge is being dragged, else null. */
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** The window `message` handler. */
    onMessage(e) {
      if (e?.data?.dgn !== 'artboard-live-size') return;
      const m = acceptFromCanvas(e, { canvasOrigin: deps.canvasOrigin(), active: activeWin() });
      if (!m) return;
      const w = typeof m.w === 'number' ? clampPx(m.w) : null;
      const h = typeof m.h === 'number' ? clampPx(m.h) : null;
      if (!m.id || w == null || h == null) {
        if (state) set(null);
        return;
      }
      set({ id: m.id, w, h, preset: typeof m.preset === 'string' ? m.preset.slice(0, 80) : null });
    },
    /** The active canvas changed: a drag on the last one is over. */
    switched() {
      if (state) set(null);
    },
  };
}

/** The id of the ONE artboard a selection is (a whole-artboard selection has no element id), or null. */
function artboardIdOf(sel) {
  if (!sel || Array.isArray(sel) || sel.id) return null;
  if (typeof sel.artboardId === 'string') return sel.artboardId;
  const m = /^\[data-dc-screen="([^"]+)"\]$/.exec(sel.selector || '');
  return m ? m[1] : null;
}

/** The selection as the inspector should read it: the live size laid over the artboard it is about. */
export function overlayLiveSize(selected, live) {
  if (!live || artboardIdOf(selected) !== live.id) return selected;
  return {
    ...selected,
    worldW: live.w,
    worldH: live.h,
    liveSize: true,
    livePreset: live.preset ?? null,
  };
}

/** The lane for the active canvas, bound to the window; returns the live size or null. */
export function useLiveArtboardSize({ activePath, iframesRef, canvasOrigin }) {
  const live = useRef({});
  live.current = { activePath, iframesRef, canvasOrigin };
  const laneRef = useRef(null);
  if (!laneRef.current)
    laneRef.current = createLiveSizeLane({
      canvasOrigin: () => live.current.canvasOrigin || window.location.origin,
      activePath: () => live.current.activePath,
      frameOf: (p) => live.current.iframesRef?.current?.get(p),
    });
  const lane = laneRef.current;
  useEffect(() => {
    window.addEventListener('message', lane.onMessage);
    return () => window.removeEventListener('message', lane.onMessage);
  }, [lane]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching canvases is the trigger
  useEffect(() => {
    lane.switched();
  }, [lane, activePath]);
  return useSyncExternalStore(lane.subscribe, lane.get, lane.get);
}
