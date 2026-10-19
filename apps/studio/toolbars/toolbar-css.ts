// apps/studio/toolbars/toolbar-css.ts — the two canvas toolbars' stylesheet (V2-4.5a).
//
// Material (V2-1.8 M1/M4): the toolbar is an island — solid, hairline edge, soft shadow, NO
// backdrop-filter (`none` literally; the one blur lives behind `--island-backdrop` in the shell's CSS,
// and the iframe document has no use for it). The island tokens are the shell's; the iframe document
// does not define them, so each falls back to the `--maude-chrome-*` family this document does.
//
// Geometry is v1's on purpose: bottom 16 px, 32 px buttons in 4 px padding. The colours, inks and
// thicknesses are popovers of their slot (S4.8; the dark swatch tray above the toolbar is retired).
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
  background: var(--island-bg, var(--maude-chrome-bg-0, #ffffff));
  border: 1px solid var(--island-edge, var(--maude-chrome-border, rgba(0,0,0,0.08)));
  border-radius: 14px;
  box-shadow: var(--island-shadow, 0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent)));
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  color: var(--maude-chrome-fg-0, #1a1a1a);
  z-index: 6;
  user-select: none;
  /* Intentionally NO overflow:hidden — the popovers are position:absolute children anchored above
     their slot; clipping the island would hide them. */
}
.dc-tool-palette .dc-tb-body {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 4px;
}
.dc-tool-palette .dc-tp-sep {
  width: 1px;
  background: var(--maude-chrome-border, rgba(0,0,0,0.08));
  margin: 6px 2px;
}
.dc-tool-palette button {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 10px;
  padding: 0;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--maude-chrome-fg-1, rgba(40,30,20,0.75));
  cursor: pointer;
  position: relative;
  transition: background-color 80ms linear, color 80ms linear;
}
.dc-tool-palette button:hover {
  background: color-mix(in oklab, var(--maude-hud-accent, #d63b1f) 8%, transparent);
  color: var(--maude-chrome-fg-0, #1a1a1a);
}
.dc-tool-palette button:focus-visible {
  outline: 2px solid var(--maude-hud-accent, #d63b1f);
  outline-offset: -2px;
}
/* DDR-046 — Active tool: tinted background + accent underbar + accent text. */
.dc-tool-palette button[aria-pressed="true"] {
  background: color-mix(in oklab, var(--maude-hud-accent, #d63b1f) 14%, transparent);
  color: var(--maude-hud-accent, #d63b1f);
}
.dc-tool-palette button[aria-pressed="true"]::after {
  content: "";
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 2px;
  height: 2px;
  background: var(--maude-hud-accent, #d63b1f);
  border-radius: 1px;
}
/* T19 — sticky-tool lock: a hairline ring + a corner badge on the armed slot. */
.dc-tool-palette button[data-sticky="true"] {
  box-shadow: inset 0 0 0 1px var(--maude-hud-accent, #d63b1f);
}
.dc-tool-palette button .dc-tp-sticky-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  background: var(--maude-hud-accent, #d63b1f);
  border-radius: 1px;
  box-shadow: 0 0 0 1px var(--maude-chrome-bg-0, #ffffff);
  opacity: 0;
  transition: opacity 50ms linear 50ms;
  pointer-events: none;
}
.dc-tool-palette button[data-sticky="true"] .dc-tp-sticky-badge { opacity: 1; }
/* A slot that opens a popover (Shape kinds, Marker tips) carries a small caret. */
.dc-tool-palette .dc-tp-slot { position: relative; display: inline-flex; }
.dc-tool-palette .dc-tp-caret {
  position: absolute;
  right: 2px;
  bottom: 1px;
  display: inline-flex;
  opacity: 0.5;
  pointer-events: none;
}
.dc-tp-shape-popover,
.dc-tp-list-popover,
.dc-tp-opts-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--island-bg, var(--maude-chrome-bg-0, #ffffff));
  border: 1px solid var(--island-edge, var(--maude-chrome-border, rgba(0,0,0,0.08)));
  border-radius: 12px;
  box-shadow: var(--island-shadow, 0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent)));
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  z-index: 8;
}
.dc-tp-shape-popover button[aria-checked="true"],
.dc-tp-list-popover button[aria-checked="true"] {
  background: color-mix(in oklab, var(--maude-hud-accent, #d63b1f) 14%, transparent);
  color: var(--maude-hud-accent, #d63b1f);
}
/* S4.8 — the colour popovers: Sticky's papers, the Marker's tip + inks + thicknesses, the Highlighter's hues + nibs. */
.dc-tp-opts-popover fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.dc-tp-opts-popover { flex-direction: column; gap: 6px; padding: 8px; white-space: nowrap; }
.dc-tp-opts-popover .dc-tp-row,
.dc-tp-opts-popover .dc-tp-seg-row,
.dc-tp-opts-popover .dc-tp-swatches { display: flex; align-items: center; gap: 4px; }
.dc-tp-opts-popover .dc-tp-row { gap: 8px; }
.dc-tp-opts-popover button.dc-tp-swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--maude-chrome-border, rgba(0,0,0,0.16));
}
.dc-tp-opts-popover button[aria-pressed="true"]::after { content: none; }
.dc-tp-opts-popover button.dc-tp-swatch[aria-pressed="true"] {
  box-shadow: 0 0 0 2px var(--maude-chrome-bg-0, #ffffff), 0 0 0 4px var(--maude-hud-accent, #d63b1f);
}
.dc-tp-opts-popover button.dc-tp-more,
.dc-tp-opts-popover button.dc-tp-seg {
  width: auto;
  height: 28px;
  min-width: 28px;
  padding: 0 8px;
  gap: 6px;
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
}
.dc-tp-opts-popover button.dc-tp-seg[aria-pressed="true"] {
  background: color-mix(in oklab, var(--maude-hud-accent, #d63b1f) 14%, transparent);
  color: var(--maude-hud-accent, #d63b1f);
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
  border-radius: 8px;
}
.dc-tp-list-popover button span.dc-tp-label { font-size: 12px; }
/* ToolbarMorph — Edit ↔ Preview. The island stays put; its slot group fades in and the old one
   (a picture, not controls) fades out, both over --dur-panel. opacity + transform only. */
.dc-tool-palette[data-morph] .dc-tb-body {
  animation: dc-tb-in var(--dur-panel, 220ms) var(--ease-out, cubic-bezier(0.2, 0.8, 0.2, 1)) both;
}
.dc-tool-palette .dc-tb-ghost {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 4px;
  pointer-events: none;
  color: var(--maude-chrome-fg-1, rgba(40,30,20,0.75));
  animation: dc-tb-out var(--dur-panel, 220ms) var(--ease-out, cubic-bezier(0.2, 0.8, 0.2, 1)) both;
}
.dc-tool-palette .dc-tb-ghost .dc-tb-ghost-slot {
  width: 32px;
  height: 32px;
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
