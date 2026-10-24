// client/v2/inspector/kinds/artboard-print.jsx — S7.23: the Print artboard's rows (08 ak-print-letak, "the inspector speaks mm").
//
//   Paper           A6 … (the one paper table, print/units.ts); "Custom" when the size is typed in
//   Size in mm      105 × 148 — the trim; typing a number makes it a custom size (kinds/print-custom.ts)
//   Orientation     Portrait | Landscape
//   Bleed           3 mm
//   Safe margin     5 mm (one value, all four sides)
//   Print guides    this artboard's own switch (C25): View › Advanced › Print guides is the default, this wins
//   Colour          "RGB — the print shop converts to CMYK."
//
// Export is S8's section; Clip content, Kind and every exact number (px, resolution, guides, the code) are under
// Advanced (client/v2/kinds/advanced-rows.js). Every change is ONE request, `artboard.set-print` through the edit-op
// route: the `print` prop and the artboard's px size land in one write, and one ⌘Z takes both back (print-write.js).

import { useCallback, useEffect, useState } from 'react';

import { artboardPhysicalSize } from '../../../../kinds/physical.ts';
import { effectivePrintGuides, printGuidesOverride } from '../../../../kinds/print-guides.ts';
import { uniformMarginMm } from '../../../../kinds/print-edit.ts';
import { readSizeMm } from '../../../../kinds/print-custom.ts';
import { NumberField, Segmented, Select, Toggle } from '../../../inspector-controls.jsx';
import {
  PRINT_GUIDES_DEFAULT_EVENT,
  readPrintGuidesDefault,
  writePrint,
  writePrintGuides,
} from '../print-write.js';
import { Quiet, Row } from '../sections/row.jsx';
import { registerSlot } from '../slots.js';
import { artboardFacts, presetOptions } from './artboard-model.js';

export const PRINT_COLOUR_WORDS = 'RGB — the print shop converts to CMYK.';

// V2-8.5 C2 (08 ak-print-letak) — a length in millimetres reads "3 mm" (value, then unit), as the board draws it
const mmWord = (n) => `${Number(n)} mm`;
const mmParse = (raw) => Number.parseFloat(String(raw).replace(/mm/i, '').trim());
const CUSTOM = '';

const first = (selection) => (Array.isArray(selection) ? selection[0] : selection);
const kindOf = (selection) => first(selection)?.attrs?.['data-dc-kind'] || 'digital';

/** View › Advanced › Print guides for this canvas, kept current while the inspector is open. */
export function useViewPrintGuides(canvas) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    if (canvas)
      readPrintGuidesDefault(canvas).then((v) => {
        if (live) setOn(v);
      });
    const hear = (e) => {
      if (e?.detail?.canvas === canvas && typeof e.detail.visible === 'boolean')
        setOn(e.detail.visible);
    };
    globalThis.window?.addEventListener?.(PRINT_GUIDES_DEFAULT_EVENT, hear);
    return () => {
      live = false;
      globalThis.window?.removeEventListener?.(PRINT_GUIDES_DEFAULT_EVENT, hear);
    };
  }, [canvas]);
  return on;
}

/** The facts the rows read, off the selection payload. */
export function printFacts(el) {
  const f = artboardFacts(el);
  const mm = artboardPhysicalSize({ attrs: el?.attrs });
  return { f, id: f.id, print: f.print, mm, custom: readSizeMm(f.print) !== null };
}

