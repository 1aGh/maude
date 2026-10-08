// inspector/color-picker.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect, useRef, useState } from 'react';
import { clamp01, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './color.js';
import { StIcon } from '../shell/icons.jsx';

// Phase 12.3 (#4) — the "Custom" tab of the colour popover: a normal colour
// input (native OS picker via a large swatch) + a hex/value text field. Applies
// LIVE as you adjust (onApply), so the canvas previews while the picker is open.
// #6 — the unified colour picker (Custom tab). A real HSV control: a
// saturation/value square + a hue slider + a hex field + an eyedropper — the
// Figma model. Replaces BOTH the old native <input type="color"> on the swatch
// AND the simple hex field, so colours have ONE popover (Custom · Variables).
// `seed` is the resolved current colour (hex). Drag updates the picker UI live;
// commits on pointer-up (one source write per drag); the hex field commits on
// blur/Enter.
export function ColorPicker({ seed, label, onApply }) {
  const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(seed || '#000000')));
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const svRef = useRef(null);
  const hueRef = useRef(null);
  // Reseed when the selection's colour changes (but not while the user drags).
  const seedRef = useRef(seed);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reseed on seed change only.
  useEffect(() => {
    if (seed && seed !== seedRef.current) {
      seedRef.current = seed;
      setHsv(rgbToHsv(hexToRgb(seed)));
    }
  }, [seed]);
  const hex = rgbToHex(hsvToRgb(hsv));

  const dragSV = (e) => {
    e.preventDefault();
    const r = svRef.current?.getBoundingClientRect();
    if (!r) return;
    const h = hsvRef.current.h;
    const move = (ev) => {
      setHsv({
        h,
        s: clamp01((ev.clientX - r.left) / r.width),
        v: clamp01(1 - (ev.clientY - r.top) / r.height),
      });
    };
    move(e);
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      onApply(rgbToHex(hsvToRgb(hsvRef.current)));
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  const dragHue = (e) => {
    e.preventDefault();
    const r = hueRef.current?.getBoundingClientRect();
    if (!r) return;
    const { s, v } = hsvRef.current;
    const move = (ev) => {
      setHsv({ h: clamp01((ev.clientX - r.left) / r.width) * 360, s, v });
    };
    move(e);
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      onApply(rgbToHex(hsvToRgb(hsvRef.current)));
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  // Keyboard equivalents for dragSV/dragHue (feature-photo-editor follow-up
  // debt, Task 18) — the pad + hue bar were pointer-only. Arrow keys nudge
  // the same `setHsv`/`onApply` path the drag handlers use; shift = a bigger
  // step (mirrors makeScrub's shift=×10 modifier convention elsewhere).
  const nudgeHsv = (patch) => {
    const next = { ...hsvRef.current, ...patch };
    setHsv(next);
    onApply(rgbToHex(hsvToRgb(next)));
  };
  const onSvKeyDown = (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const deltas = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = deltas[e.key];
    if (!d) return;
    e.preventDefault();
    nudgeHsv({ s: clamp01(hsvRef.current.s + d[0]), v: clamp01(hsvRef.current.v + d[1]) });
  };
  const onHueKeyDown = (e) => {
    const step = e.shiftKey ? 20 : 2;
    const deltas = { ArrowLeft: -step, ArrowRight: step };
    const d = deltas[e.key];
    if (d == null) return;
    e.preventDefault();
    nudgeHsv({ h: Math.min(360, Math.max(0, hsvRef.current.h + d)) });
  };
  const eyedrop = async () => {
    try {
      // EyeDropper is Chromium-only; guarded.
      const ED = window.EyeDropper;
      if (!ED) return;
      const res = await new ED().open();
      if (res?.sRGBHex) {
        setHsv(rgbToHsv(hexToRgb(res.sRGBHex)));
        onApply(res.sRGBHex);
      }
    } catch {
      /* user cancelled */
    }
  };

  // handoff — RGB numeric fields (design parity). Editing one re-derives hsv.
  const rgb = hsvToRgb(hsv);
  const setRgb = (patch) => {
    const next = { ...rgb, ...patch };
    const h = rgbToHsv({ r: clamp01(next.r / 255) * 255, g: clamp01(next.g / 255) * 255, b: clamp01(next.b / 255) * 255 });
    setHsv(h);
    onApply(rgbToHex(hsvToRgb(h)));
  };
  return (
    <div className="st-cp-cpick">
      {/* hex + swatch on top (design), then the SV pad, controls, RGB */}
      <div className="st-cp-cpick-hexrow">
        <span className="st-cp-cpick-hexsw" style={{ background: hex }} />
        <input
          className="st-cp-cpick-hex"
          type="text"
          value={hex}
          aria-label={label ? `${label} hex value` : 'hex value'}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#?[0-9a-f]{6}$/i.test(v)) setHsv(rgbToHsv(hexToRgb(v)));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onApply(e.currentTarget.value);
          }}
          onBlur={(e) => onApply(e.currentTarget.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
      <button
        type="button"
        ref={svRef}
        className="st-cp-cpick-sv"
        aria-label={label ? `${label} saturation and value` : 'saturation and value'}
        style={{ background: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={dragSV}
        onKeyDown={onSvKeyDown}
      >
        <span className="st-cp-cpick-svwhite" />
        <span className="st-cp-cpick-svblack" />
        <span
          className="st-cp-cpick-knob"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
        />
      </button>
      <div className="st-cp-cpick-controls">
        {window.EyeDropper ? (
          <button
            type="button"
            className="st-cp-cpick-eye"
            aria-label="pick from screen"
            title="eyedropper"
            onClick={eyedrop}
          >
            <StIcon name="eyedropper" size={14} />
          </button>
        ) : null}
        <span className="st-cp-cpick-preview" style={{ background: hex }} aria-hidden="true" />
        <button
          type="button"
          ref={hueRef}
          className="st-cp-cpick-hue"
          aria-label={label ? `${label} hue` : 'hue'}
          onPointerDown={dragHue}
          onKeyDown={onHueKeyDown}
        >
          <span className="st-cp-cpick-huethumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
        </button>
      </div>
      <div className="st-cp-cpick-rgb">
        {['r', 'g', 'b'].map((k) => (
          <label key={k} className="st-cp-cpick-rgbf">
            <input
              aria-label={k.toUpperCase()}
              value={Math.round(rgb[k])}
              onChange={(e) => setRgb({ [k]: clamp01((Number.parseFloat(e.target.value) || 0) / 255) * 255 })}
              onFocus={(e) => e.currentTarget.select()}
            />
            <span>{k.toUpperCase()}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
