/**
 * @file       cursors-overlay.tsx — foreign peer cursors rendered on the canvas
 * @scope      apps/studio/cursors-overlay.tsx
 * @purpose    Renders one colored SVG arrow + name label per foreign peer at
 *             their published world coords, transformed through the local
 *             viewport so the cursor anchors to canvas content (not to my
 *             screen) — the standard Excalidraw / tldraw multiplayer model.
 *
 * Render shape:
 *   <div position:fixed top:0 left:0 pointer-events:none>
 *     <Cursor for each foreign peer />
 *   </div>
 *
 * Each cursor is positioned via `transform: translate(screenX px, screenY px)`
 * where (screenX, screenY) = world * viewport.zoom + viewport.{x,y}. No
 * react-spring / lerp in this ship (just last-known-position render); the
 * 30 Hz publish cadence keeps it smooth enough for the multiplayer demo.
 */

import type { JSX } from 'react';
import { memo, useEffect, useState } from 'react';

import { useLiveViewport } from './canvas-lib.tsx';
import { type ForeignAwareness, useCollab, useForeignAwareness } from './use-collab.tsx';

const CURSOR_CSS = `
.dc-cursor-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10000;
}
.dc-cursor {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  will-change: transform;
  /* The arrow tip is the (0,0) anchor of the SVG; the label hangs to the
     bottom-right so it never occludes the tip itself. */
}
.dc-cursor-arrow {
  display: block;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.4));
}
/* DS colors-presence .cur-label recipe — hue pill, mono 10px, dark
 * accent-fg text (never white-on-hue, which washed out on light hues).
 * NOTE: keep this comment backtick-free — it lives inside the CURSOR_CSS
 * template literal and a stray backtick closes it. */
.dc-cursor-label {
  position: absolute;
  /* specimen geometry: the pill hangs below-right of the 15px triangle */
  top: 14px;
  left: 10px;
  padding: 1px 8px;
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-weight: 500;
  font-size: 10px;
  line-height: 1.4;
  color: var(--maude-hud-accent-fg, oklch(0.180 0.030 268));
  border-radius: 999px;
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dc-peer-selection {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  border: 2px solid;
  border-radius: 2px;
  box-sizing: border-box;
  will-change: transform, width, height;
}
.dc-peer-selection__label {
  position: absolute;
  top: -18px;
  left: -2px;
  padding: 1px 5px;
  font-family: system-ui, -apple-system, sans-serif;
  font-weight: 600;
  font-size: 10px;
  line-height: 1.3;
  color: var(--maude-hud-accent-fg, #fff);
  border-radius: 2px 2px 0 0;
  white-space: nowrap;
}
/* Phase 30 / DDR-120 — soft editing-presence. When a peer (human or a bridged
 * agent) is actively editing this canvas, their cursor pulses gently and the
 * label carries a ✎ mark. A heads-up, never a lock. */
.dc-cursor--editing .dc-cursor-arrow { animation: dc-cursor-edit-pulse 1.6s ease-in-out infinite; }
.dc-cursor-edit-mark { margin-left: 3px; opacity: 0.85; }
@keyframes dc-cursor-edit-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) {
  .dc-cursor { transition: none !important; }
  .dc-cursor--editing .dc-cursor-arrow { animation: none; }
}
`.trim();

function ensureCursorStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-cursor-overlay-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-cursor-overlay-css';
  s.textContent = CURSOR_CSS;
  document.head.appendChild(s);
}

/** How often a peer halo re-measures when nothing it can observe changed. */
const HALO_REFRESH_MS = 500;

interface ViewportSnapshot {
  x: number;
  y: number;
  zoom: number;
}

interface CursorProps {
  peer: ForeignAwareness;
  viewport: ViewportSnapshot;
}

// Issue #131 — awareness hands out a FRESH peer object on every change (every
// 30 Hz cursor publish of every peer), so the default shallow `memo` never
// held: each cursor move re-rendered every halo, and the halos measure the DOM
// in render. Each component compares only what it draws.
const sameViewport = (a: ViewportSnapshot, b: ViewportSnapshot): boolean =>
  a === b || (a.x === b.x && a.y === b.y && a.zoom === b.zoom);
const sameLabel = (a: ForeignAwareness, b: ForeignAwareness): boolean =>
  a.clientID === b.clientID && a.name === b.name && a.color === b.color;
