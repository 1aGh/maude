// editing/gap-bands.tsx — the gap and padding of an auto layout, drawn as bands (S2.11, artboard
// ed-lay-auto).
//
// Select a frame laid out in a row or a column and the space it keeps is no longer a number in a
// panel: each gap between its children is a band tinted in the guide colour with a chip ("24"), and
// the padding is a band along each edge. While a gap is dragged (`use-spacing-handles.tsx` →
// token-ruler.tsx) the bands follow it live, because they are re-read from the DOM every frame.
//
// This replaces nothing: the dots the v1 overlay draws stay the thing you grab; the bands are what
// they measure. Display only — no pointer events, no writes.
//
// Pure where it can be (`computeBands` takes rects and numbers), so it runs without layout.

import { useEffect, useRef, useState } from 'react';

import { resolveSelectionEl } from '../dom-selection.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { type RectLike, worldScaleOf } from './arrange.ts';
import { tokenRuler } from './token-ruler.tsx';

export interface Band {
  kind: 'gap' | 'padding';
  /** gap: its index (0 = between the first two). padding: the side. */
  key: string;
  /** screen px */
  left: number;
  top: number;
  width: number;
  height: number;
  /** the chip, world px ("24"); '' = unlabelled */
  label: string;
}

export interface Pad {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const MIN = 0.5;

/** A world length for a chip: whole px when it is whole within 0.05 ("24", not "23.95"), else two decimals at most. */
export function worldWords(n: number): string {
  const whole = Math.round(n);
  if (Math.abs(n - whole) <= 0.05) return String(whole);
  return `${Math.round(n * 100) / 100}`;
}

/**
 * The bands of one auto-layout frame. `frame` and `kids` are screen rects; `padding` is world px;
 * `scale` is screen px per world unit; `axis` is the main axis ('x' for a row).
 */
export function computeBands(
  frame: RectLike,
  kids: readonly RectLike[],
  padding: Pad,
  axis: 'x' | 'y',
  scale: number
): Band[] {
  const k = scale > 0 ? scale : 1;
  const world = (n: number) => worldWords(n / k);
  const bands: Band[] = [];
  const pt = padding.top * k;
  const pr = padding.right * k;
  const pb = padding.bottom * k;
  const pl = padding.left * k;
  const sorted = [...kids].sort((a, b) => (axis === 'x' ? a.left - b.left : a.top - b.top));
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i] as RectLike;
    const b = sorted[i + 1] as RectLike;
    if (axis === 'x') {
      const left = a.left + a.width;
      const width = b.left - left;
      if (width < MIN) continue;
      const top = Math.min(a.top, b.top);
      const bottom = Math.max(a.top + a.height, b.top + b.height);
      bands.push({
        kind: 'gap',
        key: String(i),
        left,
        top,
        width,
        height: bottom - top,
        label: world(width),
      });
    } else {
      const top = a.top + a.height;
      const height = b.top - top;
      if (height < MIN) continue;
      const left = Math.min(a.left, b.left);
      const right = Math.max(a.left + a.width, b.left + b.width);
      bands.push({
        kind: 'gap',
        key: String(i),
        left,
        top,
        width: right - left,
        height,
        label: world(height),
      });
    }
  }
  const innerTop = frame.top + pt;
  const innerHeight = frame.height - pt - pb;
  const edge = (
    key: string,
    left: number,
    top: number,
    width: number,
    height: number,
    label: string
  ) => {
    if (width >= MIN && height >= MIN)
      bands.push({ kind: 'padding', key, left, top, width, height, label });
  };
  edge('top', frame.left, frame.top, frame.width, pt, world(pt));
  edge('bottom', frame.left, frame.top + frame.height - pb, frame.width, pb, '');
  edge('left', frame.left, innerTop, pl, innerHeight, world(pl));
  edge('right', frame.left + frame.width - pr, innerTop, pr, innerHeight, '');
  return bands;
}

