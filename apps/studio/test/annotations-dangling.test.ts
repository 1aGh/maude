// S4.11 — V2-1.4 T9 end to end (canvas 15 `an-rebind`, `an-dangling`): an arrow bound to
// `el:<artboard>/<id>` follows the element when it moves or when AI rewrites it, keeps its bind
// and freezes at its last place when the element is gone ("dangling", derived), says why in the
// card, and re-attaches when the element comes back — with nothing ever stripped from the board.
// Pure: the live canvas is a `canvas-rects` manifest literal.

import { describe, expect, test } from 'bun:test';
import { applyOps, diffToOps } from '../annotations/ops.ts';
import { Scene } from '../annotations/scene.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import type { AimRects } from '../annotations/ui/arrow-bind.ts';
import { rewrittenText } from '../annotations/ui/arrow-bind.ts';
import { danglingCard, danglingCause, rewrittenRing } from '../annotations/ui/arrow-cards.tsx';
import {
  danglingOf,
  hasHosts,
  hostSignature,
  markDangling,
  rectsReady,
  viewStrokes,
} from '../annotations/ui/host-view.ts';
import type { RenderItem } from '../annotations/ui/render-model.ts';
import { renderItemsFromStrokes } from '../annotations/ui/render-model.ts';
import { projectStrokes } from '../annotations/ui/world.ts';
import type { ArrowStroke, Stroke } from '../annotations-model.ts';

const el = (o: Record<string, unknown>): AnnotationElement =>
  ({ index: 'a0', ...o }) as AnnotationElement;

const BOOK = { x: 600, y: 700, w: 140, h: 44 };
const board = (): AnnotationElement[] => [
  el({ id: 'note', type: 'sticky', x: 100, y: 300, w: 150, h: 150, text: 'Book a call in orange' }),
  el({
    id: 'arw',
    type: 'arrow',
    start: { el: 'note' },
    end: { x: 670, y: 744 },
    endHost: { ref: 'el:desktop/book-a-call', label: 'Book a call', box: BOOK },
  }),
];

const rectsWith = (
  box: { x: number; y: number; w: number; h: number } | null,
  text = 'Book a call',
  extra: Partial<AimRects> = {}
): AimRects => ({
  artboards: [{ id: 'desktop', x: 500, y: 600, w: 1440, h: 900 }],
  elements: box
    ? [{ cdId: 'book-a-call', artboard: 'desktop', ...box, index: 0, tag: 'button', text }]
    : [],
  ...extra,
});

const strokesOf = (els: AnnotationElement[]): Stroke[] =>
  projectStrokes(new Scene(els), new WeakMap());
const arrowOf = (ss: readonly Stroke[]): ArrowStroke =>
  ss.find((s) => s.id === 'arw') as ArrowStroke;

describe('the stroke view carries the bind (so the layer can derive and write it)', () => {
  test('startHost / endHost / label ride on the projected arrow stroke', () => {
    const els = board();
    (els[1] as Record<string, unknown>).label = 'orange!';
    const a = arrowOf(strokesOf(els));
    expect(a.endHost?.ref).toBe('el:desktop/book-a-call');
    expect(a.label).toBe('orange!');
    expect(hasHosts([a])).toBe(true);
  });
});

describe('T9 — the element moves: the arrow re-routes (derived, nothing written)', () => {
  test('the end slides to the new box; the committed board is untouched', () => {
    const els = board();
    const strokes = strokesOf(els);
    const before = arrowOf(viewStrokes(strokes, rectsWith(BOOK)));
    const moved = { x: 900, y: 1000, w: 140, h: 44 };
    const after = arrowOf(viewStrokes(strokes, rectsWith(moved)));
    expect(after.x2).not.toBe(before.x2);
    expect(after.y2).toBeGreaterThan(before.y2);
    // The stored cache is still the first place — a v1 peer draws it frozen there.
    expect(arrowOf(strokes).x2).toBe(670);
    expect(arrowOf(strokes).endHost?.box).toEqual(BOOK);
  });

  test('a resized box (AI made the button bigger) moves the end to the new edge', () => {
    const strokes = strokesOf(board());
    const big = { x: 580, y: 690, w: 220, h: 64 };
    const a = arrowOf(viewStrokes(strokes, rectsWith(big)));
    // Auto end facing the sticky on the left/top: it sits on the BIG box's side, not the old one.
    const onBox = (x: number, y: number) =>
      x >= big.x - 0.01 &&
      x <= big.x + big.w + 0.01 &&
      y >= big.y - 0.01 &&
      y <= big.y + big.h + 0.01;
    expect(onBox(a.x2, a.y2)).toBe(true);
    expect(a.endHost?.ref).toBe('el:desktop/book-a-call');
  });
});

