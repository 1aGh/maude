// client/v2/inspector/kinds/multi-artboard.jsx — S2.9: several artboards at once (14 Editing, ed-ab-tidy).
//
//   "4 artboards" · Preset, Size, Position as the boards share them, or "Mixed" where they differ · Background the
//   same way · "Changes go to all 4."
//
// The rows are what the selected boards SAY today; moving or sizing them as a group goes through the align bar
// (align, distribute, Tidy up), which is one commit and one ⌘Z. Nothing here writes a file.

import { reduceMixed } from '../../../../edit-ops/words-paint.ts';
import { Quiet, Row } from '../sections/row.jsx';
import { registerSlot } from '../slots.js';
import { artboardFacts, presetOptions, presetValue } from './artboard-model.js';

export const MULTI_ARTBOARD = 'multi-artboard';

/** What the selected boards share, per field — `{ mixed: false, value }` or `{ mixed: true, values }`. */
export function multiArtboardModel(selection) {
  const list = Array.isArray(selection) ? selection : [];
  const facts = list.map((el) => ({ ...artboardFacts(el), geometry: el?.geometry }));
  const field = (pick) => reduceMixed(facts.map(pick));
  const presetLabel = (f) =>
    presetOptions(f.kind).find((o) => o.value === presetValue(f))?.label ?? '';
  return {
    count: list.length,
    preset: field(presetLabel),
    w: field((f) => f.w),
    h: field((f) => f.h),
    x: field((f) => f.geometry?.x),
    y: field((f) => f.geometry?.y),
    bg: field((f) => f.bg),
  };
}

const show = (r, empty = '—') => {
  if (r.mixed) return 'Mixed';
  const v = r.value;
  return v === undefined || v === null || v === '' ? empty : String(v);
};

function Value({ name, r, empty }) {
  return (
    <span
      className="insp-ro"
      data-testid={`insp-mab-${name}`}
      data-mixed={r.mixed ? 'true' : undefined}
    >
      {show(r, empty)}
    </span>
  );
}

function MultiArtboardRows({ selection }) {
  const m = multiArtboardModel(selection);
  return (
    <>
      <Row k="Preset" name="mab-preset">
        <Value name="preset" r={m.preset} empty="Custom" />
      </Row>
      <Row k="Size" name="mab-size">
        <Value name="w" r={m.w} />
        <span aria-hidden="true"> × </span>
        <Value name="h" r={m.h} />
      </Row>
      <Row k="Position" name="mab-position">
        <Value name="x" r={m.x} />
        <span aria-hidden="true"> · </span>
        <Value name="y" r={m.y} />
      </Row>
      <Quiet testid="insp-mab-note">{`Changes go to all ${m.count}.`}</Quiet>
    </>
  );
}

function MultiArtboardFill({ selection }) {
  const m = multiArtboardModel(selection);
  return (
    <Row k="Background" name="mab-bg">
      <Value name="bg" r={m.bg} empty="Default" />
    </Row>
  );
}

const K = [MULTI_ARTBOARD];

/** The sections several artboards show. Exported so a test can seat them in a clean registry (the registry is process-wide). */
export const MULTI_ARTBOARD_SLOTS = Object.freeze([
  [
    'size',
    {
      id: 'size.multi-artboard',
      order: 10,
      kinds: K,
      title: 'Artboards',
      // S7.21: boards of different kinds share no size or paper — artboard-multi.jsx draws their rows (ak-mixed-select)
      when: ({ selection }) =>
        new Set(
          (Array.isArray(selection) ? selection : []).map(
            (el) => el?.attrs?.['data-dc-kind'] || 'digital'
          )
        ).size < 2,
      Body: MultiArtboardRows,
    },
  ],
  ['fill', { id: 'fill.multi-artboard', order: 10, kinds: K, Body: MultiArtboardFill }],
]);

/** @returns {() => void} take the sections back out of the registry */
export function registerMultiArtboardSlots() {
  const offs = MULTI_ARTBOARD_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offMultiArtboard = registerMultiArtboardSlots();
