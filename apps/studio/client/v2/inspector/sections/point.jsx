// client/v2/inspector/sections/point.jsx — the Point card of a Pen path (14 Editing, ed-pen).
//   Corner   Smooth · Sharp   the selected point's kind; one click turns it (the Pen's own double-click, `toggled`)
//   X · Y    the point's place in its frame, in px; typing moves the point and its handles with it
// Drawn while the path is in point editing and a point is selected (the canvas says so on the payload); one write
// per change (`path.edit`), one undo step. Nothing is drawn when the canvas's markup is cut off: it never guesses.

import { useState } from 'react';
import { NumberField, IconButtonGroup } from '../../../inspector-controls.jsx';
import { pointOf, withCorner, withPosition, writePath } from '../path-point.js';
import { Quiet, Row } from './row.jsx';

/** 14 Editing's `pt-smooth` / `pt-sharp`: a point on a curve, a point on a corner (16-unit box, 1.5 stroke). */
const GLYPH = {
  smooth: <path d="M2 12C5 4 11 4 14 12" />,
  sharp: <path d="M2 12L8 4l6 8" />,
};
const Glyph = ({ name }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {GLYPH[name]}
    <rect x="6.6" y={name === 'smooth' ? 4.6 : 2.6} width="2.8" height="2.8" fill="currentColor" stroke="none" />
  </svg>
);

const KINDS = [
  { value: 'smooth', label: 'Smooth', node: <Glyph name="smooth" /> },
  { value: 'sharp', label: 'Sharp', node: <Glyph name="sharp" /> },
];

export function PointBody({ el, ctx }) {
  const info = pointOf(el);
  const [said, setSaid] = useState('');
  if (!info) return null;
  const canvas = ctx?.canvasFile ?? el?.file ?? null;
  const live = ctx?.editable !== false && !!canvas;

  const send = async (model, label) => {
    if (!live || !model) return;
    setSaid('');
    const r = await writePath({ canvas, el, model });
    if (!r.ok) return setSaid(r.message);
    if (!r.actionId && r.writeId) ctx?.onRecordEdit?.({ op: 'edit-op', writeId: r.writeId, label });
  };

  return (
    <>
      <Row k="Corner" name="point-corner">
        <span data-testid="insp-point-corner">
          <IconButtonGroup
            value={info.kind}
            options={KINDS}
            ariaLabel="Corner"
            onChange={(kind) => send(withCorner(el, kind), 'Edit path')}
          />
        </span>
      </Row>
      <Row k="X · Y" name="point-xy">
        <span className="insp-pair">
          <span data-testid="insp-point-x">
            <NumberField
              value={info.x}
              ariaLabel="X"
              lead="X"
              scrub={false}
              steppers={false}
              className="insp-nf"
              onCommit={(n) => send(withPosition(el, { x: n }), 'Move point')}
            />
          </span>
          <span data-testid="insp-point-y">
            <NumberField
              value={info.y}
              ariaLabel="Y"
              lead="Y"
              scrub={false}
              steppers={false}
              className="insp-nf"
              onCommit={(n) => send(withPosition(el, { y: n }), 'Move point')}
            />
          </span>
        </span>
      </Row>
      {said ? <Quiet testid="insp-point-said">{said}</Quiet> : null}
    </>
  );
}
