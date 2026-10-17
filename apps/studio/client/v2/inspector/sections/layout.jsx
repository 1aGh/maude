// client/v2/inspector/sections/layout.jsx — S2.3: Layout (14 Editing, ed-inspector §3 and ed-lay-auto).
// "Auto layout: direction, gap, spacing (Packed or Space between), padding H and V, alignment. Values come from
// the system's space; a number that isn't in it shows plainly with Bind."
//
// Each control writes only the declarations it owns (a direction change never touches padding, an alignment
// change never touches display), through the words → CSS writer.

import { ArrowDown, ArrowRight, LayoutGrid, Move, Scan } from 'lucide-react';
import { useState } from 'react';
import { layoutToCss, lengthToCss, toWords } from '../../../../edit-ops/words-css.ts';
import { AlignPad, IconButtonGroup, Segmented } from '../../../inspector-controls.jsx';
import { useCssWrite } from '../css-write.js';
import { registerSlot } from '../slots.js';
import { LengthControl, useSpaceTokens } from '../token-chip.jsx';
import { Quiet, Row, effectiveCss } from './row.jsx';

const DIRECTIONS = [
  { value: 'row', label: 'Row', node: <ArrowRight size={14} /> },
  { value: 'column', label: 'Column', node: <ArrowDown size={14} /> },
  { value: 'grid', label: 'Grid', node: <LayoutGrid size={14} /> },
  { value: 'free', label: 'Free', node: <Move size={14} /> },
];

const OWNS = {
  direction: ['display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items'],
  gap: ['gap'],
  spacing: ['justify-content'],
  align: ['justify-content', 'align-items'],
  padding: ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
};
const only = (patch, keys) =>
  Object.fromEntries(Object.entries(patch).filter(([k]) => keys.includes(k)));

const ROWS = ['t', 'c', 'b'];
const COLS = ['l', 'c', 'r'];
const POS = ['start', 'center', 'end'];
const cellOf = (align) => {
  const idx = (v) => (v === 'stretch' ? 1 : POS.indexOf(v));
  return ROWS[idx(align.v)] + COLS[idx(align.h)];
};

const sameLength = (a, b) => lengthToCss(a) === lengthToCss(b);
const SIDES = [
  ['top', 'Top'],
  ['right', 'Right'],
  ['bottom', 'Bottom'],
  ['left', 'Left'],
];

