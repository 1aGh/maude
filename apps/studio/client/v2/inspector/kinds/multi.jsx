// client/v2/inspector/kinds/multi.jsx — S2.4: several objects at once (14 Editing, ed-obj-multi).
//
//   "The inspector shows what they share and says Mixed where they differ."
//   · a row shows the shared value, or "Mixed" (swatches for colours) — `reduceMixed` in edit-ops/words-paint.ts;
//   · one edit goes to every selected object (`useCssWrite` takes the whole selection) — the line says so;
//   · text settings show only when every object is text.
//
// This file owns the helpers every section uses to ask "what am I editing?" and the things only the Mixed inspector
// draws: Position and Size with "Mixed" where the objects differ (S2.23 G2, 14 Editing ed-obj-multi), the Opacity row
// (under Fill — for one object it sits under Effects) and the line at the foot.

import { RotateCw } from 'lucide-react';
import { axisToCss, positionToCss, toWords } from '../../../../edit-ops/words-css.ts';
import { reduceMixed } from '../../../../edit-ops/words-paint.ts';
import { NumberField, Select } from '../../../inspector-controls.jsx';
import { registerSlot } from '../slots.js';
import { Quiet, Row, effectiveCss, worldSize } from '../sections/row.jsx';
import { OpacityRow } from '../sections/opacity-row.jsx';
import { useCssWrite } from '../css-write.js';
import { resolveKind } from './index.js';

/** What a section edits: the whole selection when it is several objects, else the one element. */
export const targetOf = ({ el, selection, kind }) =>
  kind === 'multi' && Array.isArray(selection) ? selection : el;

/** Every selected object is text (a one-element array counts). */
export function isAllText(selection) {
  const list = Array.isArray(selection) ? selection : selection ? [selection] : [];
  return list.length > 0 && list.every((e) => resolveKind(e).id === 'text');
}

function MultiOpacity({ el, selection, kind, ctx }) {
  const { cssAll, editable, write, count } = useCssWrite(targetOf({ el, selection, kind }), ctx);
  return (
    <>
      <OpacityRow cssAll={cssAll} editable={editable} write={write} />
      <Quiet testid="insp-multi-note">
        {`Changes go to all ${count}. Text settings show when only text is selected.`}
      </Quiet>
    </>
  );
}

const PLACED = new Set(['absolute', 'relative', 'fixed', 'sticky']);
const MODES = [
  { value: 'hug', label: 'Hug' },
  { value: 'fill', label: 'Fill' },
  { value: 'fixed', label: 'Fixed' },
];

/** "Mixed" beside a quiet field (the Opacity row's pattern): the objects differ, typing a number sets all of them. */
const Mixed = ({ testid }) => (
  <span className="insp-mixed" data-testid={testid}>
    Mixed
  </span>
);

