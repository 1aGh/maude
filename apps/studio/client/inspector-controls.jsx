// inspector-controls.jsx — the shared control library for the Inspector edit
// panels (feature-inspector-controls-redesign).
//
// ONE source of truth for the input controls both the CSS panel (`CssKnobs` in
// app.jsx) and the Photo panel (`photo-knobs.jsx`) render. Before this file,
// each panel hand-rolled its own number field / slider / toggle 6+ times, so
// scrub-to-change was wired onto the <input> (fighting click-to-edit), there
// was no select-all-on-focus, arrow-key stepping was missing, and the "sliders"
// had no track. These primitives fix the interaction model once:
//
//   • NumberField — typeable, mono/tabular. The DRAG-TO-SCRUB handle is the
//     leading icon/grip (Figma/Blender/Base UI convention), NOT the input body,
//     so click-to-type and select-all still work. Select-all on focus with a
//     click-again-to-caret escape hatch. ArrowUp/Down (Shift ×10, PageUp/Down
//     large, Home/End → min/max) step the value. Optional ▲▼ steppers + unit slot.
//   • Slider / SliderField — a real WAI-ARIA slider (track · fill · thumb,
//     keyboard-accessible), and the coarse+fine COMBO that links a Slider to a
//     NumberField (edit either → both update; drag previews, release commits).
//   • UnitSelect — the unit suffix on a CSS length field (px/rem/%/em/…),
//     plugged into a NumberField's `unitSlot`.
//   • Segmented — ≤5 mutually-exclusive options, all visible (radio semantics).
//   • Select — styled native <select> (6+ options).
//   • Swatch — a compact color trigger that opens a caller-supplied popover/picker.
//   • Toggle — immediate-effect boolean switch.
//   • Field — the label + control [+ help] inspector row.
//
// Runs on the MAIN origin (studio shell), so it's plain React with the shell's
// `.st-cp-*` classes (styled in client/styles/3-shell-maude.css). Value model is
// numeric-first; NumberField accepts optional parse/format hooks so CssKnobs can
// adapt its CSS-unit strings without the library learning about units.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Diamond,
  Eye,
  EyeOff,
  RotateCcw,
  Search,
  SquareDashed,
  X,
} from 'lucide-react';

// lucide wrapper — hairline stroke to match the shell's icon weight.
const Ic = ({ as: C, size = 14 }) => (
  <C size={size} strokeWidth={1.75} style={{ display: 'block', flex: 'none' }} />
);

const pretty = (n) => n.replace(/^--/, '').replace(/-/g, ' ');

const clampTo = (n, min, max) => {
  let v = n;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
};

// Round to a step's natural precision so 0.1+0.2 doesn't surface 0.30000000004.
const precisionOf = (step) => {
  if (!(step > 0)) return 2;
  if (step >= 1) return 0;
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
};
const snap = (n, step) => {
  const p = precisionOf(step);
  return Number(n.toFixed(p));
};

