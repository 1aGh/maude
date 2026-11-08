// #168 F4 — the canvas reports an object's inline `background` shorthand beside its `authored` map (`declared`,
// dom-selection.ts), and the Fill row reads it through `declaredOf` (css-write.js). The canvas is untrusted: the
// value is capped at 512 characters and must look like a colour, a `var()` or a gradient — on the canvas side when
// it is read, and again in the shell before the Fill row uses it. Anything else (a url(), a 100 kB string, a
// declaration break) is not reported, and the shell drops it if a canvas sends it anyway.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

import { declaredBackgroundOk, declaredOf } from '../client/v2/inspector/css-write.js';
import { styleMapsFor } from '../dom-selection.ts';
import { DECLARED_BACKGROUND_MAX } from '../editing/declared-background.ts';

const GOOD = [
  'var(--bg-3, #d4d4d8)',
  '#fff',
  '#d4d4d8cc',
  'transparent',
  'rebeccapurple',
  'rgb(10 20 30 / 50%)',
  'oklch(0.7 0.1 200)',
  'linear-gradient(90deg, #fff 0%, var(--accent) 100%)',
  'repeating-radial-gradient(circle, red, blue 10px)',
  'conic-gradient(from 0deg, red, blue), var(--bg-1)',
];
const BAD = [
  'url(https://example.test/x.png)',
  'linear-gradient(red, blue), url(/x.png)',
  'image-set("a.png" 1x)',
  'red; color: blue',
  'var(--x) } body { display: none',
  `#${'a'.repeat(DECLARED_BACKGROUND_MAX)}`,
  `linear-gradient(${'red, '.repeat(200)}blue)`,
  '',
  42,
  null,
];

describe('the declared background shape', () => {
  test('a colour, a var() or a gradient passes', () => {
    for (const v of GOOD) expect([v, declaredBackgroundOk(v)]).toEqual([v, true]);
  });
  test('anything else, or anything over the cap, does not', () => {
    for (const v of BAD) expect([v, declaredBackgroundOk(v)]).toEqual([v, false]);
  });
});

describe('the shell re-checks it (declaredOf)', () => {
  test('a good shorthand still fills an empty authored map', () => {
    expect(declaredOf({ authored: {}, declared: { background: 'var(--bg-3, #d4d4d8)' } })).toEqual({
      background: 'var(--bg-3, #d4d4d8)',
    });
  });
  test('a planted or oversized shorthand is dropped', () => {
    for (const v of BAD)
      expect(declaredOf({ authored: {}, declared: { background: v } })).toEqual({});
  });
});

describe('the canvas side reports only a capped, shaped value', () => {
  function bg(style: string) {
    const el = document.createElement('div');
    el.setAttribute('style', style);
    document.body.append(el);
    const out = styleMapsFor(el).declared;
    el.remove();
    return out;
  }
  test('a gradient is reported', () => {
    expect(bg('background: linear-gradient(90deg, red, blue)')?.background).toContain('gradient');
  });
  test('a url() or an oversized value is not', () => {
    expect(bg('background: url(https://example.test/x.png)')?.background).toBeUndefined();
    expect(
      bg(`background: linear-gradient(${'red, '.repeat(200)}blue)`)?.background
    ).toBeUndefined();
  });
});
