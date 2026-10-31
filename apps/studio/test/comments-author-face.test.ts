// rc.1 F08 — one face per comment author: the pin, the thread card and the Comments list's row read the
// same letter and tone, "You" is the viewer's own, and nothing ever wears a "?".

import { describe, expect, test } from 'bun:test';
import { authorFace, isUnsigned, SOMEONE } from '../comments/author-face.ts';
import { pinInitial } from '../comments-overlay.tsx';
import { toneFor, YOU_TONE } from '../presence/tones.ts';

describe('authorFace', () => {
  test('the viewer is "You", on the tone "You" wears, with their own initial', () => {
    expect(authorFace('iagh', 'iagh')).toEqual({
      name: 'You',
      letter: 'I',
      tone: YOU_TONE,
      you: true,
    });
  });

  test('anybody else keeps their name and the tone their name hashes to', () => {
    expect(authorFace('Tereza', 'iagh')).toEqual({
      name: 'Tereza',
      letter: 'T',
      tone: toneFor('Tereza'),
      you: false,
    });
    expect(authorFace('  jan ', null).letter).toBe('J');
  });

  test('an unsigned record is Someone on grey — never a "?"', () => {
    for (const a of ['', '   ', 'unknown', 'Unknown', undefined, null, 7]) {
      expect(isUnsigned(a)).toBe(true);
      const f = authorFace(a, 'iagh');
      expect(f.name).toBe(SOMEONE);
      expect(f.letter).toBe('S');
      expect(f.tone).toBe('grey');
      expect(f.you).toBe(false);
    }
  });
});

describe('the pin wears the list avatar’s letter', () => {
  test('pinInitial is the face letter, including for an unsigned record', () => {
    expect(pinInitial('Tereza')).toBe('T');
    expect(pinInitial('  jan')).toBe('J');
    expect(pinInitial('unknown')).toBe('S');
    expect(pinInitial('')).toBe('S');
    expect(pinInitial('')).not.toBe('?');
  });
});
