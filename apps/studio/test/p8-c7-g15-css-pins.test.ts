// P8 stage C round 7 — 15 Annotations: CSS pins for the live states the board draws (cheap rule checks).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('an-vote: the Start-a-vote sheet is opaque (the inspector must not read through it)', () => {
  const css = read('client/v2/annotations/vote.css');
  test('the sheet takes the popover/sheet surface, the bar keeps the island frost', () => {
    const sheet = css.match(/\n\s*\.an-vsheet \{\n\s*width: min\(440px[^}]*\}/);
    expect(sheet).not.toBeNull();
    expect(sheet?.[0]).toMatch(/background: var\(--bg-2\)/);
    const shared = css.match(/\.an-vbar,\n\s*\.an-vsheet \{[^}]*\}/);
    expect(shared?.[0]).toContain('var(--island-bg');
  });
});
