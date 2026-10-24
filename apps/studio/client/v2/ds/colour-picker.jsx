// client/v2/ds/colour-picker.jsx — the drawn colour picker of 13 · ds-edit-colour: a lightness × chroma
// square and a hue rail, each with a round handle (`.ds-picker` in the board). It edits in OKLCH, the space
// the system's colours are written in, so a drag changes what a person means (lighter, calmer, another hue)
// and never walks through the native control's sRGB. Pointer or keyboard: the square is two arrows' worth of
// lightness and chroma, the rail one of hue — each a `slider` a screen reader can read.

import { useRef } from 'react';
import { oklchToHex, rgbToOklch } from '../../../draw/palette.ts';
import { resolveColour } from '../../../ds/contrast.ts';

const C_MAX = 0.37; // the square's right edge; sRGB never reaches further in any hue
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** A value → { l, c, h }; a colour with no hue (grey) keeps the hue it was last given. */
export function oklchOf(value, lastHue = 255) {
  const rgb = resolveColour(value, () => undefined);
  if (!rgb) return { l: 0.5, c: 0, h: lastHue };
  const o = rgbToOklch(rgb);
  return { l: o.l, c: o.c, h: o.c < 0.004 ? lastHue : o.h };
}

export const hueStops = [0, 60, 120, 180, 240, 300, 360]
  .map((h) => `oklch(0.72 0.15 ${h})`)
  .join(', ');

export function ColourPicker({ value, onChange, onEnd, label = 'Colour' }) {
  const hue = useRef(255);
  const o = oklchOf(value, hue.current);
  hue.current = o.h;
  const sq = useRef(null);
  const rail = useRef(null);
  const emit = (next) => onChange(oklchToHex({ l: next.l, c: next.c, h: next.h }));

  const dragIn = (ref, apply) => (e) => {
    const el = ref.current;
    if (!el) return;
    el.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      apply(
        clamp((ev.clientX - r.left) / r.width, 0, 1),
        clamp((ev.clientY - r.top) / r.height, 0, 1)
      );
    };
    move(e);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onEnd?.();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const squareKey = (e) => {
    const d = e.shiftKey ? 0.1 : 0.02;
    const step = {
      ArrowLeft: [-d * C_MAX, 0],
      ArrowRight: [d * C_MAX, 0],
      ArrowUp: [0, d],
      ArrowDown: [0, -d],
    }[e.key];
    if (!step) return;
    e.preventDefault();
    emit({ l: clamp(o.l + step[1], 0, 1), c: clamp(o.c + step[0], 0, C_MAX), h: o.h });
    onEnd?.();
  };
  const railKey = (e) => {
    const d = e.shiftKey ? 30 : 5;
    const step = { ArrowLeft: -d, ArrowDown: -d, ArrowRight: d, ArrowUp: d }[e.key];
    if (!step) return;
    e.preventDefault();
    emit({ ...o, h: (o.h + step + 360) % 360 });
    onEnd?.();
  };

  return (
    <div className="ds-picker" data-testid="ds-picker">
      <span
        ref={sq}
        className="ds-picker-sq"
        data-testid="ds-picker-square"
        style={{ '--pk-h': Math.round(o.h) }}
        // biome-ignore lint/a11y/useSemanticElements: a two-axis surface has no native element
        role="slider"
        tabIndex={0}
        aria-label={`${label} — lightness and chroma`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(o.l * 100)}
        aria-valuetext={`Lightness ${Math.round(o.l * 100)} percent, chroma ${o.c.toFixed(2)}`}
        onPointerDown={dragIn(sq, (x, y) => emit({ l: 1 - y, c: x * C_MAX, h: o.h }))}
        onKeyDown={squareKey}
      >
        <i
          style={{ left: `${(clamp(o.c, 0, C_MAX) / C_MAX) * 100}%`, top: `${(1 - o.l) * 100}%` }}
        />
      </span>
      <span
        ref={rail}
        className="ds-picker-hue"
        data-testid="ds-picker-hue"
        style={{ background: `linear-gradient(to right, ${hueStops})` }}
        // biome-ignore lint/a11y/useSemanticElements: a custom rail
        role="slider"
        tabIndex={0}
        aria-label={`${label} — hue`}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(o.h)}
        onPointerDown={dragIn(rail, (x) => emit({ ...o, h: x * 360 }))}
        onKeyDown={railKey}
      >
        <i style={{ left: `${(o.h / 360) * 100}%` }} />
      </span>
    </div>
  );
}