// ── the scrub hook ───────────────────────────────────────────────────────────
//
// Generalizes app.jsx `makeScrub` + photo-knobs `makePhotoScrub` into one
// pointer-drag engine, attached to a HANDLE element (not the input). 3px
// dead-zone so a click never reads as a 1px scrub; Shift = coarse ×10, Alt =
// fine ×0.1. `delta = dx * step * modifier` — with step=1 (CSS lengths) that's
// 1px→1unit, with step=0.01 (photo adjustments) it's the gentle sweep the photo
// panel already used. Non-locked (drag stops at the screen edge) — matches
// today's behaviour; deliberately no Pointer Lock (WKWebView/Safari layout-shift
// risk), can be layered on later.
// `sides` (optional) generalizes app.jsx's box-model scrub grammar: dragging a
// margin/padding/inset cell with Alt held moves its axis PAIR too, Alt+Shift
// moves all four — Webflow's box-model convention. When `sides` is given, the
// per-axis Shift(×10)/Alt(fine) modifiers are unavailable (Alt/Shift are spoken
// for), so granularity is fixed at 1 — matching the prior makeScrub behavior.
// `onInput`/`onCommit` receive `(value, activeSides)`; `activeSides` is
// `undefined` when `sides` isn't configured, or `sides.pair`/`sides.all`/absent
// (self only) per the held modifiers.
// Plain (non-hook) builder — the actual drag-math engine. Exported directly for
// callers that invoke it from a per-row helper closure rather than a real React
// component (e.g. CssKnobs' `side()`/`inset()` box-model cells, which are
// plain functions called during render, not components — wrapping this in a
// hook there would call `useCallback` conditionally on render order, breaking
// the rules of hooks). `useScrub` below is the convenience hook form for actual
// components (NumberField).
export function makeScrubHandler({
  getBase,
  min,
  max,
  step = 1,
  onInput,
  onCommit,
  sensitivity = 1,
  sides,
}) {
  return (e) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const base = Number.parseFloat(getBase()) || 0;
    let scrubbing = false;
    let last = base;
    const activeSidesFor = (ev) => {
      if (!sides) return undefined;
      if (ev.altKey && ev.shiftKey) return sides.all;
      if (ev.altKey) return sides.pair;
      return undefined;
    };
    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (!scrubbing && Math.abs(dx) < 3) return;
      if (!scrubbing) {
        scrubbing = true;
        document.body.classList.add('st-scrubbing');
      }
      ev.preventDefault();
      const modifier = sides ? 1 : ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      last = snap(clampTo(base + dx * step * sensitivity * modifier, min, max), step);
      onInput?.(last, activeSidesFor(ev));
    };
    const up = (ev) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (!scrubbing) return;
      document.body.classList.remove('st-scrubbing');
      onCommit?.(last, activeSidesFor(ev));
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
}

export function useScrub({
  getBase,
  min,
  max,
  step = 1,
  onInput,
  onCommit,
  sensitivity = 1,
  sides,
}) {
  return useCallback(
    makeScrubHandler({ getBase, min, max, step, onInput, onCommit, sensitivity, sides }),
    [getBase, min, max, step, onInput, onCommit, sensitivity, sides]
  );
}

