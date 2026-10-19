// client/v2/shell/use-annotation-prefs.js — S4.8: this page's one annotation-prefs store, wired to
// prefs.json (hydrated by use-panel-layout.js's one GET) and to every canvas frame.
//
//   annotation-prefs-set {prefs}  c2s, `active`: the ACTIVE canvas's own window on the origin the shell
//                                 built its frame on, or it is dropped (acceptFromCanvas). The change is
//                                 validated against the palettes (tool-prefs.ts), written to prefs.json,
//                                 and sent on to every frame.
//   annotation-prefs {prefs}      s2c, parent only: seeds a canvas that has just loaded or rendered, and
//                                 follows a change made in another canvas. A canvas keeps the fields it
//                                 changed itself (tool-state.ts hydrate), so the echo to the sender is a no-op.

import { useEffect, useRef } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { persistUiPrefs } from '../../shell/util.js';
import { createAnnotationPrefsStore } from './annotation-prefs-store.js';

export const annotationPrefsStore = createAnnotationPrefsStore({ persist: persistUiPrefs });

const frameOrigin = (frame) => {
  try {
    return new URL(frame.src, window.location.href).origin;
  } catch {
    return '';
  }
};

/**
 * Keep every canvas frame told, and take the active canvas's changes.
 * @param iframesRef Map<path, HTMLIFrameElement> (the shell's registered canvas frames)
 * @param activePath string | null — the active canvas tab's path
 */
export function useAnnotationPrefsLane(iframesRef, activePath, store = annotationPrefsStore) {
  const pathRef = useRef(activePath);
  pathRef.current = activePath;
  useEffect(() => {
    const frames = () => [...(iframesRef.current?.values() ?? [])];
    // A literal `{ dgn }` (not postToCanvas) so the bridge inventory sees this send site.
    const tell = (win, prefs) => {
      try {
        win?.postMessage({ dgn: 'annotation-prefs', prefs }, '*');
      } catch {
        /* detached */
      }
    };
    const tellAll = (except) => {
      const prefs = store.get();
      if (Object.keys(prefs).length === 0) return;
      for (const f of frames()) if (f.contentWindow !== except) tell(f.contentWindow, prefs);
    };
    const unsub = store.subscribe(() => tellAll(null));
    const onMessage = (e) => {
      const dgn = e.data?.dgn;
      if (dgn === 'loaded' || dgn === 'canvas-rendered') {
        const win = frames().find((f) => f.contentWindow === e.source)?.contentWindow;
        const prefs = store.get();
        if (win && Object.keys(prefs).length > 0) tell(win, prefs);
        return;
      }
      if (dgn !== 'annotation-prefs-set') return;
      const path = pathRef.current;
      const active = path ? iframesRef.current?.get(path) : null;
      if (!active || active.contentWindow !== e.source) return;
      const m = acceptFromCanvas(e, {
        canvasOrigin: frameOrigin(active),
        active: active.contentWindow,
      });
      if (m?.dgn !== 'annotation-prefs-set') return;
      // `set` tells every frame (including the sender, which already has the value: its hydrate is a no-op).
      store.set(m.prefs);
    };
    window.addEventListener('message', onMessage);
    return () => {
      unsub();
      window.removeEventListener('message', onMessage);
    };
  }, [iframesRef, store]);
}
