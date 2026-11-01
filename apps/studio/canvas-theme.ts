// The canvas's Light | Dark (r4 #6, decision `v2-michal-r4-global-light-dark`).
//
// ONE mode per canvas, switched by the pill at the top of the canvas (the one the Design system canvas always had).
// It governs every artboard: the artboard-follow rule in canvas-shell.tsx re-declares that mode's tokens on all of
// them, so a person no longer pins artboards one by one ("Follow chrome" / "DS default" are gone from Advanced).
//
//   start      the canvas's design system's own default theme (`__registerDesignSystem`), else Light
//   the pick   remembered per canvas, per Mac: `_canvas-state/<slug>.view.json` `canvasTheme` (DDR-115) — never the
//              versioned `.meta.json`. It reaches the iframe as `window.__canvas_meta__.canvasTheme` on load.
//   preview    `setCanvasTheme(mode, { persist: false })` — the Design system canvas's `?dsMode=` and the app's
//              `ds.set-theme-preview` show a mode without remembering it.
//
// The store lives on `globalThis`, not in a module `let`: a soft HMR re-evaluation (or a second copy of this file in
// one canvas bundle) must still agree on what the canvas shows, the same reason `__maudeLockedKeys` is a window global.

import { useSyncExternalStore } from 'react';
import { persistsCanvasMeta } from './read-only-mode.ts';

export type CanvasTheme = 'light' | 'dark';

interface Store {
  /** the pick (or preview) made in this session / seeded from the view file; null = none */
  chosen: CanvasTheme | null;
  /** the registered design system's default theme NAME (`dark`, `light`, `night`…), null = no system */
  dsDefault: string | null;
  /** the registered design system's name, null = no system */
  dsName: string | null;
  subs: Set<() => void>;
}

const KEY = '__maudeCanvasTheme';

function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  let s = g[KEY];
  if (!s) {
    s = { chosen: null, dsDefault: null, dsName: null, subs: new Set() };
    g[KEY] = s;
  }
  return s;
}

const emit = (): void => {
  for (const f of [...store().subs]) f();
};

/** The mode a theme NAME means: a theme literally called "dark" is Dark, everything else starts as Light. */
export const modeOfThemeName = (name: string | null | undefined): CanvasTheme =>
  typeof name === 'string' && name.toLowerCase() === 'dark' ? 'dark' : 'light';

interface MetaWindow {
  __canvas_meta__?: { canvasTheme?: unknown };
  __canvas_meta_file__?: string;
  __maude_last_meta_self_write_at?: number;
}

function savedPick(): CanvasTheme | null {
  if (typeof window === 'undefined') return null;
  const v = (window as unknown as MetaWindow).__canvas_meta__?.canvasTheme;
  return v === 'light' || v === 'dark' ? v : null;
}

/** The mode this canvas shows now: this session's pick, else the saved one, else its design system's default. */
export function getCanvasTheme(): CanvasTheme {
  const s = store();
  return s.chosen ?? savedPick() ?? modeOfThemeName(s.dsDefault);
}

/** The mode the canvas starts in with no pick at all (its design system's default) — what a reset goes back to. */
export const getCanvasThemeDefault = (): CanvasTheme => modeOfThemeName(store().dsDefault);

/** Called by `__registerDesignSystem`: the system this canvas renders under and its default theme's name. */
export function registerCanvasThemeSystem(ds: { name: string; themeDefault: string | null }): void {
  const s = store();
  if (s.dsDefault === ds.themeDefault && s.dsName === ds.name) return;
  s.dsDefault = ds.themeDefault;
  s.dsName = ds.name;
  emit();
}

/** The registered design system's name, or null on a canvas with none. */
export const getCanvasThemeSystemName = (): string | null => store().dsName;

/** Remember the pick for this canvas on this Mac (best-effort, fire-and-forget like the camera). */
function persist(mode: CanvasTheme): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
  // an embed, a Present follower and a past version are not the designer's own view (read-only-mode.ts)
  if (!persistsCanvasMeta()) return;
  const w = window as unknown as MetaWindow;
  const file = typeof w.__canvas_meta_file__ === 'string' ? w.__canvas_meta_file__ : null;
  if (!file) return;
  // keep the page-load snapshot current, so a soft remount reads the pick back (DDR-138)
  if (w.__canvas_meta__ && typeof w.__canvas_meta__ === 'object')
    w.__canvas_meta__.canvasTheme = mode;
  w.__maude_last_meta_self_write_at = Date.now();
  fetch('/_api/canvas-meta', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, patch: { canvasTheme: mode } }),
  }).catch((err) => {
    console.warn('[canvas-theme] persist failed:', err);
  });
}

/** Show `mode` on every artboard. `persist: false` is a preview — nothing is remembered. */
export function setCanvasTheme(mode: CanvasTheme, opts: { persist?: boolean } = {}): void {
  if (mode !== 'light' && mode !== 'dark') return;
  const s = store();
  const changed = getCanvasTheme() !== mode;
  s.chosen = mode;
  if (opts.persist !== false) persist(mode);
  if (changed) emit();
}

export function subscribeCanvasTheme(f: () => void): () => void {
  const subs = store().subs;
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export const useCanvasTheme = (): CanvasTheme =>
  useSyncExternalStore(subscribeCanvasTheme, getCanvasTheme, getCanvasTheme);

/** test seam */
export function __resetCanvasTheme(): void {
  const s = store();
  s.chosen = null;
  s.dsDefault = null;
  s.dsName = null;
  emit();
}