export function LayoutBody({ el, ctx }) {
  const { css, editable, write } = useCssWrite(el, ctx);
  const tokens = useSpaceTokens(ctx);
  const [sides, setSides] = useState(false);
  const read = effectiveCss(el, css);
  // a gap the file does not author but the browser resolved (a class) reads as the number it is
  const gapComputed = el?.computed?.gap;
  const words = toWords(
    gapComputed && !read.gap && gapComputed !== 'normal' && gapComputed !== '0px'
      ? { ...read, gap: gapComputed }
      : read,
    { tokens }
  ).layout;
  const inline = /^inline-/.test(read.display || '');
  const flexy = words.direction === 'row' || words.direction === 'column';
  const set = (key, next) => {
    if (!editable) return;
    // a flex direction only changes display and flex-direction; leaving flex also clears the flex-only declarations
    const keys =
      key === 'direction' && (next.direction === 'row' || next.direction === 'column')
        ? ['display', 'flex-direction']
        : OWNS[key];
    write(only(layoutToCss(next, { inline, tokens }), keys));
  };
  const pad = words.padding;
  const hMixed = !sameLength(pad.left, pad.right);
  const vMixed = !sameLength(pad.top, pad.bottom);
  const setPad = (patch) => set('padding', { ...words, padding: { ...pad, ...patch } });

  return (
    <>
      <Row k="Direction" name="direction">
        <span data-testid="insp-ctl-direction">
          <IconButtonGroup
            value={words.direction}
            options={DIRECTIONS}
            ariaLabel="Direction"
            onChange={(direction) => set('direction', { ...words, direction })}
          />
        </span>
      </Row>
      {flexy || words.direction === 'grid' ? (
        <Row k="Gap" name="gap">
          <LengthControl
            name="gap"
            label="Gap"
            value={words.spacing === 'between' && flexy ? null : words.gap}
            tokens={tokens}
            allowNone
            noneLabel={words.spacing === 'between' && flexy ? 'Auto' : 'None'}
            onChange={(gap) => {
              if (words.spacing === 'between') set('spacing', { ...words, spacing: 'packed' });
              set('gap', { ...words, gap });
            }}
            extraItems={
              flexy
                ? [
                    {
                      id: 'auto',
                      label: 'Auto — space between',
                      onSelect: () => set('spacing', { ...words, spacing: 'between' }),
                    },
                  ]
                : []
            }
            disabled={!editable}
          />
        </Row>
      ) : null}
      {flexy ? (
        <Row k="Spacing" name="spacing">
          <span data-testid="insp-ctl-spacing">
            <Segmented
              value={words.spacing}
              ariaLabel="Spacing"
              options={[
                { value: 'packed', label: 'Packed' },
                { value: 'between', label: 'Space between' },
              ]}
              onChange={(spacing) => set('spacing', { ...words, spacing })}
            />
          </span>
        </Row>
      ) : null}
      <Row k="Padding" name="padding">
        <span className="insp-pad">
          <span className="insp-ax">H</span>
          {hMixed ? (
            <span className="insp-mixed" data-testid="insp-mixed-h">
              Mixed
            </span>
          ) : (
            <LengthControl
              name="pad-h"
              label="Padding horizontal"
              value={pad.left}
              tokens={tokens}
              disabled={!editable}
              onChange={(l) => setPad({ left: l, right: l })}
            />
          )}
          <span className="insp-ax">V</span>
          {vMixed ? (
            <span className="insp-mixed" data-testid="insp-mixed-v">
              Mixed
            </span>
          ) : (
            <LengthControl
              name="pad-v"
              label="Padding vertical"
              value={pad.top}
              tokens={tokens}
              disabled={!editable}
              onChange={(l) => setPad({ top: l, bottom: l })}
            />
          )}
          <button
            type="button"
            className="insp-sides"
            data-testid="insp-sides"
            aria-pressed={sides || hMixed || vMixed}
            aria-label="Padding per side"
            title="Padding per side"
            onClick={() => setSides((s) => !s)}
          >
            <Scan size={12} />
          </button>
        </span>
      </Row>
      {sides || hMixed || vMixed
        ? SIDES.map(([side, label]) => (
            <Row k={label} name={`pad-${side}`} key={side}>
              <LengthControl
                name={`pad-${side}`}
                label={`Padding ${label.toLowerCase()}`}
                value={pad[side]}
                tokens={tokens}
                disabled={!editable}
                onChange={(l) => setPad({ [side]: l })}
              />
            </Row>
          ))
        : null}
      {flexy ? (
        <Row k="Align" name="align">
          <span data-testid="insp-ctl-align">
            <AlignPad
              value={cellOf(words.align)}
              ariaLabel="Align"
              onChange={(cell) => {
                const h = POS[COLS.indexOf(cell[1])];
                const v = POS[ROWS.indexOf(cell[0])];
                // with Space between the main axis is the spacing's: only the cross axis moves
                const keepMain = words.spacing === 'between';
                const align =
                  words.direction === 'row'
                    ? { h: keepMain ? 'start' : h, v }
                    : { h, v: keepMain ? 'start' : v };
                set('align', { ...words, align });
              }}
            />
          </span>
        </Row>
      ) : null}
      {!editable ? (
        <Quiet testid="insp-layout-locked">
          This object has no id yet. Edit element id… gives it one.
        </Quiet>
      ) : null}
    </>
  );
}

/** Containers: a frame, a button, an instance. Text and images lay nothing out. */
export const LAYOUT_KINDS = ['frame', 'button', 'instance'];

export const offLayout = registerSlot('layout', {
  id: 'layout.words',
  order: 10,
  kinds: LAYOUT_KINDS,
  Body: LayoutBody,
});
