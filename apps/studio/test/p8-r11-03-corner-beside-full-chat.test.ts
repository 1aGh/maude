// P8 r11 (03 `ai-long`): the folded Inspector's corner icon (top right, under the Share cluster) sat on the header of a
// full-height AI chat — over its "Hide the AI chat panel" chevron. A short chat is a bottom island and clears the
// icon; a full-height one (`data-full`) reaches the top, so the icon stands beside it, on the canvas side — the
// same rule the pinned layout already has (06 `ad-pinned`). Verified by eye in the release client; this pins the rule.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dir, '../client/v2/shell/floating-panels.css'), 'utf8');

describe('P8 r11 — corner icons stand beside a full-height chat', () => {
  test('the right corner icon moves left of a full-height chat in the right slot', () => {
    expect(css).toMatch(
      /\.st-body--float:has\(> \.st-dockslot--right:not\(\.is-hidden\):not\(\.is-collapsed\) \.st-dockslot-ai:not\(\[hidden\]\) > \.ai-island\[data-full="true"\]\) > \.st-corner--right\s*\{[^}]*right:\s*calc\([^}]*\}/
    );
  });

  test('and the left one, for a chat docked on the left', () => {
    expect(css).toMatch(
      /\.st-body--float:has\(> \.st-dockslot--left:not\(\.is-hidden\):not\(\.is-collapsed\) \.st-dockslot-ai:not\(\[hidden\]\) > \.ai-island\[data-full="true"\]\) > \.st-corner--left\s*\{[^}]*left:\s*calc\([^}]*\}/
    );
  });
});
