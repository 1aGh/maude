// editing/corner-dots.tsx — the dot inside each corner of a selected shape or frame (S2.13, artboard ed-shape).
//
//   "Drag the dot inside a corner to round it; unlink the corners to set each."
//
// A selected rectangle, ellipse, polygon or frame shows four small dots, one inside each corner, sitting as far
// from the corner as its radius (so a square corner's dot is near the corner and a round one's is well inside).
// The dot under the pointer is lit; dragging it rounds that corner and a chip beside it says the radius ("8").
// While the four corners are equal the drag rounds all four; when they differ it rounds that corner only, and ⌥
// rounds one corner alone even from linked. The radius clicks onto the system's `--radius-*` stops (⌘ = any
// number) and is written as the token when it lands on one, as a number otherwise. esc gives the drag back.
//
// One drag = one `object.set-corner-radius` edit-op (edit-ops/corner-radius.ts), the same CSS the inspector's
// Corners row writes. While dragging, the element's inline radius is moved live and put back on release, so the
// file — not the preview — is what the canvas shows afterwards. `position: fixed` overlay divs outside the world
// transform, like the selection chrome, so a dot is 10 px at any zoom.

import { useEffect, useRef, useState } from 'react';

import { showCanvasToast } from '../canvas-notifications.tsx';
import { resolveSelectionEl } from '../dom-selection.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { useToolModeOptional } from '../use-tool-mode.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { worldScaleOf } from './arrange.ts';
import type { Pt } from './draw-geometry.ts';
import { editOpRecord, runEditOp } from './edit-op.ts';
import { refOfElement } from './object-actions.ts';
import { isLockedDom } from './selection.tsx';
import { snapToStop, stopsFromValues } from './token-ruler.tsx';

export type Corner = 'tl' | 'tr' | 'br' | 'bl';
export const CORNER_ORDER: readonly Corner[] = ['tl', 'tr', 'br', 'bl'];
/** Which way is "into the box" for each corner. */
export const INWARD: Readonly<Record<Corner, { sx: 1 | -1; sy: 1 | -1 }>> = {
  tl: { sx: 1, sy: 1 },
  tr: { sx: -1, sy: 1 },
  br: { sx: -1, sy: -1 },
  bl: { sx: 1, sy: -1 },
};
const LONGHAND: Readonly<Record<Corner, string>> = {
  tl: 'border-top-left-radius',
  tr: 'border-top-right-radius',
  br: 'border-bottom-right-radius',
  bl: 'border-bottom-left-radius',
};

/** Where a dot sits when the radius is 0: this far in from the corner, along the diagonal (screen px). */
export const DOT_INSET = 14;
/** A box smaller than this on screen shows no dots (they would sit on each other). */
export const MIN_BOX = 48;

/** The radius a corner can reach: half the shorter side (element px). */
export const maxRadius = (w: number, h: number): number => Math.max(0, Math.min(w, h) / 2);

/** Where the dot of `corner` is on screen for `radius` (element px), `k` screen px per element px. */
export function dotAt(
  corner: Corner,
  rect: { left: number; top: number; width: number; height: number },
  radius: number,
  k: number
): Pt {
  const { sx, sy } = INWARD[corner];
  const reach = Math.min(radius * k + DOT_INSET, Math.min(rect.width, rect.height) / 2);
  const ax = sx > 0 ? rect.left : rect.left + rect.width;
  const ay = sy > 0 ? rect.top : rect.top + rect.height;
  return { x: ax + sx * reach, y: ay + sy * reach };
}

/** The radius (element px) a pointer at `p` means for `corner`: its distance in along the diagonal, less the inset. */
export function radiusFromPointer(
  corner: Corner,
  p: Pt,
  rect: { left: number; top: number; width: number; height: number },
  k: number,
  max: number
): number {
  const { sx, sy } = INWARD[corner];
  const ax = sx > 0 ? rect.left : rect.left + rect.width;
  const ay = sy > 0 ? rect.top : rect.top + rect.height;
  const d = (sx * (p.x - ax) + sy * (p.y - ay)) / 2 - DOT_INSET;
  return Math.max(0, Math.min(max, d / (k > 0 ? k : 1)));
}

/** The radius a drag lands on: a stop of the system (0 counts), or any whole number with ⌘ / no scale. */
export function snapRadius(raw: number, stops: readonly number[], free: boolean): number {
  const v = Math.max(0, raw);
  if (free || stops.length === 0) return Math.round(v);
  return snapToStop(v, [0, ...stops.filter((s) => s > 0)]);
}

/** A computed `border-*-radius` value in element px (`50%` is half of the shorter side). */
export function radiusPx(value: string, w: number, h: number): number {
  const first = value.trim().split(/\s+/)[0] ?? '';
  const n = Number.parseFloat(first);
  if (!Number.isFinite(n)) return 0;
  return first.endsWith('%') ? (n / 100) * Math.min(w, h) : n;
}

