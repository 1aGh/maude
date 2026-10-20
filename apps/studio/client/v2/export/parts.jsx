// client/v2/export/parts.jsx — S8.2: the small pieces every section of the Export sheet is made of
// (09 Export `Row` · `Seg` · `Check` · `Hint`). Presentational; the sheet owns every decision.

import { useId } from 'react';
import { StIcon } from '../../shell/icons.jsx';

/** A labelled row: `Format  [PNG][JPG] Other…`, with an optional quiet note under the value. */
export function Row({ k, children, note, testid, top = false }) {
  return (
    <div
      className={`ex-row${top ? ' ex-row--top' : ''}${note ? ' ex-row--note' : ''}`}
      data-testid={testid}
    >
      <span className="ex-row-k">{k}</span>
      <div className="ex-row-v">
        {children}
        {note ? <span className="ex-row-n">{note}</span> : null}
      </div>
    </div>
  );
}

/**
 * A segmented choice. `options` = [{ id, label, small?, testid?, disabled? }]; `value` = the picked id.
 * Radios, ← → move and pick, one tab stop (WAI-ARIA radio group).
 */
export function Seg({ options, value, onPick, label, testid }) {
  const id = useId();
  const picked = options.some((o) => o.id === value);
  const onKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const ids = options.filter((o) => !o.disabled).map((o) => o.id);
    if (ids.length === 0) return;
    e.preventDefault();
    const at = Math.max(0, ids.indexOf(value));
    const to = ids[(at + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
    onPick(to);
    e.currentTarget.querySelector(`[data-seg="${CSS.escape(String(to))}"]`)?.focus();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a radio group of segments, the design's control
    <div
      className="ex-seg"
      role="radiogroup"
      aria-label={label}
      data-testid={testid}
      data-value={value}
      data-seg-group={id}
      onKeyDown={onKey}
    >
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: see the group
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          disabled={o.disabled}
          tabIndex={o.id === value || (!picked && o === options[0]) ? 0 : -1}
          className="ex-seg-b"
          data-seg={o.id}
          data-testid={o.testid}
          onClick={() => onPick(o.id)}
        >
          {o.label}
          {o.small ? <small>{o.small}</small> : null}
        </button>
      ))}
    </div>
  );
}

/** A checkbox row with a quiet second line. */
export function Check({ checked, onChange, children, sub, disabled = false, testid }) {
  return (
    <label className={`ex-check${disabled ? ' ex-check--off' : ''}`}>
      <input
        type="checkbox"
        className="ex-check-in"
        checked={checked}
        disabled={disabled}
        data-testid={testid}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ex-box" data-on={checked ? 'true' : undefined} aria-hidden="true">
        {checked ? <StIcon name="check" size={10} /> : null}
      </span>
      <span>
        {children}
        {sub ? <small>{sub}</small> : null}
      </span>
    </label>
  );
}

/** One quiet line inside the sheet. One action at most (CONTRACT §4). */
export function Hint({ icon = 'link', children, action, onAction, testid, tone }) {
  return (
    <div className="ex-hint" data-testid={testid} data-tone={tone}>
      <span className="ex-hint-ic">
        <StIcon name={icon} size={14} />
      </span>
      <span className="ex-hint-t">{children}</span>
      {action ? (
        <button type="button" className="btn btn--ghost btn--sm ex-hint-a" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
