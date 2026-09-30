// The annotations lane of accepted revisions under DDR-242 (annotations v2).
//
// Replaces the Task 2 characterization of the v1 whole-SVG lane (git history:
// annotations-v2 plan, Task 2). Every weakness that file pinned is flipped here
// deliberately:
//   • v1 compared element TEXT, so non-canonical bytes read as an edit and a
//     move + recolour of one element conflicted          → merged per FIELD;
//   • v1 silently dropped our z-order change on merge   → `index` is a field;
//   • v1 never equated '' with the 72-byte wrapper       → an empty board IS '';
//   • v1 refused a board with an id-less element         → validated per element.
// Plus the upgrade path: a pre-v2 SVG history blob upconverts, never reads as
// an empty board (the DDR-223 failure shape).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as Y from 'yjs';
import { serializeBoard, validateElements } from '../../studio/annotations/schema.ts';
import { strokesToSvg } from '../../studio/annotations-model.ts';
import { MAX_ANNOTATIONS_BYTES } from '../../studio/sync/limits.ts';
import { applyLane, checkLane, mergeLane, readLane } from '../src/project-transactions/lanes.mjs';

const board = (raw) => serializeBoard(validateElements(raw).elements);
const sticky = (id, extra = {}) => ({
  id,
  type: 'sticky',
  index: 'a0',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  text: '',
  ...extra,
});
const els = (text) => (text === '' ? [] : JSON.parse(text).elements);
const byId = (text) => new Map(els(text).map((e) => [e.id, e]));

describe('checkLane (annotations)', () => {
  test('canonicalizes a board and accepts the empty lane', () => {
    const b = board([sticky('s1', { text: 'hi' })]);
    assert.deepEqual(checkLane('annotations', b), { ok: true, content: b });
    assert.deepEqual(checkLane('annotations', ''), { ok: true, content: '' });
  });

  test('an EMPTY board is the empty lane value (no wrapper-vs-empty split)', () => {
    assert.deepEqual(checkLane('annotations', board([])), { ok: true, content: '' });
    assert.deepEqual(checkLane('annotations', strokesToSvg([])), { ok: true, content: '' });
  });

  test('a legacy SVG (history blob / v1 client) is upconverted, not refused', () => {
    const svg = strokesToSvg([
      { id: 'r1', tool: 'rect', color: '#000000', width: 2, x: 1, y: 2, w: 30, h: 40 },
    ]);
    const r = checkLane('annotations', svg);
    assert.equal(r.ok, true);
    assert.equal(els(r.content)[0].type, 'shape');
  });

  test('rejects what is not a board, and oversized content', () => {
    assert.equal(checkLane('annotations', '{"not":"a board"}').ok, false);
    assert.equal(checkLane('annotations', 'x'.repeat(MAX_ANNOTATIONS_BYTES + 1)).code, 'capacity');
  });

  test('hostile element fields are dropped at the lane, not stored', () => {
    const raw = JSON.stringify({
      format: 'maude.annotations',
      v: 2,
      elements: [
        { id: 'i1', type: 'image', index: 'a0', x: 0, y: 0, w: 10, h: 10, href: 'javascript:1' },
      ],
    });
    const r = checkLane('annotations', raw);
    assert.equal(r.ok, true);
    assert.equal(els(r.content)[0].href, undefined);
  });
});