export function PrintRows({ el, ctx }) {
  const { id, print, mm, custom } = printFacts(el);
  const canvas = ctx?.canvasFile ?? el?.file ?? null;
  // An artboard has no element id, so the frame's `editable` is false for it; the server judges the role (403).
  const can = !!id && !!canvas;
  const viewDefault = useViewPrintGuides(canvas);
  const [said, setSaid] = useState('');
  const [guidesNow, setGuidesNow] = useState(null);
  // the canvas read-back is the truth again as soon as it arrives
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh payload drops the local pick
  useEffect(() => setGuidesNow(null), [id, print?.showGuides]);

  const send = useCallback(
    async (patch) => {
      if (!can) return;
      setSaid('');
      const r = await writePrint({ canvas, artboardId: id, patch });
      if (!r.ok) setSaid(r.message);
    },
    [can, canvas, id]
  );

  // 08 ak-print-letak: the Paper row reads "A6" — the millimetres are the next row's
  const paperOptions = presetOptions('print').map((o) => ({
    ...o,
    label: o.label.split(' · ')[0],
  }));
  const paper = custom ? CUSTOM : `paper:${print?.paper ?? 'a4'}`;
  const pickPaper = (v) => {
    const o = paperOptions.find((x) => x.value === v);
    if (o?.paper) send({ paper: o.paper });
  };

  // a custom size is its two numbers; a paper keeps the orientation it was given (a business card is wider than tall
  // and still "portrait" in the table)
  const orientation = custom
    ? mm && mm.wMm > mm.hMm
      ? 'landscape'
      : 'portrait'
    : print?.orientation === 'landscape'
      ? 'landscape'
      : 'portrait';
  const own = printGuidesOverride(print);
  const shown = guidesNow ?? effectivePrintGuides(print, viewDefault);
  const setGuides = async (visible) => {
    if (!can) return;
    setGuidesNow(visible === null ? effectivePrintGuides(null, viewDefault) : visible);
    setSaid('');
    const r = await writePrintGuides({ canvas, artboardId: id, visible });
    if (!r.ok) {
      setGuidesNow(null);
      setSaid(r.message);
    }
  };

  const margin = uniformMarginMm(print);
  return (
    <>
      <Row k="Paper" name="ab-preset">
        <Select
          value={paper}
          ariaLabel="Paper"
          testId="insp-ab-preset"
          options={
            paper === CUSTOM ? [{ value: CUSTOM, label: 'Custom' }, ...paperOptions] : paperOptions
          }
          onChange={pickPaper}
        />
      </Row>
      <Row k="Size in mm" name="pr-size">
        <span className="insp-pair">
          <span data-testid="insp-num-pr-w">
            <NumberField
              value={mm?.wMm ?? 0}
              min={10}
              step={1}
              lead="W"
              ariaLabel="Width, millimeters"
              steppers={false}
              scrub={false}
              className="insp-nf"
              onCommit={(n) => mm && send({ sizeMm: [n, mm.hMm] })}
            />
          </span>
          <span data-testid="insp-num-pr-h">
            <NumberField
              value={mm?.hMm ?? 0}
              min={10}
              step={1}
              lead="H"
              ariaLabel="Height, millimeters"
              steppers={false}
              scrub={false}
              className="insp-nf"
              onCommit={(n) => mm && send({ sizeMm: [mm.wMm, n] })}
            />
          </span>
        </span>
      </Row>
      <Row k="Orientation" name="ab-orientation">
        <Segmented
          value={orientation}
          ariaLabel="Paper orientation"
          options={[
            { value: 'portrait', label: 'Portrait' },
            { value: 'landscape', label: 'Landscape' },
          ]}
          onChange={(v) => send({ orientation: v })}
        />
      </Row>
      <Row k="Bleed" name="ab-bleed">
        <NumberField
          value={Number.isFinite(print?.bleedMm) ? print.bleedMm : 3}
          min={0}
          step={0.5}
          ariaLabel="Bleed, millimeters"
          format={mmWord}
          parse={mmParse}
          steppers={false}
          scrub={false}
          className="insp-nf insp-nf--one"
          onCommit={(n) => send({ bleedMm: n })}
        />
      </Row>
      <Row k="Safe margin" name="pr-margin">
        <NumberField
          value={margin ?? 5}
          min={0}
          step={0.5}
          ariaLabel="Safe margin, millimeters"
          format={mmWord}
          parse={mmParse}
          steppers={false}
          scrub={false}
          className="insp-nf insp-nf--one"
          onCommit={(n) => send({ marginMm: n })}
        />
      </Row>
      {margin === null ? (
        <Quiet testid="insp-pr-margin-note">
          The four sides differ. Typing a number sets all four.
        </Quiet>
      ) : null}
      <Row k="Print guides" name="pr-guides">
        <span data-testid="insp-ctl-pr-guides">
          <Toggle checked={shown} ariaLabel="Print guides" onChange={(v) => setGuides(!!v)} />
        </span>
      </Row>
      <Quiet testid="insp-pr-guides-note">
        {own === null ? (
          'Follows Menu › View › Advanced › Print guides.'
        ) : (
          <>
            Set for this artboard.{' '}
            <button
              type="button"
              className="insp-link"
              data-testid="insp-pr-guides-follow"
              onClick={() => setGuides(null)}
            >
              Follow View
            </button>
          </>
        )}
      </Quiet>
      <Row k="Colour" name="pr-colour">
        <span className="insp-ro insp-ro--note" data-testid="insp-pr-colour">
          {PRINT_COLOUR_WORDS}
        </span>
      </Row>
      {said ? <Quiet testid="insp-pr-said">{said}</Quiet> : null}
    </>
  );
}

export const ARTBOARD_PRINT_SLOTS = Object.freeze([
  [
    'size',
    {
      id: 'size.artboard-print',
      order: 10,
      kinds: ['artboard'],
      title: 'Artboard',
      when: ({ selection }) => kindOf(selection) === 'print',
      Body: PrintRows,
    },
  ],
]);

/** @returns {() => void} take the Print rows back out of the registry */
export function registerArtboardPrintSlots() {
  const offs = ARTBOARD_PRINT_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offArtboardPrint = registerArtboardPrintSlots();
