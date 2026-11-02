// client/v2/export/advanced/print.jsx — S8.3: Advanced › Print PDF.
//
// What the spec carries for a print PDF: the resolution of the images inside, the bleed and the crop
// marks, the text and registration marks. Paper is drawn as a choice with the one answer there is (the page
// keeps the artboard's own size); the Print section, S8.7, owns the paper preview.

import { Row } from '../parts.jsx';
import {
  BLEED,
  BLEED_AMOUNT,
  CROP_MARKS,
  IMAGES_INSIDE,
  PAPER,
  PAPER_OPTIONS,
  PRINT_COLOUR_NOTE,
  PRINT_TITLE,
  REGISTRATION_MARKS,
  TEXT_HANDLING,
  TEXT_NOTE,
  TEXT_OPTIONS,
} from './advanced-copy.js';
import { Note, ReadField, Select, Switch } from './fields.jsx';
import { DPI_PRESETS } from './model.js';

/** The print options the spec holds right now, wherever they sit (a kind's own, else the top level). */
export const printOf = (spec) => spec.byKind?.print?.options?.print ?? spec.options?.print ?? {};
export const printDpiOf = (spec) => {
  const size = spec.byKind?.print?.options?.size ?? spec.options?.size;
  return size && 'dpi' in size ? size.dpi : null;
};

/** @param bleedMm the bleed the print artboard was authored with (3 mm when the paper is not known yet) */
export function PrintPart({ spec, setAdv, bleedMm = 3 }) {
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
        <ReadField
          label={BLEED_AMOUNT}
          testid="export-adv-bleed-mm"
          value={`${Number(bleedMm.toFixed(2))} mm`}
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
      <Row k={PAPER}>
        <Select
          label={PAPER}
          testid="export-adv-paper"
          value="same"
          options={PAPER_OPTIONS}
          onChange={() => {}}
        />
      </Row>
      <Note>{PRINT_COLOUR_NOTE}</Note>
    </section>
  );
}
