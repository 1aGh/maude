// client/v2/inspector/sections/position.jsx — S2.3: Position (14 Editing, ed-inspector §1 and ed-lay-free).
// "Where it sits inside its frame. Constraints say which edges it keeps when the frame grows."
//
// X and Y are enabled where the object is placed (position absolute / relative …); an object inside auto layout is
// placed by its frame, and says so. Rotation keeps the rest of the transform. Constraints pin edges; converting
// from one pin to another needs the object's distances to the frame's edges, which the canvas reports as
// `el.geometry` ({ x, y, w, h, parentW, parentH } in world px) — until it does, the pins read but do not write.
//
// S2.11b: a pin is ONE `object.constrain` edit-op, asked of the canvas through `run-action` (`ctx.onRunAction`)
// with the pins and the measured box — all four edges in one write, one undo step ("64 from the corner"). A
// canvas bundle that does not report `refs` (an old one) has no such action; there the pins keep writing the
// CSS declarations through /_api/edit-css, exactly as before.

import { RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { constraintsToCss, positionToCss, toWords } from '../../../../edit-ops/words-css.ts';
import { NumberField, Select } from '../../../inspector-controls.jsx';
import { useCssWrite } from '../css-write.js';
import { registerSlot } from '../slots.js';
import { sitsInLayout } from '../kinds/frame.jsx';
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

/**
 * 14 ed-lay-free: the card says what a free frame is and what the pins keep —
 * "Post places things freely — no auto layout. Constraints keep Datum 64 from the top-right corner."
 * `read` is the object's effective CSS (`right`, `top`…). Nothing when the frame is unknown or the pins are not
 * one horizontal edge + one vertical edge with a number each.
 */
export function freeLine(parent, name, pins, read) {
  if (!parent) return '';
  const head = `${parent} places things freely — no auto layout.`;
  const h = pins.left !== pins.right ? (pins.right ? 'right' : 'left') : null;
  const v = pins.top !== pins.bottom ? (pins.bottom ? 'bottom' : 'top') : null;
  const px = (k) => {
    const m = /^(-?\d*\.?\d+)(px)?$/.exec(String(read?.[k] ?? '').trim());
    return m ? Math.round(Number.parseFloat(m[1])) : null;
  };
  const dh = h ? px(h) : null;
  const dv = v ? px(v) : null;
  if (!h || !v || dh == null || dv == null) return head;
  const who = name || 'It';
  return dh === dv
    ? `${head} Constraints keep ${who} ${dh} from the ${v}-${h} corner.`
    : `${head} Constraints keep ${who} ${dh} from the ${h} and ${dv} from the ${v}.`;
}

/** The shell → canvas message for one pin change: the canvas runs `object.constrain` (editing/layout-actions.ts). */
export function constrainMessage(ref, pins, geometry) {
  return {
    dgn: 'run-action',
    v: 1,
    id: 'object.constrain',
    params: { targets: [ref], h: pins.h, v: pins.v, geometry },
  };
}

export function PositionBody({ el, ctx }) {
  const { css, editable, write } = useCssWrite(el, ctx);
  const read = effectiveCss(el, css);
  const placed = PLACED.has((read.position || '').trim());
  const geometry = el?.geometry ?? null;
  const words = toWords(css, { geometry }).position;
  // the pins just asked for, shown until the canvas re-posts the file as it is now
  const [asked, setAsked] = useState(null);
  const fresh = `${el?.id ?? ''}#${el?.index ?? 0}~${JSON.stringify(el?.authored ?? null)}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear on a fresh selection payload only
  useEffect(() => setAsked(null), [fresh]);
  const c = asked ?? words.constraints ?? { h: 'left', v: 'top' };
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
    const ref = Array.isArray(el?.refs) ? el.refs[0] : null;
    if (ctx?.onRunAction && ref) {
      setAsked({ h: next.h, v: next.v });
      ctx.onRunAction(constrainMessage(ref, next, geometry));
      return;
    }
    write(constraintsToCss(next, geometry));
  };
  const toggle = (edge) => {
    const p = pinsOf(c);
    p[edge] = !p[edge];
    const h = p.left && p.right ? 'both' : p.right ? 'right' : p.left ? 'left' : 'center';
    const v = p.top && p.bottom ? 'both' : p.bottom ? 'bottom' : p.top ? 'top' : 'center';
    setPin({ h, v });
  };

  // V2-8.5 c6 (14 ed-obj-enter): an object its frame lays out has no X · Y of its own. The card says who places it
  // ("In Services — Set by Services · 2 of 3"); Place freely (kinds/frame.jsx) is the one way to make them its own.
  if (!placed && sitsInLayout(el, read)) {
    const where = ctx?.placement;
    const frame = where?.parent || null;
    const nth = where?.index && where?.count ? ` · ${where.index} of ${where.count}` : '';
    return (
      <Row k={frame ? `In ${frame}` : 'In layout'} name="in-layout">
        <span className="insp-from" data-testid="insp-in-layout">
          {`Set by ${frame || 'its frame'}${nth}`}
        </span>
      </Row>
    );
  }

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
          {freeLine(ctx?.placement?.parent, ctx?.title, pinsOf(c), read) ? (
            <Quiet line testid="insp-position-free">
              {freeLine(ctx?.placement?.parent, ctx?.title, pinsOf(c), read)}
            </Quiet>
          ) : null}
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
