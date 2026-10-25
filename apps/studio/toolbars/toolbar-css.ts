// apps/studio/toolbars/toolbar-css.ts — the two canvas toolbars' stylesheet (V2-4.5a).
//
// Material (V2-1.8 M1/M4): the toolbar is an island — solid, hairline edge, soft shadow, NO
// backdrop-filter (`none` literally; the one blur lives behind `--island-backdrop` in the shell's CSS,
// and the iframe document has no use for it). Every colour / radius / shadow is the HUD family the
// generated block (`canvas-hud-tokens.gen.ts`, maude-v2) defines — never the canvas's own `--island-*`,
// which a canvas on the maude-v2 system would carry.
//
// Geometry is the kit's dock (P8 C5, boards 04 / 10 / 07): bottom 16 px, padding 8, gap 4, radius-xl;
// Edit's buttons 40 px with 18 px glyphs, Preview's "a size bigger" — 48 px, 22 px glyphs, radius-lg.
// The colours, inks and thicknesses are popovers of their slot (S4.8).
//
// Motion (ToolbarMorph, M6): Edit ↔ Preview swaps the slot group inside a fixed-position island, so the
// only animated properties are `opacity` and `transform` (compositor-only), over `--dur-panel` (220 ms).
// Reduced motion cuts to 1 ms.

