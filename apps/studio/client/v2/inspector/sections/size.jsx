// client/v2/inspector/sections/size.jsx — S2.3: Size (14 Editing, ed-inspector §2).
// "Hug wraps the content, Fill takes the room the frame gives, Fixed is a number." Width and Height each pick
// a word; Clip content is overflow. Writes go through the words → CSS writer and the existing /_api/edit-css.

import { axisToCss, toWords } from '../../../../edit-ops/words-css.ts';
import { NumberField, Select, Toggle } from '../../../inspector-controls.jsx';
import { useCssWrite } from '../css-write.js';
import { registerSlot } from '../slots.js';
import { Quiet, Row, worldSize } from './row.jsx';

const MODES = [
  { value: 'hug', label: 'Hug' },
  { value: 'fill', label: 'Fill' },
  { value: 'fixed', label: 'Fixed' },
];

function Axis({ axis, words, world, parent, write, editable }) {
  const label = axis === 'width' ? 'Width' : 'Height';
  const w = words[axis];
  const shown = w.mode === 'fixed' ? (w.px ?? world[axis]) : world[axis];
  return (
    <Row k={label} name={axis}>
      <span className="insp-pair">
        <span data-testid={`insp-num-${axis}`} data-quiet={w.mode === 'fixed' ? undefined : 'true'}>
          <NumberField
            value={shown}
            min={0}
            ariaLabel={label}
            steppers={false}
            scrub={false}
            className="insp-nf"
            onCommit={(n) =>
              editable && n !== shown && write(axisToCss(axis, { mode: 'fixed', px: n }, parent))
            }
          />
        </span>
        <Select
          value={w.mode}
          options={MODES}
          ariaLabel={`${label} sizing`}
          testId={`insp-mode-${axis}`}
          mini
          onChange={(mode) =>
            editable &&
            write(axisToCss(axis, mode === 'fixed' ? { mode, px: world[axis] } : { mode }, parent))
          }
        />
      </span>
    </Row>
  );
}

export function SizeBody({ el, ctx }) {
  const { css, editable, parent, write } = useCssWrite(el, ctx);
  const words = toWords(css, { parent }).size;
  const world = worldSize(el);
  return (
    <>
      <Axis
        axis="width"
        words={words}
        world={world}
        parent={parent}
        write={write}
        editable={editable}
      />
      <Axis
        axis="height"
        words={words}
        world={world}
        parent={parent}
        write={write}
        editable={editable}
      />
      <Row k="Clip content" name="clip">
        <span data-testid="insp-ctl-clip">
          <Toggle
            checked={words.clip}
            ariaLabel="Clip content"
            onChange={(on) => editable && write({ overflow: on ? 'hidden' : null })}
          />
        </span>
      </Row>
      {!editable ? (
        <Quiet testid="insp-size-locked">
          This object has no id yet. Edit element id… gives it one.
        </Quiet>
      ) : null}
    </>
  );
}

/** Every kind but an artboard (its own editor) and a multi-selection (S2.4's Mixed reducer). */
export const BOXY_KINDS = ['frame', 'button', 'text', 'image', 'shape', 'path', 'instance'];

export const offSize = registerSlot('size', {
  id: 'size.words',
  order: 10,
  kinds: BOXY_KINDS,
  Body: SizeBody,
});
