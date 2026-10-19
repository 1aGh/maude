// S4.12 (canvas 15 `an-section`) — a section is a named place: pick its colour, Fold it to one line that
// says what is inside ("6 stickies · 2 people"), and Unfold it. Folding hides the members from the
// drawing only — they stay in the file and move with the section.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AnnotationElement } from '../annotations/types.ts';
import { ElementNode } from '../annotations/ui/element-node.tsx';
import { strokeToRenderItem } from '../annotations/ui/render-model.ts';
import {
  foldSummary,
  foldVerb,
  hiddenByFold,
  membersOf,
  SECTION_TONES,
  setFolded,
  toneOf,
  withoutFolded,
} from '../annotations/ui/section-fold.ts';
import { elementsToStrokes, strokesToElementMap } from '../annotations/v1-adapter.ts';
import { SECTION_FOLDED_H } from '../annotations/constants.ts';
import {
  type SectionStroke,
  type StickyStroke,
  type Stroke,
  strokeBBox,
  strokeHitTest,
} from '../annotations-model.ts';

const section = (id: string, o: Partial<SectionStroke> = {}): SectionStroke => ({
  id,
  tool: 'section',
  x: 0,
  y: 0,
  w: 600,
  h: 400,
  label: 'Zpětná vazba Tereza',
  color: SECTION_TONES[5].value,
  ...o,
});
const note = (id: string, who?: string, o: Partial<StickyStroke> = {}): StickyStroke => ({
  id,
  tool: 'sticky',
  color: '#fce8a6',
  x: 10,
  y: 10,
  w: 100,
  h: 100,
  text: id,
  fontSize: 14,
  ...(who ? { authorName: who } : {}),
  ...o,
});

describe('the count line', () => {
  test('"6 stickies · 2 people"', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => note(id, i < 3 ? 'Tereza' : 'Jonas'));
    expect(foldSummary(six)).toBe('6 stickies · 2 people');
  });
  test('one person says no people; one sticky reads for one', () => {
    expect(foldSummary([note('a', 'Tereza'), note('b', 'Tereza'), note('c', 'Tereza')])).toBe(
      '3 stickies'
    );
    expect(foldSummary([note('a', 'Tereza')])).toBe('1 sticky');
  });
  test('the AI counts as a person; you count once however you are named', () => {
    const ai = { ...note('a'), author: 'ai' } as Stroke;
    expect(foldSummary([ai, note('b', 'Jonas')], 'Jonas')).toBe('2 stickies · 2 people');
    expect(foldSummary([note('a', 'Jonas'), note('b', 'Jonas')], 'Jonas')).toBe('2 stickies');
  });
  test('anything but stickies counts as items', () => {
    const r: Stroke = { id: 'r', tool: 'rect', color: '#000', width: 2, x: 0, y: 0, w: 5, h: 5 };
    expect(foldSummary([note('a'), r])).toBe('2 items');
    expect(foldSummary([])).toBe('0 items');
  });
});

