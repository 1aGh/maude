// editing/pen/overlay.tsx — what the Pen draws over the canvas (S2.14, ed-pen): one fixed SVG in screen px, the chips
// and the key hints. Shared by the drawing tool (draw.tsx) and point editing (points.tsx). Colours are the HUD's
// tokens; motion is none (a live drag draws as fast as the pointer moves).

import { useEffect, useState } from 'react';

export const PEN_CSS = `
/* the input layer pen/draw.tsx renders: its rule used to live only in the shape tool's style (G3) */
.ed-draw-input { position: absolute; inset: 0; z-index: 4; touch-action: none; }
.ed-pen-svg { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; overflow: visible; z-index: 5; pointer-events: none; }
.ed-pen-path { fill: none; stroke: var(--maude-hud-accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ed-pen-was { fill: none; stroke: var(--maude-hud-accent); stroke-width: 1.5; stroke-dasharray: 5 4; opacity: 0.55; }
.ed-pen-rubber { fill: none; stroke: var(--maude-hud-accent); stroke-width: 1.5; stroke-dasharray: 4 4; opacity: 0.8; }
.ed-pen-h { fill: none; stroke: var(--maude-hud-accent); stroke-width: 1; }
.ed-pen-hd { fill: var(--maude-hud-accent-fg); stroke: var(--maude-hud-accent); stroke-width: 1.5; pointer-events: all; cursor: pointer; }
.ed-pen-hd[data-on="true"] { fill: var(--maude-hud-accent); }
.ed-pen-pt { fill: var(--maude-hud-accent-fg); stroke: var(--maude-hud-accent); stroke-width: 1.5; pointer-events: all; cursor: pointer; }
.ed-pen-pt[data-on="true"] { fill: var(--maude-hud-accent); }
.ed-pen-close { fill: none; stroke: var(--maude-hud-accent); stroke-width: 1.5; }
.ed-pen-hit { fill: none; stroke: transparent; stroke-width: 14; stroke-linecap: round; pointer-events: stroke; cursor: copy; }
.ed-pen-chip {
  position: fixed; pointer-events: none; z-index: 6; padding: 1px 6px; border-radius: 3px; white-space: nowrap;
  background: var(--maude-hud-accent); color: var(--maude-hud-accent-fg);
  font: 500 11px/16px var(--maude-chrome-font-mono, ui-monospace, monospace);
}
.ed-pen-chip[data-tone="quiet"] { background: var(--maude-hud-bg, #222); color: var(--maude-hud-fg, #eee); }
.ed-pen-hints {
  position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); z-index: 6; pointer-events: none;
  display: flex; gap: 14px; padding: 4px 10px; border-radius: 6px; white-space: nowrap;
  background: var(--maude-hud-bg, #222); color: var(--maude-hud-fg, #eee);
  font: 500 11px/16px var(--maude-chrome-font, system-ui, sans-serif);
}
.ed-pen-hints kbd { font: inherit; padding: 0 4px; border-radius: 3px; border: 1px solid currentColor; opacity: 0.8; }
`;

/** "Click — a sharp point" … the keys of drawing (the words of the canvas's hint row). */
export const DRAW_HINTS: ReadonlyArray<readonly [string | null, string]> = [
  [null, 'Click — a sharp point'],
  [null, 'Drag — a smooth one'],
  ['⇧', '45° steps'],
  ['↵', 'or esc — finish, open'],
];
/** The keys of point editing (the canvas's right-hand key list). */
export const EDIT_HINTS: ReadonlyArray<readonly [string | null, string]> = [
  [null, 'Click — add a point'],
  [null, 'Drag — bend'],
  ['⌥', 'drag — break a handle'],
  [null, 'Double-click — sharp ↔ smooth'],
  ['⌫', 'remove the point'],
  ['↵', 'done'],
];

export function PenHints({
  hints,
  testid,
}: {
  hints: ReadonlyArray<readonly [string | null, string]>;
  testid: string;
}) {
  return (
    <div className="ed-pen-hints" data-testid={testid} aria-hidden="true">
      {hints.map(([key, words]) => (
        <span key={words}>
          {key ? <kbd>{key}</kbd> : null} {words}
        </span>
      ))}
    </div>
  );
}

export function PenChip({
  x,
  y,
  tone,
  testid,
  children,
}: {
  x: number;
  y: number;
  tone?: 'quiet';
  testid: string;
  children: string;
}) {
  return (
    <div
      className="ed-pen-chip"
      data-testid={testid}
      data-tone={tone}
      style={{ left: x, top: y }}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

/**
 * Re-render when the frame the overlay draws against moves (a pan, a zoom, a resize): `read` returns a cheap key of
 * it; the hook polls once a frame while `on` and sets state only on a change.
 */
export function useFrameTick(read: () => string, on: boolean): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!on || typeof requestAnimationFrame === 'undefined') return;
    let last = read();
    let raf = 0;
    const tick = () => {
      const now = read();
      if (now !== last) {
        last = now;
        force((n) => n + 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, read]);
}
