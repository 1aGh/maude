// V2-2.4 — chord normalisation and event mapping (V2-1.3 contract §5.4, §7 row 1).
import { describe, expect, test } from 'bun:test';

import {
  BROWSER_RESERVED,
  chord,
  chordFromEvent,
  formatChord,
  hasCommandMod,
  k,
  splitChord,
  TEXT_RESERVED,
  toTauriAccel,
} from '../actions/keys.ts';

describe('chord() — every spelling converges on one canonical form', () => {
  const same: [string, string[]][] = [
    ['⇧⌘M', ['⌘⇧M', '⌘ ⇧ M', '⇧⌘M', '⇧ ⌘ M', 'Cmd+Shift+M', 'shift+cmd+m', 'Meta+Shift+m']],
    ['⌘K', ['⌘K', '⌘ K', 'Cmd+K', 'cmd+k']],
    ['⌃K', ['⌃K', 'ctrl+k']],
    ['⌥⌘↵', ['⌥⌘↵', '⌘⌥↵', 'Cmd+Alt+Enter', '⌥ ⌘ Return']],
    ['esc', ['esc', 'Esc', 'Escape']],
    ['⌘−', ['⌘−', '⌘ −', '⌘-', 'Cmd+-']],
    ['⌘+', ['⌘+', '⌘ +']],
    ['⇧P', ['⇧P', '⇧ P', 'Shift+p']],
    ['Space', ['Space', ' ']],
    ['F1', ['F1', 'f1']],
    ['?', ['?']],
    ['⌫', ['⌫', 'Backspace']],
    ['⌦', ['⌦', 'Delete']],
    ['⌃⌥⇧⌘Z', ['⌘⇧⌥⌃Z', 'ctrl+alt+shift+cmd+z']],
  ];
  for (const [want, spellings] of same)
    for (const s of spellings)
      test(`${JSON.stringify(s)} → ${want}`, () => expect(chord(s)).toBe(want));

  test('pointer gestures are not chords', () => {
    expect(chord('⌘ click')).toBeNull();
    expect(chord('⌘ ⇧ click')).toBeNull();
    expect(chord('⌘ hover')).toBeNull();
    expect(chord('')).toBeNull();
  });
  test('a lone modifier glyph is a key, not a modifier', () => expect(chord('⇧')).toBe('⇧'));
  test('k() throws on a non-chord (registry literals must not silently vanish)', () => {
    expect(() => k('⌘ click')).toThrow();
    expect(k('⇧ ⌘ E')).toBe('⇧⌘E');
  });
});