export const TOOLBAR_CSS = `
.dc-tool-palette {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  align-items: stretch;
  background: var(--maude-chrome-bg-1, #ffffff);
  border: 0;
  border-radius: var(--maude-hud-radius-xl, 20px);
  box-shadow: var(--maude-hud-island-shadow, 0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent))), inset 0 0 0 0.5px var(--maude-hud-island-edge, var(--maude-chrome-border, rgba(0,0,0,0.08)));
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  font-family: var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  font-size: var(--maude-hud-type-sm, 12px);
  color: var(--maude-chrome-fg-0, #1a1a1a);
  z-index: 6;
  user-select: none;
  /* Intentionally NO overflow:hidden — the popovers are position:absolute children anchored above
     their slot; clipping the island would hide them. */
}
.dc-tool-palette .dc-tb-body {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
}
.dc-tool-palette .dc-tp-sep {
  align-self: center;
  width: 1px;
  height: 24px;
  background: var(--maude-chrome-border-default, rgba(0,0,0,0.12));
  margin: 0 4px;
}
.dc-tool-palette button {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: calc(var(--maude-hud-radius-xl, 20px) - 8px);
  padding: 0;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--maude-chrome-fg-0, #1a1a1a);
  cursor: pointer;
  position: relative;
  font: inherit;
  transition: background-color var(--maude-hud-dur-flip, 120ms) var(--maude-hud-ease-out, ease-out), color var(--maude-hud-dur-flip, 120ms) var(--maude-hud-ease-out, ease-out);
}
.dc-tool-palette button svg {
  width: 18px;
  height: 18px;
  display: block;
}
/* Preview's toolbar — annotation tools only, "a size bigger" than Edit's (board .dock .icon-btn.k-ad-b). */
.dc-tool-palette[data-testid="toolbar-preview"] .dc-tp-b {
  width: 48px;
  height: 48px;
  border-radius: var(--maude-hud-radius-lg, 14px);
}
.dc-tool-palette[data-testid="toolbar-preview"] .dc-tp-b svg {
  width: 22px;
  height: 22px;
}
.dc-tool-palette button:hover {
  background: var(--maude-chrome-bg-3, rgba(0,0,0,0.04));
}
.dc-tool-palette button:focus-visible {
  outline: 2px solid var(--maude-hud-focus-ring, var(--maude-hud-accent, #2a6fd6));
  outline-offset: 1px;
}
/* The active tool is accent-muted with accent text (kit .icon-btn[aria-pressed]); Share stays the one solid azure. */
.dc-tool-palette button[aria-pressed="true"] {
  background: var(--maude-hud-accent-muted, color-mix(in oklab, var(--maude-hud-accent, #2a6fd6) 14%, transparent));
  color: var(--maude-hud-accent-text, var(--maude-hud-accent, #2a6fd6));
}
/* Sticky is a note in the paper it places; the Marker wears its ink; Stickers a filled disc (board AnnotateIcon). */
.dc-tool-palette .dc-tp-note {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: var(--maude-hud-radius-xs, 4px) var(--maude-hud-radius-xs, 4px) var(--maude-hud-radius-md, 10px) var(--maude-hud-radius-xs, 4px);
  rotate: -6deg;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--maude-hud-object-ink, #1c1917) 14%, transparent);
}
.dc-tool-palette[data-testid="toolbar-preview"] .dc-tp-note { width: 22px; height: 22px; }
.dc-tool-palette .dc-tp-mk { position: relative; display: grid; place-items: center; }
.dc-tool-palette .dc-tp-ink {
  position: absolute;
  left: 1px;
  right: 1px;
  bottom: -5px;
  height: 4px;
  border-radius: 999px;
}
.dc-tool-palette .dc-tp-stamp-disc { fill: var(--maude-hud-object-yellow, #f2d36b); }
/* T19 — sticky-tool lock: a hairline ring + a corner badge on the armed slot. */
.dc-tool-palette button[data-sticky="true"] {
  box-shadow: inset 0 0 0 1px var(--maude-hud-accent, #2a6fd6);
}
.dc-tool-palette button .dc-tp-sticky-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  background: var(--maude-hud-accent, #2a6fd6);
  border-radius: 999px;
  box-shadow: 0 0 0 1px var(--maude-chrome-bg-1, #ffffff);
  opacity: 0;
  transition: opacity 50ms linear 50ms;
  pointer-events: none;
}
.dc-tool-palette button[data-sticky="true"] .dc-tp-sticky-badge { opacity: 1; }
/* A slot that opens a popover (Shape kinds, Marker tips, Sticky papers) — no caret: the board draws none. */
.dc-tool-palette .dc-tp-slot { position: relative; display: inline-flex; }
.dc-tp-shape-popover,
.dc-tp-list-popover,
.dc-tp-opts-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--maude-chrome-bg-1, #ffffff);
  border: 0;
  border-radius: var(--maude-hud-radius-lg, 14px);
  box-shadow: var(--maude-hud-island-shadow, 0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent))), inset 0 0 0 0.5px var(--maude-hud-island-edge, var(--maude-chrome-border, rgba(0,0,0,0.08)));
  color: var(--maude-chrome-fg-0, #1a1a1a);
  font-family: var(--maude-chrome-font-body, system-ui, sans-serif);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  z-index: 8;
}
.dc-tp-shape-popover button[aria-checked="true"],
.dc-tp-list-popover button[aria-checked="true"] {
  background: var(--maude-hud-accent-muted, color-mix(in oklab, var(--maude-hud-accent, #2a6fd6) 14%, transparent));
  color: var(--maude-hud-accent-text, var(--maude-hud-accent, #2a6fd6));
}
/* S4.8 — the colour popovers: Sticky's papers, the Marker's tip + inks + thicknesses, the Highlighter's hues + nibs. */
.dc-tp-opts-popover fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
/* the board's colour row (.k-ad-pop): an island pill, swatches 20 px, the current one ringed in accent */
.dc-tp-opts-popover { flex-direction: row; align-items: center; gap: 10px; padding: 6px 12px; border-radius: var(--maude-hud-radius-lg, 14px); white-space: nowrap; }
/* P8 C7 (15 an-marker): ONE row — segment · divider · inks · +N · divider · widths — the board's .an-mkpop pill */
.dc-tp-opts-popover .dc-tp-div { align-self: stretch; width: 1px; margin: 4px 0; background: var(--maude-chrome-border, rgba(0,0,0,0.08)); flex: none; }
.dc-tp-opts-popover .dc-tp-seg-row button.dc-tp-seg:not([data-testid="toolbar-tip-eraser"]) svg { display: none; }
.dc-tp-opts-popover .dc-tp-row,
.dc-tp-opts-popover .dc-tp-seg-row,
.dc-tp-opts-popover .dc-tp-swatches { display: flex; align-items: center; gap: 4px; }
.dc-tp-opts-popover .dc-tp-row { gap: 8px; }
.dc-tp-opts-popover button.dc-tp-swatch {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  border: 0;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--maude-hud-object-ink, #1c1917) 14%, transparent);
}
.dc-tp-opts-popover button.dc-tp-swatch[aria-pressed="true"] {
  box-shadow: 0 0 0 2px var(--maude-chrome-bg-1, #ffffff), 0 0 0 4px var(--maude-hud-accent, #2a6fd6);
}
.dc-tp-opts-popover button.dc-tp-more,
.dc-tp-opts-popover button.dc-tp-seg {
  width: auto;
  height: 28px;
  min-width: 28px;
  padding: 0 8px;
  gap: 6px;
  border-radius: var(--maude-hud-radius-sm, 6px);
  font: inherit;
  font-size: var(--maude-hud-type-sm, 12px);
}
.dc-tp-opts-popover button.dc-tp-seg[aria-pressed="true"] {
  background: var(--maude-hud-accent-muted, color-mix(in oklab, var(--maude-hud-accent, #2a6fd6) 14%, transparent));
  color: var(--maude-hud-accent-text, var(--maude-hud-accent, #2a6fd6));
}
.dc-tp-opts-popover .dc-tp-nib { border-radius: 50%; background: currentColor; display: inline-block; }
/* Marker tips / More: a vertical labeled list (the glyphs alone do not name a tip). */
.dc-tp-list-popover { flex-direction: column; min-width: 140px; }
.dc-tp-list-popover button {
  width: auto;
  height: auto;
  justify-content: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--maude-hud-radius-sm, 6px);
}
.dc-tp-list-popover button svg { width: 14px; height: 14px; }
.dc-tp-list-popover button span.dc-tp-label { font-size: var(--maude-hud-type-sm, 12px); }
/* ToolbarMorph — Edit ↔ Preview. The island stays put; its slot group fades in and the old one
   (a picture, not controls) fades out, both over --dur-panel. opacity + transform only. */
.dc-tool-palette[data-morph] .dc-tb-body {
  animation: dc-tb-in var(--maude-hud-dur-panel, 220ms) var(--maude-hud-ease-out, cubic-bezier(0.25, 0.8, 0.25, 1)) both;
}
.dc-tool-palette .dc-tb-ghost {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 8px;
  pointer-events: none;
  color: var(--maude-chrome-fg-1, rgba(40,30,20,0.75));
  animation: dc-tb-out var(--maude-hud-dur-panel, 220ms) var(--maude-hud-ease-out, cubic-bezier(0.25, 0.8, 0.25, 1)) both;
}
.dc-tool-palette .dc-tb-ghost .dc-tb-ghost-slot {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
@keyframes dc-tb-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@keyframes dc-tb-out {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(-6px); }
}
@media (prefers-reduced-motion: reduce) {
  .dc-tool-palette .dc-tb-body,
  .dc-tool-palette .dc-tb-ghost { animation-duration: 1ms; }
  .dc-tool-palette button,
  .dc-tool-palette button .dc-tp-sticky-badge { transition: none; }
}
`.trim();

export function ensureToolbarStyles(): void {
  if (typeof document === 'undefined') return;
  const old = document.getElementById('dc-tool-palette-css');
  if (old) {
    // A soft HMR of this module keeps the old element: refresh its text, never stack a second sheet.
    if (old.textContent !== TOOLBAR_CSS) old.textContent = TOOLBAR_CSS;
    return;
  }
  const s = document.createElement('style');
  s.id = 'dc-tool-palette-css';
  s.textContent = TOOLBAR_CSS;
  document.head.appendChild(s);
}
