// client/v2/inspector/kinds/artboard-fixed.jsx — S7.21: the Fixed size artboard's rows (08 ak-social).
//
//   Size            "Story 9:16 (still)" — a preset of the one catalogue (App + Social), or Custom
//   (W × H)         the exact pixels
//
// Fill is artboard.jsx's; Safe zones + Show on canvas are S7.22's section; Export is S8's (its default here is
// `exportDefaults('digital')` — "PNG · 1×"). Clip content and Kind sit under Advanced. A fixed size keeps its exact
// pixels and lets you place things anywhere, so there is no Height mode and no Add a width.

import { registerSlot } from '../slots.js';
import { SizePairRow, SizeSelectRow, useArtboardWrites } from './artboard-rows.jsx';

function FixedRows({ el, ctx }) {
  const { f, can, resize, commitHeight } = useArtboardWrites(el, ctx);
  return (
    <>
      <SizeSelectRow k="Size" f={f} resize={resize} />
      <SizePairRow f={f} can={can} resize={resize} commitHeight={commitHeight} />
    </>
  );
}

const kindOf = (selection) => {
  const el = Array.isArray(selection) ? selection[0] : selection;
  return el?.attrs?.['data-dc-kind'] || 'digital';
};

export const ARTBOARD_FIXED_SLOTS = Object.freeze([
  [
    'size',
    {
      id: 'size.artboard-fixed',
      order: 10,
      kinds: ['artboard'],
      title: 'Artboard',
      when: ({ selection }) => kindOf(selection) === 'digital',
      Body: FixedRows,
    },
  ],
]);

/** @returns {() => void} take the Fixed size rows back out of the registry */
export function registerArtboardFixedSlots() {
  const offs = ARTBOARD_FIXED_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offArtboardFixed = registerArtboardFixedSlots();