function sameSelection(a: ForeignAwareness['selection'], b: ForeignAwareness['selection']) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ab = a.bounds;
  const bb = b.bounds;
  return (
    a.cssPath === b.cssPath &&
    (ab === bb ||
      (!!ab && !!bb && ab.x === bb.x && ab.y === bb.y && ab.w === bb.w && ab.h === bb.h))
  );
}
function sameIds(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

const Cursor = memo(
  function Cursor({ peer, viewport }: CursorProps): JSX.Element | null {
    if (!peer.cursor) return null;
    // world → screen: screen = world * zoom + viewport.{x,y}
    const screenX = peer.cursor.x * viewport.zoom + viewport.x;
    const screenY = peer.cursor.y * viewport.zoom + viewport.y;
    const editing = !!peer.editing;
    return (
      <div
        className={`dc-cursor${editing ? ' dc-cursor--editing' : ''}`}
        style={{ transform: `translate(${screenX}px, ${screenY}px)` }}
      >
        {/* DS colors-presence Pointer — one plain triangle glyph, tinted by its
          owner (the specimen's exact 24-grid path, no tail/notch). */}
        <svg
          className="dc-cursor-arrow"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M4 3 L20 11.5 L12.5 13 L10 21 Z" fill={peer.color} />
        </svg>
        <div className="dc-cursor-label" style={{ background: peer.color }}>
          {peer.name}
          {editing && (
            <span className="dc-cursor-edit-mark" aria-hidden="true">
              ✎
            </span>
          )}
        </div>
      </div>
    );
  },
  (a, b) =>
    sameViewport(a.viewport, b.viewport) &&
    sameLabel(a.peer, b.peer) &&
    !!a.peer.editing === !!b.peer.editing &&
    (a.peer.cursor === b.peer.cursor ||
      (!!a.peer.cursor &&
        !!b.peer.cursor &&
        a.peer.cursor.x === b.peer.cursor.x &&
        a.peer.cursor.y === b.peer.cursor.y))
);

/**
 * Foreign-selection halos for stamped annotation strokes. Each peer publishes
 * `annotationSelection: string[]` — stroke `data-id` values from Phase 5.
 * We resolve each via `[data-id="<id>"]` and render an outlined rect at the
 * element's current screen bounds. Re-runs every render so geometry changes
 * (resize, move) stay in sync without manual re-publish.
 */
interface PeerAnnotationSelectionProps {
  peer: ForeignAwareness;
  /**
   * Unused in the math below — the halo is measured straight off the DOM — but
   * load-bearing as a PROP: `memo` compares props, and through a pan/zoom the
   * peer never changes, so without a value that ticks with the camera this
   * component would bail out of every re-render and leave the halo frozen in
   * screen space while the stroke it outlines moves away underneath it.
   */
  viewport: ViewportSnapshot;
  /**
   * Bumps when what the halo outlines may have moved WITHOUT the camera or the
   * peer's selection changing — an annotation edit, a canvas re-render. It used
   * to be implicit: the halo re-measured on every awareness change (30 Hz per
   * moving peer), which was the #131 cost. Now it is this, and nothing else.
   */
  tick?: number;
}

export const PeerAnnotationSelection = memo(
  function PeerAnnotationSelection({ peer }: PeerAnnotationSelectionProps): JSX.Element | null {
    if (!peer.annotationSelection || peer.annotationSelection.length === 0) return null;
    if (typeof document === 'undefined') return null;
    const rects: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const id of peer.annotationSelection) {
      try {
        const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (!el) continue;
        const r = (el as Element).getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        // Pad by 3px so the halo sits OUTSIDE the stroke instead of clipping it.
        rects.push({ id, x: r.left - 3, y: r.top - 3, w: r.width + 6, h: r.height + 6 });
      } catch {
        /* invalid id token — skip */
      }
    }
    if (rects.length === 0) return null;
    return (
      <>
        {rects.map((r, i) => (
          <div
            key={r.id}
            className="dc-peer-selection"
            style={{
              transform: `translate(${r.x}px, ${r.y}px)`,
              width: r.w,
              height: r.h,
              borderColor: peer.color,
            }}
          >
            {i === 0 && (
              <div className="dc-peer-selection__label" style={{ background: peer.color }}>
                {peer.name}
              </div>
            )}
          </div>
        ))}
      </>
    );
  },
  (a, b) =>
    sameViewport(a.viewport, b.viewport) &&
    a.tick === b.tick &&
    sameLabel(a.peer, b.peer) &&
    sameIds(a.peer.annotationSelection, b.peer.annotationSelection)
);

/**
 * Foreign-selection halo for canvas-shell elements (cdId-based selSet).
 * The peer publishes selection.cssPath; we re-resolve in the local DOM
 * each render so pan / zoom / hydration changes don't desync. Falls back
 * to the published `bounds` (screen-px at publish time) when cssPath
 * can't be resolved locally.
 */
