// client/v2/kinds/advanced-rows.js — S7.23 (08 ak-advanced): a print artboard's › Advanced rows, registered through
// S11.8's append-only registry (client/v2/inspector/advanced-rows.js) without editing it:
//
//   Exact size · Resolution · Colour · Guides + Add · Look and layout   (group `artboard`)
//   In code                                                             (group `in-code`)
//
// They show for a print artboard only; a web page, a fixed size and a video keep the rows artboard-advanced-rows.jsx
// gives them. Theme (every artboard), Clip content and Kind are drawn by ArtboardAdvanced above these.

import { registerAdvancedRow } from '../inspector/advanced-rows.js';
import {
  PrintColour,
  PrintExactSize,
  PrintGuides,
  PrintInCode,
  PrintLookAndLayout,
  PrintResolution,
} from '../inspector/kinds/artboard-print-advanced.jsx';

const isPrint = ({ el }) => (el?.attrs?.['data-dc-kind'] || 'digital') === 'print';

const entry = (id, order, Body) => ({ id, order, kinds: ['artboard'], when: isPrint, Body });

/** @returns {() => void} take the print rows back out of the registry */
export function registerPrintAdvancedRows() {
  const offs = [
    registerAdvancedRow('artboard', entry('artboard.print-exact', 10, PrintExactSize)),
    registerAdvancedRow('artboard', entry('artboard.print-resolution', 20, PrintResolution)),
    registerAdvancedRow('artboard', entry('artboard.print-colour', 30, PrintColour)),
    registerAdvancedRow('artboard', entry('artboard.print-guides', 40, PrintGuides)),
    registerAdvancedRow('artboard', entry('artboard.print-look', 50, PrintLookAndLayout)),
    registerAdvancedRow('in-code', entry('artboard.print-code', 10, PrintInCode)),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** Tests only: take the print rows back out of the registry (it is process-wide). */
export const offPrintAdvancedRows = registerPrintAdvancedRows();
