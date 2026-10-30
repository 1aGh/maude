// client/v2/inspector/sections/color-control.jsx — S2.4: a colour as the inspector says it (14 Editing, ed-inspector).
//
//   a token        a chip with its swatch, "Ink" — the name the system gives it; a click opens the menu
//   other CSS      a colour the system has no token for: said as written, quietly; the menu still offers the tokens
//   Mixed          several objects that differ: their swatches side by side and the word (`MixedSwatches`)
//
// The menu lists the system's own colour tokens (the list the panel read from its tokens CSS — never a built-in one),
// then "A colour, no token…" and, where a value may be absent, "None". A token is only ever written as `var(--<name>)`.

import { useRef, useState } from 'react';
import { tokenLabel } from '../../../../edit-ops/words-css.ts';
import { isCssColor, swatchCss } from '../../../../edit-ops/words-paint.ts';
import { NumberField } from '../../../inspector-controls.jsx';
import { StIcon } from '../../../shell/icons.jsx';
import { useDismiss } from '../token-chip.jsx';
import { colourWords } from './colour-words.js';

const SW = ({ colour }) => (
  <i className="insp-sw" aria-hidden="true" style={{ background: swatchCss(colour) }} />
);

/**
 * @param {{ name: string, label: string, value: { paint: any, opacity: number } | null, colors: string[],
 *   onChange: (c: { paint: any, opacity: number } | null) => void, allowNone?: boolean, noneLabel?: string,
 *   disabled?: boolean, showOpacity?: boolean }} props
 */
export function ColorControl({
  name,
  label,
  value,
  colors,
  onChange,
  allowNone = false,
  noneLabel = 'None',
  disabled = false,
  showOpacity = false,
  mixed = null, // several objects that differ: their distinct colours (null / a missing one = none) — drawn as swatches + "Mixed"
  vals = {}, // every token's resolved value (`useDsFamilies().vals`): names a resolved colour by the token that has it
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [bad, setBad] = useState(false);
  const ref = useRef(null);
  const close = () => {
    setOpen(false);
    setTyping(false);
  };
  useDismiss(open || typing, close, ref);
  const isToken = !!value && 'token' in value.paint;
  const opacity = value?.opacity ?? 100;
  const paintOf = (paint) => ({ paint, opacity });

  const commitCss = (raw) => {
    const t = String(raw).trim();
    if (!t) return close();
    if (!isCssColor(t)) return setBad(true);
    setBad(false);
    close();
    onChange(paintOf({ css: t }));
  };

  return (
    <span className="insp-len insp-color" ref={ref} data-testid={`insp-ctl-${name}`}>
      <button
        type="button"
        className="insp-chip"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={`insp-chip-face${value ? '' : ' insp-chip-face--none'}${value && !isToken ? ' insp-chip-face--css' : ''}`}
          data-testid={`insp-chip-${name}`}
          data-mixed={mixed ? 'true' : undefined}
        >
          {mixed ? (
            <>
              {mixed.slice(0, 4).map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: distinct values, positional
                <SW key={i} colour={c} />
              ))}
              Mixed
            </>
          ) : (
            <>
              {value ? <SW colour={value} /> : null}
              {value ? (
                isToken ? (
                  <b>{tokenLabel(value.paint.token)}</b>
                ) : (
                  // V2-8.5 C2 — a resolved colour is said in words ("Ink", "White"), not `rgb(20, 24, 31)`
                  (colourWords(value.paint.css, colors, vals) ?? value.paint.css)
                )
              ) : (
                noneLabel
              )}
            </>
          )}
        </span>
        <StIcon name="chevron-down" size={10} />
      </button>
      {showOpacity && value ? (
        <span className="insp-opacity" data-testid={`insp-opacity-${name}`}>
          <NumberField
            value={opacity}
            min={0}
            max={100}
            steppers={false}
            scrub={false}
            className="insp-nf"
            ariaLabel={`${label} opacity`}
            format={(n) => `${n} %`}
            parse={(raw) => Number.parseFloat(String(raw).replace('%', ''))}
            onCommit={(n) => n !== opacity && onChange({ paint: value.paint, opacity: n })}
          />
        </span>
      ) : null}
      {open ? (
        <div className="insp-menu" role="menu" aria-label={label} data-testid={`insp-menu-${name}`}>
          {colors.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={isToken && value.paint.token === t}
              className="insp-menu-i"
              data-testid={`insp-color-${name}-${t.replace(/^--/, '')}`}
              onClick={() => {
                close();
                onChange(paintOf({ token: t }));
              }}
            >
              <span className="insp-menu-sw">
                <SW colour={paintOf({ token: t })} />
                {tokenLabel(t)}
              </span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="insp-menu-i insp-menu-i--sep"
            data-testid={`insp-colorcss-${name}`}
            onClick={() => {
              setOpen(false);
              setTyping(true);
            }}
          >
            A colour, no token…
          </button>
          {allowNone ? (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={value == null}
              className="insp-menu-i"
              data-testid={`insp-none-${name}`}
              onClick={() => {
                close();
                onChange(null);
              }}
            >
              {noneLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      {typing ? (
        <span className="insp-num">
          <input
            className="insp-num-in insp-color-in"
            type="text"
            aria-label={`${label} — a colour`}
            aria-invalid={bad || undefined}
            data-testid={`insp-colorin-${name}`}
            placeholder="oklch(…) or #…"
            // biome-ignore lint/a11y/noAutofocus: the person just chose "A colour, no token…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCss(e.currentTarget.value);
              else if (e.key === 'Escape') close();
            }}
            onBlur={(e) =>
              e.currentTarget.value.trim() ? commitCss(e.currentTarget.value) : close()
            }
          />
        </span>
      ) : null}
    </span>
  );
}
