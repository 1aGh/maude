// P8 stage C round 7 — 15 Annotations: CSS pins for the live states the board draws (cheap rule checks).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('an-print: the "Not printed" pill paints ABOVE the paper it sits inside', () => {
  test('the pin tags carry a z-index (they are the first child, the paper is a later sibling)', () => {
    const src = read('annotations/ui/time-pins.tsx');
    const rule = src.match(/\.dc-annot-pintag \{[^}]*\}/);
    expect(rule?.[0]).toMatch(/z-index:\s*2/);
  });
});

describe('an-stk-search: a result tile has its own surface (the picker panel is --bg-1)', () => {
  test('.sg-cell is not --bg-1 (it vanished on the panel in light)', () => {
    const css = read('client/v2/annotations/stickers-gallery.css');
    const rule = css.match(/\.sg-cell \{[^}]*\}/);
    expect(rule?.[0]).toMatch(/background: var\(--bg-3\)/);
    expect(rule?.[0]).not.toMatch(/background: var\(--bg-1\)/);
  });
});

describe('an-vote:the Start-a-vote sheet is opaque (the inspector must not read through it)', () => {
  const css = read('client/v2/annotations/vote.css');
  test('the sheet takes the popover/sheet surface, the bar keeps the island frost', () => {
    const sheet = css.match(/\n\s*\.an-vsheet \{\n\s*width: min\(440px[^}]*\}/);
    expect(sheet).not.toBeNull();
    expect(sheet?.[0]).toMatch(/background: var\(--bg-2\)/);
    const shared = css.match(/\.an-vbar,\n\s*\.an-vsheet \{[^}]*\}/);
    expect(shared?.[0]).toContain('var(--island-bg');
  });
});
