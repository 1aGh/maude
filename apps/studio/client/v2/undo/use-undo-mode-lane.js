// client/v2/undo/use-undo-mode-lane.js — S2.20b: the canvas → shell ⌘Z lane (V2-1.5 §5.4, V2-1.2 feed).
//
//   canvas → shell  `undo-key {redo}`    active-gated: ⌘Z / ⇧⌘Z pressed with the canvas focused
//
// sec-a (wave-A attacker, low): the shell can't prove from here that a key was really pressed inside the
// iframe — a planted canvas could post `undo-key` and run the person's ⌘Z on its own. So the shell honours one
// only while the active canvas frame HOLDS FOCUS in a focused window (`focused`: the person is in the canvas,
// where their own ⌘Z would land anyway), and at most UNDO_KEY_BURST per second (a held key repeats slower
// than a script). Anything else is dropped without a word.
//
// The canvas keeps no undo stack (p8-v1-drop deleted the legacy one and its `undo-mode {opLog}` state
// message): every key comes here and runs the projection (`runUndoKey`), exactly as the shell's own ⌘Z.

import { useEffect, useRef } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { runUndoKey, undoProjection } from './use-undo-projection.jsx';

/**
 * @param {{
 *   frames: () => Map<string, Window | null | undefined>,
 *   activePath: () => string | null,
 *   canvasOrigin: () => string,
 *   store?: typeof undoProjection,
 *   runKey?: typeof runUndoKey,
 *   focused?: () => boolean,
 *   now?: () => number,
 * }} o
 */
export const UNDO_KEY_BURST = 8;

export function createUndoModeLane(o) {
  const store = o.store ?? undoProjection;
  const runKey = o.runKey ?? runUndoKey;
  const now = o.now ?? (() => Date.now());
  /** Absent = the canvas never holds focus: fail closed. */
  const focused = o.focused ?? (() => false);
  let windowStart = -Infinity;
  let inWindow = 0;
  const allowKey = () => {
    if (!focused()) return false;
    const t = now();
    if (t - windowStart >= 1000) {
      windowStart = t;
      inWindow = 0;
    }
    if (inWindow >= UNDO_KEY_BURST) return false;
    inWindow++;
    return true;
  };
  function onMessage(e) {
    const dgn = e?.data?.dgn;
    if (dgn === 'loaded' || dgn === 'canvas-rendered') {
      for (const [path, win] of o.frames()) {
        if (win && win === e.source) void store.open?.(path);
      }
      return null;
    }
    if (dgn !== 'undo-key') return null;
    const path = o.activePath();
    const active = path ? (o.frames().get(path) ?? null) : null;
    const m = acceptFromCanvas(e, { canvasOrigin: o.canvasOrigin(), active });
    if (m?.dgn !== 'undo-key' || !path) return null;
    if (!allowKey()) return null;
    return runKey(path, m.redo, store);
  }

  return { onMessage, dispose: () => {} };
}

/** Mounted once by the shell (ShellUndoHistory). `iframesRef`: Map<path, HTMLIFrameElement>. */
export function useUndoModeLane({ iframesRef, activePath, cfg, store = undoProjection }) {
  const live = useRef({ activePath, cfg });
  live.current = { activePath, cfg };
  useEffect(() => {
    const lane = createUndoModeLane({
      store,
      frames: () =>
        new Map([...(iframesRef?.current?.entries() ?? [])].map(([p, f]) => [p, f?.contentWindow])),
      activePath: () => live.current.activePath ?? null,
      canvasOrigin: () => live.current.cfg?.canvasOrigin || window.location.origin,
      // the active canvas frame holds the focus of a focused window (sec-a: undo-key gate)
      focused: () => {
        const frame = live.current.activePath
          ? iframesRef?.current?.get(live.current.activePath)
          : null;
        return !!frame && document.hasFocus() && document.activeElement === frame;
      },
    });
    const onMessage = (e) => void lane.onMessage(e);
    window.addEventListener('message', onMessage);
    return () => {
      lane.dispose();
      window.removeEventListener('message', onMessage);
    };
  }, [iframesRef, store]);
}
