// editing/place-freely.tsx — Place freely and the pin guides (S2.11, artboard ed-lay-free).
//
// The canvas half of two edit-ops:
//   · `object.place-freely` — an object inside an auto layout stops being arranged and keeps the
//     box it has now. The canvas MEASURES (where the object is inside its frame, in world px) and
//     asks the shell for one edit-op (edit-ops/place-freely.ts says what the writer does). The same
//     function serves ⌘K / the Position row's "Place freely" / dragging an object out of its frame.
//   · `object.constrain` — the pins of a freely placed object, written in one request.
//
// And the one thing this file draws: for an object placed freely and pinned (`right: 64px` in its
// style) a thin guide from each pinned edge to the frame's edge with the distance — "64 from the
// corner" — so the pin is visible where it acts. Never writes, never takes a key.
//
// Pure where it can be (the maths takes rects and numbers, so it runs without layout).

import { useEffect, useRef, useState } from 'react';

import { resolveSelectionEl } from '../dom-selection.ts';
import { isElementDragActive } from '../drag-state.ts';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import type { PinH, PinV } from '../edit-ops/words-css.ts';
import type { CommandRecord } from '../undo-stack.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { type RectLike, worldScaleOf } from './arrange.ts';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { refOfElement } from './object-actions.ts';
import { stampedParent } from './selection.tsx';

// ── measuring ─────────────────────────────────────────────────────────────────────────────────

export interface PlaceInputs {
  /** the object's box on screen (a drag transform included: that is where it is being dropped) */
  child: RectLike;
  /** the frame's border box on screen */
  frame: RectLike;
  /** the frame's border widths, world px (`clientLeft` / `clientTop`) */
  frameBorder: { left: number; top: number };
  /** the object's margins — `left` is where the margin edge goes, so they come off */
  margin: { left: number; top: number };
  /** screen px per world unit */
  scale: number;
  boxSizing: string;
  /** padding + border of the object, summed per axis, world px (a content-box width excludes them) */
  padBorder: { w: number; h: number };
}

export interface PlaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The numbers the writer takes: where the object's margin edge sits inside the frame's padding box. */
export function placeBox(i: PlaceInputs): PlaceBox {
  const k = i.scale > 0 ? i.scale : 1;
  const round = (n: number) => Math.round(n);
  const wide = i.child.width / k;
  const high = i.child.height / k;
  const content = i.boxSizing === 'content-box';
  return {
    x: round((i.child.left - i.frame.left) / k - i.frameBorder.left - i.margin.left),
    y: round((i.child.top - i.frame.top) / k - i.frameBorder.top - i.margin.top),
    w: round(content ? wide - i.padBorder.w : wide),
    h: round(content ? high - i.padBorder.h : high),
  };
}

const px = (v: string | null | undefined) => Number.parseFloat(v ?? '') || 0;

/** Is it already placed freely (taken out of its frame's layout)? */
export const isPlacedFreely = (position: string | null | undefined): boolean =>
  position === 'absolute' || position === 'fixed';

export interface PlacementMeasure {
  box: PlaceBox;
  /** the frame to pin `position: relative` on, or null when it already is a positioning reference */
  relativeFrame: Element | null;
}

/**
 * Measure `el` for Place freely. `at` overrides the object's rect (a drop: where the cursor let go).
 * The frame is the nearest stamped ancestor, else the artboard body.
 */
export function measurePlacement(
  el: HTMLElement,
  win: Window = window,
  at?: RectLike
): PlacementMeasure | null {
  const stamped = stampedParent(el);
  const frame = (stamped ?? el.closest('.dc-artboard-body')) as HTMLElement | null;
  if (!frame) return null;
  const cs = win.getComputedStyle(el);
  const k = worldScaleOf(el);
  const box = placeBox({
    child: at ?? el.getBoundingClientRect(),
    frame: frame.getBoundingClientRect(),
    frameBorder: { left: frame.clientLeft, top: frame.clientTop },
    margin: { left: px(cs.marginLeft), top: px(cs.marginTop) },
    scale: k,
    boxSizing: cs.boxSizing,
    padBorder: {
      w:
        px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth),
      h:
        px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth),
    },
  });
  const framePos = win.getComputedStyle(frame).position;
  // the artboard body is the positioning reference of last resort and needs no pin of its own
  const needsPin = !!stamped && (framePos === 'static' || framePos === '');
  return { box, relativeFrame: needsPin ? stamped : null };
}

