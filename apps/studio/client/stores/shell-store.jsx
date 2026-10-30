// The shell store (V2-2.3) — the one context the shell's state owner (ShellState in app.jsx)
// provides and every shell surface reads, so a surface needs no prop drilling and the v2 chrome
// (Phase 4) mounts under the same provider as today's. Grouped by the module seam each value
// comes from: one group per custom hook (shellCore, tabs, canvasBridge, …) plus `local`.
import { createContext, useContext } from 'react';

export const ShellStoreContext = createContext(null);

/** The shell store; throws outside ShellState so a surface mounted in the wrong place fails loud. */
export function useShellStore() {
  const store = useContext(ShellStoreContext);
  if (!store)
    throw new Error('useShellStore() outside <ShellState> — mount the surface under the shell');
  return store;
}
