// client/v2/undo/use-undo-mode-lane.js — S2.20b: the shell ↔ canvas ⌘Z lane (V2-1.5 §5.4, V2-1.2 feed).
//
//   shell → canvas  `undo-mode {opLog}`  state, parent-gated: on every mode change of a canvas, and to a
//                                        frame that has just loaded or rendered (a reload forgets it)
//   canvas → shell  `undo-key {redo}`    active-gated: ⌘Z / ⇧⌘Z pressed with an op-log canvas focused
//
// An op-log canvas keeps no durable stack (editing/undo-mode.ts): its keys come here and run the
// projection (`runUndoKey`), exactly as the shell's own ⌘Z does. Should the projection answer `legacy`
// after all, the store flips the mode first — this lane tells the frame `opLog: false` synchronously
// in the store's change — and only then the fallback sends `run-action edit.undo`, which the canvas,
// now legacy, runs on its own stack (postMessage keeps the order, so the two never ping-pong).

import { useEffect, useRef } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { runActionMessage } from '../../actions/shell-key-handlers.js';
import { runUndoKey, undoProjection } from './use-undo-projection.jsx';

/**
 * @param {{
 *   frames: () => Map<string, Window | null | undefined>,
 *   activePath: () => string | null,
 *   canvasOrigin: () => string,
 *   store?: typeof undoProjection,
 *   runKey?: typeof runUndoKey,
 * }} o
 */
export function createUndoModeLane(o) {
  const store = o.store ?? undoProjection;
  const runKey = o.runKey ?? runUndoKey;
  /** path → what the frame was last told (absent = never told: the canvas starts legacy). */
  const told = new Map();

  // A literal `{ dgn }` per send site so the bridge inventory sees it.
  const tell = (path, win, force = false) => {
    if (!win) return;
    const opLog = store.mode(path) === 'op-log';
    if (!force && (told.get(path) ?? false) === opLog) return;
    told.set(path, opLog);
    try {
      win.postMessage({ dgn: 'undo-mode', opLog }, '*');
    } catch {
      /* detached */
    }
  };

  const tellAll = () => {
    for (const [path, win] of o.frames()) tell(path, win);
  };

  function onMessage(e) {
    const dgn = e?.data?.dgn;
    if (dgn === 'loaded' || dgn === 'canvas-rendered') {
      for (const [path, win] of o.frames()) {
        if (win && win === e.source) {
          told.delete(path); // a reloaded document starts legacy again
          tell(path, win);
          void store.open?.(path);
        }
      }
      return null;
    }
    if (dgn !== 'undo-key') return null;
    const path = o.activePath();
    const active = path ? (o.frames().get(path) ?? null) : null;
    const m = acceptFromCanvas(e, { canvasOrigin: o.canvasOrigin(), active });
    if (m?.dgn !== 'undo-key' || !path) return null;
    return runKey(path, m.redo, () => {
      try {
        active?.postMessage(runActionMessage(m.redo ? 'edit.redo' : 'edit.undo'), '*');
      } catch {
        /* detached */
      }
    });
  }

  const unsub = store.subscribe(tellAll);
  return { onMessage, tellAll, dispose: unsub };
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
    });
    const onMessage = (e) => void lane.onMessage(e);
    window.addEventListener('message', onMessage);
    return () => {
      lane.dispose();
      window.removeEventListener('message', onMessage);
    };
  }, [iframesRef, store]);
}
