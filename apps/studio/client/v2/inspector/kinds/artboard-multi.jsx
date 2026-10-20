// client/v2/inspector/kinds/artboard-multi.jsx — S7.21: boards of DIFFERENT kinds selected together (08 ak-mixed-select).
//
//   "2 artboards" · "2 kinds"
//   Kinds        the glyph and the word of each: Fixed size · Print
//   Horizontal   Left | Centre | Right      Vertical   Top | Middle | Bottom   (the align bar's verbs, asked of the canvas)
//   note         "Size and paper differ. Select one to change it."
//   (Fill is S2.9's "Mixed"; Export is S8's "2 files…")
//
// Boards of ONE kind keep S2.9's rows (Preset · Size · Position · "Changes go to all N."). Only what both kinds
// understand is offered: no size, no paper, until one board is picked.

import { Segmented } from '../../../inspector-controls.jsx';
import { DigitalIcon, PrintIcon, VideoIcon, WebIcon } from '../../canvases/canvas-icons.jsx';
import { Quiet, Row } from '../sections/row.jsx';
import { registerSlot } from '../slots.js';
import { multiKindModel } from './artboard-kinds-model.js';
import { MULTI_ARTBOARD } from './multi-artboard.jsx';

const GLYPH = { digital: DigitalIcon, web: WebIcon, print: PrintIcon, video: VideoIcon };

/** The align bar's verbs (editing/arrange.ts): the canvas moves the boards and keeps annotations riding along. */
export const H_ALIGN = Object.freeze([
  { value: 'align.left', label: 'Left' },
  { value: 'align.hcentre', label: 'Centre' },
  { value: 'align.right', label: 'Right' },
]);
export const V_ALIGN = Object.freeze([
  { value: 'align.top', label: 'Top' },
  { value: 'align.vmiddle', label: 'Middle' },
  { value: 'align.bottom', label: 'Bottom' },
]);

function MultiKindRows({ selection, ctx }) {
  const m = multiKindModel(selection);
  const run = (id) => ctx?.onRunAction?.({ dgn: 'run-action', v: 1, id });
  return (
    <>
      <Row k="Kinds" name="mk-kinds">
        <span className="insp-kinds" data-testid="insp-mk-kinds">
          {m.kinds.map(({ kind, word }) => {
            const Glyph = GLYPH[kind] ?? DigitalIcon;
            return (
              <span key={kind} className="insp-kind" data-kind={kind}>
                <Glyph size={12} /> {word}
              </span>
            );
          })}
        </span>
      </Row>
      <Row k="Horizontal" name="mk-horizontal">
        <span data-testid="insp-mk-horizontal">
          <Segmented value="" ariaLabel="Align horizontally" options={H_ALIGN} onChange={run} />
        </span>
      </Row>
      <Row k="Vertical" name="mk-vertical">
        <span data-testid="insp-mk-vertical">
          <Segmented value="" ariaLabel="Align vertically" options={V_ALIGN} onChange={run} />
        </span>
      </Row>
      <Quiet testid="insp-mk-note">{m.note}</Quiet>
    </>
  );
}

const K = [MULTI_ARTBOARD];

/** The rows several boards of different kinds show. Exported so a test can seat them in a clean registry. */
export const MULTI_KIND_SLOTS = Object.freeze([
  [
    'size',
    {
      id: 'size.multi-kind',
      order: 10,
      kinds: K,
      title: 'Artboards',
      when: ({ selection }) => multiKindModel(selection).mixed,
      Body: MultiKindRows,
    },
  ],
]);

/** @returns {() => void} take the rows back out of the registry */
export function registerMultiKindSlots() {
  const offs = MULTI_KIND_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offMultiKind = registerMultiKindSlots();
