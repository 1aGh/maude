// T2.5 (#163) — Esc on an inline text keeps what was typed, for EVERY text (as Figma does), not only a text the
// Text tool has just made. Esc ends the edit and saves the words; it never puts the old text back.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { textEditKey } from '../editing/text-in-place.tsx';

const key = (k: string, extra: Partial<{ shiftKey: boolean }> = {}) => ({
  key: k,
  shiftKey: false,
  ...extra,
});

describe('Esc on an inline text', () => {
  test('Esc commits the typed words — it does not restore the old text', () => {
    expect(textEditKey(key('Escape'))).toBe('commit');
  });
  test('Enter ends the edit (blur commits); Shift+Enter and letters are the field’s own', () => {
    expect(textEditKey(key('Enter'))).toBe('blur');
    expect(textEditKey(key('Enter', { shiftKey: true }))).toBe('none');
    expect(textEditKey(key('a'))).toBe('none');
  });
  test('the canvas shell routes its text-edit keys through textEditKey and keeps no restore-on-Esc switch', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'canvas-shell.tsx'), 'utf8');
    expect(src).toContain('textEditKey(e)');
    expect(src).not.toMatch(/escKeeps/);
  });
});
