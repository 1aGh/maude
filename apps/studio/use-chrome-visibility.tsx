/**
 * @file       use-chrome-visibility.tsx — canvas-chrome visibility store
 * @scope      apps/studio/use-chrome-visibility.tsx
 * @purpose    Tiny store shared by the in-canvas floating chrome — DCMiniMap +
 *             DCZoomToolbar (canvas-lib), ToolPalette, and AnnotationsLayer —
 *             so the dev-server menubar can hide/show the minimap and zoom
 *             controls, and drive a non-destructive "Presentation Mode" that
 *             overlays-hides ALL chrome (minimap, zoom, tool palette,
 *             annotations) without mutating the user's individual toggles.
 *             Mounted by CanvasShell (next to AnnotationsVisibilityProvider) so
 *             the user canvas (which renders the minimap/zoom) AND its overlay
 *             siblings under CanvasRouter all consume the same value. Updated
 *             by the `dgn:'view-chrome'` postMessage handler in CanvasRouter.
 *
 *             `present` is a master overlay-hide that supersedes `minimap`/
 *             `zoom`: while it is on, every chrome consumer renders nothing,
 *             and exiting restores whatever the individual toggles were.
 */

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export interface ChromeVisibilityState {
  /** Floating world mini-map (DCMiniMap). */
  minimap: boolean;
  /** Bottom zoom pill (DCZoomToolbar). */
  zoom: boolean;
  /** Presentation Mode — hides ALL chrome regardless of the two above. */
  present: boolean;
  /**
   * Generic layout guides (feature-1-artboard-kinds-foundation T4–T6) — UNLIKE
   * minimap/zoom/present, this is per-CANVAS persisted state (view.json
   * `overlays.guides`), not a global shell preference. DesignCanvasInner
   * self-seeds it from the canvas's own meta right after mount (see
   * canvas-lib.tsx); the shell's View-menu toggle then live-updates it through
   * the SAME `dgn:'view-chrome'` bridge as the other three flags.
   */
  guides: boolean;
  /**
   * feature-2-print-artboards T3 — "Show print guides" (bleed/trim/margin
   * overlay for `kind="print"` artboards). Same shape as `guides` above:
   * per-CANVAS persisted state (view.json `overlays.print`), self-seeded by
   * DesignCanvasInner, live-updated through the same `dgn:'view-chrome'`
   * bridge.
   */
  print: boolean;
  /**
   * S7.22 — "Show on canvas" for an artboard's safe zones. Per-CANVAS, per-person (view.json
   * `overlays.safeZones`), and UNLIKE `guides`/`print` it defaults to SHOWN: naming a preset on the artboard is
   * the opt-in, only an explicit `false` hides it.
   */
  safeZones: boolean;
  /**
   * P8 C8 (01 cf-open-big) — ⌘\ hid the panels: the toolbar folds to its one current tool (the board's
   * `Toolbar folded`). Shell-driven like `present` (`view-chrome {zen}`), never stored.
   */
  zen: boolean;
}

export interface ChromeVisibilityValue extends ChromeVisibilityState {
  /** Merge a partial patch (only the provided keys change). */
  setChrome: (patch: Partial<ChromeVisibilityState>) => void;
}

const ChromeVisibilityContext = createContext<ChromeVisibilityValue | null>(null);

export function ChromeVisibilityProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Partial<ChromeVisibilityState>;
}) {
  // Defaults MUST match the app-shell's own default view-prefs (app.jsx
  // MINIMAP_STORE / ZOOMCTL_STORE both default false) — otherwise a freshly
  // loaded canvas shows the minimap/zoom before (or instead of, when the seed
  // races the early inline-script `dgn:'loaded'`) the shell's OFF state is
  // applied, so a user with both toggled off still sees them. `present` is a
  // transient overlay, never persisted, so it stays false.
  const [state, setState] = useState<ChromeVisibilityState>({
    minimap: initial?.minimap ?? false,
    zoom: initial?.zoom ?? false,
    present: initial?.present ?? false,
    guides: initial?.guides ?? false,
    print: initial?.print ?? false,
    safeZones: initial?.safeZones ?? true,
    zen: initial?.zen ?? false,
  });
  const setChrome = useCallback((patch: Partial<ChromeVisibilityState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);
  const value = useMemo<ChromeVisibilityValue>(() => ({ ...state, setChrome }), [state, setChrome]);
  return (
    <ChromeVisibilityContext.Provider value={value}>{children}</ChromeVisibilityContext.Provider>
  );
}

/**
 * Returns the chrome-visibility value, or null when rendered outside a
 * provider (e.g. a bare DS specimen). Consumers treat null as "all visible"
 * so the default behaviour is unchanged.
 */
export function useChromeVisibility(): ChromeVisibilityValue | null {
  return useContext(ChromeVisibilityContext);
}
