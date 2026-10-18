// client/v2/inspector/sections/border.jsx — S2.4: Border (14 Editing, ed-inspector §6 and ed-shape).
// "Empty until you add one with +. Inside, centre or outside. Lines and Pen paths call it Stroke."
//
// A colour token and a width, and where the line sits. Inside is an inset ring (it never changes the object's size);
// Centre and Outside are an outline (edit-ops/words-paint.ts has the table). A border and a shadow share `box-shadow`;
// the writer composes them. On a line or a Pen path the section is "Stroke": a colour and a width, no position.

import { useMemo } from 'react';
import {
  borderFromCss,
  borderToCss,
  isStrokeTag,
  strokeFromCss,
  strokeToCss,
} from '../../../../edit-ops/words-paint.ts';
import { NumberField, Segmented } from '../../../inspector-controls.jsx';
import { useCssWrite } from '../css-write.js';
import { registerSlot } from '../slots.js';
import { useDsFamilies } from '../token-chip.jsx';
import { requestAdd, useAddRequest } from './add-requests.js';
import { ColorControl } from './color-control.jsx';
import { Quiet, Row } from './row.jsx';
import { BOXY_KINDS } from './size.jsx';

const POSITIONS = [
  { value: 'inside', label: 'Inside' },
  { value: 'centre', label: 'Centre' },
  { value: 'outside', label: 'Outside' },
];

/** A line or a Pen path draws a stroke; everything else has a border. */
export const isStroke = ({ el, kind }) =>
  kind === 'path' || kind === 'line' || isStrokeTag(el?.tag);

/** The colour a new border starts as: the system's ink-like token, else its first colour. */
export function defaultLineColour(colors) {
  const pick =
    colors.find((c) => /^--(?:ink|border|line|stroke|fg(?:-0|-1)?)$/.test(c)) ?? colors[0];
  return pick ? { token: pick } : { css: 'currentColor' };
}

export function BorderBody({ el, kind, ctx }) {
  const { css, editable, write } = useCssWrite(el, ctx);
  const fam = useDsFamilies(ctx);
  const stroke = isStroke({ el, kind });
  const border = useMemo(() => (stroke ? null : borderFromCss(css)), [stroke, css]);
  const line = stroke ? strokeFromCss(css) : border;
  const shadow = css['box-shadow'];

  const put = (next) => editable && write(stroke ? strokeToCss(next) : borderToCss(next, shadow));
  useAddRequest('border', el, () => {
    if (!line)
      put({
        color: defaultLineColour(fam.color),
        width: 1,
        ...(stroke ? {} : { position: 'inside' }),
      });
  });

  if (!line) {
    return (
      <Row k={stroke ? 'Stroke' : 'Border'} name="border" dim>
        <span className="ed-none insp-none" data-testid="insp-border-none">
          None
        </span>
      </Row>
    );
  }
  return (
    <>
      <Row k={stroke ? 'Stroke' : 'Border'} name="border">
        <ColorControl
          name="border"
          label={stroke ? 'Stroke colour' : 'Border colour'}
          value={{ paint: line.color, opacity: 100 }}
          colors={fam.color}
          allowNone
          noneLabel="None"
          disabled={!editable}
          onChange={(c) => put(c ? { ...line, color: c.paint } : null)}
        />
        <span data-testid="insp-num-border-width">
          <NumberField
            value={line.width}
            min={0}
            step={0.5}
            steppers={false}
            scrub={false}
            className="insp-nf"
            ariaLabel={stroke ? 'Stroke width' : 'Border width'}
            onCommit={(n) =>
              editable && (n <= 0 ? put(null) : n !== line.width && put({ ...line, width: n }))
            }
          />
        </span>
      </Row>
      {stroke ? null : (
        <Row k="Position" name="border-position">
          <span data-testid="insp-ctl-border-position">
            <Segmented
              value={border.position}
              ariaLabel="Border position"
              options={POSITIONS}
              onChange={(position) =>
                // leaving Inside also leaves a plain `border` for an outline: the object keeps its size
                position !== border.position &&
                put({ ...border, position, via: position === 'inside' ? border.via : undefined })
              }
            />
          </span>
        </Row>
      )}
      {!editable ? (
        <Quiet testid="insp-border-locked">
          This object has no id yet. Edit element id… gives it one.
        </Quiet>
      ) : null}
    </>
  );
}

export const BORDER_KINDS = BOXY_KINDS;

export const offBorder = registerSlot('border', {
  id: 'border.words',
  order: 10,
  kinds: BORDER_KINDS,
  Body: BorderBody,
  title: ({ el, kind }) => (isStroke({ el, kind }) ? 'Stroke' : null),
  add: ({ el }) => requestAdd('border', el),
});
