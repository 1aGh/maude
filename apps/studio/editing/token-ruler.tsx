// editing/token-ruler.tsx — the ruler a gap drag shows (S2.11, artboard ed-lay-auto).
//
//   "Drag a gap: it clicks through the system's space, like an artboard clicks onto presets."
//
// While a gap handle is dragged the value does not slide through every number: it clicks onto the
// stops of the Design system's space scale (12 · 16 · 24 · 32 · 48 — five stops around where it is),
// and a small ruler near the pointer shows them with the current one lit. ⌘ held ignores the stops
// (any number); ⌥ held changes every gap of the same size in the frame at once. The stops are the
// system's own — read from the `--space-*` custom properties the canvas has loaded; a system with no
// space scale has no ruler and the drag stays free (nothing here is a built-in list).
//
// `use-spacing-handles.tsx` drives it: `tokenRuler.show(...)` while dragging, `tokenRuler.hide()`
// on release. Pure where it can be (stops, window, snap take numbers), so it runs without layout.

import { useSyncExternalStore } from 'react';

const pxOf = (value: string): number | null => {
  const m = /^(-?\d*\.?\d+)(px|rem)?$/i.exec(value.trim());
  if (!m) return null;
  const n = Number.parseFloat(m[1] as string);
  return (m[2] || 'px').toLowerCase() === 'rem' ? n * 16 : n;
};

/** Distinct px stops, ascending, from raw custom-property values ("24px", "1.5rem"; anything else is skipped). */
export function stopsFromValues(values: readonly string[]): number[] {
  const set = new Set<number>();
  for (const v of values) {
    const n = pxOf(v);
    if (n !== null && n > 0) set.add(Math.round(n * 100) / 100);
  }
  return [...set].sort((a, b) => a - b);
}

/** The names of every `--space-*` custom property declared in the document's stylesheets. */
export function spaceNames(doc: Document): string[] {
  const names = new Set<string>();
  const walk = (rules: CSSRuleList | undefined, depth: number) => {
    if (!rules || depth > 4) return;
    for (const rule of Array.from(rules)) {
      const style = (rule as CSSStyleRule).style;
      if (style) {
        for (let i = 0; i < style.length; i++) {
          const prop = style[i] as string;
          if (/^--space-[a-z0-9-]+$/i.test(prop)) names.add(prop);
        }
      }
      walk((rule as CSSGroupingRule).cssRules, depth + 1);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules, 0);
    } catch {
      /* a cross-origin sheet: its space scale is not ours to read */
    }
  }
  return [...names];
}

/** The space stops of the design system loaded in this canvas, in px, ascending. Empty = no scale. */
export function spaceStops(doc: Document = document): number[] {
  const root = doc.documentElement;
  const cs = doc.defaultView?.getComputedStyle(root);
  if (!cs) return [];
  return stopsFromValues(spaceNames(doc).map((n) => cs.getPropertyValue(n)));
}

/**
 * The `--space-*` name whose value is `px` in this canvas's system, or null (⌘ any number, or a
 * system without that stop). A gap that lands on a stop is written as the token, not the number.
 * Several names with one value: the first by name, so the answer does not move between runs.
 */
export function spaceTokenFor(px: number, doc: Document = document): string | null {
  const cs = doc.defaultView?.getComputedStyle(doc.documentElement);
  if (!cs) return null;
  for (const name of spaceNames(doc).sort()) {
    const n = pxOf(cs.getPropertyValue(name));
    if (n !== null && Math.abs(n - px) < 0.005) return name;
  }
  return null;
}

/** Five stops around the one nearest `current` (fewer when the scale is short). */
export function rulerWindow(stops: readonly number[], current: number, size = 5): number[] {
  if (stops.length <= size) return [...stops];
  let near = 0;
  for (let i = 1; i < stops.length; i++)
    if (Math.abs((stops[i] as number) - current) < Math.abs((stops[near] as number) - current))
      near = i;
  const half = Math.floor(size / 2);
  const start = Math.max(0, Math.min(stops.length - size, near - half));
  return stops.slice(start, start + size);
}

