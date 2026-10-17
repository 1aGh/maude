// client/v2/inspector/token-chip.jsx — S2.3: a length as the inspector says it (14 Editing, ed-inspector).
//
//   a token        a chip, "Space 24" — the name the Design system gives it (13's names); a click opens the menu
//   a number       "10" and **Bind** — "V 10 · not a token"; Bind takes the nearest stop of the system's space
//   other CSS      a calc(), a %, an em: said as written, quietly; the menu still offers the stops
//
// The menu lists the system's space tokens, then "A number, no token…" (and "None" where a value may be absent).
// Chips only ever write `var(--<name>)` for a name the system declares.

import { useEffect, useMemo, useRef, useState } from 'react';
import { lengthPx, nearestSpace, tokenLabel } from '../../../edit-ops/words-css.ts';
import { StIcon } from '../../shell/icons.jsx';
import { activeDsNameFor, useAllDsTokens } from '../../inspector/ds-tokens.js';

const pxOf = (value) => {
  const m = /^(-?\d*\.?\d+)(px|rem)?$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return (m[2] || 'px').toLowerCase() === 'rem' ? n * 16 : n;
};

/** The active design system's space stops, smallest first: `{ space: [{ name: '--space-5', px: 24 }] }`. */
export function useSpaceTokens(ctx) {
  const cfg = ctx?.cfg;
  const designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '');
  const active = activeDsNameFor(ctx?.canvasFile, cfg);
  const all = useAllDsTokens(cfg, designRel, active);
  return useMemo(() => {
    const ds = all.find((d) => d.name === active) || all[0];
    const stops = (ds?.space || [])
      .map((name) => ({ name, px: pxOf(ds.vals?.[name]) }))
      .filter((s) => s.px != null)
      .sort((a, b) => a.px - b.px);
    return { space: stops };
  }, [all, active]);
}

function useDismiss(open, onClose, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, onClose, ref]);
}

/**
 * One length: a token chip, a plain number with Bind, or CSS the words cannot say.
 * `value` is the `Length` from words-css (or null = nothing written); `onChange(Length | null)` is the edit.
 */
export function LengthControl({
  name, // testid suffix: insp-chip-<name>, insp-bind-<name>, insp-ctl-<name>
  label, // accessible name
  value,
  tokens,
  onChange,
  disabled = false,
  allowNone = false,
  noneLabel = 'None',
  extraItems = [], // [{ id, label, onSelect }] — rows ahead of the stops (the Gap menu's "Auto")
  min = 0,
  step = 1,
}) {
  const [open, setOpen] = useState(false);
  const [numeric, setNumeric] = useState(false);
  const ref = useRef(null);
  const close = () => setOpen(false);
  useDismiss(open, close, ref);
  const stops = tokens?.space || [];
  const isToken = value && 'token' in value;
  const isPx = !!value && !('token' in value) && 'px' in value;
  const px = lengthPx(value);

  const pick = (stop) => {
    setNumeric(false);
    setOpen(false);
    onChange({ token: stop.name, px: stop.px });
  };
  const commitNumber = (raw) => {
    const n = Number.parseFloat(String(raw).trim());
    setNumeric(false);
    if (Number.isNaN(n)) return;
    onChange({ px: Math.max(min, n) });
  };

  let face;
  if (isToken) {
    face = (
      <span className="insp-chip-face" data-testid={`insp-chip-${name}`}>
        <i className="insp-chip-dot" aria-hidden="true" />
        <b>{tokenLabel(value.token, value.px)}</b>
      </span>
    );
  } else if (value && 'css' in value) {
    face = (
      <span className="insp-chip-face insp-chip-face--css" data-testid={`insp-chip-${name}`}>
        {value.css}
      </span>
    );
  } else if (value == null) {
    face = (
      <span className="insp-chip-face insp-chip-face--none" data-testid={`insp-chip-${name}`}>
        {noneLabel}
      </span>
    );
  }

  const nearest = isPx ? nearestSpace(value.px, tokens) : null;

  return (
    <span className="insp-len" ref={ref} data-testid={`insp-ctl-${name}`}>
      {isPx || numeric ? (
        <span className="insp-num">
          <input
            className="insp-num-in"
            type="text"
            inputMode="decimal"
            aria-label={label}
            data-testid={`insp-num-${name}`}
            disabled={disabled}
            defaultValue={px ?? ''}
            // biome-ignore lint/a11y/noAutofocus: the person just chose "A number, no token…"
            autoFocus={numeric}
            key={`${px}:${numeric}`}
            onBlur={(e) => commitNumber(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') {
                e.currentTarget.value = String(px ?? '');
                e.currentTarget.blur();
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const n = Number.parseFloat(e.currentTarget.value) || 0;
                const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : step);
                onChange({ px: Math.max(min, n + d) });
              }
            }}
          />
          {isPx && nearest && value.px !== 0 ? (
            <button
              type="button"
              className="insp-bind"
              data-testid={`insp-bind-${name}`}
              disabled={disabled}
              title={`Bind to ${tokenLabel(nearest.name, nearest.px)}`}
              onClick={() => onChange({ token: nearest.name, px: nearest.px })}
            >
              Bind
            </button>
          ) : null}
        </span>
      ) : (
        <button
          type="button"
          className="insp-chip"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
        >
          {face}
          <StIcon name="chevron-down" size={10} />
        </button>
      )}
      {isPx || numeric ? (
        <button
          type="button"
          className="insp-chip-more"
          aria-label={`${label} — choose a token`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
        >
          <StIcon name="chevron-down" size={10} />
        </button>
      ) : null}
      {open ? (
        <div className="insp-menu" role="menu" aria-label={label} data-testid={`insp-menu-${name}`}>
          {extraItems.map((x) => (
            <button
              key={x.id}
              type="button"
              role="menuitem"
              className="insp-menu-i"
              data-testid={`insp-extra-${name}-${x.id}`}
              onClick={() => {
                setOpen(false);
                x.onSelect();
              }}
            >
              {x.label}
            </button>
          ))}
          {stops.map((s) => (
            <button
              key={s.name}
              type="button"
              role="menuitemradio"
              aria-checked={isToken && value.token === s.name}
              className="insp-menu-i"
              data-testid={`insp-stop-${name}-${s.px}`}
              onClick={() => pick(s)}
            >
              <span>{tokenLabel(s.name, s.px)}</span>
              <i>{s.px}</i>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="insp-menu-i insp-menu-i--sep"
            data-testid={`insp-number-${name}`}
            onClick={() => {
              setOpen(false);
              if (isToken) onChange({ px: value.px ?? 0 });
              else setNumeric(true);
            }}
          >
            A number, no token…
          </button>
          {allowNone ? (
            <button
              type="button"
              role="menuitem"
              className="insp-menu-i"
              data-testid={`insp-none-${name}`}
              onClick={() => {
                setOpen(false);
                setNumeric(false);
                onChange(null);
              }}
            >
              {noneLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