describe('T9 — the element is gone: the bind stays, the end freezes, dangling is derived', () => {
  test('the host is missing: dangling, end at the cached point, bind kept', () => {
    const strokes = strokesOf(board());
    const rects = rectsWith(null);
    const d = danglingOf(strokes, rects);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      arrowId: 'arw',
      end: 'end',
      ref: 'el:desktop/book-a-call',
      label: 'Book a call',
    });
    const a = arrowOf(viewStrokes(strokes, rects));
    expect([a.x2, a.y2]).toEqual([670, 744]);
    expect(a.endHost?.ref).toBe('el:desktop/book-a-call');
  });

  test('restoring the element re-attaches it — nothing was stripped', () => {
    const strokes = strokesOf(board());
    expect(danglingOf(strokes, rectsWith(null))).toHaveLength(1);
    const back = { x: 610, y: 720, w: 140, h: 44 };
    expect(danglingOf(strokes, rectsWith(back))).toHaveLength(0);
    const a = arrowOf(viewStrokes(strokes, rectsWith(back)));
    expect(a.y2).toBeGreaterThanOrEqual(back.y);
  });

  test('a canvas that has not painted yet marks nothing and derives nothing', () => {
    const strokes = strokesOf(board());
    const empty: AimRects = { artboards: [], elements: [] };
    expect(rectsReady(empty)).toBe(false);
    expect(danglingOf(strokes, empty)).toEqual([]);
    expect(danglingOf(strokes, null)).toEqual([]);
    expect(viewStrokes(strokes, empty)).toBe(strokes);
    expect(hostSignature(strokes, empty)).toBe('pending');
  });

  test('the arrow is drawn dashed with no head on the lost end', () => {
    const strokes = strokesOf(board());
    const items = renderItemsFromStrokes(strokes);
    const marked = markDangling(items, danglingOf(strokes, rectsWith(null)));
    const it = marked.find((i: RenderItem) => i.el.id === 'arw');
    expect(it?.ends?.dangling).toEqual({ end: true });
    // Untouched items keep their identity.
    expect(marked.find((i) => i.el.id === 'note')).toBe(items.find((i) => i.el.id === 'note'));
  });

  test('the signature changes when a host moves or vanishes, and only then', () => {
    const strokes = strokesOf(board());
    const a = hostSignature(strokes, rectsWith(BOOK));
    expect(hostSignature(strokes, rectsWith({ ...BOOK }))).toBe(a);
    expect(hostSignature(strokes, rectsWith({ ...BOOK, x: 700 }))).not.toBe(a);
    expect(hostSignature(strokes, rectsWith(null))).not.toBe(a);
  });
});

describe('the card says what the arrow meant (an-dangling, an-rebind 2)', () => {
  test('an element gone from a present artboard: replaced or removed, with Point to…', () => {
    const strokes = strokesOf(board());
    const rects = rectsWith(null);
    const d = danglingOf(strokes, rects)[0];
    if (!d) throw new Error('expected a dangling end');
    const card = danglingCard(d, rects);
    expect(card.cause).toBe('element');
    expect(card.lead).toBe('Pointed at “Book a call” — it was replaced or removed');
  });

  test('its artboard gone too: the artboard is in the trash', () => {
    const rects: AimRects = {
      artboards: [{ id: 'mobile', x: 0, y: 0, w: 390, h: 844 }],
      elements: [],
    };
    expect(danglingCause('el:desktop/book-a-call', rects)).toBe('artboard');
    expect(danglingCause('ab:desktop', rects)).toBe('artboard');
    const d = danglingOf(strokesOf(board()), rects)[0];
    if (!d) throw new Error('expected a dangling end');
    expect(danglingCard(d, rects).lead).toBe(
      'Pointed at “Book a call” — its artboard is in the trash'
    );
  });
});

describe('an-rebind 1 — AI rewrites the button: the same id, new words and size', () => {
  const big = { x: 580, y: 690, w: 220, h: 64 };
  test('the arrow stays bound and the ring names the new words', () => {
    const rects = rectsWith(big, 'See our work');
    const bind = { ref: 'el:desktop/book-a-call', label: 'Book a call' };
    expect(rewrittenText(rects, bind)).toBe('See our work');
    expect(rewrittenRing(rects, bind, 'Button')).toEqual({
      word: 'Button',
      text: 'See our work · rewritten by AI',
    });
    expect(danglingOf(strokesOf(board()), rects)).toHaveLength(0);
  });

  test('unchanged words are not "rewritten"', () => {
    const rects = rectsWith(BOOK, 'Book a call');
    expect(
      rewrittenText(rects, { ref: 'el:desktop/book-a-call', label: 'Book a call' })
    ).toBeNull();
  });
});

describe('Point to… and ⌘Z are ordinary board ops (the bind is the stroke’s, not carried)', () => {
  test('re-aiming writes the new host; dropping it writes a removal', () => {
    const els = board();
    const cur = new Map(els.map((e) => [e.id, e]));
    const next = new Map(cur);
    next.set(
      'arw',
      el({
        ...(cur.get('arw') as AnnotationElement),
        endHost: { ref: 'el:desktop/other-cta', label: 'Other', box: { x: 1, y: 2, w: 3, h: 4 } },
      })
    );
    const ops = diffToOps(cur, next);
    expect(ops.length).toBe(1);
    const applied = applyOps(cur, ops);
    expect((applied.state.get('arw') as { endHost?: { ref: string } }).endHost?.ref).toBe(
      'el:desktop/other-cta'
    );
    // ⌘Z: the inverse puts the old bind back — it re-attaches when the element is back.
    const undone = applyOps(applied.state, applied.inverse);
    expect((undone.state.get('arw') as { endHost?: { ref: string } }).endHost?.ref).toBe(
      'el:desktop/book-a-call'
    );
  });
});
