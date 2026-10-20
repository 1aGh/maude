/**
 * @file       artboard-guides-overlay.tsx — feature-1-artboard-kinds-foundation, T4.
 * @scope      apps/studio/artboard-guides-overlay.tsx
 * @purpose    Render-only chrome for an artboard's guides/marks — Figma-vocabulary
 *             generic layout guides (columns/rows/grid, T5) plus a per-kind
 *             content registry that downstream plans hang kind-specific chrome
 *             off of (feature-2-print-artboards: bleed/trim/margin/marks;
 *             feature-3-web-artboards: breakpoint band). Rendered by DCArtboard
 *             as a world-coord sibling of the `<article>` — same mount pattern
 *             as `ArtboardActivityOverlay` — so it pans/zooms with the artboard
 *             for free WITHOUT living inside `.dc-artboard`'s
 *             `contain:paint`/`content-visibility` subtree (that subtree exists
 *             to cull/freeze exported artboard CONTENT; guides are never
 *             exported/screenshotted and must never be culled with it).
 *
 * Decorative — `aria-hidden` + `pointer-events:none`, flat divs only (no
 * filters/blends/gradients — Design Decision 2: WebKit does not
 * GPU-accelerate those, and this layer sits on top of every artboard on a
 * dense canvas).
 */

import type { ReactNode } from 'react';

import type { ArtboardKind } from './canvas-lib.tsx';
import { safeZonePreset } from './kinds/safe-zones.ts';
import type { ArtboardPrintProp } from './print/units.ts';
import { SafeZonesOverlay } from './safe-zones-overlay.tsx';

export interface OverlayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One axis of the Figma "columns"/"rows" layout-guide vocabulary. */
export interface BandGuideDef {
  count: number;
  gutter: number;
  margin: number;
}

export interface GridGuideDef {
  /** World-unit spacing between grid lines. */
  size: number;
}

/**
 * Generic layout guides (T5) — versioned design intent (a JSX prop on
 * DCArtboard), kind-agnostic: any artboard can carry columns/rows/grid
 * regardless of its `kind`.
 */
export interface GuideDefinitions {
  columns?: BandGuideDef;
  rows?: BandGuideDef;
  grid?: GridGuideDef;
}

/**
 * Per-user show/hide state (T6) — lives in `_canvas-state/<slug>.view.json`
 * (existing runtime file), never in the versioned `.meta.json`. A flat bag,
 * not just a `guides` boolean, so downstream plans can add their own keys
 * (`bleed`, `breakpoints`, …) without a schema change here.
 */
export interface OverlayVisibility {
  guides?: boolean;
  [key: string]: boolean | undefined;
}

export interface KindOverlayProps {
  rect: OverlayRect;
  kind: ArtboardKind;
  guides?: GuideDefinitions;
  /** feature-2-print-artboards T2/T3 — the artboard's `print` JSX prop, when
   *  present. Only meaningful to the 'print' kind's registered renderer. */
  print?: ArtboardPrintProp;
  /** S7.22 — the artboard's `safeZones` JSX prop (a preset id from kinds/safe-zones.ts). Any kind. */
  safeZones?: string;
  /** S7.22 — the DCArtboard id, how the text under a safe-zone band is found. */
  artboardId?: string;
  visibility: OverlayVisibility;
}

