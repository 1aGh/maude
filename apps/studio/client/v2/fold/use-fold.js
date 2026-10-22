// client/v2/fold/use-fold.js — V2-4.10: the one fold store of this page, wired to prefs.json, plus the hook.
//
// A tiny external store (like use-panel-layout.js): ⌘K "Open all Advanced sections", Settings › Reset
// and every fold on screen reach the same instance without threading state through the shell. The disk
// read is not made here: `useHydratePanelLayout` (shell/use-panel-layout.js) already GETs
// /_api/ui-prefs once per page and hands the same answer to `foldStore.hydrate`. A page that never
// hydrates (a test, a viewer) keeps the in-memory state.

import { useCallback, useSyncExternalStore } from 'react';
import { persistUiPrefs } from '../../shell/util.js';
import { createFoldStore } from './fold-store.js';

export const foldStore = createFoldStore({ persist: persistUiPrefs });

/** `[open, setOpen]` for one panel's fold; `setOpen` takes a boolean or an updater. */
export function useFold(panel) {
  const open = useSyncExternalStore(
    foldStore.subscribe,
    () => foldStore.get(panel),
    () => foldStore.get(panel)
  );
  const setOpen = useCallback(
    (v) => foldStore.set(panel, typeof v === 'function' ? v(foldStore.get(panel)) : v),
    [panel]
  );
  return [open, setOpen];
}

/** Is this panel's fold open by a remembered choice ("kept open")? */
export function useFoldRemembered(panel) {
  return useSyncExternalStore(
    foldStore.subscribe,
    () => foldStore.isRemembered(panel),
    () => foldStore.isRemembered(panel)
  );
}
