/**
 * @file       canvas-lib.tsx — dev-server-bundled canvas library
 * @scope      apps/studio/canvas-lib.tsx
 *             Ships with the dev-server install; resolved at canvas build time
 *             via the `@maude/canvas-lib` virtual specifier. Per DDR-025, this
 *             is the single source of truth — no project-side copy.
 * @purpose    Shared primitives + helpers + hooks for every TSX canvas
 *             (UI mocks + DS specimens). Imported via the virtual module
 *             specifier `@maude/canvas-lib`, which the dev-server's Bun.build
 *             resolver maps to this file. On /design:handoff the used exports
 *             are AST-inlined into the emitted registry-item so the consumer
 *             never sees the `@maude/canvas-lib` specifier.
 *
 * Exports (cold-reader cheat sheet):
 *
 *   Frame envelope ─────────────────────────────────────────────────────────
 *   DesignCanvas       Root wrapper. <div class="dc-canvas"> holding a
 *                      transformable <div class="dc-world"> world plane.
 *                      DCArtboard children inside the world are absolutely
 *                      positioned in world coords; pan/zoom (Phase 4 T2)
 *                      applies a single transform to the world plane.
 *   DCSection          Group label. Inside DesignCanvas it collapses to a
 *                      transparent wrapper (DCArtboard children take their
 *                      own world coords); standalone it keeps the legacy
 *                      <section>/<header><h2> chrome for specimens.
 *   DCArtboard         Bordered artboard with SKU strip header. Inside
 *                      DesignCanvas it absolutely-positions itself in world
 *                      coords resolved from meta.layout (or default grid).
 *                      Standalone it renders a fixed-size block at its given
 *                      width/height (specimens / legacy uses).
 *   DCPostIt           <aside class="dc-postit"> — sticky-note annotation.
 *   DrawProof          (Phase 25) Renders one vector mark across a size ladder
 *                      × {light, dark, single-color flatten} as labeled
 *                      DCArtboards — the draw engine's render/verify harness.
 *
 *   Specimen helpers ───────────────────────────────────────────────────────
 *   SpecimenHeader     The .specimen-hd row (sku + crumbs + ThemeToggle).
 *   SpecimenMeta       <dl class="specimen-meta"> ladder from entries[].
 *   KbdHint            <kbd> chrome.
 *   TokenChip          Inline visualiser for a var(--*) value.
 *   ColorSwatch        Square + label for a color token.
 *   TypeScaleRow       One row of a type-ladder specimen.
 *   ThemeToggle        Light/dark <button> group writing data-theme on <html>.
 *
 *   Hooks ──────────────────────────────────────────────────────────────────
 *   useTokens(prefix?) Resolves CSS custom properties from <html> computed style.
 *   useTheme()         Current theme + setter, syncs to <html data-theme>.
 *   useArtboardBounds(ref) ResizeObserver wrapper returning {width,height}.
 *
 *   Whiteboard toolkit (feature-whiteboard-ai-toolkit) ────────────────────
 *   window.__maudeCanvasRects() Installed as a side effect on module load.
 *                      Returns { artboards, elements, elementsTruncated } in
 *                      WORLD coords — the geometry manifest `maude design
 *                      canvas-rects` reads via headless Chromium so the
 *                      annotation read/write verbs never hand-compute a
 *                      coordinate. See the section right after DCArtboard.
 *   getLiveViewport()  The live pan/zoom, readable outside the React tree —
 *                      what the hook above converts screen rects through.
 *
 * Authoring vocabulary. Lift these before re-implementing equivalents. The
 * surface intentionally mirrors the .html-era specimen idioms one-for-one
 * (`.specimen-hd`, `.specimen-meta`, `.sku`, `.swatch`, `.stamp`) so existing
 * `_components.css` rules still target them.
 *
 * data-cd-id IDs are injected by canvas-pipeline.ts pass 1 — including on the
 * primitives below. That's fine; pipeline IDs change every time the lib
 * changes. Don't pin lib-internal IDs in tests.
 *
 * Phase 4 (2026-05-19) — DesignCanvas became a transformable world plane.
 * The engine is always on; a single-artboard canvas just defaults to
 * fit-to-screen and looks identical to pre-Phase 4. Layout + viewport state
 * live in `<file>.meta.json` via `window.__canvas_meta__` (T5 wiring).
 *
 * Phase 4.0.5 (2026-05-19) — relocated from `<designRoot>/_lib/canvas-lib.tsx`
 * per DDR-025; single source in dev-server. No project-side copy is scaffolded
 * anymore; legacy `_lib/` directories in downstream projects get a one-cycle
 * deprecation log at dev-server boot.
 */

import type { Easing } from 'motion/react';
import {
  AnimatePresence as _MotionAnimatePresence,
  motion as _motionImpl,
  useReducedMotion as _useReducedMotion,
} from 'motion/react';
import {
  type CSSProperties,
  createContext,
  Fragment,
  isValidElement,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ArtboardActivityOverlay } from './artboard-activity-overlay.tsx';
import {
  ArtboardGuidesOverlay,
  type GuideDefinitions,
  type OverlayVisibility,
} from './artboard-guides-overlay.tsx';
import { CanvasShell } from './canvas-shell.tsx';
import type { ArtboardPrintProp } from './print/units.ts';
// feature-2-print-artboards T3 — side-effect import: registers the print
// kind's overlay content (bleed/trim/margin) into artboard-guides-overlay's
// registry at module load, per that file's own "call registerKindOverlay at
// module load" contract. Must live in the same module graph every canvas
// bundle already pulls in (canvas-lib IS that shared graph — DDR-025), so a
// canvas never renders without the registration having run first.
import './print-overlay-content.tsx';
// feature-3-web-artboards T2 — same side-effect-import contract as the print
// registration above, for the 'web' kind's breakpoint-band chip.
import './web-overlay-content.tsx';
import {
  buildMoveArtboardsRecord,
  diffLayoutPositions,
} from './commands/move-artboards-command.ts';
import { scopedCdSelector, selectorIndex, shortText } from './dom-selection.ts';
import { applyCaptureChrome } from './exporters/capture-chrome.ts';
import {
  type DomToSvgApi,
  pinArtboard,
  rasterizeSvg,
  resetWorldPlane,
  restoreArtboard,
  restoreWorldPlane,
  svgForElement,
} from './exporters/capture-core.ts';
// Photo editor (feature-photo-editor) — schema.ts is DEPENDENCY-FREE (no pixi),
// so this static import is safe and adds zero bundle cost. The WebGL compositor
// (photo/pipeline.ts, which imports pixi.js) is loaded via a DYNAMIC import
// inside <PhotoLayer> only when an edited photo actually mounts — see there.
import { isDefaultEdit, type PhotoEdit } from './photo/schema.ts';
import { isReadOnlyCanvas } from './read-only-mode.ts';
import { AgentPresenceProvider, useAgentPresence } from './use-agent-presence.tsx';
import { type DragState, useArtboardDrag } from './use-artboard-drag.tsx';
import {
  CanvasActivityProvider,
  matchesArtboard,
  useCanvasActivity,
} from './use-canvas-activity.tsx';
import { useChromeVisibility } from './use-chrome-visibility.tsx';
import { CollabProvider, canvasSlugFromPath } from './use-collab.tsx';
import { useSelectionSetOptional } from './use-selection-set.tsx';
import { MaybeToolProvider, useToolModeOptional } from './use-tool-mode.tsx';
import { UndoStackProvider, useUndoSinks, useUndoStackOptional } from './use-undo-stack.tsx';
// DDR-148 — video-comp canvas kind. Imported (not just re-exported below) so
// DCArtboard can identity-match <VideoComp> for the header badge. Its
// `remotion`/`@remotion/player` imports resolve through the canvas importmap
// (RUNTIME_PACKAGES), same as react/motion.
import { VideoComp } from './video-comp.tsx';

export type { CompSnapshot, VideoCompMeta, VideoCompProps } from './video-comp.tsx';
export { VideoComp };

// ─────────────────────────────────────────────────────────────────────────────
// AIPlaceholder — feature-enhanced-video-editing (Task 21). A prompt-carrying
// slate clip: occupies real timeline space inside a video-comp until the
// DDR-164 generation spine resolves it into media (replace-media swaps the
// slate in place; the clip's stableId survives). Deterministic, DS-tokened,
// export-safe (renders identically in the Player and both export paths).
// Plain absolutely-filled divs — deliberately no remotion import here.

export interface AIPlaceholderProps {
  /** The generation prompt (user text — rendered as TEXT, never executed).
   *  Prefer passing it as CHILDREN (`<AIPlaceholder>{"…"}</AIPlaceholder>`) —
   *  a stamped child element is inline-editable in the artboard. */
  prompt?: string;
  /** Target generator: veo (video) · motion (motion-graphics video) · image. */
  kind?: 'veo' | 'motion' | 'image';
  /** Optional display hint (the clip's own durationInFrames rules playback). */
  durationInFrames?: number;
  /** The prompt slot (wins over `prompt` when present). */
  children?: React.ReactNode;
}