function MultiPosition({ el, selection, kind, ctx }) {
  const targets = targetOf({ el, selection, kind });
  const { cssAll, editable, write } = useCssWrite(targets, ctx);
  const list = Array.isArray(targets) ? targets : [];
  const words = list.map(
    (t, i) => toWords(cssAll[i] ?? {}, { geometry: t?.geometry ?? null }).position
  );
  const placed =
    list.length > 0 &&
    list.every((t, i) => PLACED.has((effectiveCss(t, cssAll[i]).position || '').trim()));
  const x = reduceMixed(words.map((w) => w.x ?? 0));
  const y = reduceMixed(words.map((w) => w.y ?? 0));
  const rot = reduceMixed(words.map((w) => w.rotation ?? 0));
  const ctxw = { geometry: list[0]?.geometry ?? null, transform: cssAll[0]?.transform };
  // one value for every object: each field writes only the declarations it owns, like the single-object Position
  const set = (patch, keys) =>
    editable &&
    write(
      Object.fromEntries(
        Object.entries(positionToCss({ ...words[0], ...patch }, ctxw)).filter(([k]) =>
          keys.includes(k)
        )
      )
    );
  const quiet = (r) => (r.mixed ? 'true' : undefined);
  return (
    <>
      <Row k="X · Y" name="xy" dim={!placed}>
        <span className="insp-pair">
          {x.mixed ? <Mixed testid="insp-mixed-x" /> : null}
          <span data-testid="insp-num-x" data-quiet={quiet(x)}>
            <NumberField
              value={x.mixed ? 0 : (x.value ?? 0)}
              ariaLabel="X"
              lead="X"
              scrub={false}
              steppers={false}
              className="insp-nf"
              onCommit={(n) =>
                placed && (x.mixed || n !== x.value) && set({ x: n }, ['left', 'right'])
              }
            />
          </span>
          {y.mixed ? <Mixed testid="insp-mixed-y" /> : null}
          <span data-testid="insp-num-y" data-quiet={quiet(y)}>
            <NumberField
              value={y.mixed ? 0 : (y.value ?? 0)}
              ariaLabel="Y"
              lead="Y"
              scrub={false}
              steppers={false}
              className="insp-nf"
              onCommit={(n) =>
                placed && (y.mixed || n !== y.value) && set({ y: n }, ['top', 'bottom'])
              }
            />
          </span>
        </span>
      </Row>
      <Row k="Rotation" name="rotation">
        <span className="insp-pair">
          {rot.mixed ? <Mixed testid="insp-mixed-rotation" /> : null}
          <span data-testid="insp-num-rotation" data-quiet={quiet(rot)}>
            <NumberField
              value={rot.mixed ? 0 : (rot.value ?? 0)}
              ariaLabel="Rotation"
              lead={<RotateCw size={12} />}
              step={1}
              scrub={false}
              steppers={false}
              className="insp-nf"
              format={(n) => `${Math.round(n * 100) / 100}°`}
              parse={(raw) => Number.parseFloat(String(raw).replace('°', ''))}
              onCommit={(n) =>
                (rot.mixed || n !== rot.value) && set({ rotation: n }, ['transform'])
              }
            />
          </span>
        </span>
      </Row>
    </>
  );
}

function MultiSize({ el, selection, kind, ctx }) {
  const targets = targetOf({ el, selection, kind });
  const { cssAll, editable, parent, write } = useCssWrite(targets, ctx);
  const list = Array.isArray(targets) ? targets : [];
  const widths = reduceMixed(list.map((t) => worldSize(t).width));
  const modes = reduceMixed(
    list.map(
      (t, i) =>
        toWords(cssAll[i] ?? {}, {
          parent: { display: t?.parentDisplay, flexDirection: t?.parentFlexDirection },
        }).size.width.mode
    )
  );
  const mode = modes.mixed ? 'fixed' : modes.value;
  const shown = widths.mixed ? 0 : widths.value;
  return (
    <Row k="Width" name="width">
      <span className="insp-pair">
        {widths.mixed ? <Mixed testid="insp-mixed-width" /> : null}
        <span
          data-testid="insp-num-width"
          data-quiet={widths.mixed || mode !== 'fixed' ? 'true' : undefined}
        >
          <NumberField
            value={shown}
            min={0}
            ariaLabel="Width"
            steppers={false}
            scrub={false}
            className="insp-nf"
            onCommit={(n) =>
              editable &&
              (widths.mixed || n !== shown) &&
              write(axisToCss('width', { mode: 'fixed', px: n }, parent))
            }
          />
        </span>
        <Select
          value={mode}
          options={MODES}
          ariaLabel="Width sizing"
          testId="insp-mode-width"
          mini
          onChange={(m) =>
            editable &&
            write(
              axisToCss(
                'width',
                m === 'fixed'
                  ? { mode: m, px: widths.mixed ? worldSize(list[0]).width : shown }
                  : { mode: m },
                parent
              )
            )
          }
        />
      </span>
    </Row>
  );
}

const offs = [
  registerSlot('position', {
    id: 'position.multi',
    order: 10,
    kinds: ['multi'],
    Body: MultiPosition,
  }),
  registerSlot('size', { id: 'size.multi', order: 10, kinds: ['multi'], Body: MultiSize }),
  registerSlot('fill', { id: 'fill.multi', order: 90, kinds: ['multi'], Body: MultiOpacity }),
];
export const offMulti = () => {
  for (const off of offs) off();
};