export type KindOverlayRenderFn = ((props: KindOverlayProps) => ReactNode) & {
  /** React DevTools label. Every registered renderer sets it; the registry
   *  holds plain functions, so it is not inherited from a component type. */
  displayName?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-kind content registry. Foundation registers nothing here — the generic
// guides below already apply to every kind. feature-2-print-artboards /
// feature-3-web-artboards call `registerKindOverlay` at module load to hang
// their own kind-specific chrome off the same mount point.

const kindOverlayRegistry = new Map<ArtboardKind, KindOverlayRenderFn>();

/**
 * Register additional overlay content for one artboard kind. Last call for a
 * given kind wins — safe to re-call on HMR (module re-eval re-registers).
 */
export function registerKindOverlay(kind: ArtboardKind, renderFn: KindOverlayRenderFn): void {
  kindOverlayRegistry.set(kind, renderFn);
}

/** Test-only: clear the registry between test files (module-scoped Map would
 *  otherwise leak registrations across `bun test`'s shared module graph). */
export function __resetKindOverlayRegistryForTests(): void {
  kindOverlayRegistry.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic guides (T5) — Figma vocabulary. Columns/rows render as translucent
// violet bands (Figma's own default), grid renders as red hairlines @ 10%
// opacity. Chrome-engine constants, not DS tokens — guides are never part of
// exported artboard content, same reasoning as SnapGuideOverlay's hardcoded
// magenta/gray.
const COLUMN_FILL = 'color-mix(in oklab, oklch(62% 0.19 300) 14%, transparent)';
const GRID_LINE = 'color-mix(in oklab, oklch(55% 0.22 25) 10%, transparent)';

/** Safety bound, not a coverage cap — guards against a pathological
 *  `grid.size` (e.g. 1) turning into thousands of divs on a large artboard. */
const MAX_GRID_LINES_PER_AXIS = 400;

/**
 * Safety bound, not a coverage cap — same reasoning as MAX_GRID_LINES_PER_AXIS,
 * for the columns/rows `count`. `guides` is an artboard-authored JSX prop, so
 * it's part of the DDR-054 untrusted-canvas surface — a malicious/poisoned
 * canvas (peer-pushed under phase-30 branch-scoped multiplayer, or a
 * prompt-injected agent edit) can set `columns.count` to an arbitrary number
 * with no server-side validation in between (the value never round-trips
 * through `setArtboardGuidesOp`'s bounds — it's read directly from React
 * props at render time). An uncapped loop here mounts one `<div>` per band,
 * so a huge count is a real client-side DoS (viewer tab freeze/OOM), found
 * independently by both the security-auditor and ethical-hacker passes on
 * this feature. 64 comfortably exceeds any real layout-guide use.
 */
const MAX_BANDS_PER_AXIS = 64;

function computeBands(def: BandGuideDef, extent: number): Array<{ start: number; size: number }> {
  const count = Math.min(Math.max(0, Math.floor(def.count)), MAX_BANDS_PER_AXIS);
  if (count <= 0 || extent <= 0) return [];
  const usable = extent - def.margin * 2;
  if (usable <= 0) return [];
  const bandSize = (usable - def.gutter * Math.max(0, count - 1)) / count;
  if (bandSize <= 0) return [];
  const bands: Array<{ start: number; size: number }> = [];
  for (let i = 0; i < count; i++) {
    bands.push({ start: def.margin + i * (bandSize + def.gutter), size: bandSize });
  }
  return bands;
}

function gridLinePositions(size: number, extent: number): number[] {
  if (size < 2 || extent <= 0) return [];
  const out: number[] = [];
  for (let pos = size; pos < extent && out.length < MAX_GRID_LINES_PER_AXIS; pos += size) {
    out.push(pos);
  }
  return out;
}

function GenericGuides({ rect, guides }: { rect: OverlayRect; guides: GuideDefinitions }) {
  const nodes: ReactNode[] = [];
  if (guides.columns) {
    for (const b of computeBands(guides.columns, rect.w)) {
      nodes.push(
        <div
          key={`col-${b.start}`}
          style={{
            position: 'absolute',
            left: b.start,
            top: 0,
            width: b.size,
            height: rect.h,
            background: COLUMN_FILL,
          }}
        />
      );
    }
  }
  if (guides.rows) {
    for (const b of computeBands(guides.rows, rect.h)) {
      nodes.push(
        <div
          key={`row-${b.start}`}
          style={{
            position: 'absolute',
            left: 0,
            top: b.start,
            width: rect.w,
            height: b.size,
            background: COLUMN_FILL,
          }}
        />
      );
    }
  }
  if (guides.grid) {
    for (const x of gridLinePositions(guides.grid.size, rect.w)) {
      nodes.push(
        <div
          key={`gx-${x}`}
          style={{
            position: 'absolute',
            left: x,
            top: 0,
            width: 1,
            height: rect.h,
            background: GRID_LINE,
          }}
        />
      );
    }
    for (const y of gridLinePositions(guides.grid.size, rect.h)) {
      nodes.push(
        <div
          key={`gy-${y}`}
          style={{
            position: 'absolute',
            left: 0,
            top: y,
            width: rect.w,
            height: 1,
            background: GRID_LINE,
          }}
        />
      );
    }
  }
  return <>{nodes}</>;
}
GenericGuides.displayName = 'GenericGuides';

/**
 * The mount point DCArtboard renders as a world-coord sibling of its
 * `<article>`. Renders nothing when there's neither a visible generic guide
 * definition nor a registered kind-specific renderer — so the common case
 * (no `guides` prop, no downstream plan loaded yet) costs one map lookup and
 * no extra DOM.
 */
export function ArtboardGuidesOverlay({
  rect,
  kind,
  guides,
  print,
  safeZones,
  artboardId,
  visibility,
}: KindOverlayProps) {
  const KindContent = kindOverlayRegistry.get(kind);
  // S7.22 — a safe zone is shown whenever the artboard names one, unless THIS person turned "Show on canvas"
  // off (view.json `overlays.safeZones === false`). Unlike the guides, absence means shown: the preset is
  // design intent someone chose on purpose. It is the same mount every exporter hides.
  const zones = visibility.safeZones === false ? null : safeZonePreset(safeZones);
  // T6 Gotcha — a view.json predating the `overlays` lane has no `guides`
  // key at all; that absence must resolve to HIDDEN, not shown, so opening
  // an old canvas doesn't suddenly paint guides nobody asked to see. Only an
  // explicit `true` (the View-menu toggle) shows them.
  const showGenericGuides = visibility.guides === true && !!guides;
  if (!showGenericGuides && !KindContent && !zones) return null;
  return (
    <div
      className="dc-artboard-guides"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {showGenericGuides && guides ? <GenericGuides rect={rect} guides={guides} /> : null}
      {/* Kind-specific renderers see the full, ungated `visibility` bag and
          decide their own show/hide (e.g. print's bleed toggle is a
          different key than `guides`). */}
      {zones ? (
        <SafeZonesOverlay preset={zones} w={rect.w} h={rect.h} artboardId={artboardId} />
      ) : null}
      {KindContent ? (
        <KindContent
          rect={rect}
          kind={kind}
          guides={guides}
          print={print}
          visibility={visibility}
        />
      ) : null}
    </div>
  );
}
ArtboardGuidesOverlay.displayName = 'ArtboardGuidesOverlay';
