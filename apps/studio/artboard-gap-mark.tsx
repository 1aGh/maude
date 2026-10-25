/**
 * @file       artboard-gap-mark.tsx — V2-8.5 c7 (01 cf-duplicate-done).
 * @scope      apps/studio/artboard-gap-mark.tsx
 * @purpose    What the board draws right after "Duplicate at another width": the copy lands under its source with the
 *             left edges aligned, a dashed line down that shared edge, and the gap between the two boards measured on
 *             a short vertical guide ("80"). A mark on the canvas, never part of the design: it carries
 *             `.dc-artboard-guides` (the one class every exporter hides), sits OUTSIDE `.dc-artboard`, is aria-hidden
 *             and pointer-events none, stays a few seconds and drops by itself. The canvas sets it from the move it
 *             just made, so there is no shell message. Sizes are counter-scaled by `--dc-zoom`: a pill is 12 px on the
 *             screen at any zoom, not 12 world px (which is 3 px at the 28 % a campaign is usually seen at).
 */

import { useSyncExternalStore } from 'react';

export interface MarkBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GapMark {
  /** the copy's artboard id — the board that draws the mark */
  copyId: string;
  source: MarkBox;
  copy: MarkBox;
}

/** How long the mark stays up. */
export const GAP_MARK_MS = 6000;

let current: GapMark | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();
const notify = () => {
  for (const fn of subs) fn();
};

// The copy a duplicate writes arrives with the canvas' own reload (a file change reloads the frame), so the mark
// cannot live in memory alone: it is kept in this frame's sessionStorage until it has had its few seconds.
const storeKey = () =>
  typeof location === 'undefined' ? '' : `dc-gap-mark:${location.pathname}${location.search}`;
function save(mark: GapMark | null, until: number): void {
  try {
    if (!storeKey()) return;
    if (mark) sessionStorage.setItem(storeKey(), JSON.stringify({ mark, until }));
    else sessionStorage.removeItem(storeKey());
  } catch {
    /* storage blocked: the mark lives for this load only */
  }
}
function arm(until: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => setGapMark(null), Math.max(0, until - Date.now()));
}
function hydrate(): void {
  try {
    if (!storeKey()) return;
    const o = JSON.parse(sessionStorage.getItem(storeKey()) || 'null');
    if (o?.mark?.copyId && Number(o.until) > Date.now()) {
      current = o.mark as GapMark;
      arm(Number(o.until));
    } else if (o) sessionStorage.removeItem(storeKey());
  } catch {
    /* unreadable: no mark */
  }
}
hydrate();

/** Show the mark (and take it back after `GAP_MARK_MS`). `null` clears it. */
export function setGapMark(next: GapMark | null): void {
  if (timer) clearTimeout(timer);
  timer = null;
  current = next;
  if (next) {
    const until = Date.now() + GAP_MARK_MS;
    save(next, until);
    arm(until);
  } else save(null, 0);
  notify();
}

export const getGapMark = (): GapMark | null => current;
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};

/** The numbers the mark is drawn from, in world px. `null` when the copy is not under the source. */
export function gapGeometry(source: MarkBox, copy: MarkBox) {
  const gapTop = source.y + source.h;
  const gap = Math.round(copy.y - gapTop);
  if (!(gap > 0)) return null;
  const left = Math.round(Math.min(source.x, copy.x));
  const shared = Math.abs(source.x - copy.x) < 1;
  return {
    gap,
    gapTop,
    // the guide stands near the right edge of the narrower board, so it never crosses a headline
    guideX: Math.round(Math.min(source.x + source.w, copy.x + copy.w) - Math.min(source.w, copy.w) * 0.1),
    left,
    shared,
    top: source.y,
    bottom: copy.y + copy.h,
  };
}

const ACCENT = 'var(--accent, oklch(58% 0.19 255))';
const ACCENT_FG = 'var(--accent-fg, #fff)';
const ZOOM = 'var(--dc-zoom, 1)';

/** The mark of the board that is the new copy. Renders nothing for any other board. */
export function ArtboardGapMark({ id, show = true }: { id: string; show?: boolean }) {
  const mark = useSyncExternalStore(subscribe, getGapMark, getGapMark);
  if (!show || !mark || mark.copyId !== id) return null;
  const g = gapGeometry(mark.source, mark.copy);
  if (!g) return null;
  return (
    <>
      {g.shared ? (
        <div
          className="dc-artboard-guides dc-gap-edge"
          data-testid="artboard-gap-edge"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: g.left,
            top: g.top,
            height: g.bottom - g.top,
            width: 0,
            borderLeft: `calc(1px / ${ZOOM}) dashed ${ACCENT}`,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <div
        className="dc-artboard-guides dc-gap-guide"
        data-testid="artboard-gap-guide"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: g.guideX,
          top: g.gapTop,
          height: g.gap,
          width: 0,
          borderLeft: `calc(1px / ${ZOOM}) solid ${ACCENT}`,
          pointerEvents: 'none',
        }}
      >
        <span
          data-testid="artboard-gap-value"
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            padding: '0 4px',
            borderRadius: 3,
            background: ACCENT,
            color: ACCENT_FG,
            font: '600 12px/16px system-ui, -apple-system, sans-serif',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            transformOrigin: '0 0',
            transform: `scale(calc(1 / ${ZOOM})) translate(6px, -50%)`,
          }}
        >
          {g.gap}
        </span>
      </div>
    </>
  );
}
ArtboardGapMark.displayName = 'ArtboardGapMark';
