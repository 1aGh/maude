// client/v2/shell/panel-sizes.js — rc.1 finding 16 / 6: every resizable panel has a width the person can change.
//
// Before this, the right slot had ONE user width (`maude-rp-w`) that only Comments / Sync read: the Inspector was a
// fixed 264 card, Version history a fixed 372 island and the AI chat a fixed 340 — so the grip beside them drew its
// divider and dragging it did nothing, and the chat could not be made narrower than its floor.
//
// Each of those now keeps its own width, per Mac (localStorage, the same home as `maude-sb-w` / `maude-rp-w`). A width
// is the SLOT width — the island plus the 16 px gap the dock slot paints on its outer side — which is what the grip
// measures from. The grip sits on the edge of the WIDEST island in the slot (`gripTarget`), so the thing it draws
// beside is the thing it resizes.
//
// Pure store (injected storage) + a singleton + one hook, like panel-layout.js / use-panel-layout.js.

import { useSyncExternalStore } from 'react';
import { AI_PINNED_W } from './panel-layout.js';

/** The gap the dock slot paints beside an island (`--float-gap`). */
export const SLOT_GAP = 16;

/** The panels that own a width: `{ min, max, def }` are SLOT widths (island + gap). */
export const PANEL_SIZES = Object.freeze({
  // the Inspector card (14 `.k-insp`) is 248 + 16
  inspector: Object.freeze({ key: 'maude-rp-insp-w', min: 248, max: 480, def: 264 }),
  // Version history (11 `.pn-vh`): 356 + 16
  changes: Object.freeze({ key: 'maude-rp-changes-w', min: 320, max: 520, def: 372 }),
  // the AI chat: 340 + 16 by default, 420 + 16 when it is long (full height) and the person never chose a width
  ai: Object.freeze({ key: 'maude-ai-w', min: 296, max: 576, def: 356 }),
});

/** The AI chat's width while it is full height and the person has not chosen one (03 `ai-long`: 420 + the gap). */
export const AI_FULL_W = 436;

/** Which panel ids have an own width (anything else follows `maude-rp-w`). */
export const hasOwnWidth = (id) => Object.hasOwn(PANEL_SIZES, id);

const clampTo = (spec, v) => Math.min(spec.max, Math.max(spec.min, Math.round(v)));

/**
 * @param {{ read?: (key: string) => string | null, write?: (key: string, value: string) => void }} [io]
 */
export function createPanelSizes({ read = () => null, write = () => {} } = {}) {
  const widths = {};
  for (const [id, spec] of Object.entries(PANEL_SIZES)) {
    let v = Number.NaN;
    try {
      v = Number.parseInt(read(spec.key) ?? '', 10);
    } catch {
      /* storage blocked: the default */
    }
    widths[id] = Number.isFinite(v) ? clampTo(spec, v) : spec.def;
  }
  let aiFull = false;
  let target = null;
  let version = 0;
  const subs = new Set();
  const bump = () => {
    version += 1;
    for (const fn of subs) fn();
  };
  const store = {
    version: () => version,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    get: (id) => widths[id],
    /** Set a panel's slot width (clamped). Returns the width now in force. */
    set(id, w) {
      const spec = PANEL_SIZES[id];
      if (!spec || !Number.isFinite(w)) return widths[id];
      const next = clampTo(spec, w);
      if (next === widths[id]) return next;
      widths[id] = next;
      try {
        write(spec.key, String(next));
      } catch {
        /* the width still holds for this page */
      }
      bump();
      return next;
    },
    reset(id) {
      return store.set(id, PANEL_SIZES[id]?.def);
    },
    /** True once the person chose a width other than the default (the long-chat 420 then stops applying). */
    isCustom: (id) => widths[id] !== PANEL_SIZES[id]?.def,
    /** The chat reports whether it is full height (BigChat): the default width is wider then. */
    setAiFull(on) {
      const v = !!on;
      if (v === aiFull) return;
      aiFull = v;
      bump();
    },
    aiFull: () => aiFull,
    /** What the grip being dragged resizes (set at pointer-down, read by the move handler). */
    setTarget(id) {
      target = id ?? null;
    },
    target: () => target,
    /** `{ w, setW, min, max, def }` for a panel — the shape `PanelGrip` takes (setW accepts an updater). */
    handle(id) {
      const spec = PANEL_SIZES[id];
      return {
        w: widths[id],
        setW: (next) => store.set(id, typeof next === 'function' ? next(widths[id]) : next),
        min: spec.min,
        max: spec.max,
        def: spec.def,
      };
    },
  };
  return store;
}

/**
 * The AI chat's slot width: the person's own when they chose one; else the default for its state — 436 full height,
 * 420 docked, 356 otherwise.
 */
export function aiSlotWidth({ w, full = false, pinned = false }) {
  if (w !== PANEL_SIZES.ai.def) return w;
  if (pinned) return AI_PINNED_W;
  return full ? AI_FULL_W : PANEL_SIZES.ai.def;
}

/**
 * Which panel a grip resizes: the AI chat when it is the widest island in the slot, else the open main panel
 * (`'rp'` / `'sb'` when it has no width of its own — the generic side width).
 *
 * @param {{ active: string | null, mainW: number, aiW: number, generic: 'rp' | 'sb' }} a
 */
export function gripTarget({ active, mainW, aiW, generic }) {
  if (aiW > 0 && (!active || aiW >= mainW)) return 'ai';
  if (active && hasOwnWidth(active)) return active;
  return generic;
}

// ── the page's one instance ─────────────────────────────────────────────────────────────────────────────────

const browserIO = {
  read: (key) => globalThis.localStorage?.getItem(key) ?? null,
  write: (key, value) => globalThis.localStorage?.setItem(key, value),
};

export const panelSizes = createPanelSizes(browserIO);

/** Re-renders on any width change; returns the singleton (read it with `.get(id)` / `.handle(id)`). */
export function usePanelSizes() {
  useSyncExternalStore(panelSizes.subscribe, panelSizes.version, panelSizes.version);
  return panelSizes;
}