describe('Fold / Unfold', () => {
  const board: Stroke[] = [section('s'), note('a'), note('b'), note('far')];
  const inside = (id: string) => (id === 's' ? ['a', 'b'] : []);

  test('the verb flips with the state', () => {
    expect(foldVerb(board, ['s'])).toBe('fold');
    expect(foldVerb(setFolded(board, 's', true), ['s'])).toBe('unfold');
    expect(foldVerb(board, ['a'])).toBeNull();
  });
  test('folding hides the members from the drawing, not from the board', () => {
    const folded = setFolded(board, 's', true);
    expect(folded).toHaveLength(4);
    expect(hiddenByFold(folded, inside)).toEqual(new Set(['a', 'b']));
    expect(withoutFolded(folded, inside).map((s) => s.id)).toEqual(['s', 'far']);
    expect(withoutFolded(board, inside)).toBe(board);
  });
  test('unfolding gives everything back, and drops the flag', () => {
    const back = setFolded(setFolded(board, 's', true), 's', false);
    expect((back[0] as SectionStroke).folded).toBeUndefined();
    expect(withoutFolded(back, inside)).toBe(back);
  });
  test('members come from the layer containment', () => {
    expect(membersOf(board, 's', inside).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('colours', () => {
  test('six tones: grey, yellow, coral, green, sky, lilac', () => {
    expect(SECTION_TONES.map((t) => t.name)).toEqual([
      'Grey',
      'Yellow',
      'Coral',
      'Green',
      'Sky',
      'Lilac',
    ]);
    expect(toneOf(SECTION_TONES[3].value)).toBe('Green');
    expect(toneOf('#123456')).toBeNull();
  });
});

describe('in the file, and on the screen', () => {
  const el: AnnotationElement = {
    id: 's',
    type: 'section',
    index: 'a0',
    x: 0,
    y: 0,
    w: 600,
    h: 400,
    label: 'Nápady na story',
    color: '#3b82c4',
  };
  test('Fold written from the UI reaches the element; Unfold removes it', () => {
    const strokes = setFolded(elementsToStrokes([el]), 's', true);
    const written = strokesToElementMap(strokes, new Map([['s', el]])).get('s');
    expect(written?.folded).toBe(true);
    const back = elementsToStrokes([written as AnnotationElement]);
    expect((back[0] as SectionStroke).folded).toBe(true);
    const open = strokesToElementMap(
      setFolded(back, 's', false),
      new Map([['s', written as AnnotationElement]])
    ).get('s');
    expect(open?.folded).toBeUndefined();
  });

  const draw = (s: SectionStroke, note?: string) => {
    const item = strokeToRenderItem(s);
    return renderToStaticMarkup(
      createElement(ElementNode, {
        el: (item as { el: AnnotationElement }).el,
        interactive: true,
        edit: null,
        foldNote: note,
        resolveAsset: (h: string) => h,
      })
    );
  };
  test('a folded section keeps its name and says what is inside', () => {
    const html = draw(section('s', { folded: true }), '6 stickies · 2 people');
    expect(html).toContain('Zpětná vazba Tereza');
    expect(html).toContain('data-fold-note="1"');
    expect(html).toContain('6 stickies · 2 people');
  });
  test('an open section has no count line', () => {
    expect(draw(section('s'))).not.toContain('data-fold-note');
  });
});

// S4.13 (lead follow-up) — a folded section is ONE LINE on the board: drawn, grabbed and boxed as its
// header strip, not as the full dashed outline. The file keeps the full size, so Unfold restores it.
describe('a folded section collapses to one line', () => {
  const open = section('s');
  const folded = setFolded([open], 's', true)[0] as SectionStroke;

  test('the box of a folded section is its header strip; unfolded it is the whole section', () => {
    expect(strokeBBox(open)).toMatchObject({ x: 0, y: 0, w: 600, h: 400 });
    expect(strokeBBox(folded)).toMatchObject({ x: 0, y: 0, w: 600, h: SECTION_FOLDED_H });
  });
  test('a click where the folded body used to be reaches what is behind; the header still grabs', () => {
    expect(strokeHitTest(open, 300, 400, 4)).toBe(true); // the old bottom border
    expect(strokeHitTest(folded, 300, 400, 4)).toBe(false); // folded: nothing there any more
    expect(strokeHitTest(folded, 300, SECTION_FOLDED_H, 4)).toBe(true); // the strip's own border
    expect(strokeHitTest(folded, 20, -10, 4)).toBe(true); // the label chip above the corner
  });
  test('the drawing is one line tall and the size in the file is untouched', () => {
    const item = strokeToRenderItem(folded) as { el: AnnotationElement };
    expect(item.el.h).toBe(400); // geometry stays the file's
    const html = renderToStaticMarkup(
      createElement(ElementNode, {
        el: item.el,
        interactive: true,
        edit: null,
        foldNote: '3 stickies',
        resolveAsset: (h: string) => h,
      })
    );
    expect(html).toContain(`height="${SECTION_FOLDED_H}"`);
    expect(html).not.toContain('height="400"');
  });
  test('unfold restores the size', () => {
    const back = setFolded([folded], 's', false)[0] as SectionStroke;
    expect(back.h).toBe(400);
    expect(back.w).toBe(600);
    expect(back.folded).toBeUndefined();
    expect(strokeBBox(back)).toMatchObject({ h: 400 });
  });
  test('a section already shorter than the strip keeps its own height', () => {
    const short = setFolded([section('t', { h: 30 })], 't', true)[0] as SectionStroke;
    expect(strokeBBox(short)).toMatchObject({ h: 30 });
  });
});