export type Radii = Record<Corner, number>;

/** What a drag asks for: all four while they are equal (⌥ = one), else that corner. */
export function cornerTarget(radii: Radii, corner: Corner, alt: boolean): Corner | 'all' {
  const linked = CORNER_ORDER.every((c) => Math.abs(radii[c] - radii.tl) < 0.01);
  return linked && !alt ? 'all' : corner;
}

// ── the system's radius stops ───────────────────────────────────────────────────────────────

function radiusNames(doc: Document): string[] {
  const names = new Set<string>();
  const walk = (rules: CSSRuleList | undefined, depth: number) => {
    if (!rules || depth > 4) return;
    for (const rule of Array.from(rules)) {
      const style = (rule as CSSStyleRule).style;
      if (style) {
        for (let i = 0; i < style.length; i++) {
          const prop = style[i] as string;
          if (/^--radius-[a-z0-9-]+$/i.test(prop)) names.add(prop);
        }
      }
      walk((rule as CSSGroupingRule).cssRules, depth + 1);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules, 0);
    } catch {
      /* a cross-origin sheet: its radii are not ours to read */
    }
  }
  return [...names];
}

export interface RadiusStop {
  name: string;
  px: number;
}

/** The `--radius-*` stops of the system loaded in this canvas (px), pill-sized ones left out. */
export function radiusStops(doc: Document = document): RadiusStop[] {
  const cs = doc.defaultView?.getComputedStyle(doc.documentElement);
  if (!cs) return [];
  const out: RadiusStop[] = [];
  for (const name of radiusNames(doc).sort()) {
    const px = stopsFromValues([cs.getPropertyValue(name)])[0];
    if (px !== undefined && px <= 512) out.push({ name, px });
  }
  return out;
}

/** The ask for a finished drag: the token when the radius lands on a stop, else the number. */
export function radiusAsk(
  corner: Corner | 'all',
  px: number,
  stops: readonly RadiusStop[]
): {
  op: 'object.set-corner-radius';
  params: { corner: Corner | 'all'; radius: { token: string } | { px: number } };
} {
  const hit = px > 0 ? stops.find((s) => Math.abs(s.px - px) < 0.005) : undefined;
  return {
    op: 'object.set-corner-radius',
    params: { corner, radius: hit ? { token: hit.name } : { px: Math.round(px * 100) / 100 } },
  };
}

// ── the chrome ──────────────────────────────────────────────────────────────────────────────

const CSS_TEXT = `
.ed-cdot {
  position: fixed; z-index: 7; width: 10px; height: 10px; margin: -5px 0 0 -5px; padding: 0; box-sizing: border-box;
  border-radius: 50%; border: 1.5px solid var(--maude-hud-accent); background: var(--maude-chrome-bg-0, #fff);
  cursor: pointer; touch-action: none; pointer-events: auto;
}
.ed-cdot:hover, .ed-cdot[data-on="true"] { background: var(--maude-hud-accent); }
.ed-cdot-chip {
  position: fixed; z-index: 8; pointer-events: none; padding: 1px 6px; border-radius: 3px;
  background: var(--maude-hud-accent); color: var(--maude-hud-accent-fg);
  font: 500 11px/16px var(--maude-chrome-font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums; white-space: nowrap; transform: translate(-100%, 8px);
}
`;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A frame or a shape: the things that have a radius to round. Text, images, SVG and controls do not. */
export function roundable(el: Element): boolean {
  if (el.hasAttribute('data-shape')) return el.getAttribute('data-shape') !== 'line';
  const tag = el.tagName.toLowerCase();
  return [
    'div',
    'section',
    'article',
    'main',
    'header',
    'footer',
    'nav',
    'aside',
    'figure',
  ].includes(tag);
}

interface Drag {
  corner: Corner;
  radius: number;
  start: Radii;
  saved: Record<string, string>;
}

