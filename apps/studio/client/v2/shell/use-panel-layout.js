// client/v2/shell/use-panel-layout.js — V2-4.1: the shell's one panel-layout instance (see
// panel-layout.js) wired to the real notice host and to prefs.json, plus the React hook.

import { useEffect, useSyncExternalStore } from 'react';
import { dismissNotice, notify } from '../../../notifications.tsx';
import { persistUiPrefs } from '../../shell/util.js';
import { foldStore } from '../fold/use-fold.js';
import { createPanelLayout } from './panel-layout.js';

export const panelLayout = createPanelLayout({
  persist: persistUiPrefs,
  say: notify,
  unsay: dismissNotice,
});

/** The layout snapshot `{ hidden, pinned }`, live. */
export function usePanelLayout() {
  return useSyncExternalStore(panelLayout.subscribe, panelLayout.get, panelLayout.get);
}

let hydrated = false;
/** Read the pinned pref from disk once per page (the per-Mac home is prefs.json `pin.on`). */
export function useHydratePanelLayout() {
  useEffect(() => {
    if (hydrated) return undefined;
    hydrated = true;
    let live = true;
    fetch('/_api/ui-prefs')
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (live && p) {
          panelLayout.hydrate(p.prefs ?? p);
          foldStore.hydrate(p.prefs ?? p); // V2-4.10: the Advanced folds live in the same file
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
}
