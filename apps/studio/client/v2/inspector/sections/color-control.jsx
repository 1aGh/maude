// client/v2/inspector/sections/color-control.jsx — S2.4: a colour as the inspector says it (14 Editing, ed-inspector).
//
//   a token        a chip with its swatch, "Ink" — the name the system gives it; a click opens the menu
//   other CSS      a colour the system has no token for: said as written, quietly; the menu still offers the tokens
//   Mixed          several objects that differ: their swatches side by side and the word (`MixedSwatches`)
//
// The chip opens the colour picker (colour-popover.jsx, P6 T2): the system's colours grouped by role, Recent, "Other
// colour…" and, where a value may be absent, "None". A token is only ever written as `var(--<name>)`.
//
// P6 T3 (IR-12): an inherited colour — `currentColor`, `inherit`, or a text colour that is not set — is said in words,
// "Text colour" on a box and "Inherited" on a text, with the object's REAL colour as its swatch (`resolved`, what the
// canvas reports in `el.computed`), never the panel's own `currentColor`; the system's name for it follows in grey.

import { Droplet } from 'lucide-react';
import { useRef, useState } from 'react';
import { activeDsNameFor } from '../../../inspector/ds-tokens.js';
import { tokenLabel } from '../../../../edit-ops/words-css.ts';
import { paintToCss, swatchCss } from '../../../../edit-ops/words-paint.ts';
import { NumberField, ScrubLabelContext } from '../../../inspector-controls.jsx';
import { StIcon } from '../../../shell/icons.jsx';
import { ColourPopover } from './colour-popover.jsx';
import { colourWords } from './colour-words.js';
import { projectKeyOf, recentStore, useRecentColours } from './recent-colours.js';

const SW = ({ css }) => <i className="insp-sw" aria-hidden="true" style={{ background: css }} />;

/** `currentColor` / `inherit`: a colour that comes from somewhere else (IR-12). */
export const isInheritedCss = (css) =>
  /^\s*(?:currentcolor|inherit|unset|initial)\s*$/i.test(String(css ?? ''));

/** The words + swatch for an inherited colour: "Text colour · Ink" over the object's resolved colour. */
export function inheritedFace(word, resolved, colors, vals) {
  const named = resolved ? colourWords(resolved, colors, vals) : null;
  const isToken = !!named && colors.some((c) => tokenLabel(c) === named);
  return { word, also: isToken ? named : null, swatch: resolved || 'transparent' };
}