export function AIPlaceholder({
  prompt,
  kind = 'veo',
  durationInFrames,
  children,
}: AIPlaceholderProps) {
  return (
    <div
      data-ai-placeholder={kind}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background:
          'repeating-linear-gradient(45deg, var(--bg-0, #101014), var(--bg-0, #101014) 14px, var(--bg-1, #16161c) 14px, var(--bg-1, #16161c) 28px)',
        border: '2px dashed var(--accent, #7c8cf8)',
        boxSizing: 'border-box',
        color: 'var(--fg-0, #fff)',
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
        padding: '6%',
      }}
    >
      <div style={{ display: 'grid', gap: 10, maxWidth: '80%' }}>
        <div style={{ fontSize: 22, lineHeight: 1.4, color: 'var(--fg-0, #fff)' }}>
          {children ?? prompt}
        </div>
        {durationInFrames ? (
          <div
            style={{ fontSize: 12, color: 'var(--fg-2, #9aa)', fontVariantNumeric: 'tabular-nums' }}
          >
            {durationInFrames}f
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Module constants

// Issue #91 — was 0.1. A board spanning more world units than ~10x the
// viewport could never be framed whole: `fit()` and manual zoom-out both
// funnel through `clampZoom` (below), so the old floor blocked "fit to
// screen" from ever reaching the zoom a wide board actually needs. 0.02
// matches the interactive floor other canvas tools (Figma, tldraw) ship.
// Keep in lockstep with the mirror clamp in `api.ts`'s `normalizeViewport`
// (the per-machine camera persisted to `_canvas-state/<slug>.view.json`,
// DDR-115) — that one re-clamps on save/reload independently of this file.
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 4.0;
const ZOOM_STEP_IN = 1.2;
const ZOOM_STEP_OUT = 1 / 1.2;
const WHEEL_ZOOM_K = 0.0035; // larger = more sensitive wheel — tuned to match Figma/FigJam's zoom-per-notch feel
const SETTLE_MS = 500;
const PUBLISH_MS = 50;

// WebKit (Safari + the Tauri WKWebView native shell, DDR-106) vs Blink (Chrome).
// The two engines render the CSS `zoom` property incompatibly (see writeTransform),
// so the scale dimension takes a different path on each. Detected via Apple's
// `navigator.vendor` and the WebKit-only `GestureEvent` global — both absent in
// Chrome/Edge/Firefox, present in Safari and WKWebView. Evaluated once at module
// load; the canvas always runs in a browser/webview context.
const IS_WEBKIT =
  typeof navigator !== 'undefined' &&
  (/apple/i.test(navigator.vendor || '') ||
    (typeof window !== 'undefined' && 'GestureEvent' in window));

// ─────────────────────────────────────────────────────────────────────────────
// Render instrumentation (feature-canvas-render-performance).
//
// The whole point of this work is the invariant "a pan/zoom gesture triggers no
// React render", and an invariant nothing measures is just an intention. The
// counter is OFF unless a probe installs `window.__dcPerf` first, so the
// production cost is one property read per render — far below the reconciliation
// it exists to count. `maude design perf` installs the object, drives a scripted
// gesture, and reports the count; an uninstrumented build reports null rather
// than 0, because "not measured" must never read as "measured zero".
type DcPerfCounters = {
  artboardRenders: number;
  annotationRenders: number;
  instrumented?: boolean;
};

/** The numeric counters only — `instrumented` is a flag, not something to add 1 to. */
type DcPerfCounterKey = {
  [K in keyof DcPerfCounters]-?: DcPerfCounters[K] extends number | undefined ? K : never;
}[keyof DcPerfCounters];

export function countRender(key: DcPerfCounterKey): void {
  if (typeof window === 'undefined') return;
  const perf = (window as unknown as { __dcPerf?: DcPerfCounters }).__dcPerf;
  if (!perf) return;
  // Never let instrumentation break rendering. The page owns this object, so a
  // canvas could hand back a frozen one — assigning to it throws in strict-mode
  // ESM, and that would take out every DCArtboard render with it.
  try {
    perf.instrumented = true;
    perf[key] = ((perf[key] as number) || 0) + 1;
  } catch {
    /* frozen or exotic object — measuring is optional, rendering is not */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine CSS (Phase 4) — injected once per iframe inside DesignCanvas's mount.
// The visual chrome of `.dc-artboard` (borders, label strip, SKU type) still
// lives in the DS's _components.css. Engine CSS ONLY covers positioning + the
// world transform. Idempotent via the `dc-engine-css` id check.

const ENGINE_CSS = `
.dc-canvas {
  position: absolute;
  inset: 0;
  overflow: hidden;
  outline: none;
  /* WebKit text inflation must not re-grow artboard text that the world scales
     down on zoom-out. Inherited, so this covers every descendant. No-op on Blink. */
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  /* DDR-046 — snap-layer magenta is distinct from --accent so the snap chrome
     never visually melts into the selection halo during a drag-snap gesture.
     OKLCH default approximates FigJam magenta in the project's color space. */
  --guide-magenta: oklch(62% 0.28 350);
  /* Canvas-shell chrome — the workspace plane + dotted grid follow the Maude
     chrome theme (--maude-chrome-*), NOT the DS palette. See canvas-shell.tsx
     HUD_TOKENS_CSS. Artboards (.dc-artboard) keep the DS theme. */
  background-color: var(--maude-chrome-bg-0, #f4f1ea);
  background-image:
    radial-gradient(var(--maude-chrome-dot, rgba(0,0,0,0.12)) 1.1px, transparent 1.2px);
  background-size: 24px 24px;
}
/* DDR-046 — Snap guides. Sibling kind = confident magenta + glow + distance
   pill. Grid kind = lighter gray fallback, no pill. Width 2 px (up from 1 px)
   so the line stays readable at zoom < 0.8. */
.dc-snap-guide {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  animation: dc-snap-spawn 80ms cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: center;
}
.dc-snap-guide--sibling {
  background: var(--guide-magenta, oklch(62% 0.28 350));
  box-shadow: 0 0 4px color-mix(in oklab, var(--guide-magenta, oklch(62% 0.28 350)) 35%, transparent);
}
.dc-snap-guide--grid {
  background: color-mix(in oklab, var(--maude-chrome-fg-1, #4a3f30) 40%, transparent);
}
.dc-snap-pill {
  position: fixed;
  pointer-events: none;
  z-index: 7;
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: #fff;
  background: var(--guide-magenta, oklch(62% 0.28 350));
  padding: 3px 6px;
  border-radius: 3px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  animation: dc-snap-pill-spawn 80ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes dc-snap-spawn {
  from { opacity: 0; transform: scaleY(0.92); }
  to   { opacity: 1; transform: scaleY(1); }
}
@keyframes dc-snap-pill-spawn {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.88); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .dc-snap-guide,
  .dc-snap-pill {
    animation: none !important;
  }
}
.dc-canvas:focus { outline: none; }
.dc-world {
  position: absolute;
  top: 0;
  left: 0;
  /* CSS zoom drives the scale; transform handles pan. transform-origin is
     irrelevant under zoom (zoom anchors top-left of the box). will-change
     hints to the compositor that this layer changes often. */
  will-change: transform;
  /* Marquee / multi-select drags over artboards must not trigger native text
     selection (it highlighted the canvas content). Editable surfaces re-enable
     it below. */
  user-select: none;
  -webkit-user-select: none;
}
.dc-world input,
.dc-world textarea,
.dc-world [contenteditable="true"] {
  user-select: text;
  -webkit-user-select: text;
}
.dc-section-collapsed { display: contents; }

.dc-canvas .dc-artboard {
  background: var(--bg-0, #ffffff);
  color: var(--fg-0, #2a2520);
  /* Quiet frame chrome — FigJam Section / Figma Frame canonical. The Memphis
     hard-shadow is the Maude brand on USER CONTENT inside artboards; the frame
     itself stays calm so user content reads as loud. */
  border: 1px solid color-mix(in oklab, var(--fg-0, #2a2520) 22%, transparent);
  border-radius: 2px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Per-board compositor freeze (RCA: large filter/blend-heavy canvases jank on
     pan/zoom). Promote each artboard to its own GPU layer that rasterizes ONCE
     into a fixed bitmap the compositor then translates/scales — instead of
     re-running its paint every frame. Load-bearing on WebKit/WKWebView, which
     does NOT hardware-accelerate SVG url() reference filters or feTurbulence
     (only CSS shorthand filters), so a scale change would otherwise re-RASTER
     every board's poster/grain/blend at once (the fit-all zoom cliff).
     will-change:transform (NOT plain translateZ(0)) is the fix: it freezes the
     rastered bitmap so it never re-rasters under transform updates — fit-all pan
     composites finished textures, zoom SCALES them (sharp when zoomed out).
     Filters stay LIVE in the DOM — nothing baked — so the exact look and full
     editability are preserved; paint just happens once per board, not per frame.
     isolation:isolate bounds each board's blend backdrop so the texture is
     self-contained/cacheable (isolation/contain do not themselves promote —
     will-change does). content-visibility (on .dc-positioned) culls off-screen
     boards so the promoted-layer count + GPU memory stay bounded to what's in
     view. NB: this is the realistic ceiling on WebKit — a Chromium engine (Blink)
     GPU-accelerates url() filters and renders such canvases more smoothly.
     See .ai/logs/rca/issue-canvas-pan-zoom-jank-large-moodboard.md. */
  isolation: isolate;
  contain: paint;
  will-change: transform;
}
.dc-canvas .dc-artboard.dc-positioned { position: absolute; }
.dc-canvas .dc-artboard-label {
  flex-shrink: 0;
  background: var(--bg-2, #e8e3d8);
  border-bottom: 1px solid var(--fg-0, #2a2520);
  padding: 6px 14px;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-1, #4a3f30);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
/* T3 — per-kind chrome. Subtle tint on the header + a small glyph before the
   label text, for any non-digital kind. digital (the default, and every
   unmigrated canvas) renders no chip and no tint — byte-identical chrome. */
.dc-canvas .dc-artboard[data-dc-kind]:not([data-dc-kind='digital']) .dc-artboard-label {
  background: color-mix(in oklab, var(--accent, var(--fg-2, #4a3f30)) 10%, var(--bg-2, #e8e3d8));
}
.dc-canvas .dc-artboard-kind-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 6px;
  color: var(--accent, var(--fg-1, #4a3f30));
  opacity: 0.85;
  vertical-align: -1px;
}
.dc-canvas .dc-artboard-body {
  flex: 1;
  position: relative;
  overflow: hidden;
  /* Artboard-isolation root. An artboard is a fixed-size design surface — its
     content must NOT react to the studio chrome (panel/sidebar/window resize)
     or to pan/zoom. But @media, vw/vh, and position:fixed in mock CSS resolve
     against the iframe viewport (= the studio's canvas stage), not this box —
     so widening the Assistant panel narrows the iframe and reflows the mock
     even though the world zoom never changed. A transformed ancestor (dc-world)
     already re-roots position:fixed; container-type re-roots the responsive
     path: authors get artboard-relative @container queries + cqw/cqh units that
     stay put. Viewport units still escape by spec (no CSS can re-root them) —
     the smoke lint + design-system-keeper flag those, and the design:new +
     frontend-design guidance steers mocks off them. (NB: no backticks in this
     comment — it lives inside the ENGINE_CSS template literal.) */
  container-type: inline-size;
}
button.dc-artboard-label {
  appearance: none;
  border-width: 0 0 1px 0;
  font: inherit;
  cursor: pointer;
  text-align: left;
  display: block;
  width: 100%;
}
button.dc-artboard-label:focus-visible { outline: 2px solid var(--maude-hud-accent, #d63b1f); outline-offset: -2px; }
input.dc-artboard-rename {
  appearance: none;
  border-width: 0 0 1px 0;
  font: inherit;
  display: block;
  width: 100%;
  box-sizing: border-box;
  text-transform: none;
  outline: 2px solid var(--maude-hud-accent, #d63b1f);
  outline-offset: -2px;
}
/* DDR-148 — video-artboard badge, overlaid top-right of the header. Opens
   the timeline panel (same postMessage the context-menu entry sends). */
.dc-canvas .dc-artboard-video-badge {
  position: absolute;
  top: 4px;
  right: 6px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  appearance: none;
  border: none;
  border-radius: 3px;
  background: var(--bg-2, #e8e3d8);
  color: var(--fg-1, #4a3f30);
  cursor: pointer;
}
.dc-canvas .dc-artboard-video-badge:hover { background: color-mix(in oklab, var(--fg-0, #2a2520) 12%, var(--bg-2, #e8e3d8)); }
.dc-canvas .dc-artboard-video-badge:focus-visible { outline: 2px solid var(--maude-hud-accent, #d63b1f); outline-offset: 1px; }
/* Active-artboard ring is in canvas-shell HALO_CSS (subtle 1 px tint). */
/* Phase 4.2 — drag chrome. */
.dc-canvas[data-active-tool="move"] .dc-artboard-label { cursor: grab; }
.dc-canvas[data-active-tool="move"] .dc-artboard-label:active { cursor: grabbing; }
/* Post-Wave-2 — direct artboard drag. The article itself updates its
   inline left/top during drag (no ghost placeholder, no opacity fade on
   the original). Compositor handles the pixel movement; halo + group
   bbox naturally follow via getBoundingClientRect on the article. */
.dc-canvas .dc-artboard.dc-dragging {
  z-index: 5;
  /* Keep the cursor consistent with the label's grabbing affordance even
     when the pointer drifts off the label strip during the drag. */
  cursor: grabbing;
}
`.trim();

function ensureEngineStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-engine-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-engine-css';
  s.textContent = ENGINE_CSS;
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// World context — published by DesignCanvas. Consumed by DCArtboard (for
// world-coord positioning) and by DCSection (which collapses inside the
// canvas) and by future T3 components (MiniMap, ZoomToolbar).

/**
 * What an artboard IS — digital screen / print page / web flow / video comp.
 * Absent JSX prop resolves to `digital` (DDR-027-consistent: JSX is truth,
 * no meta PATCH lane). Drives chrome (T3), the guides overlay content
 * registry (T4), and generation/editing rules downstream (feature-2-print,
 * feature-3-web).
 */
export type ArtboardKind = 'digital' | 'print' | 'web' | 'video';

export interface ArtboardRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Resolved kind (explicit `kind` prop, or `video` fallback via
   *  `subtreeHasVideoComp`, or `digital`) — JSX-authoritative, recomputed
   *  from `harvestArtboards` every render; never persisted to meta. */
  kind: ArtboardKind;
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface WorldContextValue {
  /** Look up a DCArtboard's world-coord rect by its `id` prop. */
  rectFor: (id: string) => ArtboardRect | null;
  /** All artboards in render order, with resolved world-coord positions. */
  artboards: ArtboardRect[];
  /** Hug-mode artboards report their measured DOM height here so the shared
   *  ArtboardRect model (drag hit-test, marquee, fit-to-screen, culling) stays
   *  in sync with content that grows/shrinks. Runtime-only — never persisted
   *  to meta; a fixed-mode board never calls this. */
  reportMeasuredHeight: (id: string, h: number) => void;
  /** Current pan/zoom state. `null` until the first useLayoutEffect runs. */
  viewport: ViewportState | null;
  /** id of the artboard closest to the viewport center (recomputed on settle). */
  activeArtboardId: string | null;
  /** The fixed-bleed `.dc-canvas` host (visible iframe area). */
  hostRef: RefObject<HTMLDivElement | null>;
  /** The transformable `.dc-world` element. */
  worldRef: RefObject<HTMLDivElement | null>;
}

const WorldContext = createContext<WorldContextValue | null>(null);

function useWorldContext(): WorldContextValue | null {
  return useContext(WorldContext);
}

/** Read-only access to the artboard list + viewport state. Used by overlays
 *  that need to operate on artboards directly (distribute, marquee, etc.). */
export function useArtboardsContext(): WorldContextValue | null {
  return useContext(WorldContext);
}

// Phase 5.1: annotations-layer needs the world `<div>` to portal a stroke SVG
// inside it (so CSS zoom + translate apply natively, no per-frame projection
// math). Expose only the ref — the rest of WorldContextValue stays internal.
export function useWorldRefContext(): RefObject<HTMLDivElement | null> | null {
  const ctx = useContext(WorldContext);
  return ctx?.worldRef ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout synthesis. Default grid + fit-to-screen compute. Phase 4 T2 will
// replace the "always re-fit on resize" useLayoutEffect with the
// useViewportController hook; for T1 we hold the world at fit-to-screen
// (or at meta.viewport if seeded) and don't yet expose pan/zoom inputs.

const VP_GRID = { cols: 3, w: 1280, h: 820, gutter: 80 } as const;

interface ArtboardSeed {
  id: string;
  w: number;
  h: number;
  kind: ArtboardKind;
}

const ARTBOARD_KINDS: ReadonlySet<string> = new Set(['digital', 'print', 'web', 'video']);

/**
 * Walk a children subtree harvesting DCArtboard descriptors in render order.
 * DCSection (and any other wrapper) is traversed but doesn't appear in the
 * harvest. Identity-matches against the DCArtboard reference so renamed
 * imports don't trip it; falls back to displayName for minified builds.
 */
function harvestArtboards(children: ReactNode): ArtboardSeed[] {
  const out: ArtboardSeed[] = [];
  let auto = 0;
  function visit(node: ReactNode): void {
    if (node == null || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (!isValidElement(node)) return;
    const type = node.type;
    const isArtboard =
      type === DCArtboard ||
      (typeof type === 'function' &&
        (type as { displayName?: string }).displayName === 'DCArtboard');
    if (isArtboard) {
      const props = node.props as {
        id?: string;
        width?: number;
        height?: number;
        kind?: string;
        children?: ReactNode;
      };
      const explicitKind =
        typeof props.kind === 'string' && ARTBOARD_KINDS.has(props.kind)
          ? (props.kind as ArtboardKind)
          : undefined;
      out.push({
        id: typeof props.id === 'string' && props.id.length > 0 ? props.id : `__ab_${auto}`,
        w: typeof props.width === 'number' ? props.width : VP_GRID.w,
        h: typeof props.height === 'number' ? props.height : VP_GRID.h,
        kind: explicitKind ?? (subtreeHasVideoComp(props.children) ? 'video' : 'digital'),
      });
      auto++;
      return;
    }
    const childProp = (node.props as { children?: ReactNode } | null | undefined)?.children;
    if (childProp != null) visit(childProp);
  }
  visit(children);
  return out;
}

/**
 * Does this artboard's subtree contain a <VideoComp>? Same identity-match +
 * displayName-fallback walk as harvestArtboards, short-circuiting on the
 * first hit — used to badge video artboards in DCArtboard's header.
 */
function subtreeHasVideoComp(children: ReactNode): boolean {
  function visit(node: ReactNode): boolean {
    if (node == null || typeof node === 'boolean') return false;
    if (Array.isArray(node)) return node.some(visit);
    if (!isValidElement(node)) return false;
    const type = node.type;
    if (
      type === VideoComp ||
      (typeof type === 'function' && (type as { displayName?: string }).displayName === 'VideoComp')
    ) {
      return true;
    }
    const childProp = (node.props as { children?: ReactNode } | null | undefined)?.children;
    return childProp != null ? visit(childProp) : false;
  }
  return visit(children);
}

function synthDefaultGrid(seeds: ArtboardSeed[]): ArtboardRect[] {
  // Render order (the order DCArtboards appear in JSX), not alphabetical —
  // authors label artboards DS-01 / DS-02 / CV-01 etc. and expect that
  // numeric order to show top-left → bottom-right, but their ids are usually
  // semantic (`landing`, `docs-article`, `cmd-k`, `about`) which would
  // shuffle the numeric order.
  // Column / row size come from the largest artboard so canvases with mixed
  // dimensions (width=1440 on Docs Site, width=1280 elsewhere) don't bleed
  // past a 1280-step grid.
  if (seeds.length === 0) return [];
  const cellW = seeds.reduce((m, s) => Math.max(m, s.w), 0) || VP_GRID.w;
  const cellH = seeds.reduce((m, s) => Math.max(m, s.h), 0) || VP_GRID.h;
  return seeds.map((seed, i) => {
    const col = i % VP_GRID.cols;
    const row = Math.floor(i / VP_GRID.cols);
    return {
      id: seed.id,
      x: col * (cellW + VP_GRID.gutter),
      y: row * (cellH + VP_GRID.gutter),
      w: seed.w,
      h: seed.h,
      kind: seed.kind,
    };
  });
}

// Exported for the same reason as `clampZoom` above — lets a unit test prove
// the raw fit computation for a wide board isn't what's clamping the zoom.
export function computeFit(rects: ArtboardRect[], hostEl: HTMLElement, pad = 24): ViewportState {
  if (rects.length === 0) return { x: 0, y: 0, zoom: 1 };
  let xMin = Number.POSITIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    if (r.x < xMin) xMin = r.x;
    if (r.y < yMin) yMin = r.y;
    if (r.x + r.w > xMax) xMax = r.x + r.w;
    if (r.y + r.h > yMax) yMax = r.y + r.h;
  }
  const bw = xMax - xMin;
  const bh = yMax - yMin;
  const vw = hostEl.clientWidth;
  const vh = hostEl.clientHeight;
  if (!vw || !vh || bw <= 0 || bh <= 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = Math.min((vw - pad * 2) / bw, (vh - pad * 2) / bh, 1.0);
  const x = (vw - bw * zoom) / 2 - xMin * zoom;
  const y = (vh - bh * zoom) / 2 - yMin * zoom;
  return { x, y, zoom };
}

/**
 * Read the canvas-meta sidecar that the dev-server's `_shell.html` injects
 * on `window.__canvas_meta__` (Phase 4 T5). Returns undefined if the canvas
 * is mounted outside the shell (specimens / unit tests).
 */
function readCanvasMeta():
  | {
      layout?: { artboards?: ArtboardRect[] };
      viewport?: ViewportState;
      /** T6 — per-user overlay-visibility bag, GET-merged in from view.json
       *  server-side (never present in the versioned `.meta.json` itself). */
      overlays?: OverlayVisibility;
    }
  | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    __canvas_meta__?: {
      layout?: { artboards?: ArtboardRect[] };
      viewport?: ViewportState;
      overlays?: OverlayVisibility;
    };
  };
  return w.__canvas_meta__;
}

/**
 * Returns the repo-relative path the shell stashed alongside the meta so
 * onSettle PATCHes know which sidecar to write back to.
 */
function readCanvasMetaFile(): string | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __canvas_meta_file__?: string };
  return typeof w.__canvas_meta_file__ === 'string' ? w.__canvas_meta_file__ : null;
}

/**
 * PATCH the canvas-meta sidecar with `{ viewport }` or `{ layout }`. Best-effort
 * fire-and-forget — failures are logged but don't disrupt the canvas.
 *
 * Phase 4.2 (DDR-027): artboard `w`/`h` is JSX-authoritative. The writer
 * strips any `w`/`h` keys from `layout.artboards[]` before PATCH so a drag
 * commit only persists the position pair `{ id, x, y }`. The reader stays
 * tolerant of legacy entries that still carry `w`/`h` (Phase 4 default-grid
 * snapshots remain readable until the next drag overwrites them).
 */
/**
 * Wire shape persisted to `meta.layout.artboards[]`. DDR-027: positions only,
 * size is JSX-authoritative. Distinct from the in-memory `ArtboardRect` which
 * still carries `w`/`h` for layout math.
 */
interface PersistedArtboardLayout {
  id: string;
  x: number;
  y: number;
}

/**
 * Phase 20 (DDR-050) — last timestamp at which THIS iframe wrote canvas
 * meta. Read by `use-undo-stack.tsx` to discriminate self-echo fs:json
 * events from genuine external edits.
 */
declare global {
  interface Window {
    __maude_last_meta_self_write_at?: number;
  }
}

const META_SELF_ECHO_WINDOW_MS = 500;

/** Recent enough to be our own PATCH echoing back through fs-watch. */
export function isMetaSelfEcho(now: number = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  const last = window.__maude_last_meta_self_write_at ?? 0;
  return now - last < META_SELF_ECHO_WINDOW_MS;
}

function patchCanvasMeta(patch: {
  viewport?: ViewportState;
  layout?: { artboards: ArtboardRect[] };
}): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
  // Cloud Phase 25 C2 — a read-only session persists its CAMERA (per-user
  // `_canvas-state/` view, DDR-115) but never the LAYOUT lane (versioned
  // `.meta.json`). The dev-server refuses the layout lane too (http.ts);
  // dropping it here keeps the UI from even trying.
  if (patch.layout && isReadOnlyCanvas()) {
    if (!patch.viewport) return;
    patch = { viewport: patch.viewport };
  }
  const file = readCanvasMetaFile();
  if (!file) return;
  const sanitized: {
    viewport?: ViewportState;
    layout?: { artboards: PersistedArtboardLayout[] };
  } = {};
  if (patch.viewport) sanitized.viewport = patch.viewport;
  if (patch.layout?.artboards) {
    sanitized.layout = {
      artboards: patch.layout.artboards.map((r) => ({
        id: r.id,
        x: r.x,
        y: r.y,
      })),
    };
  }
  // Mirror the patch into the in-iframe meta snapshot. `getInitial` (viewport +
  // layout) reads `window.__canvas_meta__`, which is otherwise populated ONCE at
  // page load — so after a settle, a soft HMR remount (any module edit: text,
  // reorder, agent edit) would re-read the STALE page-load camera and reset the
  // pan/zoom. Keeping the snapshot current means the remount restores the live
  // camera. General fix, not reorder-specific. (DDR-138 dogfood.)
  const w = window as unknown as {
    __canvas_meta__?: {
      viewport?: ViewportState;
      layout?: { artboards: PersistedArtboardLayout[] };
    };
  };
  if (w.__canvas_meta__ && typeof w.__canvas_meta__ === 'object') {
    if (sanitized.viewport) w.__canvas_meta__.viewport = sanitized.viewport;
    if (sanitized.layout) w.__canvas_meta__.layout = sanitized.layout;
  }
  // Stamp the self-write timestamp BEFORE the fetch so the round-trip
  // (PATCH → server write → fs:json broadcast → iframe message) lands
  // safely inside the echo window even on a fast network.
  window.__maude_last_meta_self_write_at = Date.now();
  fetch('/_api/canvas-meta', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, patch: sanitized }),
  }).catch((err) => {
    console.warn('[canvas-lib] persist viewport failed:', err);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// useViewportController (Phase 4 T2)
//
// Owns the canvas's pan/zoom/pinch/spacebar-drag/middle-mouse-drag/Cmd shortcuts.
// Scoped to the canvas iframe via hostRef — no shell-level keyboard leaks.
// While the user is actively gesturing, the hook writes the world transform
// straight to `worldRef.current.style.transform` for a 60 fps path; React state
// publishes on a 50 ms throttle so MiniMap + ZoomToolbar consumers re-render
// at a comfortable cadence. `onSettle` fires 500 ms after the last input so
// T5 can persist the viewport without flooding writes during a drag.

export interface ViewportControllerOptions {
  hostRef: RefObject<HTMLDivElement | null>;
  worldRef: RefObject<HTMLDivElement | null>;
  /** Computes a fit-to-screen viewport for the current artboard set. */
  computeFit: () => ViewportState;
  /**
   * Initial viewport. Read once at mount. Return `null` to defer until the
   * host has a measured size (the hook will re-init on the first ResizeObserver
   * tick that produces a non-zero host).
   */
  getInitial: () => ViewportState | null;
  /** Called debounced ~500 ms after the last input. */
  onSettle?: (v: ViewportState) => void;
  /**
   * Jump-target rects (in world coords) for Cmd+Option+1..9. The N-th entry
   * fits that rect inside the host. Provided by DesignCanvas which has the
   * artboard list. Optional — keyboard jumps no-op when omitted.
   */
  jumpTargets?: ArtboardRect[];
  /**
   * Phase 4.1 hand-tool support. When this predicate returns `true`, bare
   * left-button pointerdown initiates a pan drag (no Space required). The
   * predicate is read per-event so the consumer can return the live tool
   * state. Omit / return `false` to keep the Phase-4 behavior (drag only
   * with Space or middle-mouse).
   */
  isPanDragActive?: () => boolean;
}

export interface ViewportControllerHandle {
  /** Current viewport state. Throttled — for tight render loops use the ref. */
  viewport: ViewportState;
  /** Snap to an arbitrary viewport (used by MiniMap drag, T3). */
  setViewport: (v: ViewportState) => void;
  /** Pan by (dx, dy) screen px. */
  panBy: (dx: number, dy: number) => void;
  /** Multiply zoom by factor, preserving (cx, cy) screen px under the cursor. */
  zoomAt: (factor: number, cx: number, cy: number) => void;
  /** Cmd+0 — fit-to-screen on the artboard union. */
  fit: () => void;
  /** Cmd+1 — actual size (zoom = 1.0), recentered on viewport midpoint. */
  reset: () => void;
  /** Cmd+= — zoom in 1.2× at host center. */
  zoomIn: () => void;
  /** Cmd+- — zoom out at host center. */
  zoomOut: () => void;
  /** Jump to the rect at `index` with smooth fit (used by T4 click-to-focus). */
  jumpTo: (rect: ArtboardRect) => void;
  /** Animate to a target viewport over `durationMs` (reduced-motion = instant). */
  animateTo: (target: ViewportState, durationMs?: number) => void;
  /** True while the user is actively gesturing (drag / wheel run). */
  isInteracting: boolean;
}

// Issue #94 — wheel pan used raw WheelEvent deltas as CSS pixels, but the
// Wheel Events spec lets a browser report deltas in three different units
// (`deltaMode`): pixel (0, trackpads and most Chromium mice), line (1,
// Firefox's default for physical mice — one notch is a small integer like
// 3), or page (2). Consuming a line-mode `3` as 3px of pan per notch is why
// wheel-driven panning read as "very slow" while trackpad panning (already
// pixel-mode) felt fine. LINES_TO_PIXELS mirrors the pixels-per-line browsers
// themselves use for native line-scrolling at default font size.
const LINES_TO_PIXELS = 16;
export function wheelDeltaToPixels(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === 1) return delta * LINES_TO_PIXELS; // DOM_DELTA_LINE
  if (deltaMode === 2) return delta * pageSize; // DOM_DELTA_PAGE
  return delta; // DOM_DELTA_PIXEL (0) — already pixels
}

// Exported (like `revealAxisDelta` in canvas-shell.tsx) so a pure-logic unit
// test can pin the zoom floor without booting the DOM/host-dependent
// viewport controller.
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function fitRectIntoHost(rect: ArtboardRect, hostEl: HTMLElement, pad = 24): ViewportState {
  return computeFit([rect], hostEl, pad);
}

// RC3 (rca/issue-canvas-hmr-optimistic-update-consistency) — the LIVE camera,
// hoisted above the `key=attempt` remount boundary. softReload() swaps the
// canvas module by remounting a fresh React subtree (canvas-comment-mount.tsx,
// clean-slate `key`), which tears down useViewportController and re-runs the
// one-shot getInitial(). The snapshot that init used to read
// (`__canvas_meta__.viewport` via readCanvasMeta) is mirrored only on the
// 500 ms settle, so an edit landing mid-gesture snapped the camera back to a
// stale pan/zoom — the reported "zoom reset while an artboard is edited".
// canvas-lib is an externalized runtime module (canvas-build.ts): the SAME
// module instance survives the canvas re-import, so the camera parked here
// outlives the subtree. A full page load clears it — correct, view.json seeds
// then. Written on every applyViewport (exact — no settle/publish lag).
let liveViewport: ViewportState | null = null;

/**
 * The current pan/zoom, read from OUTSIDE the React tree — the
 * `window.__maudeCanvasRects()` hook (below) has no component instance to
 * hook into, so it reads this module-scope mirror instead of WorldContext.
 */
export function getLiveViewport(): ViewportState | null {
  return liveViewport ? { ...liveViewport } : null;
}

/**
 * Viewport for the few consumers that must track a gesture AS IT HAPPENS —
 * the minimap indicator and the zoom % readout. Everything else reads the
 * published (settle-cadence) viewport and stays still while the user moves.
 *
 * Polls the live mirror on rAF, but only while a gesture is in flight, and
 * only re-renders when the value actually changed and at most every
 * `minIntervalMs`. That keeps these two small components on the same ~20 Hz
 * cadence they had when EVERY component was re-rendering at 20 Hz — the
 * difference is that now it is two of them instead of all 128 artboards.
 */
// ONE rAF ticker for every live-viewport subscriber. Each mounted consumer
// running its own loop would multiply with the UI: a board with N sections
// renders N label chips, and N independent rAF callbacks per frame is a cost
// that grows with content while measuring the same single value.
const liveVpSubs = new Set<(v: ViewportState) => void>();
let liveVpRaf = 0;
let liveVpLastAt = 0;
let liveVpLastKey = '';

function liveVpTick(t: number): void {
  liveVpRaf = requestAnimationFrame(liveVpTick);
  if (t - liveVpLastAt < PUBLISH_MS) return;
  liveVpLastAt = t;
  const cur = liveViewport;
  if (!cur) return;
  const key = `${cur.x}|${cur.y}|${cur.zoom}`;
  if (key === liveVpLastKey) return;
  liveVpLastKey = key;
  for (const fn of liveVpSubs) fn({ ...cur });
}

function subscribeLiveViewport(fn: (v: ViewportState) => void): () => void {
  liveVpSubs.add(fn);
  if (liveVpRaf === 0 && typeof requestAnimationFrame === 'function') {
    liveVpLastKey = '';
    liveVpRaf = requestAnimationFrame(liveVpTick);
  }
  return () => {
    liveVpSubs.delete(fn);
    if (liveVpSubs.size === 0 && liveVpRaf !== 0) {
      cancelAnimationFrame(liveVpRaf);
      liveVpRaf = 0;
    }
  };
}

/**
 * Viewport for the few consumers that must track a gesture AS IT HAPPENS —
 * the minimap indicator, the zoom % readout, and the counter-scaled annotation
 * chrome that has to hold a constant screen size while the world scales.
 * Everything else reads the published (settle-cadence) viewport and stays still
 * while the user moves.
 *
 * Subscribes to the shared ticker only while a gesture is in flight, and only
 * re-renders when the value actually changed — the same ~20 Hz cadence these
 * components had back when EVERY component re-rendered at 20 Hz. The difference
 * is that it is now a handful of them instead of all 128 artboards.
 */
export function useLiveViewport(): ViewportState {
  const controller = useViewportControllerContext();
  const published = controller?.viewport;
  const interacting = !!controller?.isInteracting;
  const [live, setLive] = useState<ViewportState | null>(null);

  useEffect(() => {
    if (!interacting) {
      // Settled: the published value is authoritative again. Dropping the local
      // copy avoids rendering a stale mid-gesture frame forever.
      setLive(null);
      return;
    }
    return subscribeLiveViewport(setLive);
  }, [interacting]);

  return live ?? published ?? { x: 0, y: 0, zoom: 1 };
}

export function useViewportController(opts: ViewportControllerOptions): ViewportControllerHandle {
  const {
    hostRef,
    worldRef,
    computeFit: computeFitFn,
    getInitial,
    onSettle,
    jumpTargets,
    isPanDragActive,
  } = opts;
  const isPanDragActiveRef = useRef<(() => boolean) | undefined>(isPanDragActive);
  isPanDragActiveRef.current = isPanDragActive;

  // Canonical viewport in a ref — synchronous, drives the world transform.
  const vpRef = useRef<ViewportState>({ x: 0, y: 0, zoom: 1 });
  const [viewport, setViewportPublished] = useState<ViewportState>({ x: 0, y: 0, zoom: 1 });
  const [isInteracting, setIsInteracting] = useState(false);
  const interactingRef = useRef(false);
  const isInteractingStateRef = useRef(false);
  // Snapshot of the zoom at the START of each interaction burst. Lets the
  // WebKit settle re-raster (writeTransform crisp) fire ONLY when the gesture
  // actually changed scale — a pure pan is scale-invariant, so re-rasterizing
  // the whole world plane on pan-settle is wasted work (the "seká po dojezdu"
  // tail-spike on large canvases). RCA:
  // .ai/logs/rca/issue-canvas-pan-zoom-jank-large-moodboard.md
  const zoomAtInteractStartRef = useRef(1);

  // Throttle / settle timers.
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs to options that may change between renders.
  const computeFitRef = useRef(computeFitFn);
  computeFitRef.current = computeFitFn;
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;
  const jumpTargetsRef = useRef(jumpTargets);
  jumpTargetsRef.current = jumpTargets;

  // worldRef is stable across renders — read inside callbacks lazily, no dep.
  //
  // The scale dimension takes an engine-specific path because the CSS `zoom`
  // property is NOT interoperable between Blink and WebKit:
  //
  // • Blink (Chrome): CSS `zoom`. `zoom` re-flows layout at the new size so the
  //   browser re-rasterizes text at the target resolution — text stays crisp at
  //   any zoom level (whereas `transform: scale` upscales a cached layer →
  //   pixelation at zoom > ~1.5). Blink composites `zoom` changes on a fast path,
  //   so pinch stays smooth. Unchanged from the original implementation.
  //   ! Subtle: under `zoom: N`, a co-located `transform: translate(Xpx, Ypx)`
  //   ! translates by N×X / N×Y screen px (translate is in pre-zoom coords, then
  //   ! the layer is zoomed). `vpRef` holds the translate in *screen* px, so we
  //   ! divide by zoom at write time. pan/zoom math stays screen-px throughout.
  //
  // • WebKit (Safari + the Tauri WKWebView shell): `transform: translate() scale()`.
  //   On WebKit, `zoom` co-located with a `transform` does NOT cascade scale into
  //   descendant text (fonts stay fixed size — the reported bug) and forces a
  //   main-thread relayout on every pinch tick (janky trackpad zoom). A composited
  //   `transform: scale` scales all descendants uniformly incl. text and never
  //   relayouts. transform-origin is pinned top-left so the affine matches the
  //   `screen = translate + scale·world` model the rest of the math assumes — so
  //   here the translate is plain screen px (no /z). Crispness at high zoom is
  //   recovered by releasing the compositor layer on settle (`crisp` → will-change
  //   auto), which prompts WebKit to re-rasterize text at the target scale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs only — stable identity by design.
  const writeTransform = useCallback((v: ViewportState, opts?: { crisp?: boolean }) => {
    const el = worldRef.current;
    if (!el) return;
    const z = v.zoom || 1;
    if (IS_WEBKIT) {
      el.style.zoom = '';
      el.style.transformOrigin = '0 0';
      el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${z})`;
      // Mid-gesture keep the layer promoted (smooth); when settled release it so
      // WebKit re-paints text crisp at the new scale instead of upscaling the
      // cached bitmap.
      el.style.willChange = opts?.crisp ? 'auto' : 'transform';
    } else {
      el.style.transform = `translate(${v.x / z}px, ${v.y / z}px)`;
      el.style.zoom = String(z);
    }
    // Live zoom for counter-scaled chrome (section labels, connector dots,
    // selection bboxes — anything that must stay a constant number of SCREEN px
    // while the world scales). It has to be written per frame, right here: the
    // published viewport is settle-only now, so chrome sized from React state
    // would scale with the world through a pinch and snap back at the end —
    // reintroducing exactly the fidelity-pop that was removed once already
    // (RCA addendum: the LOD toggle was reverted for visible flicker).
    el.style.setProperty('--dc-zoom', String(z));
    el.style.visibility = 'visible';
  }, []);

  const schedulePublish = useCallback(() => {
    if (publishTimerRef.current != null) return;
    publishTimerRef.current = setTimeout(() => {
      publishTimerRef.current = null;
      setViewportPublished({ ...vpRef.current });
    }, PUBLISH_MS);
  }, []);

  const scheduleSettle = useCallback(() => {
    if (settleTimerRef.current != null) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      const cb = onSettleRef.current;
      if (cb) cb({ ...vpRef.current });
    }, SETTLE_MS);
  }, []);

  // Read the interacting flag from a ref so this callback identity stays
  // stable across renders — otherwise applyViewport (and the listeners that
  // close over it) get torn down on every state update, eating mid-gesture
  // pointer events.
  const markInteracting = useCallback(() => {
    interactingRef.current = true;
    if (!isInteractingStateRef.current) {
      isInteractingStateRef.current = true;
      // Start of a fresh gesture burst — remember the scale so settle can tell
      // a pure pan (skip the crisp re-raster) from a zoom (needs it).
      zoomAtInteractStartRef.current = vpRef.current.zoom;
      setIsInteracting(true);
    }
    if (interactEndTimerRef.current != null) clearTimeout(interactEndTimerRef.current);
    interactEndTimerRef.current = setTimeout(() => {
      interactingRef.current = false;
      isInteractingStateRef.current = false;
      setIsInteracting(false);
      interactEndTimerRef.current = null;
      // Motion has stopped — re-write the world transform in crisp mode so the
      // WebKit path drops its compositor layer and re-rasterizes text sharply at
      // the settled scale. No-op on the Blink path (CSS `zoom` is already crisp).
      // Skip it when the burst never changed scale (pure pan): the layer is
      // already crisp at this zoom, so releasing + repainting the whole world
      // plane would be a wasted main-thread spike on large canvases.
      if (vpRef.current.zoom !== zoomAtInteractStartRef.current) {
        writeTransform(vpRef.current, { crisp: true });
      }
      // The gesture is over — NOW publish. Everything that reads the published
      // viewport (LOD banding, collab awareness, the active-artboard pick) is
      // settle-cadence by design; deferring the publish to here is what keeps
      // the whole React tree still while the user is actually moving.
      setViewportPublished({ ...vpRef.current });
    }, 220);
  }, [writeTransform]);

  const applyViewport = useCallback(
    (next: ViewportState, opts?: { defer?: boolean }) => {
      const clamped: ViewportState = {
        x: Number.isFinite(next.x) ? next.x : 0,
        y: Number.isFinite(next.y) ? next.y : 0,
        zoom: clampZoom(next.zoom),
      };
      vpRef.current = clamped;
      liveViewport = clamped; // RC3 — survives the soft-reload remount
      writeTransform(clamped);
      // `defer` is what makes a gesture render-free. A wheel/pinch/drag burst
      // writes the transform imperatively every frame (above) and publishes to
      // React only once the motion settles; a programmatic move (fit, reset,
      // jumpTo, animateTo) publishes immediately, because nothing follows it to
      // trigger the settle and consumers would sit on a stale value.
      //
      // Measured reason: at 20 Hz publishing, one pan+zoom over a 128-artboard
      // canvas re-rendered DCArtboard 6272 times (128 boards x ~49 publishes),
      // and every published value was one the drag/hit-test paths already read
      // live from a ref. See `maude design perf` and the plan's findings table.
      if (!opts?.defer) schedulePublish();
      scheduleSettle();
      markInteracting();
    },
    [writeTransform, schedulePublish, scheduleSettle, markInteracting]
  );

  // Imperative API ------------------------------------------------------------

  const setViewport = useCallback((v: ViewportState) => applyViewport(v), [applyViewport]);

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = vpRef.current;
      applyViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom }, { defer: true });
    },
    [applyViewport]
  );

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const v = vpRef.current;
      const newZoom = clampZoom(v.zoom * factor);
      // World coord under (cx, cy) before the zoom change.
      const wx = (cx - v.x) / v.zoom;
      const wy = (cy - v.y) / v.zoom;
      const next: ViewportState = {
        x: cx - wx * newZoom,
        y: cy - wy * newZoom,
        zoom: newZoom,
      };
      applyViewport(next, { defer: true });
    },
    [applyViewport]
  );

  // Forward-decl ref — fit / reset run animations that need `animateTo`, but
  // `animateTo` is declared further down (depends on applyViewport). Resolve
  // the ordering with a ref the animateTo callback writes to on definition.
  const animateToRef = useRef<((t: ViewportState, d?: number) => void) | null>(null);

  // T33 — programmatic zoom is eased. Direct user-driven gestures
  // (wheel, pinch, drag-to-pan) still call `applyViewport` directly so
  // input feel stays 1:1 with the cursor; only fit/reset/zoom-to-rect
  // ease over 200 ms. `animateTo` honors `prefers-reduced-motion` and
  // returns instantly under that media query.
  const PROGRAMMATIC_EASE_MS = 200;
  const fit = useCallback(() => {
    const next = computeFitRef.current();
    const a = animateToRef.current;
    if (a) a(next, PROGRAMMATIC_EASE_MS);
    else applyViewport(next);
  }, [applyViewport]);

  const reset = useCallback(() => {
    const host = hostRef.current;
    if (!host) {
      applyViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const cx = host.clientWidth / 2;
    const cy = host.clientHeight / 2;
    const v = vpRef.current;
    // Target: same world-coord under cursor, zoom = 1.
    const wx = (cx - v.x) / v.zoom;
    const wy = (cy - v.y) / v.zoom;
    const target: ViewportState = { x: cx - wx, y: cy - wy, zoom: 1 };
    const a = animateToRef.current;
    if (a) a(target, PROGRAMMATIC_EASE_MS);
    else applyViewport(target);
  }, [hostRef, applyViewport]);

  const zoomIn = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    zoomAt(ZOOM_STEP_IN, host.clientWidth / 2, host.clientHeight / 2);
  }, [hostRef, zoomAt]);

  const zoomOut = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    zoomAt(ZOOM_STEP_OUT, host.clientWidth / 2, host.clientHeight / 2);
  }, [hostRef, zoomAt]);

  // Animation — rAF-driven ease-out cubic, falls through to apply on each
  // frame so MiniMap / ZoomToolbar follow the trajectory live.
  const animationRef = useRef<number | null>(null);

  const animateTo = useCallback(
    (target: ViewportState, durationMs = 240) => {
      if (animationRef.current != null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      const dur = prefersReducedMotion() ? 0 : Math.max(0, durationMs);
      if (dur === 0) {
        applyViewport(target);
        return;
      }
      const start: ViewportState = { ...vpRef.current };
      const t0 =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = 1 - (1 - t) ** 3; // ease-out cubic
        applyViewport({
          x: start.x + (target.x - start.x) * e,
          y: start.y + (target.y - start.y) * e,
          zoom: clampZoom(start.zoom + (target.zoom - start.zoom) * e),
        });
        if (t < 1) {
          animationRef.current = requestAnimationFrame(tick);
        } else {
          animationRef.current = null;
        }
      };
      animationRef.current = requestAnimationFrame(tick);
    },
    [applyViewport]
  );

  // Keep the ref pointed at the latest `animateTo` so the earlier-declared
  // fit / reset callbacks can call it without circular dependency.
  animateToRef.current = animateTo;

  const jumpTo = useCallback(
    (rect: ArtboardRect) => {
      const host = hostRef.current;
      if (!host) return;
      animateTo(fitRectIntoHost(rect, host));
    },
    [hostRef, animateTo]
  );

  // Mount / event wiring ------------------------------------------------------

  // Initial viewport. Intentionally one-shot — caller drives re-fit via the `fit()` handle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot mount; caller controls re-fits.
  useLayoutEffect(() => {
    const initial = getInitial();
    if (initial) {
      vpRef.current = { ...initial };
      liveViewport = { ...initial }; // mirror pre-first-gesture so headless capture sees it
      writeTransform(vpRef.current, { crisp: true });
      setViewportPublished({ ...vpRef.current });
    }
    // If host has no size yet, refit when ResizeObserver delivers one.
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    let hadSize = host.clientWidth > 0 && host.clientHeight > 0;
    const ro = new ResizeObserver(() => {
      if (interactingRef.current) return; // never re-fit during a gesture
      if (!hadSize && host.clientWidth > 0 && host.clientHeight > 0) {
        hadSize = true;
        const refit = computeFitRef.current();
        vpRef.current = { ...refit };
        liveViewport = { ...refit };
        writeTransform(vpRef.current, { crisp: true });
        setViewportPublished({ ...vpRef.current });
      }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Pointer + wheel + key listeners — all scoped to hostRef so the shell
  // keyboard and other iframes stay quiet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pan/zoom callbacks are useCallback-stable; listeners mount once on host.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Auto-focus on pointer enter — without this, keyboard shortcuts (Space
    // for pan, Cmd+0/1/+/-) silently fail until the user clicks inside the
    // iframe. Focusing the host element pulls keyboard focus into this
    // iframe's contentWindow so the window-scoped keydown listener below
    // receives events natively.
    const onPointerEnter = () => {
      try {
        if (typeof window !== 'undefined' && document.activeElement !== host) {
          host.focus({ preventScroll: true });
        }
      } catch {
        /* ignore */
      }
    };

    const spaceHeld = { current: false };
    const panState: {
      active: boolean;
      pointerId: number;
      lastX: number;
      lastY: number;
    } = { active: false, pointerId: -1, lastX: 0, lastY: 0 };

    // Safari/WKWebView trackpad pinch — see gesture* handlers below. While a
    // native gesture is in flight, the ctrlKey-wheel branch defers to it so a
    // pinch doesn't double-apply (WebKit may emit both event streams).
    const gesture = { active: false, lastScale: 1 };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // Normalize line/page-mode deltas to pixels before anything below
      // reads them — see `wheelDeltaToPixels` (issue #94). Zoom's own
      // [-50, 50] clamp already absorbed this for the pinch/ctrl+wheel path,
      // but pan had no such clamp so a line-mode mouse wheel panned at only
      // a few px per notch.
      const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode, host.clientWidth);
      const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode, host.clientHeight);
      // Mac trackpad pinch fires wheel with ctrlKey:true automatically, even
      // without a physical Ctrl press — so the same branch covers both
      // Ctrl+wheel (mouse) and pinch-zoom (trackpad).
      if (e.ctrlKey || e.metaKey) {
        if (gesture.active) return; // WebKit GestureEvent owns this pinch
        // T32 — clamp deltaY into [-50, 50] before the exp() to bring
        // trackpad-pinch (small per-frame delta) and mouse-wheel (one
        // notch = ±100) onto the same perceived-speed curve. Mouse-wheel
        // users still get smooth zoom (clamped notches accumulate at the
        // same exp rate), trackpad-pinch users no longer outpace them.
        const clamped = Math.max(-50, Math.min(50, dy));
        const factor = Math.exp(-clamped * WHEEL_ZOOM_K);
        zoomAt(factor, cx, cy);
        return;
      }
      // Shift+wheel → horizontal pan. Some browsers / OSes auto-swap
      // deltaX↔deltaY when shift is held (Chromium on Linux does, macOS
      // doesn't, Safari sometimes does); some don't. Read whichever axis
      // actually carries energy so the gesture lands horizontally either way.
      if (e.shiftKey) {
        const d = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
        panBy(-d, 0);
        return;
      }
      // Default: trackpad two-finger scroll → 2D pan. The negation keeps the
      // "content follows your fingers" mapping (Mac natural scroll). Mouse
      // wheels with only deltaY pan vertically.
      panBy(-dx, -dy);
    };

    // Safari/WKWebView-only trackpad pinch. WebKit exposes the native pinch via
    // `gesture*` events (absent in Blink — these listeners simply never fire
    // there). Two reasons to handle them: (1) preventDefault suppresses Safari's
    // built-in page-zoom that would otherwise fight the canvas; (2) `e.scale`
    // (cumulative since gesturestart) gives a smoother, 1:1 pinch than reverse-
    // engineering it from synthesized ctrlKey-wheel deltas. The onWheel ctrlKey
    // branch defers while `gesture.active` so a pinch is never applied twice.
    type SafariGestureEvent = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (ev: Event) => {
      ev.preventDefault();
      const e = ev as SafariGestureEvent;
      gesture.active = true;
      gesture.lastScale = e.scale || 1;
    };
    const onGestureChange = (ev: Event) => {
      ev.preventDefault();
      if (!gesture.active) return;
      const e = ev as SafariGestureEvent;
      const rect = host.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const s = e.scale || 1;
      const factor = gesture.lastScale > 0 ? s / gesture.lastScale : 1;
      gesture.lastScale = s;
      zoomAt(factor, cx, cy);
    };
    const onGestureEnd = (ev: Event) => {
      ev.preventDefault();
      gesture.active = false;
      gesture.lastScale = 1;
    };

    const onPointerDown = (e: PointerEvent) => {
      const isMiddle = e.button === 1;
      const isLeftWithSpace = e.button === 0 && spaceHeld.current;
      // Phase 4.1 hand tool: bare left-button initiates pan when the consumer
      // signals hand-mode via `isPanDragActive`. Read per-event so the live
      // tool state controls the gate.
      const isLeftWithHandTool =
        e.button === 0 && !spaceHeld.current && !!isPanDragActiveRef.current?.();
      if (!isMiddle && !isLeftWithSpace && !isLeftWithHandTool) return;
      e.preventDefault();
      try {
        host.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      panState.active = true;
      panState.pointerId = e.pointerId;
      panState.lastX = e.clientX;
      panState.lastY = e.clientY;
      host.style.cursor = 'grabbing';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panState.active || e.pointerId !== panState.pointerId) return;
      const dx = e.clientX - panState.lastX;
      const dy = e.clientY - panState.lastY;
      panState.lastX = e.clientX;
      panState.lastY = e.clientY;
      panBy(dx, dy);
    };

    const endPan = (e: PointerEvent) => {
      if (!panState.active || e.pointerId !== panState.pointerId) return;
      try {
        host.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      panState.active = false;
      panState.pointerId = -1;
      host.style.cursor = spaceHeld.current ? 'grab' : '';
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Spacebar pan affordance — only when no input is focused.
      if (e.code === 'Space' && !isEditableTarget(e.target)) {
        spaceHeld.current = true;
        host.style.cursor = panState.active ? 'grabbing' : 'grab';
        e.preventDefault();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Cmd+Option+1..9 → jump to artboard N (Option avoids Chrome's
      // Cmd+1..9 tab-switching shortcut).
      if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const n = Number(e.code.slice(-1));
        const target = jumpTargetsRef.current?.[n - 1];
        if (target) {
          e.preventDefault();
          jumpTo(target);
        }
        return;
      }
      if (e.altKey) return;
      switch (e.key) {
        case '0':
          e.preventDefault();
          fit();
          return;
        case '1':
          e.preventDefault();
          reset();
          return;
        case '=':
        case '+':
          e.preventDefault();
          zoomIn();
          return;
        case '-':
          e.preventDefault();
          zoomOut();
          return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = false;
        host.style.cursor = panState.active ? 'grabbing' : '';
      }
    };

    host.tabIndex = host.tabIndex >= 0 ? host.tabIndex : 0; // focusable for kbd

    // Wheel listener lives on the document at the CAPTURE phase. Bubble-phase
    // on `host` is too late — an inner scrollable element (e.g. CSS
    // `overflow: auto` somewhere in an artboard's content tree) consumes the
    // wheel first and the bubble never reaches us, which is why
    // shift+wheel-for-horizontal-pan would silently drop on some pages.
    // We still check the event target is inside this canvas before acting,
    // so wheels happening in shell chrome or another iframe pass through.
    const doc = host.ownerDocument || document;
    const captureWheel = (e: WheelEvent) => {
      if (!host.contains(e.target as Node)) return;
      onWheel(e);
    };
    const captureKeyDown = (e: KeyboardEvent) => {
      // Don't intercept keyboard events from input fields anywhere.
      if (isEditableTarget(e.target)) return;
      onKeyDown(e);
    };
    const captureKeyUp = (e: KeyboardEvent) => onKeyUp(e);

    doc.addEventListener('wheel', captureWheel, { passive: false, capture: true });
    doc.addEventListener('keydown', captureKeyDown, { capture: true });
    doc.addEventListener('keyup', captureKeyUp, { capture: true });
    host.addEventListener('pointerenter', onPointerEnter);
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', endPan);
    host.addEventListener('pointercancel', endPan);
    // WebKit-only; no-ops elsewhere. passive:false so preventDefault can cancel
    // Safari's native page-zoom.
    host.addEventListener('gesturestart', onGestureStart, { passive: false });
    host.addEventListener('gesturechange', onGestureChange, { passive: false });
    host.addEventListener('gestureend', onGestureEnd, { passive: false });

    return () => {
      doc.removeEventListener('wheel', captureWheel, { capture: true } as EventListenerOptions);
      doc.removeEventListener('keydown', captureKeyDown, { capture: true } as EventListenerOptions);
      doc.removeEventListener('keyup', captureKeyUp, { capture: true } as EventListenerOptions);
      host.removeEventListener('pointerenter', onPointerEnter);
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', endPan);
      host.removeEventListener('pointercancel', endPan);
      host.removeEventListener('gesturestart', onGestureStart);
      host.removeEventListener('gesturechange', onGestureChange);
      host.removeEventListener('gestureend', onGestureEnd);
    };
  }, [hostRef]);

  // Final settle on unmount — drop pending timers, flush onSettle synchronously
  // so persistence-on-close (T5) still records the last viewport.
  useEffect(() => {
    return () => {
      if (publishTimerRef.current != null) clearTimeout(publishTimerRef.current);
      if (settleTimerRef.current != null) {
        clearTimeout(settleTimerRef.current);
        const cb = onSettleRef.current;
        if (cb) cb({ ...vpRef.current });
      }
      if (interactEndTimerRef.current != null) clearTimeout(interactEndTimerRef.current);
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return {
    viewport,
    setViewport,
    panBy,
    zoomAt,
    fit,
    reset,
    zoomIn,
    zoomOut,
    jumpTo,
    animateTo,
    isInteracting,
  };
}

// Helper — true when the event target is an editable input (so spacebar
// pan doesn't fight typing inside a canvas-embedded textarea).
function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || !(t as HTMLElement).tagName) return false;
  const el = t as HTMLElement;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

// Controller context — published by DesignCanvas so DCMiniMap + DCZoomToolbar
// can issue pan/zoom operations.
const ControllerContext = createContext<ViewportControllerHandle | null>(null);

export function useViewportControllerContext(): ViewportControllerHandle | null {
  return useContext(ControllerContext);
}

// Drag-state context (Phase 4.2) — published by DesignCanvas so SnapGuideOverlay
// (mounted by CanvasShell) can read the active drag's snap guides + so each
// DCArtboard can know whether it's being dragged as a follower (multi-select
// drag). A single source-of-truth: only one drag can be active at a time, so
// the bus holds a single DragState. Each DCArtboard's hook writes here when
// non-idle and resets to idle on release.
/** Optional metadata accompanying a position commit. */
export interface CommitPositionsOptions {
  /**
   * HUD / undo-stack label override. Default = `"move N artboard(s)"`.
   * Distribute / align gestures pass their own label so undo HUD reads
   * `"Undo: equal-space 4 artboards"` instead of `"Undo: move 4 artboards"`.
   */
  label?: string;
}

interface DragStateBus {
  current: DragState;
  setCurrent: (s: DragState) => void;
  /** Commit drag positions — DesignCanvas wires this to patchCanvasMeta. */
  commitPositions: (
    moved: { id: string; x: number; y: number }[],
    opts?: CommitPositionsOptions
  ) => void;
}

const DragStateContext = createContext<DragStateBus | null>(null);

export function useDragStateContext(): DragStateBus | null {
  return useContext(DragStateContext);
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame envelope

interface DesignCanvasProps {
  children: ReactNode;
  /** Per-overlay opt-out. `false` hides it; omit or `true` shows it. */
  controls?: { minimap?: boolean; toolbar?: boolean; zoom?: boolean };
}

/**
 * DesignCanvas mounts the universal canvas input grammar (hover preview,
 * Cmd-click select, multi-select, tool modes V/H/C, right-click menu) for
 * every TSX canvas. There's no opt-out — the legacy Cmd-only inspector
 * overlay path was removed in favor of one consistent affordance everywhere.
 *
 * `ToolProvider` lives above `DesignCanvasInner` so the viewport
 * controller's `isPanDragActive` predicate can read the live tool state
 * via `useToolModeOptional` (hand-mode bare-drag pan). It's wrapped in
 * `MaybeToolProvider` so when the shell-owned comment mount layer
 * (canvas-comment-mount.tsx) already provides a ToolProvider, DesignCanvas
 * consumes that single instance instead of double-mounting.
 */
export function DesignCanvas(props: DesignCanvasProps) {
  // Phase 20 — per-canvas undo/redo stack (DDR-050 rev 2). The provider
  // wraps both DesignCanvasInner (so artboard commits push records) AND
  // the CanvasShell tree (so input-router Cmd+Z / Cmd+Shift+Z + the HUD
  // share the same context). Stack state is keyed by canvas file path in
  // `window.top.__maude_undo_stacks` so it survives canvas switches —
  // close Foo.tsx, open Bar.tsx, come back to Foo.tsx → history intact.
  const canvasFile = readCanvasMetaFile() ?? undefined;
  // Phase 8 / DDR-051 — open a Yjs collab session for this canvas iff we can
  // derive a stable slug. The slug must match `api.fileSlug` server-side so
  // both ends agree on the room key. When the canvas was opened via a URL
  // that doesn't yield a slug (e.g. preview iframes without `canvas=`),
  // CollabProvider is omitted; useCollab() falls back gracefully to null.
  const collabSlug = canvasSlugFromPath(canvasFile);
  const inner = (
    <MaybeToolProvider>
      <DesignCanvasInner {...props} />
    </MaybeToolProvider>
  );
  return (
    // Phase 13 / DDR-029 — the activity context MUST be provided here (canvas-lib
    // bundle) so DCArtboard's `useCanvasActivity()` reads the SAME context
    // instance. Providing it from comment-mount.js (a separate bundle) would
    // create a second ActivityContext the consumer never sees. `canvasFile` is
    // normalized to the server's design-root-relative activity key inside the
    // provider (falls back to window.__canvas_rel__).
    <CanvasActivityProvider file={canvasFile}>
      {/* Phase 13.2 / DDR-078 — agent presence. Same canvas-lib-bundle rule as
          the activity context: provided here so DCArtboard + ParticipantsChrome
          (both canvas-lib) read one context instance. */}
      <AgentPresenceProvider file={canvasFile}>
        <UndoStackProvider canvasFile={canvasFile}>
          {collabSlug ? <CollabProvider slug={collabSlug}>{inner}</CollabProvider> : inner}
        </UndoStackProvider>
      </AgentPresenceProvider>
    </CanvasActivityProvider>
  );
}
DesignCanvas.displayName = 'DesignCanvas';

// DDR-231 (hybrid export lanes) — the workspace `browser` export lane.
//
// In workspace mode the studio shell cannot capture the canvas itself: the
// iframe is a separate (untrusted, DDR-054) origin, unreachable by DOM from
// the shell. So the SHELL ASKS and the CANVAS CAPTURES — this bridge listens
// for an `export-capture` postMessage from the embedding parent, renders the
// requested artboards through the shared capture spine (capture-core.ts — the
// same code the playwright SVG shim injects, DDR-231's single-spine rule) and
// replies with per-artboard Blobs (structured-clonable across the origin
// split). dom-to-svg loads LAZILY through the importmap (`dom-to-svg` runtime
// bundle — the pixi.js pattern), so a canvas that never exports pays zero
// bundle cost.
//
// Capture mutates live DOM (world zoom reset + artboard pinned to origin) and
// restores everything afterwards — the member is looking at this plane. The
// shell overlays a veil during capture to cover the brief reflow.
function useExportCaptureBridge() {
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    let busy = false;
    const onMsg = (e: MessageEvent) => {
      // Only the embedding shell may drive capture — a message from any other
      // window (a nested iframe, an opened popup) is ignored outright.
      if (e.source !== window.parent) return;
      const m = e.data as {
        dgn?: string;
        id?: unknown;
        format?: unknown;
        artboardIds?: unknown;
        scale?: unknown;
      } | null;
      if (!m || m.dgn !== 'export-capture' || typeof m.id !== 'string') return;
      const requestId = m.id;
      // DDR-231 security (L1): reply to the ASKING origin, never `'*'`. The
      // done-message carries the rendered artboard blobs; a wildcard target
      // would leak them to whatever page happens to be the parent if the
      // shell's `frame-ancestors` CSP were ever absent (tests / misconfig).
      // `e.origin` here is the embedding shell (we already gated
      // `e.source === window.parent`); fall back to `'*'` only for an opaque
      // `"null"` origin where a targeted post is impossible.
      const replyOrigin = e.origin && e.origin !== 'null' ? e.origin : '*';
      const reply = (msg: Record<string, unknown>) => {
        try {
          window.parent.postMessage(msg, replyOrigin);
        } catch {
          /* parent gone — nothing to deliver to */
        }
      };
      if (busy) {
        reply({
          dgn: 'export-capture-error',
          id: requestId,
          message: 'a capture is already running on this canvas',
        });
        return;
      }
      busy = true;
      const format = m.format === 'svg' ? 'svg' : 'png';
      const scale = Math.max(1, Math.min(8, Number(m.scale) || 1));
      const wanted = Array.isArray(m.artboardIds)
        ? m.artboardIds.filter((s): s is string => typeof s === 'string')
        : null;
      void (async () => {
        const savedWorld = resetWorldPlane();
        // Hold the chrome suppression across the WHOLE batch. `svgForElement`
        // applies it per target too (ref-counted), but a 10-artboard deck would
        // otherwise add and remove the style ten times — ten forced reflows,
        // and the member watching the canvas sees the chrome flicker.
        const releaseChrome = applyCaptureChrome(document);
        try {
          const all = Array.from(document.querySelectorAll('[data-dc-screen]'));
          const targets = wanted?.length
            ? all.filter((el) => wanted.includes(el.getAttribute('data-dc-screen') ?? ''))
            : all;
          if (!targets.length) throw new Error('no artboards matched the capture request');
          const api = (await import('dom-to-svg')) as unknown as DomToSvgApi;
          const items: { name: string; type: string; blob: Blob }[] = [];
          for (let i = 0; i < targets.length; i += 1) {
            const el = targets[i] as Element;
            const abId = el.getAttribute('data-dc-screen') || `artboard-${i + 1}`;
            const prevPos = pinArtboard(el);
            try {
              const svg = await svgForElement(el, api);
              if (format === 'svg') {
                items.push({
                  name: `${abId}.svg`,
                  type: 'image/svg+xml',
                  blob: new Blob([svg], { type: 'image/svg+xml' }),
                });
              } else {
                items.push({
                  name: `${abId}.png`,
                  type: 'image/png',
                  blob: await rasterizeSvg(svg, scale),
                });
              }
            } finally {
              restoreArtboard(el, prevPos);
            }
            reply({
              dgn: 'export-capture-progress',
              id: requestId,
              current: i + 1,
              total: targets.length,
            });
          }
          reply({ dgn: 'export-capture-done', id: requestId, items });
        } catch (err) {
          reply({
            dgn: 'export-capture-error',
            id: requestId,
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          releaseChrome();
          restoreWorldPlane(savedWorld);
          busy = false;
        }
      })();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
}

function DesignCanvasInner({ children, controls }: DesignCanvasProps) {
  ensureEngineStyles();
  useExportCaptureBridge();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);

  // T6 — self-seed the (per-canvas, persisted) guides visibility into the
  // shared ChromeVisibilityContext once at mount, from the SAME
  // window.__canvas_meta__ snapshot the viewport/layout reads above use.
  // Unlike minimap/zoom/present (global shell prefs pushed in via postMessage
  // shortly after load), `guides` has no global default to race — it's
  // read directly out of this canvas's own meta, so there's nothing to wait
  // for. The shell's View-menu toggle then live-updates it through the same
  // `dgn:'view-chrome'` channel as the other three flags.
  // T6 — the per-canvas overlay-visibility self-seed used to live here, but
  // this component renders CanvasShell as its CHILD and the
  // ChromeVisibilityProvider mounts INSIDE CanvasShell — so this component's
  // own useChromeVisibility() was always null and the seed silently never
  // ran (dead code since the foundation feature). The working seed now lives
  // in canvas-shell.tsx's CanvasRouter, which sits inside the provider.

  const seeds = useMemo(() => harvestArtboards(children), [children]);

  // Merge JSX-derived defaults with meta-persisted positions. Per DDR-027,
  // artboard size is JSX-authoritative; meta tolerates legacy w/h fields for
  // back-compat with Phase 4 snapshots but never lets a missing meta size
  // zero-out the rendered box.
  const initialArtboards = useCallback((): ArtboardRect[] => {
    const meta = readCanvasMeta();
    const defaults = synthDefaultGrid(seeds);
    const metaLayout = meta?.layout?.artboards;
    if (!Array.isArray(metaLayout) || metaLayout.length === 0) return defaults;
    const byId = new Map<string, ArtboardRect>();
    for (const r of metaLayout) {
      if (r && typeof r.id === 'string') byId.set(r.id, r);
    }
    return defaults.map((d) => {
      const m = byId.get(d.id);
      if (!m) return d;
      return {
        id: d.id,
        x: Number.isFinite(m.x) ? m.x : d.x,
        y: Number.isFinite(m.y) ? m.y : d.y,
        w: typeof m.w === 'number' && m.w > 0 ? m.w : d.w,
        h: typeof m.h === 'number' && m.h > 0 ? m.h : d.h,
        // kind is JSX-authoritative like w/h (DDR-027) but, unlike w/h, was
        // never part of the legacy persisted layout shape — always the fresh
        // seed value, no meta fallback to tolerate.
        kind: d.kind,
      };
    });
  }, [seeds]);

  // Artboards live in state (not a useMemo) so a drag commit can update
  // positions in-place without waiting for an iframe reload to re-read meta.
  // Phase 4.2 originally used useMemo([seeds]) — dragging would PATCH the
  // server but the local React state stayed frozen at mount-time. Users had
  // to switch canvases (forcing a reload) to see the new position.
  const [artboards, setArtboards] = useState<ArtboardRect[]>(initialArtboards);

  // Re-seed when JSX children change (HMR after canvas TSX edit). The seed
  // signature is identity-stable across renders that don't change the JSX,
  // so this won't clobber drag-commit state during normal interaction.
  useEffect(() => {
    setArtboards(initialArtboards());
  }, [initialArtboards]);

  // Phase 8 — foreign canvas-meta change. The shell-level HMR client
  // re-fetches `<canvas>.meta.json` and dispatches `maude:meta-refreshed`
  // when *another* tab PATCHed the layout (drag, distribute, align). We
  // re-apply positions in-place — no full reload — so the user's tool mode,
  // undo stack, scroll, and selection state survive. Self-writes are
  // suppressed at the dispatch site via the `__maude_last_meta_self_write_at`
  // echo timestamp.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onRefresh = () => {
      setArtboards(initialArtboards());
    };
    document.addEventListener('maude:meta-refreshed', onRefresh);
    return () => document.removeEventListener('maude:meta-refreshed', onRefresh);
  }, [initialArtboards]);

  // Stable refs so the controller's callbacks always see the latest values.
  const artboardsRef = useRef(artboards);
  artboardsRef.current = artboards;

  const computeFitForArtboards = useCallback((): ViewportState => {
    const host = hostRef.current;
    if (!host) return { x: 0, y: 0, zoom: 1 };
    return computeFit(artboardsRef.current, host);
  }, []);

  const getInitial = useCallback((): ViewportState | null => {
    // RC3 — after a soft-reload remount, resume the live camera parked at
    // module scope (exact, no settle lag) before falling back to the meta
    // snapshot. Null on a fresh page load, so view.json still seeds there.
    if (liveViewport) return { ...liveViewport };
    const meta = readCanvasMeta();
    const v = meta?.viewport;
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom)) {
      return { x: v.x, y: v.y, zoom: v.zoom };
    }
    const host = hostRef.current;
    if (!host) return null;
    return computeFit(artboardsRef.current, host);
  }, []);

  const onSettle = useCallback((v: ViewportState) => {
    patchCanvasMeta({ viewport: v });
  }, []);

  const toolModeCtx = useToolModeOptional();
  const toolRef = useRef(toolModeCtx?.tool ?? 'move');
  toolRef.current = toolModeCtx?.tool ?? 'move';
  const isPanDragActive = useCallback(() => toolRef.current === 'hand', []);

  const controller = useViewportController({
    hostRef,
    worldRef,
    computeFit: computeFitForArtboards,
    getInitial,
    onSettle,
    jumpTargets: artboards,
    isPanDragActive,
  });

  const rectById = useMemo(() => {
    const m = new Map<string, ArtboardRect>();
    for (const r of artboards) m.set(r.id, r);
    return m;
  }, [artboards]);

  const rectFor = useCallback((id: string) => rectById.get(id) ?? null, [rectById]);

  // Active artboard — the one whose center sits closest to the viewport
  // center after pan settles. Recomputed on every viewport publish (~50 ms).
  const activeArtboardId = useMemo<string | null>(() => {
    if (artboards.length === 0) return null;
    const host = hostRef.current;
    if (!host) return artboards[0]?.id ?? null;
    const vp = controller.viewport;
    const cx = (host.clientWidth / 2 - vp.x) / vp.zoom;
    const cy = (host.clientHeight / 2 - vp.y) / vp.zoom;
    let bestId: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const r of artboards) {
      const ax = r.x + r.w / 2;
      const ay = r.y + r.h / 2;
      const d = (ax - cx) ** 2 + (ay - cy) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestId = r.id;
      }
    }
    return bestId;
  }, [artboards, controller.viewport]);

  // DDR-148 — report the viewport-active artboard (nearest the centre) to the
  // shell so the Timeline panel FOLLOWS whichever artboard the user pans to,
  // not just the one they cmd+click. Fires on every pan/zoom that changes it.
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    try {
      window.parent.postMessage({ dgn: 'active-artboard', id: activeArtboardId }, '*');
    } catch {
      /* cross-origin parent without our listener — no-op */
    }
  }, [activeArtboardId]);

  // The world's transform is owned by useViewportController (writes straight
  // to `worldRef.current.style.transform`). Rendering the transform from
  // React state instead would race: between React's commit and the
  // controller's next synchronous write, the world would snap back to a
  // stale published value. We start hidden and the controller's
  // useLayoutEffect writes the initial transform before first paint.
  const worldStyle: CSSProperties = { visibility: 'hidden' };

  // Hug-mode height feedback (artboard "hug height" default). A hug board's
  // CSS height is `auto` (content-driven) — the DOM is authoritative, and this
  // just mirrors the measured height into the shared ArtboardRect model so
  // OTHER consumers (marquee, distribute, fit-to-screen, off-screen culling)
  // see the current box. Never touches meta/JSX — purely runtime state, unlike
  // commitArtboardPositions/applyArtboardLayout which persist. A no-op guard
  // on <1px delta avoids a ResizeObserver → setState → render → (stable, since
  // CSS height never reads back rect.h in hug mode) loop.
  const reportMeasuredHeight = useCallback((id: string, h: number) => {
    setArtboards((prev) => {
      const cur = prev.find((r) => r.id === id);
      if (!cur || Math.abs(cur.h - h) < 1) return prev;
      return prev.map((r) => (r.id === id ? { ...r, h } : r));
    });
  }, []);

  const ctxValue = useMemo<WorldContextValue>(
    () => ({
      rectFor,
      artboards,
      reportMeasuredHeight,
      viewport: controller.viewport,
      activeArtboardId,
      hostRef,
      worldRef,
    }),
    [rectFor, artboards, reportMeasuredHeight, controller.viewport, activeArtboardId]
  );

  const showMiniMap = controls?.minimap !== false;
  const showZoom = controls?.zoom !== false;

  // Drag-state bus (Phase 4.2). Single source of truth: only one artboard
  // drag is active at a time. DCArtboards write here when their local drag
  // hook is non-idle; SnapGuideOverlay (in canvas-shell) reads guides.
  const [dragCurrent, setDragCurrent] = useState<DragState>({ kind: 'idle' });

  const undoStack = useUndoStackOptional();
  const undoSinks = useUndoSinks();
  // Stable ref so the commit callback (memoized once, on mount) always reads
  // the latest stack value without re-creating the callback on every render.
  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;

  /**
   * Applies a full artboard layout: optimistic local React state update +
   * server PATCH. Used as the `layoutPatchFn` sink registered with the
   * undo stack — both the initial commit (do) and every undo/redo replay
   * route through here, so React state always tracks the server.
   */
  const applyArtboardLayout = useCallback((layout: unknown) => {
    setArtboards(layout as ArtboardRect[]);
    patchCanvasMeta({ layout: { artboards: layout as ArtboardRect[] } });
  }, []);

  // Register the layout patch sink with the undo provider so the rebuilt
  // MoveArtboardsCommand (after a canvas switch + return) can apply layouts
  // through THIS iframe's React state, not the gone iframe's stale closures.
  useEffect(() => {
    undoSinks.setSink('layoutPatchFn', applyArtboardLayout);
    return () => undoSinks.setSink('layoutPatchFn', undefined);
  }, [undoSinks, applyArtboardLayout]);

  const commitArtboardPositions = useCallback(
    (moved: { id: string; x: number; y: number }[], opts?: CommitPositionsOptions) => {
      const movedById = new Map(moved.map((m) => [m.id, m]));
      const before = artboardsRef.current;
      const next = before.map((r) => {
        const m = movedById.get(r.id);
        if (m) return { ...r, x: m.x, y: m.y };
        return r;
      });
      // Phase 20 — skip pushing no-op drags (click-without-movement). The
      // user got back what they had, no edit happened, undo would do nothing.
      if (!diffLayoutPositions(before, next)) return;
      const record = buildMoveArtboardsRecord({
        before: before.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h })),
        after: next.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h })),
        ...(opts?.label ? { label: opts.label } : {}),
      });
      // push() invokes the rebuilt cmd.do() = applyArtboardLayout(next) BEFORE
      // updating the stack, so the optimistic local + PATCH flow is preserved.
      void undoStackRef.current.push(record);
    },
    []
  );

  const dragBus = useMemo<DragStateBus>(
    () => ({
      current: dragCurrent,
      setCurrent: setDragCurrent,
      commitPositions: commitArtboardPositions,
    }),
    [dragCurrent, commitArtboardPositions]
  );

  const inner = (
    <div className="dc-canvas" ref={hostRef}>
      <div className="dc-world" ref={worldRef} style={worldStyle}>
        {children}
      </div>
      {showMiniMap ? <DCMiniMap /> : null}
      {/* Plan C F6 — separate bottom-left zoom pill (the design's ZoomHud).
          Phase 5.1 had folded zoom into the ToolPalette; user feedback wants
          the design's standalone pill, so DCZoomToolbar renders here again (the
          ToolPalette's inline zoom is removed in tool-palette.tsx). It carries
          MORE than the mock — fit + actual-size — so no capability is lost. */}
      {showZoom ? <DCZoomToolbar /> : null}
    </div>
  );

  return (
    <WorldContext.Provider value={ctxValue}>
      <ControllerContext.Provider value={controller}>
        <DragStateContext.Provider value={dragBus}>
          <CanvasShell hostRef={hostRef}>{inner}</CanvasShell>
        </DragStateContext.Provider>
      </ControllerContext.Provider>
    </WorldContext.Provider>
  );
}
DesignCanvasInner.displayName = 'DesignCanvasInner';

export function DCSection({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const ctx = useWorldContext();
  if (ctx) {
    // Inside DesignCanvas: DCSection is purely metadata. Its title + subtitle
    // are stashed as data-* on a `display: contents` wrapper so inspector
    // selectors still resolve, but the wrapper imposes no layout — DCArtboard
    // children take their own world-coord positions.
    return (
      <div
        className="dc-section dc-section-collapsed"
        data-dc-section={id}
        data-dc-section-title={title}
        data-dc-section-subtitle={subtitle ?? ''}
      >
        {children}
      </div>
    );
  }
  return (
    <section className="dc-section" data-dc-section={id}>
      <header>
        <h2>{title}</h2>
        {subtitle ? <p className="sku">{subtitle}</p> : null}
      </header>
      <div className="dc-section-body">{children}</div>
    </section>
  );
}
DCSection.displayName = 'DCSection';

/**
 * Small monochrome glyph shown in the SKU-strip header for a non-`digital`
 * artboard (T3). Mirrors the corner video-badge's stroke style (viewBox 16,
 * `currentColor`, ~1.2px stroke) for chrome consistency. `video` reuses that
 * exact badge glyph.
 */
function ArtboardKindIcon({ kind }: { kind: ArtboardKind }) {
  if (kind === 'print') {
    return (
      <svg viewBox="0 0 16 16" width="10" height="10" fill="none" aria-hidden="true">
        <rect
          x="3"
          y="1.5"
          width="10"
          height="5"
          rx="0.5"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <rect x="1.5" y="6" width="13" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="4.5" y="10.5" width="7" height="4" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    );
  }
  if (kind === 'web') {
    return (
      <svg viewBox="0 0 16 16" width="10" height="10" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"
          stroke="currentColor"
          strokeWidth="1.1"
        />
      </svg>
    );
  }
  // video — same glyph as the corner Timeline badge.
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" aria-hidden="true">
      <rect x="1.5" y="4.5" width="8" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M9.5 7l4-2.3v6.6l-4-2.3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
ArtboardKindIcon.displayName = 'ArtboardKindIcon';

/**
 * Bordered artboard with a SKU-strip header. Inside DesignCanvas its world
 * position comes from meta.layout (or the synthesized default grid); the
 * given `width` + `height` props are honored only as a fallback when the
 * layout has no matching id. Outside DesignCanvas (DS specimens, legacy
 * uses) it renders a plain fixed-size block.
 */
export function DCArtboard({
  id,
  label,
  width,
  height,
  fixed,
  background,
  padding,
  layout,
  gap,
  kind,
  guides,
  print,
  children,
}: {
  id: string;
  label: string;
  width: number;
  height: number;
  /** Height sizing mode. Default (omitted/false) = HUG — the board grows to
   *  fit content; `height` becomes a min-height floor rather than an exact
   *  size. `true` = FIXED — today's behavior, `height` is exact and overflow
   *  clips. Width is always exact regardless of this flag. */
  fixed?: boolean;
  /** `.dc-artboard-body` background (CSS color/token, e.g. "var(--bg-1)"). */
  background?: string;
  /** `.dc-artboard-body` padding — px number, or a `var(--token)` string
   *  (space-token binding from the Inspector's artboard panel). */
  padding?: number | string;
  /** `.dc-artboard-body` layout mode. Default = the engine's plain block flow. */
  layout?: 'block' | 'flex-col' | 'flex-row' | 'grid';
  /** `.dc-artboard-body` gap — px number or `var(--token)` string; only
   *  visible under flex-col/flex-row/grid. */
  gap?: number | string;
  /** What this artboard IS — digital screen / print page / web flow / video
   *  comp. Absent ⇒ `digital` (or `video` when the subtree contains a
   *  `<VideoComp>`, for unmigrated canvases — see `subtreeHasVideoComp`).
   *  An explicit prop always supersedes that structural fallback. */
  kind?: ArtboardKind;
  /** Generic layout guides (T5) — Figma-vocabulary columns/rows/grid,
   *  versioned design intent. Kind-agnostic: any artboard can carry these
   *  regardless of `kind`. Visibility is per-user (T6), not this prop. */
  guides?: GuideDefinitions;
  /** feature-2-print-artboards T2 — paper/orientation/bleed/margins intent.
   *  Only meaningful when `kind="print"`; the overlay (T3) reads it to draw
   *  bleed/trim/margin guides against THIS artboard's own resolved px size. */
  print?: ArtboardPrintProp;
  children: ReactNode;
}) {
  countRender('artboardRenders');
  const ctx = useWorldContext();
  const _controller = useViewportControllerContext();
  const toolMode = useToolModeOptional();
  const chrome = useChromeVisibility();
  const selSet = useSelectionSetOptional();
  const dragBus = useDragStateContext();
  // Phase 13 / DDR-029 — live "agent works here" overlay. Inert (present=false)
  // outside CanvasActivityProvider, so specimens / legacy mounts never show it.
  const activity = useCanvasActivity();
  // Phase 13.2 / DDR-078 — when an agent is the editor, tint the overlay with
  // its presence color + show its funny name instead of the generic file label.
  const agent = useAgentPresence();
  const rect = ctx ? ctx.rectFor(id) : null;
  // T1/T2 — explicit `kind` wins; `subtreeHasVideoComp` is the fallback that
  // keeps existing unmigrated video canvases badged identically without
  // requiring a JSX edit (Design Decision 1).
  const hasVideoContent = useMemo(() => subtreeHasVideoComp(children), [children]);
  const resolvedKind: ArtboardKind = kind ?? (hasVideoContent ? 'video' : 'digital');
  // DDR-148 — badge video artboards in the header; clicking the badge opens
  // the timeline panel via the same postMessage the context-menu "Open
  // Timeline" entry already sends (canvas-shell.tsx artboardHasVideo/handler).
  const hasVideo = resolvedKind === 'video';
  const openTimeline = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      try {
        window.parent.postMessage({ dgn: 'open-timeline-request', artboardId: id }, '*');
      } catch {
        /* detached / cross-origin */
      }
    },
    [id]
  );

  // Drag hook — always called (hook rules). Inert outside DesignCanvas
  // (allRects empty, enabled=false), so specimens / legacy uses get a plain
  // fixed-size block as before.
  const dragHook = useArtboardDrag({
    artboardId: id,
    selected: selSet?.selected ?? [],
    rectFor: (rid) => (ctx ? ctx.rectFor(rid) : null),
    allRects: ctx?.artboards ?? [],
    viewport: ctx?.viewport ?? null,
    // Event-time zoom (publishing is settle-only — see applyViewport's `defer`).
    liveZoom: () => getLiveViewport()?.zoom ?? ctx?.viewport?.zoom ?? 1,
    // Cloud Phase 25 C2 — a read-only canvas keeps the Move tool for
    // selection, but artboards don't drag (editing is absent, not hidden).
    enabled: !!ctx && (toolMode?.tool ?? 'move') === 'move' && !isReadOnlyCanvas(),
    onCommit: (moved) => {
      if (dragBus) dragBus.commitPositions(moved);
    },
  });

  // Publish this artboard's drag state to the bus. Only push when non-idle;
  // when our local state returns to idle AFTER having been non-idle, push
  // one final idle update so the bus clears.
  const wasNonIdleRef = useRef(false);
  useEffect(() => {
    if (!dragBus) return;
    const s = dragHook.dragState;
    if (s.kind !== 'idle') {
      dragBus.setCurrent(s);
      wasNonIdleRef.current = true;
    } else if (wasNonIdleRef.current) {
      dragBus.setCurrent({ kind: 'idle' });
      wasNonIdleRef.current = false;
    }
  }, [dragHook.dragState, dragBus]);

  // Hug default (artboard "hug height") — the authored `height` prop is a
  // FLOOR (min-height), not an exact size, unless `fixed` pins it. The floor
  // stays stable across renders (it only changes when the JSX prop itself is
  // edited), so it never ratchets up from a previously-larger measured value
  // the way feeding `rect.h` back as the floor would.
  const heightFloor = typeof height === 'number' ? height : VP_GRID.h;
  // Plan T25/L08 — rename in place: double-click the name, Enter commits (the
  // shell writes the `label` prop), Escape or an unchanged name cancels.
  const [renaming, setRenaming] = useState(false);
  const renameDoneRef = useRef(false);
  const commitRename = (value: string) => {
    if (renameDoneRef.current) return;
    renameDoneRef.current = true;
    setRenaming(false);
    const next = value.trim();
    if (!next || next === label) return;
    try {
      window.parent.postMessage({ dgn: 'rename-artboard-request', artboardId: id, label: next }, '*');
    } catch {
      /* detached / cross-origin */
    }
  };
  const articleRef = useRef<HTMLElement | null>(null);
  const measured = useArtboardBounds(articleRef as RefObject<HTMLElement | null>);
  useEffect(() => {
    if (!ctx || fixed) return;
    if (dragHook.dragState.kind !== 'idle') return;
    if (measured.height <= 0) return;
    ctx.reportMeasuredHeight(id, Math.round(measured.height));
  }, [ctx, fixed, dragHook.dragState.kind, measured.height, id]);

  // Phase 2 — background/padding/layout/gap apply to the BODY (content box),
  // not the frame (label header stays chrome-styled). Undefined keys are
  // simply absent from the style object — no engine-CSS default is clobbered.
  const bodyStyle = useMemo<CSSProperties>(() => {
    const st: CSSProperties = {};
    if (background) st.background = background;
    // number → px; string → a var(--token) binding (validated server-side).
    if (typeof padding === 'number' || typeof padding === 'string') st.padding = padding;
    if (typeof gap === 'number' || typeof gap === 'string') st.gap = gap;
    if (layout === 'flex-col') {
      st.display = 'flex';
      st.flexDirection = 'column';
    } else if (layout === 'flex-row') {
      st.display = 'flex';
      st.flexDirection = 'row';
    } else if (layout === 'grid') {
      st.display = 'grid';
    }
    return st;
  }, [background, padding, gap, layout]);

  // Read-back surface for the Inspector's ArtboardKnobs panel — the SAME
  // generic "custom HTML attributes" escape hatch dom-selection.ts already
  // scrapes off the selected element (styleMapsFor → Selection.attrs), so the
  // panel pre-fills current state with no new plumbing. React omits an
  // attribute entirely when its value is `undefined`.
  const readBackAttrs = {
    'data-dc-fixed': fixed ? 'true' : undefined,
    'data-dc-bg': background,
    'data-dc-padding': padding != null ? String(padding) : undefined,
    'data-dc-layout': layout,
    'data-dc-gap': gap != null ? String(gap) : undefined,
    // Always present (unlike the optional-override props above) — this is a
    // resolved classification, not a "no override" style knob. Chrome, the
    // Inspector kind picker (T8), and canvas-shell's artboardHasVideo gate
    // (T2) all key off this attribute.
    'data-dc-kind': resolvedKind,
    // feature-2-print-artboards T2 — read-back for the Inspector's print
    // picker (paper/orientation/bleed pre-fill), same "stamp the resolved
    // prop as JSON, parse it back" shape `guides` would need if it grew an
    // Inspector editor. Small object (≤ ~150 bytes), so a plain JSON attr is
    // simpler than adding parallel data-dc-print-* scalar attrs per field.
    'data-dc-print': print ? JSON.stringify(print) : undefined,
  };

  if (!ctx || !rect) {
    return (
      <article
        className="dc-artboard"
        data-dc-screen={id}
        ref={articleRef}
        style={fixed ? { width, height } : { width, height: 'auto', minHeight: heightFloor }}
        {...readBackAttrs}
      >
        <header className="dc-artboard-label sku">{label}</header>
        <div className="dc-artboard-body" style={bodyStyle}>
          {children}
        </div>
      </article>
    );
  }
  const isActive = ctx.activeArtboardId === id;
  // G2v2 — earlier the label single-click called `controller.jumpTo(rect)`,
  // auto-zooming on every click. Per post-Wave-3.5 feedback this was
  // surprising. The label button stays for a11y (focus + screen-reader
  // label) but no longer mutates the viewport. Cmd+1 + the zoom HUD still
  // expose the manual zoom path.

  // Am I involved in the current drag (as leader or follower)?
  const busDrag = dragBus?.current;
  const isLeader = busDrag?.kind === 'dragging' && busDrag.leaderId === id;
  const followerOffset =
    busDrag?.kind === 'dragging' ? busDrag.followers.find((f) => f.id === id) : undefined;
  const isFollower = !!followerOffset;
  const isInDrag = isLeader || isFollower;

  // Live drag position (world coords). The article's own `left/top` updates
  // each frame while the drag is in flight — no ghost placeholder, no faded
  // original. commitFromState then persists the final position on settle.
  let liveX = rect.x;
  let liveY = rect.y;
  if (busDrag?.kind === 'dragging') {
    if (isLeader) {
      liveX = busDrag.leaderRect.x;
      liveY = busDrag.leaderRect.y;
    } else if (isFollower && followerOffset) {
      liveX = busDrag.leaderRect.x + followerOffset.offsetX;
      liveY = busDrag.leaderRect.y + followerOffset.offsetY;
    }
  }

  const handleProps = dragHook.bindHandle();

  // Phase 13 — overlay when THIS canvas is active and the change scope includes
  // this artboard (null scope = file-level = every artboard). Rendered as a
  // world-coord sibling of the <article> so it pans/zooms with the artboard.
  const showActivity = activity.present && matchesArtboard(activity.artboardIds, id);
  // Agent-driven → funny name + agent color; manual edit → file label + default hue.
  const activityLabel = agent
    ? agent.name
    : activity.artboardIds
      ? `${activity.fileLabel}:${label}`
      : activity.fileLabel;

  return (
    <>
      <article
        className={`dc-artboard dc-positioned${isInDrag ? ' dc-dragging' : ''}`}
        data-dc-screen={id}
        aria-current={isActive ? 'true' : undefined}
        ref={articleRef}
        {...readBackAttrs}
        style={{
          left: liveX,
          top: liveY,
          width: rect.w,
          // Hug default: height:auto + minHeight floor, content dictates the
          // box; the ResizeObserver above mirrors the settled size back into
          // rect.h for other consumers. Fixed: today's exact-height behavior.
          ...(fixed ? { height: rect.h } : { height: 'auto', minHeight: heightFloor }),
          // Off-screen artboards skip layout+paint. On a large multi-board
          // canvas (e.g. an 18-board moodboard) every board otherwise paints
          // onto one huge .dc-world plane whose device-pixel size exceeds
          // WebKit's ~16384px texture limit, forcing tile repaints on every
          // pan/zoom. content-visibility localizes each board's paint and culls
          // the ones outside the viewport; contain-intrinsic-size preserves the
          // box so the model-based fit math (computeFit reads ArtboardRects,
          // never the DOM) and drag hit-testing are unaffected. RCA:
          // .ai/logs/rca/issue-canvas-pan-zoom-jank-large-moodboard.md
          contentVisibility: 'auto',
          containIntrinsicSize: `${rect.w}px ${rect.h}px`,
        }}
        {...handleProps}
      >
        {renaming ? (
          <input
            className="dc-artboard-label sku dc-artboard-rename"
            data-testid={`artboard-rename-${id}`}
            aria-label="Artboard name"
            defaultValue={label}
            maxLength={80}
            // biome-ignore lint/a11y/noAutofocus: the rename field opens on the designer's own double-click
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            // The label is the drag handle; typing and clicking in the field
            // must not start a move or reach the canvas shortcuts.
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename(e.currentTarget.value);
              else if (e.key === 'Escape') {
                renameDoneRef.current = true;
                setRenaming(false);
              }
            }}
            onBlur={(e) => commitRename(e.currentTarget.value)}
          />
        ) : (
        <button
          type="button"
          className="dc-artboard-label sku"
          onDoubleClick={(e) => {
            if (isReadOnlyCanvas()) return;
            e.stopPropagation();
            renameDoneRef.current = false;
            setRenaming(true);
          }}
          // a11y-auditor (T3 review) — the kind chip is aria-hidden (decorative,
          // redundant with the Inspector's Kind picker), so a non-digital kind
          // must still reach the artboard's own accessible name or it's
          // invisible to AT users entirely.
          aria-label={
            resolvedKind !== 'digital' ? `Artboard ${label}, ${resolvedKind}` : `Artboard ${label}`
          }
        >
          {resolvedKind !== 'digital' ? (
            <span className="dc-artboard-kind-chip" aria-hidden="true">
              <ArtboardKindIcon kind={resolvedKind} />
            </span>
          ) : null}
          {label}
        </button>
        )}
        {hasVideo ? (
          <button
            type="button"
            className="dc-artboard-video-badge"
            aria-label={`Open timeline — ${label}`}
            title="Video artboard — open timeline"
            onClick={openTimeline}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
              <rect
                x="1.5"
                y="4.5"
                width="8"
                height="7"
                rx="1.2"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path
                d="M9.5 7l4-2.3v6.6l-4-2.3"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        <div className="dc-artboard-body" style={bodyStyle}>
          {children}
        </div>
      </article>
      {showActivity ? (
        <ArtboardActivityOverlay
          rect={{ x: liveX, y: liveY, w: rect.w, h: rect.h }}
          label={activityLabel}
          active={activity.active}
          color={agent?.color}
        />
      ) : null}
      {/* T4 — world-coord sibling, same reasoning as ArtboardActivityOverlay
          above: must stay OUTSIDE `.dc-artboard`'s contain:paint/
          content-visibility subtree so guides are never culled/frozen with
          exported content (they're never exported at all). */}
      <ArtboardGuidesOverlay
        rect={{ x: liveX, y: liveY, w: rect.w, h: rect.h }}
        kind={resolvedKind}
        guides={guides}
        print={print}
        visibility={{ guides: chrome?.guides ?? false, print: chrome?.print ?? false }}
      />
    </>
  );
}
DCArtboard.displayName = 'DCArtboard';

// ─────────────────────────────────────────────────────────────────────────────
// window.__maudeCanvasRects() — the whiteboard-toolkit geometry manifest hook
// (feature-whiteboard-ai-toolkit). `maude design canvas-rects` (a headless
// Chromium shim) calls this to get every artboard's + every meaningful
// element's WORLD-coordinate rect, so the annotation read/write verbs
// (`read-annotations --rects`, `annotate --in/--pin/--board`) never need to
// hand-compute a coordinate. Pure DOM + the `liveViewport` mirror above — no
// React context needed, so it works from a plain page.evaluate() call with no
// regard for which component tree happens to be mounted.
//
// World-coord conversion mirrors DesignCanvasInner's `activeArtboardId` math
// (canvas = translate(vp.x,vp.y) then scale(vp.zoom) applied to `.dc-world`):
//   worldX = (screenX - hostRect.left - vp.x) / vp.zoom
// A `.dc-canvas` host is required (bare DS specimens have no world plane —
// this hook is for UI canvases with artboards, so it returns an empty
// manifest there rather than guessing).

export interface CanvasRectsElement {
  cdId: string | null;
  selector: string;
  index: number;
  artboard: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  tag: string;
  text: string;
}

export interface CanvasRectsManifest {
  artboards: ArtboardRect[];
  elements: CanvasRectsElement[];
  elementsTruncated: boolean;
}

// Comment/annotation/chrome subtrees never make useful annotation targets —
// mirrors the pickSpecimenEl chrome denylist (canvas-comment-mount.tsx) plus
// the annotation layer's own root.
const RECTS_CHROME_SELECTOR =
  '.cm-composer, .cm-thread, .cm-mention-popup, .cm-pin, [data-mc-hover-halo], [data-mdcc-annotations], .dc-minimap, .dc-zoom-toolbar';

const RECTS_INTERACTIVE_TAGS = new Set([
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'option',
  'label',
  'summary',
  'img',
  'svg',
  'video',
  'picture',
]);

const RECTS_ELEMENT_CAP = 400;

/** True when `el` has no `[data-cd-id]` descendant — a "leaf" in the pipeline's
 *  stamped tree, i.e. the finest element the JSX source actually distinguishes
 *  (a text run, an icon, a leaf `<div>`) rather than a structural wrapper. */
function isCdIdLeaf(el: Element): boolean {
  return el.querySelector('[data-cd-id]') === null;
}

function elementIsCandidate(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (RECTS_INTERACTIVE_TAGS.has(tag)) return true;
  if (el.hasAttribute('role') && el.getAttribute('role') === 'button') return true;
  if (el.hasAttribute('tabindex')) return true;
  if (!isCdIdLeaf(el)) return false; // structural wrapper — a leaf sibling/descendant covers it
  return shortText(el, 1).length > 0;
}

function buildCanvasRectsManifest(): CanvasRectsManifest {
  const empty: CanvasRectsManifest = { artboards: [], elements: [], elementsTruncated: false };
  if (typeof document === 'undefined') return empty;
  const host = document.querySelector('.dc-canvas') as HTMLElement | null;
  if (!host) return empty; // bare specimen / no world plane — nothing to resolve against

  const vp = getLiveViewport() ?? { x: 0, y: 0, zoom: 1 };
  const hostRect = host.getBoundingClientRect();
  const toWorld = (r: DOMRect): { x: number; y: number; w: number; h: number } => ({
    x: (r.left - hostRect.left - vp.x) / vp.zoom,
    y: (r.top - hostRect.top - vp.y) / vp.zoom,
    w: r.width / vp.zoom,
    h: r.height / vp.zoom,
  });

  const artboards: ArtboardRect[] = [];
  const artboardEls = Array.from(document.querySelectorAll('[data-dc-screen]'));
  for (const el of artboardEls) {
    const rect = (el as HTMLElement).getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const id = el.getAttribute('data-dc-screen');
    if (!id) continue;
    // `kind` is part of ArtboardRect and the manifest's consumers (canvas-rects
    // → the whiteboard toolkit, DDR-151) read it. It was being dropped here —
    // invisible until A2 put this file under a checker. Same element carries
    // `data-dc-kind`, always stamped by DCArtboard; 'digital' is its own default.
    const kindAttr = el.getAttribute('data-dc-kind');
    const kind: ArtboardKind =
      kindAttr === 'print' || kindAttr === 'web' || kindAttr === 'video' ? kindAttr : 'digital';
    artboards.push({ id, kind, ...toWorld(rect) });
  }

  const elements: CanvasRectsElement[] = [];
  let truncated = false;
  const candidateEls = Array.from(document.querySelectorAll('[data-cd-id]'));
  for (const el of candidateEls) {
    if (elements.length >= RECTS_ELEMENT_CAP) {
      truncated = true;
      break;
    }
    if (el.closest(RECTS_CHROME_SELECTOR)) continue;
    const artboardEl = el.closest('[data-dc-screen]');
    if (!artboardEl) continue; // off-artboard chrome (menubar, panels, toolbars)
    if (!elementIsCandidate(el)) continue;
    const rect = (el as HTMLElement).getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const cdId = el.getAttribute('data-cd-id');
    const artboardId = artboardEl.getAttribute('data-dc-screen');
    const selector = cdId ? scopedCdSelector(cdId, artboardId) : '';
    const index = cdId ? selectorIndex(document, selector, el) : 0;
    elements.push({
      cdId,
      selector,
      index,
      artboard: artboardId,
      ...toWorld(rect),
      tag: el.tagName.toLowerCase(),
      text: shortText(el, 120),
    });
  }

  return { artboards, elements, elementsTruncated: truncated };
}

declare global {
  interface Window {
    __maudeCanvasRects?: () => CanvasRectsManifest;
  }
}

if (typeof window !== 'undefined') {
  window.__maudeCanvasRects = buildCanvasRectsManifest;
}

// ─────────────────────────────────────────────────────────────────────────────
// DrawProof (Phase 25) — the render/verify harness for the draw engine. Renders
// ONE vector mark across a size ladder × {light, dark, single-color flatten} as
// labeled DCArtboards, so a single `maude design screenshot --all-screens`
// operationalizes the whole graphic rubric at once:
//   • per-size legibility (does the 16px instance survive the favicon test?)
//   • dark-mode correctness (does `currentColor` flip cleanly?)
//   • the single-color flatten test (pure #000 on #fff — logo must hold)
// Reference frames are FIXED (not DS tokens) on purpose: the flatten/legibility
// tests must be objective, independent of whichever DS the canvas declares.
// Additive export (DDR-025) — no existing canvas-lib surface changes.

const DRAW_PROOF_MODES = {
  light: { bg: '#ffffff', fg: '#111111', label: 'light' },
  dark: { bg: '#111111', fg: '#f5f5f5', label: 'dark' },
  flatten: { bg: '#ffffff', fg: '#000000', label: 'single-color flatten' },
} as const;

export type DrawProofMode = keyof typeof DRAW_PROOF_MODES;

/**
 * Render a single mark across the verification ladder. `mark` is the inline SVG
 * (the engine's `toJsx` output, dropped in as JSX). Each mode becomes one
 * labeled DCArtboard (a `--all-screens` target) showing the mark at every size,
 * so the proof PNGs are `proof-<mode>.png`.
 */
export function DrawProof({
  mark,
  name = 'mark',
  sizes = [16, 24, 48, 256],
  modes = ['light', 'dark', 'flatten'],
}: {
  mark: ReactNode;
  name?: string;
  sizes?: number[];
  modes?: DrawProofMode[];
}) {
  const maxSize = Math.max(...sizes, 64);
  const cellGap = 32;
  const padding = 32;
  const boardWidth =
    padding * 2 + sizes.reduce((acc, s) => acc + Math.max(s, 56), 0) + cellGap * (sizes.length - 1);
  const boardHeight = padding * 2 + maxSize + 28;

  return (
    <DesignCanvas>
      <style>{'.dp-cell svg{display:block;width:100%;height:100%}'}</style>
      {modes.map((mode) => {
        const m = DRAW_PROOF_MODES[mode];
        return (
          <DCArtboard
            key={mode}
            id={`proof-${mode}`}
            label={`${name} · ${m.label}`}
            width={boardWidth}
            height={boardHeight}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: cellGap,
                padding,
                minHeight: boardHeight,
                background: m.bg,
                color: m.fg,
                boxSizing: 'border-box',
              }}
            >
              {sizes.map((s) => (
                <figure
                  key={s}
                  style={{
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span
                    className="dp-cell"
                    style={{ display: 'inline-block', width: s, height: s, color: m.fg }}
                  >
                    {mark}
                  </span>
                  <figcaption
                    style={{
                      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                      fontSize: 11,
                      color: m.fg,
                      opacity: 0.65,
                    }}
                  >
                    {s}px
                  </figcaption>
                </figure>
              ))}
            </div>
          </DCArtboard>
        );
      })}
    </DesignCanvas>
  );
}
DrawProof.displayName = 'DrawProof';

// ─────────────────────────────────────────────────────────────────────────────
// PhotoLayer (feature-photo-editor, Task 6) — the non-destructive WebGL photo
// compositor surface. Renders a source photo (artboard `<img>` or annotation
// `ImageStroke`) with a live `PhotoEdit` applied through pixi.js.
//
// LAZY-BUNDLE GUARANTEE (the plan's load-bearing acceptance criterion + BUILDER's
// flagged top risk): an UNEDITED photo (`isDefaultEdit(edit)`) renders as the
// plain `<img>` and NEVER touches pixi. The compositor module (photo/pipeline.ts)
// is only reached through a DYNAMIC `import()` inside the effect, so a canvas
// with zero edited photos pays zero pixi.js/bg-removal cost. Verified empirically
// against `buildCanvasModule` (no eager `pixi.js` import in the default-edit
// bundle) — see test/photo-canvas-bundle.test.ts.
//
// A11y: the pixi output is a `<canvas>` (a black box to AT), so it carries
// `role="img"` + `aria-label` from `alt` (validation step 7 requirement).
// Reduced-motion: the compositor renders statically (autoStart:false, no ticker).

export interface PhotoLayerProps {
  /** Relative `assets/<sha8>.<ext>` source (validated upstream). */
  source: string;
  /** Live non-destructive edit. Absent / neutral ⇒ plain `<img>`, no pixi. */
  edit?: PhotoEdit | null;
  width: number;
  height: number;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  /** Resolve a relative asset path to a fetchable URL (defaults to identity —
   *  relative `assets/…` already resolves against the canvas iframe origin). */
  resolveUrl?: (rel: string) => string;
  /** Fired once the pixi compositor has mounted + drawn its first frame. The
   *  preview bridge hides the original element only AFTER this, so a background
   *  cutout never flashes the untouched original underneath (and no flicker). */
  onReady?: () => void;
}

export function PhotoLayer({
  source,
  edit,
  width,
  height,
  alt = '',
  className,
  style,
  resolveUrl,
  onReady,
}: PhotoLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<{ destroy(): void; update(e: PhotoEdit): void } | null>(null);
  const active = !isDefaultEdit(edit);

  // Mount / tear down the pixi compositor only while an edit is active. The
  // compositor is DYNAMICALLY imported (lazy-bundle guarantee — see header).
  // Re-created only when the source/box identity changes; edit-param changes are
  // pushed via the second effect below (no teardown → smooth live scrub).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `edit` is deliberately excluded — re-creating the pixi Application on every scrub would thrash; edit updates flow through the second effect's `update()` (mount seeds from the current edit).
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    import('./photo/pipeline.ts')
      .then(({ PhotoRenderer }) =>
        PhotoRenderer.create({
          canvas,
          source,
          edit: (edit ?? {}) as PhotoEdit,
          width,
          height,
          resolveUrl,
        })
      )
      .then((r) => {
        if (disposed) {
          r.destroy();
          return;
        }
        rendererRef.current = r;
        onReady?.();
      })
      .catch((err) => {
        console.error('[PhotoLayer] compositor failed to mount', err);
      });
    return () => {
      disposed = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [active, source, width, height, resolveUrl, onReady]);

  // Live-update the mounted compositor on edit-param change (no re-create).
  useEffect(() => {
    if (active && edit && rendererRef.current) rendererRef.current.update(edit);
  }, [edit, active]);

  if (!active) {
    const src = resolveUrl ? resolveUrl(source) : source;
    return (
      <img src={src} width={width} height={height} alt={alt} className={className} style={style} />
    );
  }
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      role="img"
      aria-label={alt || 'Edited photo'}
      className={className}
      style={{ width, height, display: 'block', ...style }}
    />
  );
}
PhotoLayer.displayName = 'PhotoLayer';

// PhotoPreviewBridge (feature-photo-editor) — applies a live/persisted
// PhotoEdit DIRECTLY to the real photo element (artboard `<img>` or
// annotation `<image>`) by swapping its `src`/`href` to a baked data URL,
// instead of floating a separate WebGL-rendered decoy on top of it.
//
// Iteration 1 of this bridge did the "decoy" version: a `position:fixed` div
// tracked the real element's screen rect via a per-frame rAF loop and hid the
// original underneath (`visibility:hidden`) while a live `<PhotoLayer>` pixi
// canvas rendered on top. That broke every bit of free native DOM behavior
// the real element used to have:
//   - cmd+click / right-click hit-testing landed on whatever was BEHIND the
//     now-invisible original (a hidden element isn't hit-testable), while the
//     decoy was `pointer-events:none` so it couldn't take the click either —
//     net result, nothing was clickable.
//   - the decoy rendered at a STABLE "world" pixel size and was CSS-stretched
//     to the live screen box on zoom; the stretch didn't reliably track the
//     real box, so the visible photo grew/shrank relative to its own frame.
//   - it needed its own z-index (originally 30 — drew over the context menu)
//     instead of just sitting at the element's normal stacking position.
//   - it only knew about an edit via the transient postMessage below, so any
//     iframe remount (Cmd+R, HMR) reset it to nothing until a human reopened
//     the Inspector and nudged a knob.
// Swapping the REAL element's `src`/`href` sidesteps all of it: resize, zoom,
// hit-testing, and stacking become the browser's native `<img>`/`<image>`
// behavior, not a hand-rolled tracker. Non-destructive still holds — only the
// LIVE DOM attribute is mutated, never the authored TSX/SVG source; the
// on-disk `PhotoEdit` sidecar (`/_api/photo-edit`) stays the persisted source
// of truth, re-applied by the hydration scan below on every canvas (re)mount.
// The bake is at the source's NATIVE resolution (`renderPhotoDataUrl`), so
// the result stays sharp across any later resize/zoom with no re-bake.

/** `assets/<sha8>.<ext>` substring inside a `src`/`href`/`xlink:href`. */
const ASSET_REF_RE = /assets\/[0-9a-f]{8}\.[a-z0-9]+/i;

/** Matches a photo element by the `data-photo-asset` tag `apply()` stamps on
 *  first touch, falling back to a literal src/href substring match for an
 *  element this bridge hasn't touched yet. The tag is load-bearing: once
 *  baked, the element's `src`/`href` is a `data:` URL that no longer contains
 *  the original asset path, so the substring match alone would lose track of
 *  it on the very next edit. */
function findPhotoEl(asset: string): Element | null {
  if (typeof document === 'undefined') return null;
  // Scoped to img/image (not a bare `[data-photo-asset]` attribute selector) —
  // the canvas iframe is untrusted content (DDR-054); an authored canvas could
  // otherwise stamp the tag on an arbitrary element to redirect a bake.
  for (const n of document.querySelectorAll('img[data-photo-asset], image[data-photo-asset]')) {
    if (n.getAttribute('data-photo-asset') === asset) return n;
  }
  for (const n of document.querySelectorAll('img, image')) {
    const src =
      n.getAttribute('src') || n.getAttribute('href') || n.getAttribute('xlink:href') || '';
    if (src.includes(asset)) return n;
  }
  return null;
}

function extractAssetRef(el: Element): string | null {
  // Only trust `data-photo-asset` when it actually has the `assets/<sha8>.<ext>`
  // shape — the tag is attacker-controllable (untrusted canvas content,
  // DDR-054), and an unshaped value would otherwise ride unbounded into
  // `_active.json`/the WS broadcast via inspect.ts's `enrich()`.
  const tagged = el.getAttribute('data-photo-asset');
  if (tagged && ASSET_REF_RE.test(tagged)) return tagged;
  const ref =
    el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href') || '';
  return ref.match(ASSET_REF_RE)?.[0] ?? null;
}

function setPhotoElSrc(el: Element, url: string): void {
  if (el.tagName.toLowerCase() === 'image') {
    el.setAttribute(el.hasAttribute('xlink:href') ? 'xlink:href' : 'href', url);
  } else {
    el.setAttribute('src', url);
  }
}

const BAKE_DEBOUNCE_MS = 80;

export function PhotoPreviewBridge() {
  // The ORIGINAL (unedited) src/href per asset, captured the first time this
  // bridge touches that element — so turning an edit off restores exactly
  // what the element pointed to, not a guess.
  const originalRef = useRef<Map<string, string>>(new Map());
  // Per-asset bake generation — guards a slow (or out-of-order) render from
  // clobbering a NEWER edit that already resolved first.
  const tokenRef = useRef<Map<string, number>>(new Map());
  const bakeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const bake = useCallback((asset: string, original: string, edit: PhotoEdit) => {
    const token = (tokenRef.current.get(asset) ?? 0) + 1;
    tokenRef.current.set(asset, token);
    import('./photo/pipeline.ts')
      .then(({ renderPhotoDataUrl }) => renderPhotoDataUrl({ source: original, edit }))
      .then((dataUrl) => {
        if (tokenRef.current.get(asset) !== token) return; // superseded by a newer edit
        const live = findPhotoEl(asset);
        if (live) setPhotoElSrc(live, dataUrl);
      })
      .catch((err) => {
        console.error('[PhotoPreviewBridge] bake failed', err);
      });
  }, []);

  const apply = useCallback(
    (asset: string, edit: PhotoEdit | null) => {
      const el = findPhotoEl(asset);
      if (!el) return;
      if (!el.hasAttribute('data-photo-asset')) el.setAttribute('data-photo-asset', asset);
      if (!originalRef.current.has(asset)) {
        const orig =
          el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href') || '';
        originalRef.current.set(asset, orig);
      }
      const original = originalRef.current.get(asset) ?? '';
      const timers = bakeTimers.current;
      clearTimeout(timers.get(asset));
      if (!edit || isDefaultEdit(edit)) {
        timers.delete(asset);
        setPhotoElSrc(el, original);
        return;
      }
      timers.set(
        asset,
        setTimeout(() => bake(asset, original, edit), BAKE_DEBOUNCE_MS)
      );
    },
    [bake]
  );

  useEffect(() => {
    const timers = bakeTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  // A peer's photo edit arrived: the sidecar changed on disk, the shell heard
  // it on the HMR socket and re-dispatched it here. Re-fetch and re-apply —
  // deliberately OUTSIDE the hydration scan's once-per-asset `attempted` set,
  // which exists to stop mutation-driven fetch amplification and which is
  // exactly why a synced edit used to appear only after Cmd+R (the scan had
  // already spent this asset's one attempt on mount).
  useEffect(() => {
    const onRefreshed = (e: Event) => {
      const sha8 = (e as CustomEvent<{ sha8?: unknown }>).detail?.sha8;
      if (typeof sha8 !== 'string' || !/^[0-9a-f]{8}$/i.test(sha8)) return;
      // Resolve the full `assets/<sha8>.<ext>` ref from the live DOM — the
      // event carries only the hash (the sidecar name has no extension).
      let asset: string | null = null;
      for (const n of document.querySelectorAll('img, image')) {
        const ref = extractAssetRef(n);
        if (ref?.includes(`assets/${sha8}.`)) {
          asset = ref;
          break;
        }
      }
      if (!asset) return; // no photo on this canvas uses that asset
      fetch(`/_api/photo-edit?asset=${encodeURIComponent(asset)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((edit) => {
          // A deleted/reset edit applies as null → restores the original src.
          apply(asset as string, edit && !isDefaultEdit(edit) ? (edit as PhotoEdit) : null);
        })
        .catch(() => {});
    };
    document.addEventListener('maude:photo-edit-refreshed', onRefreshed);
    return () => document.removeEventListener('maude:photo-edit-refreshed', onRefreshed);
  }, [apply]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as { dgn?: string; asset?: unknown; edit?: unknown; busy?: unknown } | null;
      if (!m) return;
      // Background-removal busy shimmer (Task 12 reveal) — a `data-photo-busy`
      // attribute toggle on the real element, styled by inspect.ts's single CSS
      // injection point (mirrors `.dc-activity-scan`'s sweep language). No
      // separate tracked overlay — see the header comment above `apply()`.
      // `m.asset` must pass the same shape check `extractAssetRef` applies
      // elsewhere in this file (fix-photo-editor-followup-debt, Task 8) —
      // an empty string previously matched EVERY photo element via
      // `findPhotoEl`'s substring-match fallback (`src.includes('')` is always
      // true), so an empty/malformed `asset` is now a no-op instead of toggling
      // the busy shimmer on every photo on the canvas.
      if (m.dgn === 'photo-busy' && typeof m.asset === 'string' && ASSET_REF_RE.test(m.asset)) {
        const el = findPhotoEl(m.asset);
        el?.toggleAttribute('data-photo-busy', !!m.busy);
        return;
      }
      if (m.dgn !== 'photo-preview' || typeof m.asset !== 'string') return;
      const asset = m.asset;
      const edit = (m.edit ?? null) as PhotoEdit | null;
      apply(asset, edit);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [apply]);
  // Boot-time (+ ongoing) hydration from the PERSISTED sidecar, not just the
  // live `photo-preview` message above. Without this, a saved PhotoEdit is
  // invisible after anything that re-mounts the canvas doc (Cmd+R, an
  // HMR remount, or a resize that recreates the photo's DOM node) — the
  // message-only bridge starts every fresh mount with an empty `edits` map,
  // and nothing re-sends the already-saved edit until a human happens to
  // reopen the Inspector Photo tab and touch a knob. A MutationObserver
  // re-scan (not just an initial one-shot) is what makes this self-heal after
  // those remounts, since the photo element's DOM node is often a NEW node
  // post-remount, not the one the original message targeted.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let cancelled = false;
    let raf = 0;
    // Every asset gets AT MOST one fetch attempt for this bridge's lifetime —
    // without this, a canvas whose DOM keeps mutating (an animation, a
    // re-rendering component) reissues the full unfetched set on every
    // mutation frame, forever (security review finding: unbounded fetch
    // amplification against the dev server from a zero-gesture background
    // scan).
    const attempted = new Set<string>();
    // Safety ceiling per pass — a pathological/hostile canvas DOM (thousands
    // of img/image elements) shouldn't be able to fan out unbounded fetches
    // in one scan; the next mutation-triggered pass picks up where this left
    // off since `attempted` persists across passes.
    const MAX_SCAN_PER_PASS = 500;
    const scan = () => {
      let scanned = 0;
      for (const n of document.querySelectorAll('img, image')) {
        const asset = extractAssetRef(n);
        if (!asset || attempted.has(asset)) continue;
        if (++scanned > MAX_SCAN_PER_PASS) break;
        attempted.add(asset);
        fetch(`/_api/photo-edit?asset=${encodeURIComponent(asset)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((edit) => {
            if (cancelled || !edit || isDefaultEdit(edit)) return;
            apply(asset, edit);
          })
          .catch(() => {});
      }
    };
    scan();
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(scan);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'href'],
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [apply]);
  return null; // mutates the real elements directly — no visible DOM of its own.
}
PhotoPreviewBridge.displayName = 'PhotoPreviewBridge';

// PhotoBgRemoveHarness (feature-photo-editor, Task 18) — the headless CLI proof
// harness `photo-bg-remove.sh` mounts inside a throwaway `_photo/<slug>.bgremove.tsx`
// canvas (mirrors DrawProof's role for the draw engine). Runs the EXACT SAME
// client-side ML flow the interactive "Remove Background" button uses (Task 12,
// app.jsx `onPhotoRemoveBackground`) — @imgly/background-removal, WASM/WebGPU,
// pixels never leave the browser — then persists the result and reports back to
// the driving CLI script via DOM attributes it polls (no return value crosses
// the process boundary; agent-browser reads attributes off the DOM instead).
//
// `/_api/asset` and `/_api/photo-edit` are BOTH canvas-safe routes (see their
// CANVAS_SAFE_API comments in http.ts), so this harness posts directly from the
// canvas origin — no main-origin relay / cross-origin workaround needed, despite
// the split-origin (DDR-054) boundary the rest of the canvas runs inside.

export interface PhotoBgRemoveHarnessProps {
  /** Relative `assets/<sha8>.<ext>` source to remove the background from. */
  source: string;
}

export function PhotoBgRemoveHarness({ source }: PhotoBgRemoveHarnessProps) {
  const [status, setStatus] = useState<'pending' | 'done' | 'error'>('pending');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // one ML pass per mount — a dev-mode double-effect must not double-run it
    ranRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const srcRes = await fetch(`/${source.replace(/^\/+/, '')}`);
        if (!srcRes.ok) throw new Error(`source fetch failed: ${srcRes.status}`);
        const srcBlob = await srcRes.blob();
        const { removeBackground } = await import('@imgly/background-removal');
        const matte = await removeBackground(srcBlob);
        const up = await fetch('/_api/asset', {
          method: 'POST',
          headers: { 'content-type': matte.type || 'image/png' },
          body: matte,
        });
        const upJson = (await up.json().catch(() => ({}))) as { path?: string };
        if (!up.ok || !upJson.path) throw new Error(`asset upload failed: ${up.status}`);
        const maskAsset = upJson.path;

        // Merge onto whatever's already in the sidecar (mirrors photo-adjust.sh's
        // merge-by-default behavior) instead of clobbering unrelated fields.
        const base: unknown = await fetch(`/_api/photo-edit?asset=${encodeURIComponent(source)}`)
          .then((r) => (r.ok ? r.json() : {}))
          .catch(() => ({}));
        const nextEdit = {
          ...(base && typeof base === 'object' ? base : {}),
          backgroundRemoved: { enabled: true, maskAsset },
        };
        const put = await fetch(`/_api/photo-edit?asset=${encodeURIComponent(source)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextEdit),
        });
        if (!put.ok) throw new Error(`photo-edit save failed: ${put.status}`);
        if (cancelled) return;
        setResult(maskAsset);
        setStatus('done');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <div
      data-photo-bgremove-status={status}
      data-photo-bgremove-result={result ?? ''}
      data-photo-bgremove-error={error ?? ''}
      style={{ padding: 24, font: '13px monospace' }}
    >
      photo-bg-remove: {status}
      {result ? ` → ${result}` : ''}
      {error ? ` (${error})` : ''}
    </div>
  );
}
PhotoBgRemoveHarness.displayName = 'PhotoBgRemoveHarness';

// ─────────────────────────────────────────────────────────────────────────────
// SnapGuideOverlay (Phase 4.2) — renders 1 px guide lines while a drag is in
// flight. Mounted by canvas-shell as a chrome layer outside `.dc-world`, so
// the lines are in screen coords (no CSS-zoom subpixel weirdness). Guides
// come from `dragBus.current.snap.guides`; world→screen projection uses the
// live viewport (`v.x + worldCoord * v.zoom` — same convention as `writeTransform`).

// DDR-046 — render kind-aware snap guides + distance pills. `kind === 'sibling'`
// gets the confident magenta + glow; `kind === 'grid'` gets a lighter gray (the
// grid is fallback when no sibling fires). Pre-DDR-046 guides emit no `kind`
// field — treat as sibling for back-compat. The `Δ{Math.round(delta)}` pill
// renders mid-span when |delta| > 0 and screen-span exceeds 60 px (smaller
// spans hide the pill so it never overlaps the line itself).
const MIN_PILL_SPAN_PX = 60;
const GUIDE_THICKNESS_PX = 2;

export function SnapGuideOverlay() {
  const dragBus = useDragStateContext();
  const world = useWorldContext();
  if (!dragBus || !world) return null;
  const s = dragBus.current;
  if (s.kind !== 'dragging') return null;
  const vp = world.viewport;
  if (!vp) return null;
  return (
    <>
      {s.snap.guides.map((g, i) => {
        const kindClass = g.kind === 'grid' ? 'dc-snap-guide--grid' : 'dc-snap-guide--sibling';
        const delta = g.delta ?? 0;
        const showPill = g.kind !== 'grid' && Math.abs(delta) > 0;
        if (g.axis === 'x') {
          const sx = vp.x + g.pos * vp.zoom;
          const sFrom = vp.y + g.from * vp.zoom;
          const sTo = vp.y + g.to * vp.zoom;
          const screenSpan = sTo - sFrom;
          return (
            <Fragment
              // biome-ignore lint/suspicious/noArrayIndexKey: guides are positional
              key={`x-${i}`}
            >
              <div
                className={`dc-snap-guide ${kindClass}`}
                style={{
                  left: sx - GUIDE_THICKNESS_PX / 2,
                  top: sFrom,
                  width: GUIDE_THICKNESS_PX,
                  height: Math.max(GUIDE_THICKNESS_PX, screenSpan),
                }}
                aria-hidden="true"
              />
              {showPill && screenSpan >= MIN_PILL_SPAN_PX && (
                <div
                  className="dc-snap-pill"
                  style={{
                    left: sx,
                    top: sFrom + screenSpan / 2,
                    transform: 'translate(-50%, -50%)',
                  }}
                  aria-hidden="true"
                >
                  Δ{Math.round(Math.abs(delta))}
                </div>
              )}
            </Fragment>
          );
        }
        const sy = vp.y + g.pos * vp.zoom;
        const sFrom = vp.x + g.from * vp.zoom;
        const sTo = vp.x + g.to * vp.zoom;
        const screenSpan = sTo - sFrom;
        return (
          <Fragment
            // biome-ignore lint/suspicious/noArrayIndexKey: guides are positional
            key={`y-${i}`}
          >
            <div
              className={`dc-snap-guide ${kindClass}`}
              style={{
                left: sFrom,
                top: sy - GUIDE_THICKNESS_PX / 2,
                width: Math.max(GUIDE_THICKNESS_PX, screenSpan),
                height: GUIDE_THICKNESS_PX,
              }}
              aria-hidden="true"
            />
            {showPill && screenSpan >= MIN_PILL_SPAN_PX && (
              <div
                className="dc-snap-pill"
                style={{
                  left: sFrom + screenSpan / 2,
                  top: sy,
                  transform: 'translate(-50%, -50%)',
                }}
                aria-hidden="true"
              >
                Δ{Math.round(Math.abs(delta))}
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
SnapGuideOverlay.displayName = 'SnapGuideOverlay';

export function DCPostIt({ children }: { children: ReactNode }) {
  return <aside className="dc-postit">{children}</aside>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Floating overlays (Phase 4 T3) — outside `.dc-world`, so they stay fixed
// to the canvas iframe chrome while the world pans/zooms underneath. Mounted
// by DesignCanvas; consumers opt out per-overlay via `<DesignCanvas controls>`.
// Styling lives inline so the engine drops into ANY DS without requiring
// `.dc-mm` / `.dc-zoom-tb` rules in `_components.css`. CV-01 references the
// same vocabulary; if a DS wants to restyle, it can target `.dc-mm` /
// `.dc-zoom-tb` directly.

// DDR-046 — Floating chrome (mini-map, zoom HUD, tool palette, popovers, comment
// composer, export dialog) drops the brutalist 4 × 4 × 0 hard offset shadow in
// favor of a soft ambient. The hard offset stays on app-shell chrome only
// (menubar, header, tab strip) — that's the project's intentional brutalist
// identity. Floating layer = soft. App frame = hard.
const FLOATING_SHADOW =
  '0 6px 24px var(--maude-chrome-shadow, color-mix(in oklab, #1c1917 10%, transparent))';
const FLOATING_RADIUS = '8px';

const OVERLAY_CSS = `
.dc-mm {
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: 196px;
  height: 132px;
  background: var(--maude-chrome-bg-0, #ffffff);
  border: 1px solid var(--maude-chrome-fg-0, #1c1917);
  border-radius: ${FLOATING_RADIUS};
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10px;
  color: var(--maude-chrome-fg-1, rgba(40,30,20,0.7));
  z-index: 6;
  user-select: none;
  box-shadow: ${FLOATING_SHADOW};
  overflow: hidden;
}
.dc-mm-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px 4px;
  border-bottom: 1px solid var(--maude-chrome-border, rgba(0,0,0,0.08));
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-size: 9px;
  background: var(--maude-chrome-bg-1, #f4f1ea);
}
.dc-mm-count { font-variant-numeric: tabular-nums; color: var(--maude-chrome-fg-2, rgba(40,30,20,0.55)); }
.dc-mm-body {
  position: relative;
  width: 100%;
  height: calc(100% - 22px);
  overflow: hidden;
  cursor: pointer;
  background: var(--maude-chrome-bg-1, #f4f1ea);
}
.dc-mm-rect {
  position: absolute;
  background: color-mix(in oklab, var(--maude-chrome-fg-0, #1c1917) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--maude-chrome-fg-0, #1c1917) 28%, transparent);
  border-radius: 1px;
}
/* Filled viewport indicator — FigJam / Figma both ship a tinted fill, not
   outline-only. Reads from a glance as "what slice of the world you're on". */
.dc-mm-vp {
  position: absolute;
  background: color-mix(in oklab, var(--maude-hud-accent, #d63b1f) 12%, transparent);
  border: 1.5px solid var(--maude-hud-accent, #d63b1f);
  border-radius: 1px;
  pointer-events: none;
}
.dc-zoom-tb {
  position: absolute;
  left: 16px;
  bottom: 16px;
  display: flex;
  align-items: stretch;
  background: var(--maude-chrome-bg-0, #ffffff);
  border: 1px solid var(--maude-chrome-fg-0, #1c1917);
  border-radius: ${FLOATING_RADIUS};
  overflow: hidden;
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  color: var(--maude-chrome-fg-1, rgba(40,30,20,0.85));
  z-index: 6;
  box-shadow: ${FLOATING_SHADOW};
}
.dc-zoom-tb button {
  appearance: none;
  background: transparent;
  border: 0;
  border-right: 1px solid var(--maude-chrome-border, rgba(0,0,0,0.08));
  padding: 7px 12px;
  font: inherit;
  color: inherit;
  cursor: pointer;
  min-width: 36px;
  text-align: center;
  transition: background 80ms linear;
}
.dc-zoom-tb button:last-child { border-right: 0; }
.dc-zoom-tb button:hover { background: color-mix(in oklab, var(--maude-chrome-fg-0, #1c1917) 5%, transparent); }
.dc-zoom-tb button:focus-visible { outline: 2px solid var(--maude-hud-accent, #d63b1f); outline-offset: -2px; }
.dc-zoom-tb-pct { font-variant-numeric: tabular-nums; min-width: 52px; }
`.trim();

function ensureOverlayStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-overlay-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-overlay-css';
  s.textContent = OVERLAY_CSS;
  document.head.appendChild(s);
}

interface MiniMapGeometry {
  scale: number;
  offsetX: number;
  offsetY: number;
  bbox: { x: number; y: number; w: number; h: number };
}

function computeMiniMapGeometry(
  artboards: ArtboardRect[],
  mapW: number,
  mapH: number,
  pad = 6
): MiniMapGeometry {
  if (artboards.length === 0) {
    return { scale: 1, offsetX: 0, offsetY: 0, bbox: { x: 0, y: 0, w: 0, h: 0 } };
  }
  let xMin = Number.POSITIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const r of artboards) {
    if (r.x < xMin) xMin = r.x;
    if (r.y < yMin) yMin = r.y;
    if (r.x + r.w > xMax) xMax = r.x + r.w;
    if (r.y + r.h > yMax) yMax = r.y + r.h;
  }
  const bw = Math.max(1, xMax - xMin);
  const bh = Math.max(1, yMax - yMin);
  const scale = Math.min((mapW - pad * 2) / bw, (mapH - pad * 2) / bh);
  const offsetX = pad + (mapW - pad * 2 - bw * scale) / 2 - xMin * scale;
  const offsetY = pad + (mapH - pad * 2 - bh * scale) / 2 - yMin * scale;
  return { scale, offsetX, offsetY, bbox: { x: xMin, y: yMin, w: bw, h: bh } };
}

/**
 * Bottom-right floating world map. Renders every DCArtboard rect scaled-to-fit
 * plus a red viewport indicator. Click-drag inside the map pans the main view;
 * click outside the viewport rect recenters on that point. Decorative for
 * accessibility — SR users navigate via DCArtboard label buttons (T4).
 */
export function DCMiniMap() {
  ensureOverlayStyles();
  const world = useWorldContext();
  const controller = useViewportControllerContext();
  const chrome = useChromeVisibility();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // 132 - 22 (header) = 110 body height; width matches the chrome.
  const MAP_W = 196;
  const MAP_BODY_H = 110;
  const dragRef = useRef<{ active: boolean; pointerId: number }>({
    active: false,
    pointerId: -1,
  });
  // Live, not published: the minimap indicator is one of the two things that
  // must follow the gesture frame by frame (the other is the zoom readout).
  // Everything else in the tree deliberately sits still until settle.
  // Called before the early returns below — hooks cannot sit behind a branch.
  const vp = useLiveViewport();

  if (!world || !controller) return null;
  // Menubar "View ▸ Minimap" toggle + Presentation Mode (which hides ALL
  // chrome). `chrome` is null in a bare DS specimen — then default-visible.
  if (chrome && (!chrome.minimap || chrome.present)) return null;

  const geometry = computeMiniMapGeometry(world.artboards, MAP_W, MAP_BODY_H);
  const host = world.hostRef.current;

  // Visible-area rect in world coords, then projected into map coords.
  let vpRect: { left: number; top: number; w: number; h: number } | null = null;
  if (host && Number.isFinite(vp.zoom) && vp.zoom > 0) {
    const wLeft = -vp.x / vp.zoom;
    const wTop = -vp.y / vp.zoom;
    const wW = host.clientWidth / vp.zoom;
    const wH = host.clientHeight / vp.zoom;
    vpRect = {
      left: wLeft * geometry.scale + geometry.offsetX,
      top: wTop * geometry.scale + geometry.offsetY,
      w: wW * geometry.scale,
      h: wH * geometry.scale,
    };
  }

  function mapToWorld(mx: number, my: number): { x: number; y: number } {
    return {
      x: (mx - geometry.offsetX) / geometry.scale,
      y: (my - geometry.offsetY) / geometry.scale,
    };
  }

  function centerOnWorld(wx: number, wy: number) {
    const h = world?.hostRef.current;
    const c = controller;
    if (!h || !c) return;
    const cur = c.viewport;
    c.setViewport({
      x: h.clientWidth / 2 - wx * cur.zoom,
      y: h.clientHeight / 2 - wy * cur.zoom,
      zoom: cur.zoom,
    });
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (!body) return;
    const r = body.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const w = mapToWorld(mx, my);
    centerOnWorld(w.x, w.y);
    try {
      body.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current.active = true;
    dragRef.current.pointerId = e.pointerId;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || e.pointerId !== dragRef.current.pointerId) return;
    const body = bodyRef.current;
    if (!body) return;
    const r = body.getBoundingClientRect();
    const w = mapToWorld(e.clientX - r.left, e.clientY - r.top);
    centerOnWorld(w.x, w.y);
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try {
      bodyRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="dc-mm" aria-hidden="true">
      <div className="dc-mm-hd">
        <span>World</span>
        <span className="dc-mm-count">
          {world.artboards.length} / {world.artboards.length}
        </span>
      </div>
      <div
        className="dc-mm-body"
        ref={bodyRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {world.artboards.map((r) => (
          <div
            key={r.id}
            className="dc-mm-rect"
            style={{
              left: r.x * geometry.scale + geometry.offsetX,
              top: r.y * geometry.scale + geometry.offsetY,
              width: r.w * geometry.scale,
              height: r.h * geometry.scale,
            }}
          />
        ))}
        {vpRect ? (
          <div
            className="dc-mm-vp"
            style={{ left: vpRect.left, top: vpRect.top, width: vpRect.w, height: vpRect.h }}
          />
        ) : null}
      </div>
    </div>
  );
}
DCMiniMap.displayName = 'DCMiniMap';

/**
 * Bottom-center floating toolbar — zoom out · current % · zoom in · fit · 1:1.
 * Clicking the % indicator resets to 100 %.
 */
export function DCZoomToolbar() {
  ensureOverlayStyles();
  const controller = useViewportControllerContext();
  const chrome = useChromeVisibility();
  // Before the early returns — hooks cannot sit behind a branch. Live, because
  // a zoom readout that only updates on settle reads as a frozen UI.
  const liveVp = useLiveViewport();
  if (!controller) return null;
  // Menubar "View ▸ Zoom controls" toggle + Presentation Mode.
  if (chrome && (!chrome.zoom || chrome.present)) return null;
  const pct = Math.round(liveVp.zoom * 100);
  return (
    <div className="dc-zoom-tb" role="toolbar" aria-label="Zoom">
      <button type="button" onClick={controller.zoomOut} aria-label="Zoom out">
        −
      </button>
      <button
        type="button"
        className="dc-zoom-tb-pct"
        onClick={controller.reset}
        aria-label={`Zoom ${pct}%, click to reset to 100%`}
      >
        {pct}%
      </button>
      <button type="button" onClick={controller.zoomIn} aria-label="Zoom in">
        +
      </button>
      <button type="button" onClick={controller.fit} aria-label="Fit to screen">
        [ ]
      </button>
      <button type="button" onClick={controller.reset} aria-label="Actual size">
        1:1
      </button>
    </div>
  );
}
DCZoomToolbar.displayName = 'DCZoomToolbar';

// ─────────────────────────────────────────────────────────────────────────────
// Specimen helpers

/** SKU + breadcrumb trail + optional ThemeToggle. Maps to `.specimen-hd`. */
export function SpecimenHeader({
  sku,
  crumbs,
  showThemeToggle = true,
}: {
  sku: string;
  crumbs: string[];
  showThemeToggle?: boolean;
}) {
  return (
    <header className="specimen-hd">
      <span className="sku">{sku}</span>
      <span className="crumbs">
        {crumbs.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: crumbs may repeat; index disambiguates static breadcrumb labels.
          <span key={`${c}-${i}`}>{c}</span>
        ))}
      </span>
      {showThemeToggle ? <ThemeToggle /> : null}
    </header>
  );
}

/** `<dl class="specimen-meta">` ladder. */
export function SpecimenMeta({ entries }: { entries: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="specimen-meta">
      {entries.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** <kbd> chrome — keyboard hint. */
export function KbdHint({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

/** Inline `var(--name)` value visualiser — small chip + token name. */
export function TokenChip({ name, swatch }: { name: string; swatch?: boolean }) {
  return (
    <span className="token-chip" data-token={name}>
      {swatch ? (
        <span className="token-chip-swatch" style={{ background: `var(${name})` }} />
      ) : null}
      <code>{name}</code>
    </span>
  );
}

/** Color swatch — square + token label + optional caption. */
export function ColorSwatch({
  token,
  caption,
  height = 96,
}: {
  token: string;
  caption?: ReactNode;
  height?: number;
}) {
  return (
    <div className="swatch">
      <div className="chip" style={{ background: `var(${token})`, height }} />
      <div className="meta">
        <strong>{token}</strong>
        {caption ? <span className="oklch">{caption}</span> : null}
      </div>
    </div>
  );
}

/** Single row of a type-ladder specimen — label + sample at given token. */
export function TypeScaleRow({
  token,
  label,
  sample,
}: {
  token: string;
  label: string;
  sample?: string;
}) {
  return (
    <div className="type-row" data-token={token}>
      <span className="sku">{label}</span>
      <span className="type-sample" style={{ fontSize: `var(${token})` }}>
        {sample ?? 'The quick brown fox jumps over the lazy dog'}
      </span>
    </div>
  );
}

/** Light/dark toggle. Writes `data-theme` on `<html>` and persists to memory. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <span className="theme-toggle" role="tablist" aria-label="Theme">
      <button
        type="button"
        data-theme="light"
        aria-pressed={theme === 'light'}
        onClick={() => setTheme('light')}
      >
        LIGHT
      </button>
      <button
        type="button"
        data-theme="dark"
        aria-pressed={theme === 'dark'}
        onClick={() => setTheme('dark')}
      >
        DARK
      </button>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks

/**
 * Read resolved CSS custom property values from `<html>`. Returns the full set
 * when prefix is omitted; otherwise filters to vars beginning with `--<prefix>`.
 * Re-resolves on `data-theme` mutation.
 */
export function useTokens(prefix?: string): Record<string, string> {
  const [tokens, setTokens] = useState<Record<string, string>>({});
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function read() {
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      const out: Record<string, string> = {};
      const len = cs.length;
      for (let i = 0; i < len; i++) {
        const name = cs.item(i);
        if (!name.startsWith('--')) continue;
        if (prefix && !name.startsWith(`--${prefix}`)) continue;
        out[name] = cs.getPropertyValue(name).trim();
      }
      setTokens(out);
    }
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, [prefix]);
  return tokens;
}

/**
 * Current theme + setter. Mirrors the `data-theme` attribute on `<html>`.
 * Defaults to whatever attribute is already set (or "light"). No persistence
 * to localStorage — canvases are ephemeral; specimens reset per-load.
 */
export function useTheme(): { theme: string; setTheme: (t: string) => void } {
  const [theme, setThemeState] = useState<string>(() => {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.dataset.theme ?? 'light';
  });
  const setTheme = useCallback((t: string) => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = t;
    }
    setThemeState(t);
  }, []);
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const obs = new MutationObserver(() => {
      const t = document.documentElement.dataset.theme ?? 'light';
      setThemeState(t);
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
}

/**
 * ResizeObserver wrapper. Pass a ref to any element (typically the active
 * artboard); returns its current `{ width, height }` in CSS pixels.
 */
export function useArtboardBounds(ref: RefObject<HTMLElement | null>): {
  width: number;
  height: number;
} {
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const r = e.contentRect;
      setBounds({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return bounds;
}

// Re-export `useRef` so `useArtboardBounds` consumers can keep a single
// import line from `@maude/canvas-lib`.
export { useRef };

// ─────────────────────────────────────────────────────────────────────────────
// Motion subsystem (Phase 3.7 / DDR-049 — Motion One is the canonical runtime)
//
// These helpers are tree-shakeable. A canvas that does not import any of them
// pays no bundle cost (motion/react is externalised via RUNTIME_PACKAGES, so
// even when imported the byte cost lives in a single shared runtime bundle,
// not per-canvas).
//
// Roles map 1:1 to the 8 motion-vocabulary names enforced by motion-critic +
// design-system-keeper. Each role binds to a DS duration + easing token from
// colors_and_type.css; useMotionTokens() reads the live CSS custom property
// values so the binding survives token edits without rebuilding canvas-lib.
//
// Bounded-geometry guarantee — every <MotionDemo> root sets `overflow: hidden`
// in inline style. That defends against sparkle-on-tile overflow regardless of
// the host class chrome. See SUB-AGENT-PROMPTS.md → ANIMATION SAFETY.
// ─────────────────────────────────────────────────────────────────────────────

export type MotionRole =
  | 'flip'
  | 'panel'
  | 'route'
  | 'soft'
  | 'spring'
  | 'scroll'
  | 'drag'
  | 'presence';

export type MotionLoop = 'always' | 'hover' | 'once';

interface RoleConfig {
  durationToken: string;
  easingToken: string;
  keyframes: Record<string, number[]>;
  fallbackMs: number;
}

export const MOTION_ROLE_DEFAULTS: Record<MotionRole, RoleConfig> = {
  flip: {
    durationToken: '--dur-flip',
    easingToken: '--ease-out',
    keyframes: { y: [0, -12, 0] },
    fallbackMs: 220,
  },
  panel: {
    durationToken: '--dur-panel',
    easingToken: '--ease-in-out',
    keyframes: { x: [-80, 0, -80] },
    fallbackMs: 320,
  },
  route: {
    durationToken: '--dur-route',
    easingToken: '--ease-out',
    keyframes: { opacity: [0, 1, 0], scale: [0.92, 1, 0.92] },
    fallbackMs: 480,
  },
  soft: {
    durationToken: '--dur-soft',
    easingToken: '--ease-out',
    keyframes: { opacity: [0, 1, 0] },
    fallbackMs: 160,
  },
  spring: {
    durationToken: '--dur-panel',
    easingToken: 'spring',
    // Spring physics animate toward a single target; a 3-point array
    // (`[0,-16,0]`) makes motion/react's spring no-op (no movement). Use a
    // 2-point target and let `repeatType: 'reverse'` carry the return leg.
    keyframes: { y: [0, -16] },
    fallbackMs: 320,
  },
  scroll: {
    // `--dur-route` is intentionally ~instant (route changes are snap, often
    // 1ms), which makes a scroll-linked drift imperceptible. Bind to the
    // longer `--dur-soft` so the demo (and any time-driven scroll fallback)
    // is actually visible.
    durationToken: '--dur-soft',
    easingToken: '--ease-in-out',
    keyframes: { x: [0, 24, 0] },
    fallbackMs: 480,
  },
  drag: {
    durationToken: '--dur-flip',
    easingToken: '--ease-out',
    keyframes: { rotate: [0, 4, 0] },
    fallbackMs: 220,
  },
  presence: {
    durationToken: '--dur-soft',
    easingToken: '--ease-out',
    keyframes: { opacity: [0, 1], scale: [0.9, 1] },
    fallbackMs: 160,
  },
};

/**
 * Reads --dur-* + --ease-* CSS custom properties from documentElement and
 * returns a plain map suitable for plugging into motion/react's transition
 * config. ms values parsed to numbers; easing tokens returned as strings (the
 * raw token value, e.g. "cubic-bezier(0, 0, 0.2, 1)" — motion/react accepts
 * the string form).
 */
export function useMotionTokens(): {
  durations: Record<string, number>;
  easings: Record<string, string>;
} {
  const [snap, setSnap] = useState(() => readMotionTokensOnce());
  useEffect(() => {
    setSnap(readMotionTokensOnce());
    if (typeof MutationObserver === 'undefined') return;
    const obs = new MutationObserver(() => setSnap(readMotionTokensOnce()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-reduced-motion'],
    });
    return () => obs.disconnect();
  }, []);
  return snap;
}

function readMotionTokensOnce(): {
  durations: Record<string, number>;
  easings: Record<string, string>;
} {
  if (typeof window === 'undefined' || typeof getComputedStyle === 'undefined') {
    return { durations: {}, easings: {} };
  }
  const cs = getComputedStyle(document.documentElement);
  const durations: Record<string, number> = {};
  const easings: Record<string, string> = {};
  const durKeys = ['--dur-flip', '--dur-panel', '--dur-route', '--dur-soft'];
  const easeKeys = ['--ease-out', '--ease-in', '--ease-in-out'];
  for (const k of durKeys) {
    const raw = cs.getPropertyValue(k).trim();
    if (!raw) continue;
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n)) {
      durations[k] = raw.endsWith('s') && !raw.endsWith('ms') ? n * 1000 : n;
    }
  }
  for (const k of easeKeys) {
    const raw = cs.getPropertyValue(k).trim();
    if (raw) easings[k] = raw;
  }
  return { durations, easings };
}

/**
 * Maps a DS easing token name to the value motion/react's `transition.ease`
 * accepts. Returns the live CSS string when readable, otherwise a sane default
 * matching Material's "standard" curve.
 */
export function easingFromToken(
  token: string,
  easings: Record<string, string>
): string | undefined {
  const live = easings[token];
  if (live) return live;
  if (token === '--ease-out') return 'cubic-bezier(0, 0, 0.2, 1)';
  if (token === '--ease-in') return 'cubic-bezier(0.4, 0, 1, 1)';
  if (token === '--ease-in-out') return 'cubic-bezier(0.4, 0, 0.2, 1)';
  return undefined;
}

/**
 * The same token, in the shape MOTION accepts.
 *
 * `easingFromToken` returns CSS (`cubic-bezier(a, b, c, d)`), which is right for
 * a stylesheet and wrong for motion: its `Easing` is a named curve or a
 * four-number BezierDefinition, never a CSS string. Both MotionDemo call sites
 * were handing it the CSS form, so motion silently fell back to its own default
 * — a DS motion specimen was not demonstrating the DS's easing at all. Invisible
 * until A2 put this file under a checker.
 *
 * Named curves pass through; anything unparseable returns undefined, which is
 * the same "let motion decide" the bug produced, only deliberately.
 */
function motionEaseFromToken(token: string, easings: Record<string, string>): Easing | undefined {
  const css = easingFromToken(token, easings);
  if (!css) return undefined;
  const named = css.trim();
  if (
    named === 'linear' ||
    named === 'easeIn' ||
    named === 'easeOut' ||
    named === 'easeInOut' ||
    named === 'circIn' ||
    named === 'circOut' ||
    named === 'circInOut' ||
    named === 'backIn' ||
    named === 'backOut' ||
    named === 'backInOut' ||
    named === 'anticipate'
  ) {
    return named;
  }
  // CSS keywords motion spells differently.
  if (named === 'ease-in') return 'easeIn';
  if (named === 'ease-out') return 'easeOut';
  if (named === 'ease-in-out') return 'easeInOut';
  const m = /^cubic-bezier\(([^)]*)\)$/.exec(named);
  if (!m || !m[1]) return undefined;
  const nums = m[1].split(',').map((n) => Number(n.trim()));
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return undefined;
  return [nums[0], nums[1], nums[2], nums[3]] as [number, number, number, number];
}

interface MotionDemoProps {
  role: MotionRole;
  loop?: MotionLoop;
  children?: ReactNode;
  small?: boolean;
  className?: string;
  label?: string;
}

/**
 * The foundational motion building block. Wraps motion/react's animated <div>
 * with token-bound duration + easing + reduced-motion short-circuit.
 *
 * Default loop="always" so initial paint shows motion — the "looks dead at
 * rest" failure mode is the regression Phase 3.7 exists to prevent.
 */
export function MotionDemo({
  role,
  loop = 'always',
  children,
  small = false,
  className,
  label,
}: MotionDemoProps) {
  const cfg = MOTION_ROLE_DEFAULTS[role];
  const tokens = useMotionTokens();
  const reduced = _useReducedMotion();
  const durationMs = tokens.durations[cfg.durationToken] ?? cfg.fallbackMs;
  const isSpring = cfg.easingToken === 'spring';
  const ease = isSpring ? undefined : motionEaseFromToken(cfg.easingToken, tokens.easings);
  const repeat = reduced || loop === 'once' ? 0 : Number.POSITIVE_INFINITY;
  const repeatType: 'reverse' | 'loop' = loop === 'always' ? 'reverse' : 'loop';
  const animate = reduced ? undefined : cfg.keyframes;
  // DS durations are micro-interaction speeds (often <200ms). Looping them with
  // no gap strobes ~10×/s. Insert a rest between cycles so each loop replays the
  // REAL token speed, then pauses — readable cadence, not a flicker. Spring's
  // own settle is the pause, so it skips the extra delay.
  const repeatDelay = loop === 'always' && !isSpring ? 0.9 : 0;

  return (
    <div
      className={`motion-demo${className ? ` ${className}` : ''}`}
      data-role={role}
      data-small={small ? 'true' : undefined}
      style={{ overflow: 'hidden', position: 'relative' }}
    >
      <_motionImpl.div
        animate={animate}
        transition={{
          duration: durationMs / 1000,
          ease,
          type: isSpring ? 'spring' : 'tween',
          repeat,
          repeatType,
          repeatDelay,
        }}
        className="motion-demo__target"
        aria-label={label}
        style={small ? { width: 32, height: 32 } : undefined}
      >
        {children ?? <div className="motion-demo__chip" />}
      </_motionImpl.div>
    </div>
  );
}

interface MotionTrackProps {
  children: ReactNode;
  staggerMs?: number;
  className?: string;
}

/**
 * Row container with CSS animation-delay stagger between children.
 */
export function MotionTrack({ children, staggerMs = 40, className }: MotionTrackProps) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div
      className={`motion-track${className ? ` ${className}` : ''}`}
      style={{ display: 'flex', gap: 12, alignItems: 'center' }}
    >
      {items.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stagger row is index-positional by design; no reorder/insertion semantics
        <div key={i} style={{ animationDelay: `${i * staggerMs}ms` }}>
          {c}
        </div>
      ))}
    </div>
  );
}

interface TokenPlaybackProps {
  duration: string;
  easing?: string;
  label?: string;
  keyframes?: Record<string, number[]>;
}

/**
 * Click-to-fire single-shot replay chip. Used in the motion specimen so
 * reviewers can probe a single token without hovering a card.
 */
export function TokenPlayback({
  duration,
  easing = '--ease-out',
  label,
  keyframes = { y: [0, -8, 0] },
}: TokenPlaybackProps) {
  const tokens = useMotionTokens();
  const reduced = _useReducedMotion();
  const durationMs = tokens.durations[duration] ?? 220;
  const ease = easing === 'spring' ? undefined : motionEaseFromToken(easing, tokens.easings);
  const [tick, setTick] = useState(0);
  const fire = useCallback(() => {
    if (!reduced) setTick((n) => n + 1);
  }, [reduced]);
  return (
    <button
      type="button"
      className="token-playback"
      onClick={fire}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        fontSize: 12,
        padding: '6px 10px',
        border: '1px solid var(--border-1, currentColor)',
        borderRadius: 4,
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      }}
    >
      <span style={{ opacity: 0.6 }}>{label ?? duration}</span>
      <_motionImpl.span
        key={tick}
        animate={tick === 0 ? undefined : keyframes}
        transition={{
          duration: durationMs / 1000,
          ease,
          type: easing === 'spring' ? 'spring' : 'tween',
        }}
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          background: 'var(--accent, currentColor)',
          borderRadius: '50%',
        }}
      />
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{durationMs}ms</span>
    </button>
  );
}

/**
 * Chrome toggle for the motion specimen — flips data-reduced-motion="true"
 * on <html> so reviewers can eyeball both branches without OS settings.
 * Inspection aid, never a replacement for prefers-reduced-motion.
 */
export function ReducedMotionToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const initial = el.getAttribute('data-reduced-motion') === 'true';
    setOn(initial);
  }, []);
  const toggle = useCallback(() => {
    const el = document.documentElement;
    const next = !on;
    if (next) el.setAttribute('data-reduced-motion', 'true');
    else el.removeAttribute('data-reduced-motion');
    setOn(next);
  }, [on]);
  return (
    <button
      type="button"
      className="reduced-motion-toggle"
      onClick={toggle}
      aria-pressed={on}
      style={{
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        fontSize: 11,
        padding: '4px 8px',
        border: '1px solid var(--border-1, currentColor)',
        borderRadius: 3,
        background: on ? 'var(--accent, currentColor)' : 'transparent',
        color: on ? 'var(--bg-0, white)' : 'inherit',
        cursor: 'pointer',
      }}
    >
      reduced-motion: {on ? 'on' : 'off'}
    </button>
  );
}

export {
  _MotionAnimatePresence as AnimatePresence,
  _motionImpl as motion,
  _useReducedMotion as useReducedMotion,
};
