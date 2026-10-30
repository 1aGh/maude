// client/v2/export/advanced/fields.jsx — S8.3: the small controls the fold is made of (09 `InSelect`,
// `Field`, `InSwitch`). Native select and input underneath, so the keyboard and a screen reader get
// the real thing; the look is the sheet's own. Presentational — the fold owns every decision.

import { useEffect, useId, useState } from 'react';
import { reasonProps } from '../../access/disabled-reason.js';

/** A native select. `options` = [[value, label], …]; the value is compared as text. */
export function Select({ value, options, onChange, label, testid, disabled = false, reason = '' }) {
  return (
    <select
      className="ex-select"
      aria-label={label}
      data-testid={testid}
      disabled={disabled || undefined}
      {...reasonProps(disabled, reason)}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map(([v, l]) => (
        <option key={String(v)} value={String(v)}>
          {l}
        </option>
      ))}
    </select>
  );
}

const show = (n) => (n == null ? '' : String(n));

/**
 * A number the person types. Only a value inside `range` is handed on (`onCommit`); anything else
 * stays in the box, marked invalid, and the box goes back to the last good value when it loses focus.
 */
export function NumberField({ value, onCommit, range, unit, label, testid, integer = false }) {
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(show(value));
  }, [value, focused]);
  const n = Number(String(text).replace(',', '.'));
  const ok =
    text !== '' &&
    Number.isFinite(n) &&
    n >= range[0] &&
    n <= range[1] &&
    (!integer || Number.isInteger(n));
  // onInput too: the same handler, for hosts whose `input` event does not reach onChange (happy-dom)
  const handle = (e) => {
    const raw = e.target.value;
    setText(raw);
    const v = Number(raw.replace(',', '.'));
    if (
      raw !== '' &&
      Number.isFinite(v) &&
      v >= range[0] &&
      v <= range[1] &&
      (!integer || Number.isInteger(v))
    )
      onCommit(v);
  };

  return (
    <span className="ex-num">
      <input
        type="text"
        inputMode="decimal"
        className="ex-field"
        aria-label={label}
        aria-invalid={text !== '' && !ok ? 'true' : undefined}
        data-testid={testid}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(show(value));
        }}
        onChange={handle}
        onInput={handle}
      />
      {unit ? <span className="ex-num-u">{unit}</span> : null}
    </span>
  );
}

/**
 * A value drawn as the sheet's field but not typed into: the bleed an artboard was authored with (the page is
 * trim + 2 × bleed, so an export cannot change it — only whether the strip is kept). Focusable, read aloud.
 */
export function ReadField({ value, label, testid }) {
  return (
    <input
      type="text"
      readOnly
      className="ex-field ex-field--ro"
      aria-label={label}
      data-testid={testid}
      value={value}
    />
  );
}

/** An on/off switch — a button with `role="switch"`. */
export function Switch({ checked, onChange, label, testid, disabled = false }) {
  const id = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a switch is its own ARIA role, the design's control
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="ex-switch"
      data-testid={testid}
      data-on={checked ? 'true' : undefined}
      onClick={() => onChange(!checked)}
    >
      <span className="ex-switch-k" aria-hidden="true" />
    </button>
  );
}

/** A quiet line under a control. */
export function Note({ children, testid }) {
  return (
    <p className="ex-advp-n" data-testid={testid}>
      {children}
    </p>
  );
}
