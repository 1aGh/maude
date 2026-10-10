// V2-2.4 step 5 — the canvas → shell forward table is generated from the registry (it was a hand
// list in inspect.ts) and the injected script's chord normaliser agrees with keys.ts.
import { describe, expect, test } from 'bun:test';

import { CHORD_OF_EVENT_JS, canvasForwards } from '../actions/forward.ts';
import { chordFromEvent, type KeyEventLike } from '../actions/keys.ts';

// What inspect.ts forwarded by hand before the swap (v1): ⌘K, ⌘R and ⇧⌘{I,M,E,H,T,G}.
const V1_HAND_LIST = {
  '⇧⌘E': 'export.open',
  '⇧⌘G': 'history.open',
  '⇧⌘H': 'handoff.open',
  '⇧⌘I': 'view.inspector',
  '⇧⌘M': 'view.comments',
  '⇧⌘T': 'view.timeline-keep-open',
  '⌘K': 'search.open',
  '⌘R': 'canvas.reload',
};

test('the generated forward table is exactly v1’s hand list', () => {
  expect(canvasForwards()).toEqual(V1_HAND_LIST);
});

describe('the injected chord normaliser agrees with chordFromEvent', () => {
  const chordOf = new Function(`return (${CHORD_OF_EVENT_JS});`)() as (e: KeyEventLike) => string;
  const ev = (key: string, code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
    key,
    code,
    ...mods,
  });
  const rows: KeyEventLike[] = [
    ev('k', 'KeyK', { metaKey: true }),
    ev('K', 'KeyK', { metaKey: true, shiftKey: true }),
    ev('k', 'KeyK', { ctrlKey: true }),
    ev('r', 'KeyR', { metaKey: true }),
    ev('I', 'KeyI', { metaKey: true, shiftKey: true }),
    ev('ˆ', 'KeyI', { metaKey: true, altKey: true, shiftKey: true }), // macOS ⌥ dead key → e.code
    ev('˚', 'KeyK', { metaKey: true, altKey: true }),
    ev('1', 'Digit1', { metaKey: true }),
    ev('е', 'KeyT', { metaKey: true, shiftKey: true }), // a non-Latin layout → e.code
  ];
  for (const e of rows)
    test(`${JSON.stringify(e)} → ${chordFromEvent(e)}`, () =>
      expect(chordOf(e)).toBe(chordFromEvent(e)));
  test('every forwarded chord is ⌘ + modifiers + a letter (the normaliser’s domain)', () => {
    for (const c of Object.keys(canvasForwards())) expect(c).toMatch(/^[⌥⇧]*⌘[A-Z]$/);
  });
});