describe('mergeLane (annotations) — the DDR-242 field rule', () => {
  const base = board([sticky('s1', { text: 'hello' }), sticky('s2', { index: 'a1', x: 300 })]);

  test('independent edits to different elements both survive', () => {
    const ours = board([
      sticky('s1', { text: 'hello', x: 50 }),
      sticky('s2', { index: 'a1', x: 300 }),
    ]);
    const theirs = board([
      sticky('s1', { text: 'hello' }),
      sticky('s2', { index: 'a1', x: 300, fill: '#ffffff' }),
    ]);
    const m = mergeLane('annotations', base, ours, theirs);
    assert.equal(m.ok, true);
    assert.equal(byId(m.content).get('s1').x, 50);
    assert.equal(byId(m.content).get('s2').fill, '#ffffff');
  });

  test('move + recolour of ONE element no longer conflicts (v1 did)', () => {
    const ours = board([
      sticky('s1', { text: 'hello', x: 50 }),
      sticky('s2', { index: 'a1', x: 300 }),
    ]);
    const theirs = board([
      sticky('s1', { text: 'hello', fill: '#ffffff' }),
      sticky('s2', { index: 'a1', x: 300 }),
    ]);
    const m = mergeLane('annotations', base, ours, theirs);
    assert.equal(m.ok, true);
    assert.deepEqual(
      [byId(m.content).get('s1').x, byId(m.content).get('s1').fill],
      [50, '#ffffff']
    );
  });

  test('two people typing in one sticky keep both edits', () => {
    const ours = board([sticky('s1', { text: 'Hello' }), sticky('s2', { index: 'a1', x: 300 })]);
    const theirs = board([sticky('s1', { text: 'hello!' }), sticky('s2', { index: 'a1', x: 300 })]);
    const m = mergeLane('annotations', base, ours, theirs);
    assert.equal(byId(m.content).get('s1').text, 'Hello!');
  });

  test('our z-order change is kept (v1 dropped it)', () => {
    const ours = board([
      sticky('s1', { text: 'hello', index: 'a2' }),
      sticky('s2', { index: 'a1', x: 300 }),
    ]);
    const theirs = board([sticky('s1', { text: 'hello' }), sticky('s2', { index: 'a1', x: 999 })]);
    const m = mergeLane('annotations', base, ours, theirs);
    assert.equal(byId(m.content).get('s1').index, 'a2');
    assert.equal(byId(m.content).get('s2').x, 999);
  });

  test('a peer delete wins over our edit of that element (no silent re-create)', () => {
    const ours = board([sticky('s1', { text: 'edited' }), sticky('s2', { index: 'a1', x: 300 })]);
    const theirs = board([sticky('s2', { index: 'a1', x: 300 })]);
    const m = mergeLane('annotations', base, ours, theirs);
    assert.equal(byId(m.content).has('s1'), false);
  });

  test('a pre-v2 SVG history blob merges as its elements, never as an empty board', () => {
    const svgBase = strokesToSvg([
      {
        id: 'st',
        tool: 'sticky',
        color: '#fce8a6',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        text: 'old',
        fontSize: 14,
      },
    ]);
    const head = checkLane('annotations', svgBase).content;
    // Undo/restore replay: ours = the SVG blob unchanged, theirs = the v2 head.
    const m = mergeLane('annotations', svgBase, svgBase, head);
    assert.equal(byId(m.content).get('st').text, 'old');
  });
});

describe('applyLane / readLane (annotations)', () => {
  test('writes the per-element replica and reads it back canonically', () => {
    const doc = new Y.Doc();
    const b = board([sticky('s1', { text: 'x' })]);
    assert.equal(applyLane(doc, 'annotations', b, { writeId: 'act-1' }), true);
    assert.equal(readLane(doc, 'annotations'), b);
    assert.equal(doc.getMap('annotations2').get('~action'), 'act-1');
  });

  test("'' on a never-populated doc writes nothing and still reads ''", () => {
    const doc = new Y.Doc();
    assert.equal(applyLane(doc, 'annotations', ''), false);
    assert.equal(doc.getMap('annotations2').size, 0);
    assert.equal(readLane(doc, 'annotations'), '');
  });

  test("delete-all materializes: '' after content empties the replica", () => {
    const doc = new Y.Doc();
    applyLane(doc, 'annotations', board([sticky('s1')]));
    applyLane(doc, 'annotations', '');
    assert.equal(readLane(doc, 'annotations'), '');
    assert.equal(doc.getMap('annotations2').has('s1'), false);
  });

  test('an unchanged value is a no-op (no Yjs update)', () => {
    const doc = new Y.Doc();
    const b = board([sticky('s1')]);
    applyLane(doc, 'annotations', b);
    let updates = 0;
    doc.on('update', () => updates++);
    applyLane(doc, 'annotations', b);
    assert.equal(updates, 0);
  });
});
