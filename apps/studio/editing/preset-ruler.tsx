// editing/preset-ruler.tsx — S2.8 (artboard ed-ab-resize): what the canvas draws WHILE a handle is held.
//
//   ghost     the artboard as it was, dashed, so you see how far you went
//   ruler     the presets above the artboard — Tablet 834 · Laptop 1280 · Desktop 1440 — at their true width ×
//             zoom from the left edge; the one the width clicked onto is lit
//   guide     a line down the edge being dragged, in the guide colour (`--guide`, DDR-046)
//   bubble    "Laptop · 1280 × 1573" beside the pointer
//   hint      "⌘ ignores presets · ⌥ from the centre"
//
// Pure view: screen px in, markup out. artboard-handles.tsx owns the gesture and hands this the numbers.
// Colours and motion are tokens only; nothing here animates under reduced motion (it does not animate).

import type { ReactNode } from 'react';
import { type Box, bubbleText, type RulerStop, type WidthPreset } from './artboard-resize.ts';

/** A rect in window px. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RulerHud {
  /** the artboard before the drag */
  ghost: ScreenRect;
  /** the artboard now (the design surface) */
  rect: ScreenRect;
  /** world box now — what the bubble says */
  box: Pick<Box, 'w' | 'h'>;
  preset: WidthPreset | null;
  stops: readonly RulerStop[];
  /** the pointer, window px */
  pointer: { x: number; y: number };
  /** which edge the guide line runs down: the dragged side; null = a height-only drag */
  edge: 'e' | 'w' | null;
  /** ⌘ is held: presets are off, so say so */
  presetsOff: boolean;
}

export const RULER_CSS = `
.ed-ab-ghost {
  position: fixed;
  pointer-events: none;
  z-index: 4;
  box-sizing: border-box;
  border: 1px dashed var(--maude-hud-accent);
  border-radius: 2px;
  opacity: 0.6;
}
.ed-ab-ruler {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  height: 24px;
  border-bottom: 1px solid color-mix(in oklab, var(--maude-chrome-fg-1) 40%, transparent);
  font: 500 11px/16px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  font-variant-numeric: tabular-nums;
  color: var(--maude-chrome-fg-1);
}
.ed-ab-tick {
  position: absolute;
  bottom: -1px;
  width: 0;
  height: 8px;
  border-left: 1px solid color-mix(in oklab, var(--maude-chrome-fg-1) 55%, transparent);
}
.ed-ab-tick > span {
  position: absolute;
  bottom: 10px;
  left: 0;
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 0 4px;
  border-radius: 3px;
}
.ed-ab-tick[data-at="start"] > span { transform: translateX(-4px); }
.ed-ab-tick[data-at="end"] > span { transform: translateX(calc(-100% + 4px)); }
.ed-ab-tick[data-on="true"] {
  height: 12px;
  border-left-color: var(--maude-hud-accent);
  border-left-width: 2px;
}
.ed-ab-tick[data-on="true"] > span {
  background: var(--maude-hud-accent);
  color: var(--maude-hud-accent-fg);
}
.ed-ab-guide {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  width: 0;
  border-left: 1px solid var(--guide, var(--maude-hud-accent));
}
.ed-ab-bubble {
  position: fixed;
  pointer-events: none;
  z-index: 7;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--maude-hud-accent);
  color: var(--maude-hud-accent-fg);
  font: 600 11px/16px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ed-ab-hint {
  position: fixed;
  pointer-events: none;
  z-index: 7;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--maude-chrome-bg-1);
  color: var(--maude-chrome-fg-1);
  border: 1px solid var(--maude-chrome-border);
  font: 500 11px/16px var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  white-space: nowrap;
}
.ed-ab-hint kbd {
  font: inherit;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--maude-chrome-bg-2);
  color: var(--maude-chrome-fg-0);
}
`;

const px = (n: number) => `${Math.round(n)}px`;

export function PresetRuler({ hud }: { hud: RulerHud }): ReactNode {
  const { ghost, rect, stops, pointer } = hud;
  return (
    <>
      <style>{RULER_CSS}</style>
      <span
        className="ed-ab-ghost"
        data-testid="ed-ab-ghost"
        aria-hidden="true"
        style={{
          left: px(ghost.left),
          top: px(ghost.top),
          width: px(ghost.width),
          height: px(ghost.height),
        }}
      />
      <span
        className="ed-ab-ruler"
        data-testid="ed-ab-ruler"
        aria-hidden="true"
        style={{
          left: px(rect.left),
          top: px(rect.top - 52),
          width: px(Math.max(rect.width, 1) + 24),
        }}
      >
        {stops.map((s) => (
          <span
            key={s.w}
            className="ed-ab-tick"
            data-testid={`ed-ab-tick-${s.w}`}
            data-on={s.on ? 'true' : undefined}
            data-at={s.anchor}
            style={{ left: px(s.left) }}
          >
            <span>
              {s.label} {s.w}
            </span>
          </span>
        ))}
      </span>
      {hud.edge ? (
        <span
          className="ed-ab-guide"
          data-testid="ed-ab-guide"
          aria-hidden="true"
          style={{
            left: px(hud.edge === 'e' ? rect.left + rect.width : rect.left),
            top: px(rect.top - 30),
            height: px(rect.height + 30),
          }}
        />
      ) : null}
      <span
        className="ed-ab-bubble"
        data-testid="ed-ab-bubble"
        aria-hidden="true"
        style={{ left: px(pointer.x + 16), top: px(pointer.y + 12) }}
      >
        {bubbleText(hud.box, hud.preset)}
      </span>
      <span
        className="ed-ab-hint"
        data-testid="ed-ab-hint"
        aria-hidden="true"
        style={{ left: px(pointer.x + 16), top: px(pointer.y + 44) }}
      >
        {hud.presetsOff ? (
          'Presets are off'
        ) : (
          <>
            <kbd>⌘</kbd> ignores presets · <kbd>⌥</kbd> from the centre
          </>
        )}
      </span>
    </>
  );
}