const CSS_TEXT = `
.ed-band {
  position: fixed;
  pointer-events: none;
  z-index: 3;
  background: color-mix(in srgb, var(--guide, var(--guide-magenta, #ff24bd)) 18%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--guide, var(--guide-magenta, #ff24bd)) 45%, transparent);
  transition: opacity var(--dur-fast, 120ms) var(--ease-out, ease-out);
}
.ed-band[data-hot="true"] {
  background: color-mix(in srgb, var(--guide, var(--guide-magenta, #ff24bd)) 34%, transparent);
}
.ed-band-n {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 0 4px;
  border-radius: 3px;
  background: var(--guide, var(--guide-magenta, #ff24bd));
  color: #fff;
  font: 500 10px/14px var(--maude-chrome-font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .ed-band { transition-duration: 1ms; }
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('ed-band-css')) return;
  const s = document.createElement('style');
  s.id = 'ed-band-css';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

const num = (v: string) => Number.parseFloat(v) || 0;
const rectOf = (r: DOMRect): RectLike => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

/** The bands of `el` when it is a row / column of two or more children; [] for anything else. */
export function bandsFor(el: HTMLElement, win: Window = window): Band[] {
  const cs = win.getComputedStyle(el);
  if (cs.display !== 'flex' && cs.display !== 'inline-flex') return [];
  const kids = Array.from(el.children).filter(
    (c) => !(c as HTMLElement).matches?.('.dgn-pin, .dc-cv-halo, .dc-cv-group-bbox')
  ) as HTMLElement[];
  const flow = kids.filter((c) => {
    const p = win.getComputedStyle(c).position;
    return p !== 'absolute' && p !== 'fixed';
  });
  if (flow.length < 2) return [];
  const axis = cs.flexDirection.startsWith('column') ? 'y' : 'x';
  return computeBands(
    rectOf(el.getBoundingClientRect()),
    flow.map((c) => rectOf(c.getBoundingClientRect())),
    {
      top: num(cs.paddingTop),
      right: num(cs.paddingRight),
      bottom: num(cs.paddingBottom),
      left: num(cs.paddingLeft),
    },
    axis,
    worldScaleOf(el)
  );
}

export function GapBands({ readOnly }: { readOnly?: boolean }) {
  ensureStyles();
  const { selected } = useSelectionSet();
  const tool = useToolModeOptional()?.tool;
  const [bands, setBands] = useState<Band[]>([]);
  const [hot, setHot] = useState<number | null>(null);
  const raf = useRef<number | null>(null);
  const one = selected.length === 1 ? selected[0] : null;
  const active = !!one?.id && !readOnly && tool !== 'browse';

  useEffect(() => {
    if (!active || !one) {
      setBands([]);
      return;
    }
    let last = '';
    const tick = () => {
      raf.current = requestAnimationFrame(tick);
      const el = resolveSelectionEl(document, one) as HTMLElement | null;
      const next = el ? bandsFor(el) : [];
      const dragged = tokenRuler.get()?.gapIndex ?? null;
      const key = `${dragged}|${next.map((b) => `${b.kind}${b.key}:${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)},${Math.round(b.height)},${b.label}`).join(';')}`;
      if (key === last) return;
      last = key;
      setBands(next);
      setHot(dragged);
    };
    tick();
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      setBands([]);
    };
  }, [active, one]);

  if (!bands.length) return null;
  return (
    <div aria-hidden="true" data-testid="edit-gap-bands">
      {bands.map((b) => (
        <i
          key={`${b.kind}-${b.key}`}
          className="ed-band"
          data-testid={b.kind === 'gap' ? 'edit-gap-band' : 'edit-pad-band'}
          data-kind={b.kind}
          data-key={b.key}
          data-hot={b.kind === 'gap' && hot !== null && Number(b.key) === hot ? 'true' : undefined}
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
        >
          {b.label ? (
            <b
              className="ed-band-n"
              data-testid={b.kind === 'gap' ? 'edit-gap-chip' : 'edit-pad-chip'}
            >
              {b.label}
            </b>
          ) : null}
        </i>
      ))}
    </div>
  );
}