// ── NumberField ──────────────────────────────────────────────────────────────
//
// Uncontrolled input (like photo-knobs' old Slider) so imperative mid-scrub
// value writes don't force a remount; an effect re-syncs from an external
// `value` change (reset / undo) whenever the field isn't focused.
export function NumberField({
  value,
  min,
  max,
  step = 1,
  lead, // node rendered in the drag handle (icon/letter); a grip is shown if omitted
  scrub = true,
  steppers = true,
  unitSlot, // e.g. a <UnitSelect/> or static suffix, rendered after the steppers
  sensitivity = 1,
  sides, // { pair, all } — box-model multi-side scrub grammar, forwarded to useScrub
  format, // (n) => string  display formatter (default: step-precision)
  parse, // (raw: string) => number|null  typed-value parser (default: parseFloat)
  onInput, // (n, activeSides?) => void   live preview during scrub/step (optional)
  onCommit, // (n, activeSides?) => void  final commit (blur / scrub-end / step / arrow)
  ariaLabel,
  className = '',
}) {
  const ref = useRef(null);
  const fmt = useCallback(
    (n) => (format ? format(n) : String(snap(Number(n) || 0, step))),
    [format, step]
  );
  const numOf = (v) => (typeof v === 'number' ? v : Number.parseFloat(v)) || 0;

  // Re-sync the uncontrolled input from an external value change, but never
  // while focused (don't fight typing / mid-scrub imperative writes).
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.value = fmt(value);
  }, [value, fmt]);

  const commit = (n, activeSides) => {
    const v = snap(clampTo(n, min, max), step);
    if (ref.current) ref.current.value = fmt(v);
    onCommit?.(v, activeSides);
  };
  const preview = (n, activeSides) => {
    const v = snap(clampTo(n, min, max), step);
    if (ref.current) ref.current.value = fmt(v);
    onInput?.(v, activeSides);
  };

  const onScrub = useScrub({
    getBase: () => (ref.current ? ref.current.value : numOf(value)),
    min,
    max,
    step,
    sensitivity,
    sides,
    onInput: preview,
    onCommit: commit,
  });

  const bump = (dir, mult) => commit(numOf(ref.current?.value ?? value) + dir * step * mult);

  const onKeyDown = (e) => {
    const mult = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      bump(1, mult);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      bump(-1, mult);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      bump(1, 10);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      bump(-1, 10);
    } else if (e.key === 'Home' && min != null) {
      e.preventDefault();
      commit(min);
    } else if (e.key === 'End' && max != null) {
      e.preventDefault();
      commit(max);
    } else if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const onFocus = (e) => {
    // Select-all on entry so the dominant task (replace the value) is one keystroke.
    // Deferred past the browser's own click-caret placement; a SECOND click (already
    // focused → no focus event) places the caret instead. That's the pro-tool escape hatch.
    const el = e.currentTarget;
    requestAnimationFrame(() => {
      if (document.activeElement === el) el.select();
    });
  };

  const onBlur = (e) => {
    const raw = String(e.currentTarget.value).trim();
    if (raw === '') return;
    const n = parse ? parse(raw) : Number.parseFloat(raw);
    if (n == null || Number.isNaN(n)) {
      // Revert to the last good value.
      e.currentTarget.value = fmt(value);
      return;
    }
    commit(n);
  };

  return (
    <div className={`st-cp-num ${className}`.trim()}>
      {scrub ? (
        <span
          className="st-cp-numlead st-cp-handle"
          role="presentation"
          aria-hidden="true"
          title="Drag to change · Shift ×10 · Alt fine"
          onPointerDown={onScrub}
        >
          {lead ?? <span className="st-cp-grip" />}
        </span>
      ) : lead ? (
        <span className="st-cp-numlead" aria-hidden="true">
          {lead}
        </span>
      ) : null}
      <input
        ref={ref}
        className="st-cp-numin"
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuenow={numOf(value)}
        aria-valuemin={min}
        aria-valuemax={max}
        defaultValue={fmt(value)}
        inputMode="decimal"
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {steppers ? (
        <span className="st-cp-step">
          <button
            type="button"
            className="st-cp-stepb"
            tabIndex={-1}
            aria-label={`increase ${ariaLabel || 'value'}`}
            onClick={() => bump(1, 1)}
          >
            ▲
          </button>
          <button
            type="button"
            className="st-cp-stepb"
            tabIndex={-1}
            aria-label={`decrease ${ariaLabel || 'value'}`}
            onClick={() => bump(-1, 1)}
          >
            ▼
          </button>
        </span>
      ) : null}
      {unitSlot ?? null}
    </div>
  );
}

