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

import { colourFromCss, colourToCss } from '../../../../edit-ops/words-paint.ts';
import { Segmented } from '../../../inspector-controls.jsx';
import { DigitalIcon, PrintIcon, VideoIcon, WebIcon } from '../../canvases/canvas-icons.jsx';
import { ColorControl } from '../sections/color-control.jsx';
import { Quiet, Row } from '../sections/row.jsx';
import { registerSlot } from '../slots.js';
import { useDsFamilies } from '../token-chip.jsx';
import { artboardFacts } from './artboard-model.js';
import { heldAlignment, multiKindModel } from './artboard-kinds-model.js';
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

/**
 * 08 ak-mixed-select: "Fill · [swatches] Mixed" — the boards' own fills side by side, then the word. Picking a colour
 * sets it on every selected board.
 */
function MixedFillRow({ selection, ctx }) {
  const fam = useDsFamilies(ctx);
  const h = ctx?.artboard || {};
  const facts = (Array.isArray(selection) ? selection : []).map(artboardFacts);
  const fills = facts.map((f) => (f.bg ? colourFromCss(f.bg) : null));
  const distinct = [...new Set(facts.map((f) => f.bg || `unset:${f.kind}`))];
  const mixed = distinct.length > 1;
  const shown = [
    ...new Map(fills.map((c, i) => [facts[i].bg || `unset:${facts[i].kind}`, c])).values(),
  ];
  return (
    <Row k="Fill" name="mk-fill">
      <span data-testid="insp-mab-bg">
        <ColorControl
          name="mk-fill"
          label="Artboard fill"
          value={mixed ? null : (fills[0] ?? null)}
          mixed={mixed ? shown.map((c) => (c ? c : null)) : null}
          colors={fam.color}
          vals={fam.vals}
          allowNone
          noneLabel="Default"
          disabled={!facts.every((f) => f.id)}
          onChange={(c) => {
            for (const f of facts)
              f.id && h.onSetArtboardStyle?.(f.id, { background: c ? colourToCss(c) : null });
          }}
        />
      </span>
    </Row>
  );
}

function MultiKindRows({ selection, ctx }) {
  const m = multiKindModel(selection);
  const held = heldAlignment(selection);
  const run = (id) => ctx?.onRunAction?.({ dgn: 'run-action', v: 1, id });
  return (
    <>
      <Row k="Kinds" name="mk-kinds">
        <span className="insp-mk-kinds" data-testid="insp-mk-kinds">
          {m.kinds.map(({ kind, word }) => {
            const Glyph = GLYPH[kind] ?? DigitalIcon;
            return (
              <span key={kind} className="insp-mk-kind" data-kind={kind}>
                <Glyph size={12} /> {word}
              </span>
            );
          })}
        </span>
      </Row>
      <MixedFillRow selection={selection} ctx={ctx} />
      <Row k="Horizontal" name="mk-horizontal">
        <span data-testid="insp-mk-horizontal">
          <Segmented
            value={held.h}
            ariaLabel="Align horizontally"
            options={H_ALIGN}
            onChange={run}
          />
        </span>
      </Row>
      <Row k="Vertical" name="mk-vertical">
        <span data-testid="insp-mk-vertical">
          <Segmented value={held.v} ariaLabel="Align vertically" options={V_ALIGN} onChange={run} />
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
      // the board's mixed card is one flat list (Kinds · Fill · Horizontal · Vertical · note · Export), no head
      headless: true,
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