// ── running ───────────────────────────────────────────────────────────────────────────────────

export interface PlaceDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: CommandRecord) => void;
}

export const ALREADY_FREE_LINE = 'It is already placed freely.';
export const NO_BOX_LINE = 'The canvas could not tell where it is; try again.';

/** One `object.place-freely` for one object. Resolves to the result, or null when nothing was asked. */
export async function placeFreely(
  el: HTMLElement,
  deps: PlaceDeps = {},
  opts: { at?: RectLike; win?: Window } = {}
): Promise<EditOpResult | null> {
  const win = opts.win ?? window;
  if (isPlacedFreely(win.getComputedStyle(el).position)) {
    deps.toast?.(ALREADY_FREE_LINE, 'info');
    return null;
  }
  const ref = refOfElement(el);
  const m = measurePlacement(el, win, opts.at);
  if (!ref || !m) {
    deps.toast?.(NO_BOX_LINE, 'error');
    return null;
  }
  const frameRef = m.relativeFrame ? refOfElement(m.relativeFrame) : null;
  const run = deps.run ?? ((ask: EditOpAsk) => runEditOp(ask));
  const result = await run({
    op: 'object.place-freely',
    targets: frameRef ? [ref, frameRef] : [ref],
    params: { ...m.box, ...(frameRef ? { relativeParent: true } : {}) },
  });
  if (!result.ok) {
    deps.toast?.(result.message || 'That did not go through.', 'error');
    return result;
  }
  if (result.actionId === null && result.writeId) {
    // null on the op log: the write is a kernel action there, ⌘Z is the shell's projection
    const rec = editOpRecord(result.writeId, 'Place freely');
    if (rec) deps.record?.(rec);
  }
  return result;
}

export interface ConstrainGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  parentW: number;
  parentH: number;
}

/** One `object.constrain`: the object keeps these edges of its frame. */
export async function constrain(
  ref: ElementRef,
  pins: { h: PinH; v: PinV },
  geometry: ConstrainGeometry,
  deps: PlaceDeps = {}
): Promise<EditOpResult> {
  const run = deps.run ?? ((ask: EditOpAsk) => runEditOp(ask));
  const result = await run({
    op: 'object.constrain',
    targets: [ref],
    params: { h: pins.h, v: pins.v, geometry },
  });
  if (!result.ok) deps.toast?.(result.message || 'That did not go through.', 'error');
  else if (result.actionId === null && result.writeId) {
    // null on the op log: the write is a kernel action there, ⌘Z is the shell's projection
    const rec = editOpRecord(result.writeId, 'Constraints');
    if (rec) deps.record?.(rec);
  }
  return result;
}

// ── the pin guides ────────────────────────────────────────────────────────────────────────────

export interface PinGuide {
  edge: 'top' | 'right' | 'bottom' | 'left';
  /** screen px: the guide runs from (x1, y1) to (x2, y2) */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** "64" — the distance in world px */
  label: string;
}

/** Which edges the inline style pins (a declaration present = that edge is kept). */
export function pinnedEdges(
  style: Pick<CSSStyleDeclaration, 'left' | 'right' | 'top' | 'bottom'>
): {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
} {
  const on = (v: string) => !!v && v !== 'auto';
  return {
    top: on(style.top),
    right: on(style.right),
    bottom: on(style.bottom),
    left: on(style.left),
  };
}

