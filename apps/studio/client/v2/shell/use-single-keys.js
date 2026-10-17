// client/v2/shell/use-single-keys.js — V2-4 gate: this page's one "Single-key shortcuts" store, wired to
// prefs.json (hydrated by use-panel-layout.js's one GET), the React hook, and the bridge lane that tells
// every canvas frame (`key-prefs`, bridge/dgn-protocol.ts).

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { persistUiPrefs } from '../../shell/util.js';
import { createSingleKeysStore } from './single-keys-store.js';

export const singleKeysStore = createSingleKeysStore({ persist: persistUiPrefs });

/** `[on, setOn]` — Settings › General › Keyboard. */
export function useSingleKeys() {
  const on = useSyncExternalStore(
    singleKeysStore.subscribe,
    singleKeysStore.get,
    singleKeysStore.get
  );
  const set = useCallback((v) => singleKeysStore.set(v), []);
  return [on, set];
}

/**
 * Keep every canvas frame told: on each change, and to a frame that has just loaded or rendered (its
 * runtime listener may not be up at `loaded`, so `canvas-rendered` tells it again). Nothing is sent
 * while the switch is at its default (on) and never changed — the canvas starts on.
 * @param iframesRef Map<path, HTMLIFrameElement> (the shell's registered canvas frames)
 */
export function useSingleKeysLane(iframesRef, store = singleKeysStore) {
  useEffect(() => {
    let spoken = !store.get();
    const frames = () => [...(iframesRef.current?.values() ?? [])];
    // A literal `{ dgn }` (not postToCanvas) so the bridge inventory sees this send site.
    const tell = (win) => {
      try {
        win?.postMessage({ dgn: 'key-prefs', singleKeys: store.get() }, '*');
      } catch {
        /* detached */
      }
    };
    const unsub = store.subscribe(() => {
      spoken = true;
      for (const f of frames()) tell(f.contentWindow);
    });
    const onMessage = (e) => {
      const dgn = e.data?.dgn;
      if (!spoken || (dgn !== 'loaded' && dgn !== 'canvas-rendered')) return;
      const win = frames().find((f) => f.contentWindow === e.source)?.contentWindow;
      if (win) tell(win);
    };
    window.addEventListener('message', onMessage);
    return () => {
      unsub();
      window.removeEventListener('message', onMessage);
    };
  }, [iframesRef, store]);
}
