// S8.7 — which print artboard is the back of a front (exporters/print-back.ts).
import { describe, expect, test } from 'bun:test';
import { type BoardLite, findBack } from '../exporters/print-back.ts';

const AB = (id: string, label: string, kind = 'print', w = 484, h = 640): BoardLite => ({
  id,
  label,
  kind,
  w,
  h,
});

const LETAK = [
  AB('a-flag', 'A · přední (FLAG)'),
  AB('b-flag', 'B · zadní (FLAG)'),
  AB('a-tackle', 'A · přední (TACKLE)'),
  AB('b-tackle', 'B · zadní (TACKLE)'),
];

describe('findBack', () => {
  test('pairs the leták fronts with their own backs by the words around the side', () => {
    expect(findBack(LETAK[0] as BoardLite, LETAK)?.id).toBe('b-flag');
    expect(findBack(LETAK[2] as BoardLite, LETAK)?.id).toBe('b-tackle');
  });

  test('a back has no back; a screen has no back; a different size is not a back', () => {
    expect(findBack(LETAK[1] as BoardLite, LETAK)).toBeNull();
    const post = AB('p', 'Post (front)', 'digital');
    expect(findBack(post, [post, AB('q', 'Post (back)', 'digital')])).toBeNull();
    const front = AB('f', 'Menu front', 'print', 100, 200);
    expect(findBack(front, [front, AB('g', 'Menu back', 'print', 300, 400)])).toBeNull();
  });

  test('English and diacritic spellings pair, and the only back of a size needs no shared words', () => {
    const f = AB('f', 'Business card · front');
    expect(findBack(f, [f, AB('b', 'Business card · back')])?.id).toBe('b');
    const g = AB('g', 'Vizitka');
    expect(findBack(g, [g, AB('h', 'Rückseite')])?.id).toBe('h');
  });

  test('two equally good backs are a guess, so there is none', () => {
    const f = AB('f', 'Flyer front');
    expect(findBack(f, [f, AB('b1', 'Flyer back'), AB('b2', 'Flyer — back')])).toBeNull();
  });
});