/**
 * @param {{ name: string, label: string, value: { paint: any, opacity: number } | null, colors: string[],
 *   onChange: (c: { paint: any, opacity: number } | null) => void, allowNone?: boolean, noneLabel?: string,
 *   disabled?: boolean, showOpacity?: boolean, ctx?: object, themes?: object, resolved?: string,
 *   inheritedWord?: string, noneInherits?: boolean, slotGroup?: string }} props
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
  opacityLive, // { onInput, onCancel } — the live preview of an opacity scrub (css-write `live`)
  mixed = null, // several objects that differ: their distinct colours (null / a missing one = none) — drawn as swatches + "Mixed"
  vals = {}, // every token's resolved value (`useDsFamilies().vals`): names a resolved colour by the token that has it
  themes = undefined, // both themes' resolved values (`useDsFamilies().themes`): the picker's Light | Dark swatches
  ctx = undefined, // the Inspector context: the project (Recent), the active system (Add it to the system)
  resolved = undefined, // the object's resolved colour for this paint (`el.computed`), for an inherited value's swatch
  inheritedWord = 'Text colour', // what `currentColor` reads as here: "Text colour" on a box, "Inherited" on a text
  noneInherits = false, // no value set = inherited (a text's colour), not "no paint"
  slotGroup = null, // the role group "Use <nearest>" looks in first (`surfaces` for a fill)
  fillApi = null, // a Fill only: { fill, set, live, upload?, start, end } — what makes the Solid · Gradient · Image tabs
  face = null, // a Fill that is a gradient or a picture: { swatch: CSS background, word } — the chip says what it is, not "None"
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const chipRef = useRef(null);
  const recent = useRecentColours(ctx);
  const hasSystem = ctx?.cfg ? (ctx.cfg.designSystems || []).length > 0 : colors.length > 0;
  const close = (opts) => {
    setOpen(false);
    if (opts?.refocus) chipRef.current?.focus?.();
  };
  const isToken = !!value && 'token' in value.paint;
  const opacity = value?.opacity ?? 100;
  const paintOf = (paint) => ({ paint, opacity });
  const tokenCss = (p) => vals[p.token] ?? p.fallback ?? `var(${p.token})`;
  const swatchFor = (c) =>
    c && 'token' in c.paint
      ? swatchCss({ paint: { css: tokenCss(c.paint) }, opacity: c.opacity })
      : swatchCss(c);
  const inherited =
    (value && !isToken && isInheritedCss(value.paint.css)) || (!value && noneInherits && resolved)
      ? inheritedFace(value ? inheritedWord : noneLabel, resolved, colors, vals)
      : null;
  const offSystem = !!value && !isToken && !inherited && hasSystem;

  const pick = (paint, opts) => {
    if (!opts?.keepOpen) setOpen(false);
    recentStore.push(projectKeyOf(ctx), paintToCss(paint));
    onChange(paintOf(paint), opts?.replaceLayers ? { replaceLayers: true } : undefined);
  };
  // a colour committed from the Custom tab (release, Enter, blur): the popover stays open, Recent keeps it
  const custom = (paint, opacityNow) => {
    recentStore.push(projectKeyOf(ctx), paintToCss(paint));
    onChange({ paint, opacity: opacityNow });
  };
  const tokenWord = (p) =>
    colors.includes(p.token) || !p.fallback
      ? tokenLabel(p.token)
      : (colourWords(p.fallback, colors, vals) ?? tokenLabel(p.token));

  return (
    <span className="insp-len insp-color" ref={ref} data-testid={`insp-ctl-${name}`}>
      <button
        ref={chipRef}
        type="button"
        className="insp-chip"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span
          className={`insp-chip-face${value || inherited || face ? '' : ' insp-chip-face--none'}${offSystem ? ' insp-chip-face--css' : ''}`}
          data-testid={`insp-chip-${name}`}
          data-mixed={mixed ? 'true' : undefined}
          data-inherited={inherited ? 'true' : undefined}
          data-paint={face ? 'layer' : undefined}
        >
          {face && !mixed ? (
            <>
              <i
                className="insp-sw insp-sw--wide"
                aria-hidden="true"
                style={{ background: face.swatch }}
              />
              {face.word}
            </>
          ) : mixed ? (
            <>
              {mixed.slice(0, 4).map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: distinct values, positional
                <SW key={i} css={swatchFor(c)} />
              ))}
              Mixed
            </>
          ) : inherited ? (
            <>
              <SW css={inherited.swatch} />
              {inherited.word}
              {inherited.also ? (
                <span className="insp-chip-also" data-testid={`insp-chip-also-${name}`}>
                  {` · ${inherited.also}`}
                </span>
              ) : null}
            </>
          ) : (
            <>
              {value ? <SW css={swatchFor(value)} /> : null}
              {value ? (
                isToken ? (
                  <b>{tokenWord(value.paint)}</b>
                ) : (
                  // V2-8.5 C2 — a resolved colour is said in words ("Ink", "White"), not `rgb(20, 24, 31)`
                  (colourWords(value.paint.css, colors, vals) ?? value.paint.css)
                )
              ) : (
                noneLabel
              )}
              {offSystem ? (
                <i
                  className="insp-chip-off"
                  role="img"
                  title="Not in the system"
                  aria-label="not in the system"
                  data-testid={`insp-chip-off-${name}`}
                />
              ) : null}
            </>
          )}
        </span>
        <StIcon name="chevron-down" size={10} />
      </button>
      {showOpacity && value ? (
        <span className="insp-opacity" data-testid={`insp-opacity-${name}`}>
          {/* the row's label ("Fill") names the colour, not its opacity: this field is grabbed by its own icon */}
          <ScrubLabelContext.Provider value={null}>
            <NumberField
              value={opacity}
              min={0}
              max={100}
              steppers={false}
              scrub={!disabled}
              lead={<Droplet size={12} />}
              {...(opacityLive || {})}
              className="insp-nf"
              ariaLabel={`${label} opacity`}
              format={(n) => `${n} %`}
              parse={(raw) => Number.parseFloat(String(raw).replace('%', ''))}
              onCommit={(n) => n !== opacity && onChange({ paint: value.paint, opacity: n })}
            />
          </ScrubLabelContext.Provider>
        </span>
      ) : null}
      {open && !disabled ? (
        <ColourPopover
          name={name}
          label={label}
          current={isToken ? value.paint.token : null}
          colors={colors}
          vals={vals}
          themes={themes}
          hasSystem={hasSystem}
          systemLabel={activeDsNameFor(ctx?.canvasFile, ctx?.cfg) || undefined}
          dsName={activeDsNameFor(ctx?.canvasFile, ctx?.cfg)}
          slotGroup={slotGroup}
          recent={recent}
          allowNone={allowNone}
          noneLabel={noneLabel}
          isNone={value == null}
          value={value && !inherited ? value : null}
          showOpacity={showOpacity}
          canvasFile={ctx?.canvasFile ?? null}
          designRel={(ctx?.cfg?.designRel || ctx?.cfg?.designRoot || '.design').replace(
            /^\/+|\/+$/g,
            ''
          )}
          fillApi={fillApi}
          anchorRef={chipRef}
          onPick={pick}
          onCustom={custom}
          onNone={() => {
            setOpen(false);
            onChange(null);
          }}
          onClose={close}
        />
      ) : null}
    </span>
  );
}
