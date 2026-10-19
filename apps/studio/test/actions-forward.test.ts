// V2-2.4 step 5 — the canvas → shell forward table is generated from the registry (it was a hand
// list in inspect.ts) and the injected script's chord normaliser agrees with keys.ts.
import { describe, expect, test } from 'bun:test';

import { CHORD_OF_EVENT_JS, canvasForwards } from '../actions/forward.ts';
import { chordFromEvent, type KeyEventLike } from '../actions/keys.ts';

// What inspect.ts forwarded by hand before the swap (v1): ⌘K, ⌘R and ⇧⌘{I,M,E,H,T,G}.
const V1_HAND_LIST = {
  '⇧⌘C': 'export.copy-png', // S8.8 (09 Export ex-inspector): Copy as PNG, from the canvas too
  '⇧⌘E': 'export.open',
  '⇧⌘H': 'handoff.open',
  '⇧⌘I': 'view.inspector',
  '⇧⌘M': 'view.comments',
  '⇧⌘T': 'view.timeline-keep-open',
  '⌘K': 'search.open',
  '⌘R': 'canvas.reload',
  // V2-4.1 approved delta: ⌘\ hides / shows all panels, from the canvas too (view.panels is fromCanvas).
  '⌘\\': 'view.panels',
  // V2-4 gate approved delta (rule 13): Version history moved ⇧⌘G → ⌥⌘H (CONTRACT §1).
  '⌥⌘H': 'history.open',
  // S3.1 approved delta (CONTRACT §2 [A7]): Present ⌥⌘↵ / Present from the start ⇧⌥⌘↵, from the
  // canvas too — the shell owns the mode.
  '⌥⌘↵': 'present.from-selection',
  '⌥⇧⌘↵': 'present.from-start',
  // S2.21 approved delta (14 ed-edge-keys): F6 / ⇧F6 move the keyboard between the panels and the canvas, so the
  // way out of a canvas (any canvas, even one that failed to build) is forwarded too — the one bare-key chord.
  F6: 'ui.cycle-region',
  '⇧F6': 'ui.cycle-region',
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
    ev('˙', 'KeyH', { metaKey: true, altKey: true }), // V2-4 gate ⌥⌘H (macOS ⌥H types '˙')
    ev('\\', 'Backslash', { metaKey: true }), // V2-4.1 ⌘\
    ev('\\', 'Backslash', { ctrlKey: true }),
    ev('«', 'Backslash', { metaKey: true }), // a layout whose backslash key types something else → e.code
    ev('Enter', 'Enter', { metaKey: true, altKey: true }), // S3.1 ⌥⌘↵
    ev('Enter', 'Enter', { metaKey: true, altKey: true, shiftKey: true }), // S3.1 ⇧⌥⌘↵ keeps its ⇧
    ev('Enter', 'NumpadEnter', { metaKey: true, altKey: true }),
    ev('F6', 'F6'), // S2.21
    ev('F6', 'F6', { shiftKey: true }),
  ];
  for (const e of rows)
    test(`${JSON.stringify(e)} → ${chordFromEvent(e)}`, () =>
      expect(chordOf(e)).toBe(chordFromEvent(e)));
  test('every forwarded chord is ⌘ + modifiers + a letter, the backslash or ↵, or F6 (the normaliser’s domain)', () => {
    for (const c of Object.keys(canvasForwards())) expect(c).toMatch(/^([⌥⇧]*⌘([A-Z]|\\|↵)|⇧?F6)$/);
  });
});
