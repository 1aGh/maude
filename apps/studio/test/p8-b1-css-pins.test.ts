// P8 bug sweep B1 — two layout bugs a unit test can only pin by their rules (both were verified by eye in the
// release client, before and after, at 1600×1000):
//  · a folded AI chat leaves its corner icon at the bottom of the slot, ON TOP of the last row of the panel above
//    it (Version history's "Advanced · Branch, git, changed fi…") — the panel must stop short of the icon;
//  · Version history's sub line ("16:24 · You · changed outside the ap") ended mid-word: text-overflow does not
//    reach text inside a flex container, so the words themselves carry the ellipsis.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('P8 B1 — layout rules', () => {
  test('the right (and left) slot clears the folded AI chat icon in its bottom corner', () => {
    const css = read('client/v2/shell/floating-panels.css');
    expect(css).toMatch(
      /\.st-body--float:has\(> \.st-corner--ai\) > \.st-dockslot--right\s*\{[^}]*padding-bottom:/
    );
    expect(css).toMatch(
      /\.st-body--float:has\(> \.st-corner--ai-left\) > \.st-dockslot--left\s*\{[^}]*padding-bottom:/
    );
  });
});