/** The stop nearest `value` (the lower one on a tie); `value` itself, rounded, when there are no stops. */
export function snapToStop(value: number, stops: readonly number[]): number {
  if (!stops.length) return Math.round(value);
  let best = stops[0] as number;
  for (const s of stops) if (Math.abs(s - value) < Math.abs(best - value)) best = s;
  return best;
}

/** What the drag lands on: a stop, or the raw number when ⌘ is held or the system has no scale. */
export function gapValue(raw: number, stops: readonly number[], free: boolean): number {
  const v = Math.max(0, raw);
  return free || !stops.length ? Math.round(v * 100) / 100 : snapToStop(v, stops);
}

export interface RulerState {
  /** screen px, where the ruler sits (beside the pointer) */
  x: number;
  y: number;
  stops: number[];
  /** the lit stop; null while ⌘ makes it any number */
  on: number | null;
  /** the number it would be right now */
  value: number;
  free: boolean;
  all: boolean;
  /** which gap (0 = between the first two children) the pointer holds; the bands light that one */
  gapIndex?: number | null;
}

let state: RulerState | null = null;
const subs = new Set<() => void>();
const emit = () => {
  for (const f of subs) f();
};

export const tokenRuler = {
  show(next: RulerState): void {
    state = next;
    emit();
  },
  hide(): void {
    if (state === null) return;
    state = null;
    emit();
  },
  get(): RulerState | null {
    return state;
  },
  subscribe(f: () => void): () => void {
    subs.add(f);
    return () => subs.delete(f);
  },
};

export const RULER_HINT = '⌘ any number · ⌥ every gap at once';

const CSS_TEXT = `
.ed-ruler {
  position: fixed;
  z-index: 8;
  pointer-events: none;
  transform: translate(14px, -50%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--maude-hud-bg, #1b1b1f);
  color: var(--maude-hud-fg, #f2f2f4);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
  font: 500 11px/16px var(--maude-chrome-font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  animation: ed-ruler-in var(--dur-panel, 220ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.ed-ruler-stops { display: flex; gap: 2px; align-items: center; }
.ed-ruler-stop {
  min-width: 26px;
  padding: 1px 5px;
  border-radius: 4px;
  text-align: center;
  opacity: 0.6;
}
.ed-ruler-stop[data-on="true"] {
  opacity: 1;
  background: var(--guide, var(--guide-magenta, #ff24bd));
  color: #fff;
}
.ed-ruler-hint { font-weight: 400; opacity: 0.75; white-space: nowrap; }
@keyframes ed-ruler-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .ed-ruler { animation-duration: 1ms; }
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('ed-ruler-css')) return;
  const s = document.createElement('style');
  s.id = 'ed-ruler-css';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

export function TokenRuler() {
  ensureStyles();
  const s = useSyncExternalStore(tokenRuler.subscribe, tokenRuler.get, tokenRuler.get);
  if (!s) return null;
  return (
    <div
      className="ed-ruler"
      data-testid="edit-token-ruler"
      data-free={s.free ? 'true' : undefined}
      style={{ left: s.x, top: s.y }}
      aria-hidden="true"
    >
      <div className="ed-ruler-stops">
        {s.stops.map((p) => (
          <span
            key={p}
            className="ed-ruler-stop"
            data-testid={`edit-token-ruler-stop-${p}`}
            data-on={s.on === p ? 'true' : undefined}
          >
            {p}
          </span>
        ))}
        {s.free ? (
          <span className="ed-ruler-stop" data-on="true" data-testid="edit-token-ruler-free">
            {s.value}
          </span>
        ) : null}
      </div>
      <div className="ed-ruler-hint" data-testid="edit-token-ruler-hint">
        {RULER_HINT}
      </div>
    </div>
  );
}
