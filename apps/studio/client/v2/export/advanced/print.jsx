// client/v2/export/advanced/print.jsx — S8.3: Advanced › Print PDF.
//
// What the spec carries for a print PDF: the resolution of the images inside, the bleed and the crop
// marks. (Text handling, registration marks and paper are not spec fields yet — the Print section,
// S8.7, owns the paper preview and the rest.)

import { Row } from '../parts.jsx';
import {
  BLEED,
  CROP_MARKS,
  IMAGES_INSIDE,
  PRINT_COLOUR_NOTE,
  PRINT_TITLE,
  REGISTRATION_MARKS,
  TEXT_HANDLING,
  TEXT_NOTE,
  TEXT_OPTIONS,
} from './advanced-copy.js';
import { Note, Select, Switch } from './fields.jsx';
import { DPI_PRESETS } from './model.js';

/** The print options the spec holds right now, wherever they sit (a kind's own, else the top level). */
export const printOf = (spec) => spec.byKind?.print?.options?.print ?? spec.options?.print ?? {};
export const printDpiOf = (spec) => {
  const size = spec.byKind?.print?.options?.size ?? spec.options?.size;
  return size && 'dpi' in size ? size.dpi : null;
};

export function PrintPart({ spec, setAdv }) {
  const print = printOf(spec);
  const dpi = printDpiOf(spec) ?? 300;
  const text = print.text ?? 'keep';
  return (
    <section className="ex-advp" data-testid="export-adv-print" aria-label={PRINT_TITLE}>
      <Row k={IMAGES_INSIDE}>
        <Select
          label={IMAGES_INSIDE}
          testid="export-adv-print-dpi"
          value={dpi}
          options={DPI_PRESETS.map((d) => [d, `${d} dpi`])}
          onChange={(v) => setAdv({ printDpi: Number(v) })}
        />
      </Row>
      <Row k={TEXT_HANDLING}>
        <Select
          label={TEXT_HANDLING}
          testid="export-adv-print-text"
          value={text}
          options={TEXT_OPTIONS}
          onChange={(v) => setAdv({ text: v })}
        />
      </Row>
      <Note>{TEXT_NOTE}</Note>
      <Row k={BLEED}>
        <Switch
          label={BLEED}
          testid="export-adv-bleed"
          checked={print.bleed === true}
          onChange={(bleed) => setAdv({ bleed })}
        />
      </Row>
      <Row k={CROP_MARKS}>
        <Switch
          label={CROP_MARKS}
          testid="export-adv-crop"
          checked={print.marks === 'crop'}
          onChange={(crop) => setAdv({ crop })}
        />
      </Row>
      <Row k={REGISTRATION_MARKS}>
        <Switch
          label={REGISTRATION_MARKS}
          testid="export-adv-registration"
          checked={print.registration === true}
          onChange={(registration) => setAdv({ registration })}
        />
      </Row>
      <Note>{PRINT_COLOUR_NOTE}</Note>
    </section>
  );
}
