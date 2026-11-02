// S4.11 — an-arrow-kinds: Straight · Curved · Elbow, the head picker, two-way, inks 4 + "+5", and
// the words on the line. Every choice changes only the DRAWING: a bind (stroke or canvas host)
// is never touched, and the canvas-bound arrow survives the stroke ⇄ element seam both ways.

import { describe, expect, test } from 'bun:test';
import { validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  ARROW_HEAD_CHOICES,
  ARROW_INK_FRONT,
  ARROW_INK_MORE,
  ARROW_KINDS,
  headPatch,
  isTwoWay,
  kindOf,
  kindPatch,
  labelPatch,
  NEW_ARROW,
  twoWayPatch,
} from '../annotations/ui/arrow-kinds.ts';
import { elementsToStrokes, strokesToElements } from '../annotations/v1-adapter.ts';
import { type ArrowStroke, STROKE_PALETTE, type Stroke } from '../annotations-model.ts';

const arrow = (o: Partial<ArrowStroke> = {}): ArrowStroke => ({
  id: 'a1',
  tool: 'arrow',
  color: '#1f1f1f',
  width: 2,
  x1: 0,
  y1: 0,
  x2: 100,
  y2: 50,
  ...o,
});

describe('a new arrow is Curved with a filled head', () => {
  test('the defaults', () => {
    expect(NEW_ARROW).toEqual({ lineType: 'curved', startHead: 'none', endHead: 'triangle' });
  });
  test('they survive the stroke → element → stroke seam (a v1 peer reads "curved" too)', () => {
    const a = arrow({ ...NEW_ARROW });
    const els = strokesToElements([a], new Map());
    expect(els[0]).toMatchObject({ type: 'arrow', line: 'curved' });
    const back = elementsToStrokes(els)[0] as ArrowStroke;
    expect(kindOf(back)).toBe('curved');
  });
});

describe('the vocabulary', () => {
  test('lines and heads, in the words of the canvas', () => {
    expect(ARROW_KINDS.map((k) => k.label)).toEqual(['Straight', 'Curved', 'Elbow']);
    expect(ARROW_HEAD_CHOICES.map((k) => k.label)).toEqual([
      'None',
      'Line',
      'Triangle',
      'Triangle outline',
      'Circle',
      'Diamond',
    ]);
  });
  test('inks: four up front (black first), five behind "+5", nine in all, no repeats', () => {
    expect(ARROW_INK_FRONT).toHaveLength(4);
    expect(ARROW_INK_MORE).toHaveLength(5);
    expect(ARROW_INK_FRONT[0]?.hex).toBe(STROKE_PALETTE[8]);
    const all = [...ARROW_INK_FRONT, ...ARROW_INK_MORE].map((i) => i.hex);
    expect(new Set(all).size).toBe(9);
    expect([...all].sort()).toEqual([...STROKE_PALETTE].sort());
  });
});

describe('each choice changes the drawing only — the binding stays', () => {
  const hosted = arrow({
    startBind: { hostId: 'note', nx: 1, ny: 0.5 },
    endHost: { ref: 'el:desktop/cta', label: 'See the work' },
    lineType: 'curved',
  });
  test('Straight · Curved · Elbow write lineType and nothing else', () => {
    for (const k of ['straight', 'curved', 'elbow'] as const) {
      const patch = kindPatch(k);
      expect(Object.keys(patch)).toEqual(['lineType']);
      const next = { ...hosted, ...patch };
      expect(next.endHost).toBe(hosted.endHost);
      expect(next.startBind).toBe(hosted.startBind);
    }
  });
  test('the head picker sets the end head; a two-way arrow keeps both alike', () => {
    expect(headPatch(arrow(), 'diamond')).toEqual({ endHead: 'diamond' });
    const two = arrow({ startHead: 'triangle', endHead: 'triangle' });
    expect(headPatch(two, 'circle')).toEqual({ endHead: 'circle', startHead: 'circle' });
    expect(headPatch(two, 'none')).toEqual({ endHead: 'none' });
  });
  test('two-way toggles a head on the start, copying the end head', () => {
    expect(isTwoWay(arrow())).toBe(false);
    expect(twoWayPatch(arrow())).toEqual({ startHead: 'triangle', endHead: 'triangle' });
    expect(twoWayPatch(arrow({ endHead: 'circle' }))).toEqual({
      startHead: 'circle',
      endHead: 'circle',
    });
    expect(twoWayPatch(arrow({ startHead: 'triangle', endHead: 'triangle' }))).toEqual({
      startHead: 'none',
    });
    // an arrow with no head at all becomes a real two-way arrow, not an invisible one
    expect(twoWayPatch(arrow({ endHead: 'none' }))).toEqual({
      startHead: 'triangle',
      endHead: 'triangle',
    });
  });
});

describe('the words on the line (double-click)', () => {
  test('labelPatch trims, collapses whitespace, caps at 200, and empty removes', () => {
    expect(labelPatch('  swipe   up ')).toEqual({ label: 'swipe up' });
    expect((labelPatch('x'.repeat(500)).label ?? '').length).toBe(200);
    expect(labelPatch('   ')).toEqual({ label: undefined });
  });

  test('the label rides the arrow through the seam, and AI reads it with the arrow', () => {
    const a = arrow({ label: 'then here' });
    const [el] = strokesToElements([a], new Map());
    expect(el).toMatchObject({ type: 'arrow', label: 'then here' });
    expect((elementsToStrokes([el as AnnotationElement])[0] as ArrowStroke).label).toBe(
      'then here'
    );
  });

  test('clearing the label on the stroke removes it from the element (not carried back)', () => {
    const withLabel = strokesToElements([arrow({ label: 'then here' })], new Map());
    const cur = new Map(withLabel.map((e) => [e.id, e]));
    const cleared = strokesToElements([arrow({ ...labelPatch('') })], cur);
    expect(cleared[0]).not.toHaveProperty('label');
  });

  test('the schema accepts a label and refuses a non-string one', () => {
    const base = {
      id: 'a1',
      type: 'arrow',
      index: 'a0',
      start: { x: 0, y: 0 },
      end: { x: 5, y: 5 },
    };
    expect(
      (validateElements([{ ...base, label: 'ok' }]).elements[0] as AnnotationElement).label
    ).toBe('ok');
    const bad = validateElements([{ ...base, label: 42 }]).elements[0] as AnnotationElement;
    expect(bad.label).toBeUndefined();
  });
});

describe('a canvas bind lives on the stroke (so removing it really removes it)', () => {
  const bind = { ref: 'el:desktop/cta', label: 'See the work', box: { x: 1, y: 2, w: 3, h: 4 } };
  test('startHost / endHost round-trip', () => {
    const els = strokesToElements([arrow({ endHost: bind })], new Map());
    expect(els[0]).toMatchObject({ endHost: bind });
    expect((elementsToStrokes(els)[0] as ArrowStroke).endHost).toEqual(bind);
  });
  test('dropping the bind on the stroke drops it from the element (Point to…, a drag off the host)', () => {
    const cur = new Map(
      strokesToElements([arrow({ endHost: bind })], new Map()).map((e) => [e.id, e])
    );
    const free: Stroke = arrow();
    const next = strokesToElements([free], cur);
    expect(next[0]).not.toHaveProperty('endHost');
  });
});