/** A guide from each pinned edge of `box` to the same edge of `frame`, with its distance. */
export function pinGuides(
  box: RectLike,
  frame: RectLike,
  pins: ReturnType<typeof pinnedEdges>,
  scale: number
): PinGuide[] {
  const k = scale > 0 ? scale : 1;
  const midX = box.left + box.width / 2;
  const midY = box.top + box.height / 2;
  const out: PinGuide[] = [];
  const dist = (n: number) => `${Math.round(n / k)}`;
  if (pins.top)
    out.push({
      edge: 'top',
      x1: midX,
      y1: frame.top,
      x2: midX,
      y2: box.top,
      label: dist(box.top - frame.top),
    });
  if (pins.bottom)
    out.push({
      edge: 'bottom',
      x1: midX,
      y1: box.top + box.height,
      x2: midX,
      y2: frame.top + frame.height,
      label: dist(frame.top + frame.height - (box.top + box.height)),
    });
  if (pins.left)
    out.push({
      edge: 'left',
      x1: frame.left,
      y1: midY,
      x2: box.left,
      y2: midY,
      label: dist(box.left - frame.left),
    });
  if (pins.right)
    out.push({
      edge: 'right',
      x1: box.left + box.width,
      y1: midY,
      x2: frame.left + frame.width,
      y2: midY,
      label: dist(frame.left + frame.width - (box.left + box.width)),
    });
  return out.filter((g) => Math.abs(g.x2 - g.x1) + Math.abs(g.y2 - g.y1) >= 2);
}

const CSS_TEXT = `
.ed-pin {
  position: fixed;
  pointer-events: none;
  z-index: 5;
  background: var(--guide, var(--guide-magenta, #ff24bd));
}
.ed-pin--h { height: 1px; }
.ed-pin--v { width: 1px; }
.ed-pin-n {
  position: fixed;
  pointer-events: none;
  z-index: 5;
  transform: translate(-50%, -50%);
  padding: 0 4px;
  border-radius: 3px;
  background: var(--guide, var(--guide-magenta, #ff24bd));
  color: #fff;
  font: 500 10px/14px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  font-variant-numeric: tabular-nums;
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('ed-pin-css')) return;
  const s = document.createElement('style');
  s.id = 'ed-pin-css';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

/** The guides for the one selected object that is placed freely and pinned; [] otherwise. */
export function guidesFor(el: HTMLElement, win: Window = window): PinGuide[] {
  if (!isPlacedFreely(win.getComputedStyle(el).position)) return [];
  const pins = pinnedEdges(el.style);
  if (!pins.top && !pins.right && !pins.bottom && !pins.left) return [];
  const frame = (stampedParent(el) ?? el.closest('.dc-artboard-body')) as HTMLElement | null;
  if (!frame) return [];
  return pinGuides(
    el.getBoundingClientRect(),
    frame.getBoundingClientRect(),
    pins,
    worldScaleOf(el)
  );
}

export function PinGuides({ readOnly }: { readOnly?: boolean }) {
  ensureStyles();
  const { selected } = useSelectionSet();
  const [guides, setGuides] = useState<PinGuide[]>([]);
  const raf = useRef<number | null>(null);
  const one = selected.length === 1 ? selected[0] : null;

  useEffect(() => {
    if (!one?.id || readOnly) {
      setGuides([]);
      return;
    }
    let last = '';
    const tick = () => {
      raf.current = requestAnimationFrame(tick);
      if (isElementDragActive()) return;
      const el = resolveSelectionEl(document, one) as HTMLElement | null;
      const next = el ? guidesFor(el) : [];
      const key = JSON.stringify(
        next.map((g) => [
          g.edge,
          Math.round(g.x1),
          Math.round(g.y1),
          Math.round(g.x2),
          Math.round(g.y2),
          g.label,
        ])
      );
      if (key === last) return;
      last = key;
      setGuides(next);
    };
    tick();
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      setGuides([]);
    };
  }, [one, readOnly]);

  if (!guides.length) return null;
  return (
    <div aria-hidden="true" data-testid="edit-pin-guides">
      {guides.map((g) => {
        const horizontal = g.edge === 'left' || g.edge === 'right';
        return (
          <span key={g.edge}>
            <i
              className={`ed-pin ${horizontal ? 'ed-pin--h' : 'ed-pin--v'}`}
              data-testid={`edit-pin-guide-${g.edge}`}
              style={{
                left: Math.min(g.x1, g.x2),
                top: Math.min(g.y1, g.y2),
                width: horizontal ? Math.abs(g.x2 - g.x1) : undefined,
                height: horizontal ? undefined : Math.abs(g.y2 - g.y1),
              }}
            />
            <b
              className="ed-pin-n"
              data-testid={`edit-pin-chip-${g.edge}`}
              style={{ left: (g.x1 + g.x2) / 2, top: (g.y1 + g.y2) / 2 }}
            >
              {g.label}
            </b>
          </span>
        );
      })}
    </div>
  );
}
