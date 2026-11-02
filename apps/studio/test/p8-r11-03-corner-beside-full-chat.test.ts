// P8 r11 (03 `ai-long`): the folded Inspector's corner icon (top right, under the Share cluster) sat on the header of a
// full-height AI chat — over its "Hide the AI chat panel" chevron. (rc.1 finding 6: a long chat that merely grew to the
// window reached the same corner, so the icon now stands beside ANY shown chat.) A short chat is a bottom island and clears the
// icon; a full-height one (`data-full`) reaches the top, so the icon stands beside it, on the canvas side — the
// same rule the pinned layout already has (06 `ad-pinned`). Verified by eye in the release client; this pins the rule.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// biome wraps a long `:has(…)` selector over several lines: read the stylesheet as one line
const css = readFileSync(join(import.meta.dir, '../client/v2/shell/floating-panels.css'), 'utf8')
  .replace(/\s+/g, ' ')
  .replace(/\( /g, '(')
  .replace(/ \)/g, ')');

describe('P8 r11 — corner icons stand beside a full-height chat', () => {
  test('the right corner icon moves left of a full-height chat in the right slot', () => {
    expect(css).toMatch(
      /\.sh-body--float:has\(> \.sh-dockslot--right:not\(\.is-hidden\):not\(\.is-collapsed\) \.sh-dockslot-ai:not\(\[hidden\]\)\) > \.sh-corner--right\s*\{[^}]*right:\s*calc\([^}]*\}/
    );
  });

  test('and the left one, for a chat docked on the left', () => {
    expect(css).toMatch(
      /\.sh-body--float:has\(> \.sh-dockslot--left:not\(\.is-hidden\):not\(\.is-collapsed\) \.sh-dockslot-ai:not\(\[hidden\]\)\) > \.sh-corner--left\s*\{[^}]*left:\s*calc\([^}]*\}/
    );
  });
});