interface PeerSelectionProps {
  peer: ForeignAwareness;
  /** See PeerAnnotationSelectionProps.viewport — the memo-invalidation tick. */
  viewport: ViewportSnapshot;
  /** See PeerAnnotationSelectionProps.tick. */
  tick?: number;
}

export const PeerSelection = memo(
  function PeerSelection({ peer }: PeerSelectionProps): JSX.Element | null {
    if (!peer.selection) return null;
    const { cssPath, bounds } = peer.selection;

    let rect: { x: number; y: number; w: number; h: number } | null = bounds ?? null;
    if (cssPath && typeof document !== 'undefined') {
      try {
        const el = document.querySelector(cssPath);
        if (el && el instanceof Element) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            rect = { x: r.left, y: r.top, w: r.width, h: r.height };
          }
        }
      } catch {
        /* invalid selector — fall through to published bounds */
      }
    }
    if (!rect) return null;

    return (
      <div
        className="dc-peer-selection"
        style={{
          transform: `translate(${rect.x}px, ${rect.y}px)`,
          width: rect.w,
          height: rect.h,
          borderColor: peer.color,
        }}
      >
        <div className="dc-peer-selection__label" style={{ background: peer.color }}>
          {peer.name}
        </div>
      </div>
    );
  },
  (a, b) =>
    sameViewport(a.viewport, b.viewport) &&
    a.tick === b.tick &&
    sameLabel(a.peer, b.peer) &&
    sameSelection(a.peer.selection, b.peer.selection)
);

/**
 * Subscribes to foreign awareness + the local viewport. Renders one Cursor per
 * peer. Reads viewport from `useViewportControllerContext` — if the canvas
 * doesn't expose a controller (rare edge case), falls back to identity.
 */
export function CursorsOverlay(): JSX.Element {
  ensureCursorStyles();
  const peers = useForeignAwareness();
  // LIVE, not the published viewport. `controller.viewport` republishes only on
  // the settle (SETTLE_MS), so through a pan/zoom it is one frozen value: every
  // peer cursor and every peer selection frame sat at the screen position the
  // camera had when the gesture STARTED and only snapped onto the content half
  // a second after it ended. Same root cause, same fix as the annotation resize
  // handles — read the camera that is written on every applyViewport. Settled,
  // `useLiveViewport()` IS the published value, and it only subscribes to the
  // shared rAF ticker while a gesture is in flight.
  const vp = useLiveViewport();

  // Bump a render tick whenever annotations change so PeerAnnotationSelection
  // re-resolves [data-id] bounds. Without this, a peer resizing a stroke
  // would propagate via Y.Map → local annotations-layer re-render — but the
  // sibling CursorsOverlay wouldn't re-render, so the annotation halo would
  // sit on the OLD bounds until awareness independently changed.
  const collab = useCollab();
  const [tick, bumpTick] = useState(0);
  useEffect(() => {
    if (!collab) return;
    const map = collab.doc.getMap('annotations');
    const onChange = () => bumpTick((n) => n + 1);
    map.observe(onChange);
    return () => {
      try {
        map.unobserve(onChange);
      } catch {
        /* doc destroyed */
      }
    };
  }, [collab]);
  // A peer's selected element can change size or move with no camera or
  // selection change (they edit its text; the canvas re-renders). The halos
  // used to catch that for free by re-measuring on every awareness change —
  // up to 30× a second per moving peer (#131). A slow refresh while somebody
  // has something selected keeps the halo honest for a tiny fraction of that.
  const anySelection = peers.some((p) => !!p.selection || (p.annotationSelection?.length ?? 0) > 0);
  useEffect(() => {
    if (!anySelection) return;
    const id = setInterval(() => bumpTick((n) => n + 1), HALO_REFRESH_MS);
    return () => clearInterval(id);
  }, [anySelection]);
  return (
    <div className="dc-cursor-overlay" aria-hidden="true">
      {peers.map((peer) => (
        <PeerSelection key={`sel-${peer.clientID}`} peer={peer} viewport={vp} tick={tick} />
      ))}
      {peers.map((peer) => (
        <PeerAnnotationSelection
          key={`asel-${peer.clientID}`}
          peer={peer}
          viewport={vp}
          tick={tick}
        />
      ))}
      {peers.map((peer) => (
        <Cursor key={peer.clientID} peer={peer} viewport={vp} />
      ))}
    </div>
  );
}