export function CornerDots({ readOnly = false }: { readOnly?: boolean }) {
  const { selected } = useSelectionSet();
  const undo = useUndoStackOptional();
  const tm = useToolModeOptional();
  const [, force] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const live = useRef({ undo });
  live.current = { undo };

  const one = selected.length === 1 && selected[0]?.id ? selected[0] : null;
  const tool = tm?.tool;
  const el =
    one && typeof document !== 'undefined'
      ? (resolveSelectionEl(document, one) as HTMLElement | null)
      : null;
  const ok = !!el && !readOnly && (!tool || tool === 'move') && roundable(el) && !isLockedDom(el);

  // follow the box while it moves, resizes or the canvas pans / zooms
  useEffect(() => {
    if (!ok) return;
    let raf: number | null = null;
    let last = '';
    const tick = () => {
      const r = el?.getBoundingClientRect();
      const key = r ? `${r.left}|${r.top}|${r.width}|${r.height}|${el?.style.cssText}` : '';
      if (key !== last) {
        last = key;
        force((n) => n + 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [ok, el]);

  if (!ok || !el) return null;
  const cs = getComputedStyle(el);
  if (cs.transform !== 'none' && cs.transform !== '') return null; // a turned box: the dots would lie
  const r = el.getBoundingClientRect();
  const rect: Box = { left: r.left, top: r.top, width: r.width, height: r.height };
  if (rect.width < MIN_BOX || rect.height < MIN_BOX) return null;
  const k = worldScaleOf(el);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const max = maxRadius(w, h);
  const radii: Radii = {
    tl: radiusPx(cs.borderTopLeftRadius, w, h),
    tr: radiusPx(cs.borderTopRightRadius, w, h),
    br: radiusPx(cs.borderBottomRightRadius, w, h),
    bl: radiusPx(cs.borderBottomLeftRadius, w, h),
  };

  const restore = (d: Drag) => {
    for (const [prop, v] of Object.entries(d.saved)) {
      if (v) el.style.setProperty(prop, v);
      else el.style.removeProperty(prop);
    }
  };

  const begin = (corner: Corner) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    try {
      target.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic events can refuse capture */
    }
    const props = ['border-radius', ...CORNER_ORDER.map((c) => LONGHAND[c])];
    const saved = Object.fromEntries(props.map((p) => [p, el.style.getPropertyValue(p)]));
    const stops = radiusStops(document).map((s) => s.px);
    const d: Drag = { corner, radius: radii[corner], start: radii, saved };
    setDrag(d);

    const apply = (ev: PointerEvent) => {
      const raw = radiusFromPointer(corner, { x: ev.clientX, y: ev.clientY }, rect, k, max);
      const px = snapRadius(raw, stops, ev.metaKey || ev.ctrlKey);
      const t = cornerTarget(radii, corner, ev.altKey);
      if (t === 'all') {
        el.style.setProperty('border-radius', `${px}px`);
        for (const c of CORNER_ORDER) el.style.removeProperty(LONGHAND[c]);
      } else {
        for (const c of CORNER_ORDER)
          el.style.setProperty(LONGHAND[c], `${c === t ? px : radii[c]}px`);
      }
      const next = { ...d, radius: px };
      dragRef.current = next;
      setDrag(next);
      return { px, t };
    };
    let latest: { px: number; t: Corner | 'all' } | null = null;
    const move = (ev: PointerEvent) => {
      latest = apply(ev);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('keydown', key, true);
      // the preview goes back to the file's own inline style at once: the write, not the preview, is what stays
      restore(d);
      setDrag(null);
      if (!commit || !latest) return;
      const { px, t } = latest;
      const before = t === 'all' ? radii.tl : radii[t];
      if (
        Math.abs(px - before) < 0.005 &&
        (t !== 'all' || CORNER_ORDER.every((c) => radii[c] === radii.tl))
      )
        return;
      const ref = refOfElement(el);
      if (!ref) return;
      const ask = radiusAsk(t, px, radiusStops(document));
      void runEditOp({ op: ask.op, targets: [ref], params: ask.params }).then((res) => {
        if (!res.ok) {
          showCanvasToast(res.message || 'That did not go through.', 'error');
          return;
        }
        if (res.actionId === null && res.writeId) {
          const rec = editOpRecord(res.writeId, 'Round corner');
          if (rec) live.current.undo?.record(rec);
        }
      });
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    document.addEventListener('keydown', key, true);
  };

  return (
    <>
      <style>{CSS_TEXT}</style>
      {CORNER_ORDER.map((c) => {
        const shown = drag && drag.corner === c ? drag.radius : radii[c];
        const at = dotAt(c, rect, shown, k);
        return (
          <button
            key={c}
            type="button"
            className="ed-cdot"
            data-testid={`edit-corner-dot-${c}`}
            data-on={drag?.corner === c ? 'true' : undefined}
            aria-label={`Round the ${{ tl: 'top left', tr: 'top right', br: 'bottom right', bl: 'bottom left' }[c]} corner`}
            style={{ left: at.x, top: at.y }}
            onPointerDown={begin(c)}
          />
        );
      })}
      {drag ? (
        <div
          className="ed-cdot-chip"
          data-testid="edit-corner-chip"
          aria-hidden="true"
          style={{
            left: dotAt(drag.corner, rect, drag.radius, k).x - 6,
            top: dotAt(drag.corner, rect, drag.radius, k).y,
          }}
        >
          {Math.round(drag.radius)}
        </div>
      ) : null}
    </>
  );
}
CornerDots.displayName = 'CornerDots';
