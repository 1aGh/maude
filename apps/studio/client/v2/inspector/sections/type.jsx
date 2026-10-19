// client/v2/inspector/sections/type.jsx — S2.4: Type (14 Editing, ed-inspector §8).
// "For the text inside. The style first; size and weight override it, with a dot."
//
// Size, weight and colour of the text inside the object. The style picker ("Aa Plakát") and the override dot belong to
// S2.12 (text styles); this body is what writes the three declarations. Several objects show the section only when every
// one is text, and say Mixed where they differ.

import { useMemo } from 'react';
import {
  reduceMixed,
  systemName,
  typeFromCss,
  typeToCss,
} from '../../../../edit-ops/words-paint.ts';
import { roleName } from '../../../../edit-ops/text-style.ts';
import { Select } from '../../../inspector-controls.jsx';
import { useCssWrite } from '../css-write.js';
import { isAllText, targetOf } from '../kinds/multi.jsx';
import { registerSlot } from '../slots.js';
import { LengthControl, useDsFamilies } from '../token-chip.jsx';
import { ColorControl } from './color-control.jsx';
import { Quiet, Row } from './row.jsx';

const WEIGHTS = [
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
];
const typeLabel = (token) => systemName(token, 'type');

function ColourRow({ colour, colors, editable, set }) {
  return (
    <Row k="Colour" name="type-colour">
      <ColorControl
        name="type-colour"
        label="Text colour"
        value={colour.mixed ? null : colour.value}
        mixed={colour.mixed ? colour.values : null}
        colors={colors}
        allowNone
        noneLabel="Inherited"
        disabled={!editable}
        onChange={(c) => set({ color: c })}
      />
    </Row>
  );
}

/** A text's Colour sits after its paragraph rows (Font · Size · Line · Align first, as 14 Editing draws it). */
function TextColourBody({ el, ctx }) {
  const { cssAll, editable, write } = useCssWrite(el, ctx);
  const fam = useDsFamilies(ctx);
  const tokens = useMemo(() => ({ space: fam.type }), [fam.type]);
  const colour = reduceMixed(cssAll.map((c) => typeFromCss(c, tokens).color));
  return (
    <ColourRow
      colour={colour}
      colors={fam.color}
      editable={editable}
      set={(patch) => editable && write(typeToCss(patch))}
    />
  );
}

export function TypeBody({ el, selection, kind, ctx }) {
  const { cssAll, editable, write } = useCssWrite(targetOf({ el, selection, kind }), ctx);
  const fam = useDsFamilies(ctx);
  const tokens = useMemo(() => ({ space: fam.type }), [fam.type]);

  const all = cssAll.map((c) => typeFromCss(c, tokens));
  const size = reduceMixed(all.map((t) => t.size));
  const weight = reduceMixed(all.map((t) => t.weight));
  const colour = reduceMixed(all.map((t) => t.color));
  const set = (patch) => editable && write(typeToCss(patch));

  const w = weight.mixed ? 'mixed' : String(weight.value ?? '');
  const weightOptions = [
    ...(weight.mixed ? [{ value: 'mixed', label: 'Mixed' }] : []),
    { value: '', label: 'Inherited' },
    ...(w && w !== 'mixed' && !WEIGHTS.some((o) => o.value === w) ? [{ value: w, label: w }] : []),
    ...WEIGHTS,
  ];

  // S2.12: a text that wears a style says where its size and weight come from, and wears a dot when it
  // sets either over the style's
  const info = el?.textInfo;
  const styled = kind !== 'multi' && !!info?.role;
  const sizeMod = styled && info.differs.some((p) => p === 'font-size' || p === 'font-weight');

  return (
    <>
      <Row k="Size · weight" name="type-size" mod={sizeMod}>
        <LengthControl
          name="font-size"
          label="Text size"
          value={size.mixed ? null : size.value}
          tokens={tokens}
          labelOf={typeLabel}
          allowNone
          noneLabel={size.mixed ? 'Mixed' : 'Inherited'}
          min={1}
          disabled={!editable}
          onChange={(len) => set({ size: len })}
        />
        <Select
          value={w}
          options={weightOptions}
          ariaLabel="Weight"
          testId="insp-weight"
          mini
          onChange={(v) => v !== 'mixed' && set({ weight: v ? Number.parseInt(v, 10) : null })}
        />
        {styled && !sizeMod ? (
          <span
            className="insp-from"
            data-testid="insp-type-from"
          >{`from ${roleName(info.role)}`}</span>
        ) : null}
      </Row>
      {kind === 'text' ? null : (
        <ColourRow colour={colour} colors={fam.color} editable={editable} set={set} />
      )}
      {!editable ? (
        <Quiet testid="insp-type-locked">
          This object has no id yet. Edit element id… gives it one.
        </Quiet>
      ) : null}
    </>
  );
}

/** Text, or a container whose text inherits (a button, a frame, an instance). Several objects: only all-text. */
export const TYPE_KINDS = ['text', 'button', 'frame', 'instance', 'multi'];

const offTypeSlots = [
  registerSlot('type', {
    id: 'type.words',
    order: 10,
    kinds: TYPE_KINDS,
    when: ({ selection, kind }) => kind !== 'multi' || isAllText(selection),
    Body: TypeBody,
  }),
  registerSlot('type', { id: 'type.colour', order: 16, kinds: ['text'], Body: TextColourBody }),
];
export const offType = () => {
  for (const off of offTypeSlots) off();
};