// ── Slider (real track/thumb) ────────────────────────────────────────────────
//
// WAI-ARIA slider. Reuses the .st-cp-slider/track/fill/thumb CSS. Bipolar ranges
// (min<0<max) fill from the zero-point, not from min. Keyboard: Arrow ±step
// (Shift ×10), PageUp/Down large, Home/End → min/max. Pointer drag previews via
// onInput and commits on release.
export function Slider({ value, min = 0, max = 1, step = 0.01, onInput, onCommit, ariaLabel }) {
  const trackRef = useRef(null);
  const v = clampTo(value ?? (min < 0 ? 0 : min), min, max);
  const span = max - min || 1;
  const frac = (v - min) / span;
  const zeroFrac = min < 0 && max > 0 ? (0 - min) / span : 0;
  const fillLeft = Math.min(frac, zeroFrac);
  const fillWidth = Math.abs(frac - zeroFrac);

  const valueAtX = (clientX) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return v;
    const f = clampTo((clientX - r.left) / r.width, 0, 1);
    return snap(min + f * span, step);
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    trackRef.current?.focus();
    let last = valueAtX(e.clientX);
    onInput?.(last);
    const move = (ev) => {
      last = valueAtX(ev.clientX);
      onInput?.(last);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      onCommit?.(last);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  const onKeyDown = (e) => {
    const big = e.shiftKey ? 10 : 1;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = v + step * big;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = v - step * big;
    else if (e.key === 'PageUp') next = v + step * 10;
    else if (e.key === 'PageDown') next = v - step * 10;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next != null) {
      e.preventDefault();
      onCommit?.(snap(clampTo(next, min, max), step));
    }
  };

  return (
    <div className="st-cp-slider">
      <div
        ref={trackRef}
        className="st-cp-track"
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={v}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        {min < 0 && max > 0 ? (
          <span className="st-cp-zero" style={{ left: `${zeroFrac * 100}%` }} />
        ) : null}
        <span
          className="st-cp-fill"
          style={{ left: `${fillLeft * 100}%`, width: `${fillWidth * 100}%` }}
        />
        <span className="st-cp-thumb" style={{ left: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

// ── SliderField (Slider linked to a compact NumberField) ─────────────────────
//
// The coarse+fine combo NN/g prescribes for bounded params: the slider for
// exploration with live feedback, the numeric for the exact value — continuously
// linked. `onInput` fires during drag (preview, no undo); `onCommit` on release /
// typed entry (persist + undo).
export function SliderField({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  unit = '',
  onInput,
  onCommit,
  ariaLabel,
}) {
  const v = value ?? (min < 0 ? 0 : min);
  return (
    <div className="st-cp-sfield">
      <Slider
        value={v}
        min={min}
        max={max}
        step={step}
        onInput={onInput}
        onCommit={onCommit}
        ariaLabel={ariaLabel}
      />
      <NumberField
        className="st-cp-num--compact"
        value={v}
        min={min}
        max={max}
        step={step}
        scrub={false}
        steppers={false}
        unitSlot={
          unit ? (
            <span className="st-cp-numsuffix" aria-hidden="true">
              {unit}
            </span>
          ) : null
        }
        onInput={onInput}
        onCommit={onCommit}
        ariaLabel={ariaLabel}
      />
    </div>
  );
}

// ── UnitSelect (the unit suffix on a CSS length NumberField) ─────────────────
//
// A thin `.st-cp-unitsel` wrapper generalizing the inline unit `<select>` that
// used to live inside `CssKnobs`' `num()` factory — passed as a `NumberField`
// `unitSlot`. `onChange` receives the raw unit string (e.g. 'rem'); the caller
// owns recombining it with the numeric part (unit conversion is CSS-specific,
// not something this library should know about).
export function UnitSelect({ value, units, onChange, ariaLabel }) {
  return (
    <select
      className="st-cp-unitsel"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {units.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );
}

// ── Segmented (≤5 options, all visible) ──────────────────────────────────────
export function Segmented({ value, options, onChange, ariaLabel }) {
  return (
    <div className="st-cp-seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : (o.label ?? o.value);
        return (
          <button
            key={val}
            type="button"
            role="radio"
            aria-checked={value === val}
            className={`st-cp-segbtn${value === val ? ' is-active' : ''}`}
            onClick={() => onChange(val)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Select (styled native <select>, 6+ options) ──────────────────────────────
export function Select({ value, options, onChange, ariaLabel, mini = false }) {
  return (
    <select
      className={`st-cp-nsel${mini ? ' st-cp-nsel--mini' : ''}`}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : (o.label ?? o.value);
        return (
          <option key={val} value={val}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

// ── Toggle (immediate-effect boolean) ────────────────────────────────────────
export function Toggle({ checked, onChange, label, ariaLabel }) {
  return (
    <label className="st-cp-toggle">
      <input
        type="checkbox"
        className="st-cp-switch"
        checked={!!checked}
        aria-label={ariaLabel || label}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label ? <span className="st-cp-toggle-lbl">{label}</span> : null}
    </label>
  );
}

// ── Swatch (compact color trigger → caller-supplied picker) ───────────────────
//
// `render` is a render-prop the caller uses to plug in its own popover/picker
// (CssKnobs → TokenPopover, photo-knobs → the injected HSV ColorPicker). If no
// render is given it falls back to a native <input type="color">.
export function Swatch({ value, fallback = '#000000', label, onApply, render }) {
  const hex = value || fallback;
  if (render) return render({ hex, label, onApply });
  return (
    <label
      className="st-cp-swatch st-cp-swatch--mini st-cp-swatch--trigger"
      style={{ background: hex }}
      title={label}
    >
      <input
        type="color"
        value={hex}
        aria-label={label || 'color'}
        onChange={(e) => onApply(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
      />
    </label>
  );
}

// ── Field (the inspector row: label + control [+ help]) ──────────────────────
export function Field({ label, help, children, wide = false }) {
  return (
    <div className={`st-cp-row${wide ? ' st-cp-row--wide' : ''}`}>
      {label ? <span className="st-cp-label">{label}</span> : null}
      <span className="st-cp-ctl">{children}</span>
      {help ? <span className="st-cp-help">{help}</span> : null}
    </div>
  );
}

// ── IconButtonGroup / IconToggleGroup (≤5 options with a glyph each) ──────────
//
// Single-choice radio group (flex-direction, justify, align, text-align,
// overflow) or a multi-select toggle group (bold/italic/underline). `options`:
// `[{ value, node, label }]` where `node` is a lucide icon element.
export function IconButtonGroup({ value, options, ariaLabel, onChange }) {
  return (
    <div className="st-cp-iconseg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label}
          title={o.label}
          className={value === o.value ? 'is-active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.node}
        </button>
      ))}
    </div>
  );
}
export function IconToggleGroup({ value, options, ariaLabel, onToggle }) {
  return (
    <div className="st-cp-iconseg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={!!value[o.value]}
          aria-label={o.label}
          title={o.label}
          onClick={() => onToggle(o.value)}
        >
          {o.node}
        </button>
      ))}
    </div>
  );
}

// ── Checkbox (custom box + check, in the DS accent language) ──────────────────
export function Checkbox({ checked, label, ariaLabel, onChange }) {
  return (
    <label className="st-cp-check">
      <input
        type="checkbox"
        checked={!!checked}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="st-cp-check-box">
        <Ic as={Check} size={11} />
      </span>
      {label ? <span className="st-cp-check-lbl">{label}</span> : null}
    </label>
  );
}

// ── AlignPad (9-point auto-layout alignment) ─────────────────────────────────
const ALIGN_CELLS = ['tl', 'tc', 'tr', 'cl', 'cc', 'cr', 'bl', 'bc', 'br'];
export function AlignPad({ value, onChange, ariaLabel = 'alignment' }) {
  return (
    <div className="st-cp-alignpad" role="radiogroup" aria-label={ariaLabel}>
      {ALIGN_CELLS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`align ${c}`}
          className={value === c ? 'is-active' : ''}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

// ── AngleDial (drag around the circle → 0–360°) ──────────────────────────────
export function AngleDial({ value, onChange, ariaLabel = 'rotation' }) {
  const ref = useRef(null);
  const angleAt = (cx, cy) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return value;
    let deg = Math.round(
      (Math.atan2(cy - (r.top + r.height / 2), cx - (r.left + r.width / 2)) * 180) / Math.PI
    );
    if (deg < 0) deg += 360;
    return deg;
  };
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    document.body.classList.add('st-scrubbing', 'st-scrubbing--dial');
    onChange(angleAt(e.clientX, e.clientY));
    const move = (ev) => onChange(angleAt(ev.clientX, ev.clientY));
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.classList.remove('st-scrubbing', 'st-scrubbing--dial');
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  // Keyboard is a first-class stepper for the dial (WAI-ARIA slider): Arrow ±1°
  // (Shift ×10), Page ±15°, Home/End → 0/360. Mirrors `Slider`'s onKeyDown so
  // the rotation is reachable without a pointer (WCAG 2.1.1 / 4.1.2).
  const cur = value ?? 0;
  const onKeyDown = (e) => {
    const big = e.shiftKey ? 10 : 1;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + big;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - big;
    else if (e.key === 'PageUp') next = cur + 15;
    else if (e.key === 'PageDown') next = cur - 15;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 360;
    if (next != null) {
      e.preventDefault();
      onChange(clampTo(next, 0, 360));
    }
  };
  return (
    <button
      ref={ref}
      type="button"
      className="st-cp-dial"
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={cur}
      aria-valuetext={`${cur}°`}
      title="drag to rotate · arrows to nudge"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <span className="st-cp-dial-needle" style={{ '--angle': `${value}deg` }} />
    </button>
  );
}

// ── PanelSection (collapsable section — caret + reset + height animation) ─────
//
// Mirrors CssKnobs `sec()` (caret toggle + section reset) but with a smooth
// grid-rows collapse animation. `onReset` (optional) renders the ⟲ affordance.
export function PanelSection({ title, defaultOpen = true, onReset, right, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="st-cp-sec">
      <div className="st-cp-sechd-row">
        <button
          type="button"
          className="st-cp-sechd"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="st-cp-caret" aria-hidden="true">
            <Ic as={ChevronDown} size={12} />
          </span>
          {title}
        </button>
        {right ?? null}
        {onReset ? (
          <button
            type="button"
            className="st-cp-secreset"
            aria-label={`reset ${title} section`}
            title={`reset ${title}`}
            onClick={onReset}
          >
            <Ic as={RotateCcw} size={12} />
          </button>
        ) : null}
      </div>
      <div className={`st-cp-sec-anim${open ? ' is-open' : ''}`}>
        <div className="st-cp-sec-inner">{children}</div>
      </div>
    </section>
  );
}

// ── ColorField (compact flush shell — swatch prefix + value [+ alpha + eye]) ──
//
// The ONE colour field: the caller passes the swatch TRIGGER (a `TokenPopover`
// swatch button in CssKnobs, or an injected `ColorPicker`-opening button in
// photo-knobs) as `swatch`; it renders flush as the left prefix (divider, no
// gap). `displayValue` is the hex / token-name shown in the value input;
// `alpha`/`onAlpha` + `visible`/`onVisible` opt into the richer fill controls.
export function ColorField({
  swatch,
  displayValue,
  bound,
  alpha,
  visible,
  ariaLabel,
  onValue,
  onAlpha,
  onVisible,
}) {
  return (
    <span className="st-cp-cf">
      {swatch}
      <input
        className={`st-cp-cf-in${bound ? ' is-bound' : ''}`}
        aria-label={ariaLabel}
        value={displayValue}
        onChange={(e) => onValue?.(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        readOnly={!onValue}
      />
      {onAlpha ? (
        <input
          className="st-cp-cf-alpha"
          aria-label={`${ariaLabel || 'colour'} alpha`}
          value={`${alpha}`}
          onChange={(e) => onAlpha(clampTo(Number.parseFloat(e.target.value) || 0, 0, 100))}
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : null}
      {onVisible ? (
        <button
          type="button"
          className={`st-cp-cf-eye${visible ? '' : ' is-off'}`}
          aria-pressed={visible}
          aria-label={`${ariaLabel || 'colour'} visibility`}
          onClick={() => onVisible(!visible)}
        >
          {visible ? <Ic as={Eye} /> : <Ic as={EyeOff} />}
        </button>
      ) : null}
    </span>
  );
}

// ── ValueTokenField (◇ — bind a NumberField to a space/radius variable) ──────
//
// Value is `number | "var(--x)"`. Bound → the field turns into an accent chip
// with the token name + a ✕ detach; the ◇ opens a searchable token list. Mirrors
// CssKnobs `tok()` but with the bound-chip display the design specifies.
export function ValueTokenField({
  value,
  tokens,
  ariaLabel,
  lead,
  unit,
  unitSlot,
  min = 0,
  max,
  step = 1,
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef(null);
  const bound = typeof value === 'string' && value.startsWith('var(');
  const tokenName = bound ? value.replace(/^var\(\s*|\s*\)$/g, '') : '';
  const resolved = bound ? (tokens.find((t) => t.name === tokenName)?.value ?? '') : '';
  useEffect(() => {
    if (!open) {
      setQ('');
      return undefined;
    }
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [open]);
  const list = q
    ? tokens.filter((t) => pretty(t.name).includes(q) || (t.value || '').toLowerCase().includes(q))
    : tokens;
  return (
    <div className="st-cp-tokfield">
      {bound ? (
        <div className="st-cp-boundchip" title={`${tokenName} = ${resolved}`}>
          {lead ? (
            <span className="st-cp-boundchip-lead" aria-hidden="true">
              {lead}
            </span>
          ) : null}
          <span className="st-cp-boundchip-name">{pretty(tokenName)}</span>
          <button
            type="button"
            className="st-cp-boundchip-x"
            aria-label="detach token"
            title="detach — back to a raw value"
            onClick={() => onChange(Number.parseFloat(resolved) || 0)}
          >
            <Ic as={X} size={12} />
          </button>
        </div>
      ) : (
        <NumberField
          value={typeof value === 'number' ? value : 0}
          min={min}
          max={max}
          step={step}
          ariaLabel={ariaLabel}
          lead={lead}
          steppers={false}
          unitSlot={
            unitSlot ??
            (unit ? (
              <span className="st-cp-numsuffix" aria-hidden="true">
                {unit}
              </span>
            ) : null)
          }
          onCommit={(n) => onChange(n)}
        />
      )}
      <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          className={`st-cp-tokbtn${bound ? ' is-bound' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${ariaLabel} — bind a design token`}
          title="bind a design token"
          onClick={() => setOpen((o) => !o)}
        >
          <Ic as={Diamond} size={13} />
        </button>
        {open ? (
          <div
            className="st-cp-pop"
            role="dialog"
            aria-label="design tokens"
            style={{ left: 'auto', right: 0 }}
          >
            <div className="st-cp-pop-search">
              <Ic as={Search} size={12} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value.toLowerCase())}
                placeholder="Search variables"
                aria-label="search variables"
              />
            </div>
            {list.length ? (
              list.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className={`st-cp-pop-row${tokenName === t.name ? ' is-on' : ''}`}
                  onClick={() => {
                    onChange(`var(${t.name})`);
                    setOpen(false);
                  }}
                >
                  <span className="st-cp-pop-name">{pretty(t.name)}</span>
                  <span className="st-cp-pop-val">{t.value}</span>
                </button>
              ))
            ) : (
              <div className="st-cp-pop-empty">No match</div>
            )}
          </div>
        ) : null}
      </span>
    </div>
  );
}

// ── RadiusControl (uniform field + ▢ detach → 2×2 corner quad) ───────────────
//
// Research-grounded (Figma/Webflow): one unified radius field + a detach toggle;
// the four corner fields appear below, each with a per-corner glyph. `corners` =
// `{ tl, tr, bl, br }` numbers. `lead` is the radius glyph (caller-supplied so
// the icon set stays the caller's choice).
export function RadiusControl({ corners, lead, onCorners }) {
  const [split, setSplit] = useState(false);
  const setAll = (v) => onCorners({ tl: v, tr: v, bl: v, br: v });
  const cell = (k) => (
    <label className="st-cp-corner">
      <span className={`st-cp-cnr st-cp-cnr--${k}`} aria-hidden="true" />
      <input
        aria-label={`${k} radius`}
        value={corners[k]}
        onChange={(e) => onCorners({ ...corners, [k]: Number.parseFloat(e.target.value) || 0 })}
        onFocus={(e) => e.currentTarget.select()}
      />
    </label>
  );
  return (
    <div className="st-cp-radius">
      <div className="st-cp-radius-main">
        <NumberField
          value={corners.tl}
          min={0}
          max={200}
          ariaLabel="border-radius"
          lead={lead}
          steppers={false}
          unitSlot={
            <span className="st-cp-numsuffix" aria-hidden="true">
              px
            </span>
          }
          onCommit={(v) => (split ? onCorners({ ...corners, tl: v }) : setAll(v))}
        />
        <button
          type="button"
          className={`st-cp-splitbtn${split ? ' is-on' : ''}`}
          aria-pressed={split}
          aria-label="detach corners"
          title="detach corners — edit each independently"
          onClick={() => setSplit((s) => !s)}
        >
          <Ic as={SquareDashed} size={14} />
        </button>
      </div>
      {split ? (
        <div className="st-cp-corners">
          {cell('tl')}
          {cell('tr')}
          {cell('bl')}
          {cell('br')}
        </div>
      ) : null}
    </div>
  );
}