describe('chordFromEvent() — the DOM event table', () => {
  const rows: [string, Parameters<typeof chordFromEvent>[0], string][] = [
    ['⇧⌘E', { key: 'E', code: 'KeyE', metaKey: true, shiftKey: true }, '⇧⌘E'],
    ['lower-case letter', { key: 'e', code: 'KeyE', metaKey: true }, '⌘E'],
    ['? drops the ⇧ the character encodes', { key: '?', code: 'Slash', shiftKey: true }, '?'],
    ['⌘? keeps ⌘', { key: '?', code: 'Slash', shiftKey: true, metaKey: true }, '⌘?'],
    [
      'macOS ⌥ chord (e.key π) → e.code',
      { key: 'π', code: 'KeyP', metaKey: true, altKey: true },
      '⌥⌘P',
    ],
    [
      'macOS ⌥⇧ chord keeps ⇧ on a letter',
      { key: '∏', code: 'KeyP', metaKey: true, altKey: true, shiftKey: true },
      '⌥⇧⌘P',
    ],
    ['⌥⌘↵', { key: 'Enter', code: 'Enter', metaKey: true, altKey: true }, '⌥⌘↵'],
    ['⌃ folds into ⌘ (v1 metaKey || ctrlKey)', { key: 'k', code: 'KeyK', ctrlKey: true }, '⌘K'],
    ['⇧← keeps ⇧ on a named key', { key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true }, '⇧←'],
    ['Space', { key: ' ', code: 'Space' }, 'Space'],
    ['⇧S', { key: 'S', code: 'KeyS', shiftKey: true }, '⇧S'],
    ['esc', { key: 'Escape', code: 'Escape' }, 'esc'],
    ['⇧esc', { key: 'Escape', code: 'Escape', shiftKey: true }, '⇧esc'],
    ['⌫', { key: 'Backspace', code: 'Backspace' }, '⌫'],
    ['⌦', { key: 'Delete', code: 'Delete' }, '⌦'],
    ['Home keeps ⇧', { key: 'Home', code: 'Home', shiftKey: true }, '⇧Home'],
    ['F1', { key: 'F1', code: 'F1' }, 'F1'],
    ['⇧F1 keeps ⇧', { key: 'F1', code: 'F1', shiftKey: true }, '⇧F1'],
    ['minus becomes −', { key: '-', code: 'Minus', metaKey: true }, '⌘−'],
    ['⌘=', { key: '=', code: 'Equal', metaKey: true }, '⌘='],
    ['⌘+ (US: ⇧=)', { key: '+', code: 'Equal', metaKey: true, shiftKey: true }, '⌘+'],
    [
      'Czech QWERTZ ⌘1 = ⌘⇧ + the "+" key',
      { key: '1', code: 'Digit1', metaKey: true, shiftKey: true },
      '⌘1',
    ],
    ['Czech QWERTZ ⌘+ = the unshifted "+" key', { key: '+', code: 'Digit1', metaKey: true }, '⌘+'],
    ['⌘,', { key: ',', code: 'Comma', metaKey: true }, '⌘,'],
    ['dead key → e.code', { key: 'Dead', code: 'KeyE', altKey: true }, '⌥E'],
    ['non-Latin layout letter → e.code', { key: 'е', code: 'KeyT' }, 'T'],
  ];
  for (const [name, e, want] of rows)
    test(`${name} → ${want}`, () => expect(chordFromEvent(e)).toBe(want));
});

describe('helpers', () => {
  test('hasCommandMod', () => {
    expect(hasCommandMod('⇧⌘E')).toBe(true);
    expect(hasCommandMod('⇧P')).toBe(false);
  });
  test('splitChord / formatChord', () => {
    expect(splitChord('⌥⇧⌘P')).toEqual({ mods: ['⌥', '⇧', '⌘'], key: 'P' });
    expect(splitChord('⇧')).toEqual({ mods: [], key: '⇧' });
    expect(formatChord('⇧⌘E')).toBe('⇧⌘E');
    expect(formatChord('⇧⌘E', { spaced: true })).toBe('⇧ ⌘ E');
    expect(formatChord('esc', { spaced: true })).toBe('esc');
  });
  test('TEXT_RESERVED holds the text-editing chords, canonical', () => {
    for (const c of ['⌘Z', '⇧⌘Z', '⌘A', '⌘C', '⌘V', '⌘B', '⌥⌫'])
      expect(TEXT_RESERVED.has(c)).toBe(true);
    expect(TEXT_RESERVED.has('⌘K')).toBe(false);
  });
  test('BROWSER_RESERVED', () => {
    expect(BROWSER_RESERVED.has('⌘N')).toBe(true);
    expect(BROWSER_RESERVED.has('⇧⌘N')).toBe(true);
    expect(BROWSER_RESERVED.has('⌘K')).toBe(false);
  });
  test('toTauriAccel', () => {
    expect(toTauriAccel('⇧⌘N')).toBe('CmdOrCtrl+Shift+N');
    expect(toTauriAccel('⌘N')).toBe('CmdOrCtrl+N');
    expect(toTauriAccel('⌥⌘↵')).toBe('CmdOrCtrl+Alt+Enter');
    expect(toTauriAccel('⌘−')).toBe('CmdOrCtrl+-');
  });
});
