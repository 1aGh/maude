// client/v2/inspector/sections/position.jsx — S2.3: Position (14 Editing, ed-inspector §1 and ed-lay-free).
// "Where it sits inside its frame. Constraints say which edges it keeps when the frame grows."
//
// X and Y are enabled where the object is placed (position absolute / relative …); an object inside auto layout is
// placed by its frame, and says so. Rotation keeps the rest of the transform. Constraints pin edges; converting
// from one pin to another needs the object's distances to the frame's edges, which the canvas reports as
// `el.geometry` ({ x, y, w, h, parentW, parentH } in world px) — until it does, the pins read but do not write.

import { RotateCw } from 'lucide-react';
import { constraintsToCss, positionToCss, toWords } from '../../../../edit-ops/words-css.ts';
import { NumberField, Select } from '../../../inspector-controls.jsx';
import { useCssWrite } from '../css-write.js';
import { registerSlot } from '../slots.js';
import { BOXY_KINDS } from './size.jsx';
import { Quiet, Row, effectiveCss } from './row.jsx';

const PLACED = new Set(['absolute', 'relative', 'fixed', 'sticky']);
const H_OPTS = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'both', label: 'Left & Right' },
  { value: 'center', label: 'Center' },
  { value: 'scale', label: 'Scale' },
];
const V_OPTS = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'both', label: 'Top & Bottom' },
  { value: 'center', label: 'Center' },
  { value: 'scale', label: 'Scale' },
];

/** The four pins as a picture: which edges the object keeps (14 Editing, `Cons`). Click an edge to toggle it. */
function Pins({ pins, onToggle, disabled }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: an inline picture of four edge toggles inside a row, not a form group
    <span className="insp-cons" data-testid="insp-cons" role="group" aria-label="Pinned edges">
      <i className="insp-cons-in" />
      {['top', 'right', 'bottom', 'left'].map((edge) => (
        <button
          key={edge}
          type="button"
          className={`insp-cons-p insp-cons-p--${edge}`}
          data-on={pins[edge] ? 'true' : undefined}
          aria-pressed={!!pins[edge]}
          aria-label={`Pin ${edge}`}
          disabled={disabled}
          onClick={() => onToggle(edge)}
        />
      ))}
    </span>
  );
}

const pinsOf = (c) => ({
  left: c.h === 'left' || c.h === 'both' || c.h === 'scale',
  right: c.h === 'right' || c.h === 'both',
  top: c.v === 'top' || c.v === 'both' || c.v === 'scale',
  bottom: c.v === 'bottom' || c.v === 'both',
});

export function PositionBody({ el, ctx }) {
  const { css, editable, write } = useCssWrite(el, ctx);
  const read = effectiveCss(el, css);
  const placed = PLACED.has((read.position || '').trim());
  const geometry = el?.geometry ?? null;
  const words = toWords(css, { geometry }).position;
  const c = words.constraints ?? { h: 'left', v: 'top' };
  const free = placed && ['absolute', 'fixed'].includes((read.position || '').trim());
  const ctxw = { geometry, transform: css.transform };
  // each field writes only the declarations it owns: X the left/right edges, Y the top/bottom, Rotation the transform
  const setPos = (patch, keys) =>
    editable &&
    write(
      Object.fromEntries(
        Object.entries(positionToCss({ ...words, ...patch }, ctxw)).filter(([k]) =>
          keys.includes(k)
        )
      )
    );
  const setPin = (next) => {
    if (!editable || !geometry) return;
    write(constraintsToCss(next, geometry));
  };
  const toggle = (edge) => {
    const p = pinsOf(c);
    p[edge] = !p[edge];
    const h = p.left && p.right ? 'both' : p.right ? 'right' : p.left ? 'left' : 'center';
    const v = p.top && p.bottom ? 'both' : p.bottom ? 'bottom' : p.top ? 'top' : 'center';
    setPin({ h, v });
  };

  return (
    <>
      <Row k="X · Y" name="xy" dim={!placed}>
        <span className="insp-pair">
          <span
            data-testid="insp-num-x"
            title={placed ? undefined : 'Placed by its frame’s layout'}
          >
            <NumberField
              value={words.x ?? 0}
              ariaLabel="X"
              lead="X"
              scrub={false}
              steppers={false}
              className="insp-nf"
              onCommit={(n) => placed && n !== words.x && setPos({ x: n }, ['left', 'right'])}
            />
          </span>
          <span
            data-testid="insp-num-y"
            title={placed ? undefined : 'Placed by its frame’s layout'}
          >
            <NumberField
              value={words.y ?? 0}
              ariaLabel="Y"
              lead="Y"
              scrub={false}
              steppers={false}
              className="insp-nf"
              onCommit={(n) => placed && n !== words.y && setPos({ y: n }, ['top', 'bottom'])}
            />
          </span>
        </span>
      </Row>
      <Row k="Rotation" name="rotation">
        <span data-testid="insp-num-rotation">
          <NumberField
            value={words.rotation}
            ariaLabel="Rotation"
            lead={<RotateCw size={12} />}
            step={1}
            scrub={false}
            steppers={false}
            className="insp-nf"
            format={(n) => `${Math.round(n * 100) / 100}°`}
            parse={(raw) => Number.parseFloat(String(raw).replace('°', ''))}
            onCommit={(n) => n !== words.rotation && setPos({ rotation: n }, ['transform'])}
          />
        </span>
      </Row>
      {!placed ? (
        <Quiet testid="insp-position-auto">
          It sits where its frame’s layout puts it. Place freely makes X and Y yours.
        </Quiet>
      ) : null}
      {free ? (
        <>
          <p className="insp-sub">Constraints</p>
          <div className="insp-consrow">
            <Pins pins={pinsOf(c)} onToggle={toggle} disabled={!editable || !geometry} />
            <span className="insp-cons-sel">
              <Select
                value={c.h}
                options={H_OPTS}
                ariaLabel="Horizontal constraint"
                testId="insp-pin-h"
                mini
                onChange={(h) => setPin({ ...c, h })}
              />
              <Select
                value={c.v}
                options={V_OPTS}
                ariaLabel="Vertical constraint"
                testId="insp-pin-v"
                mini
                onChange={(v) => setPin({ ...c, v })}
              />
            </span>
          </div>
          {!geometry ? (
            <Quiet testid="insp-pin-unmeasured">
              Pins show what the file says. Select the object again to change them.
            </Quiet>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export const offPosition = registerSlot('position', {
  id: 'position.words',
  order: 10,
  kinds: BOXY_KINDS,
  Body: PositionBody,
});
