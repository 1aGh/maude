// V2-8.5 c4-video — cheap CSS pins for the 07 surroundings (the structure and behaviour have their own tests).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('07 · the artboard label row has no camera chip at rest', () => {
  const css = read('canvas-lib.tsx');
  test('the video badge is quiet until hover or keyboard focus', () => {
    expect(css).toMatch(
      /\.dc-canvas \.dc-artboard\.dc-positioned > \.dc-artboard-video-badge \{[^}]*opacity: 0;/s
    );
    expect(css).toMatch(
      /\.dc-artboard\.dc-positioned:hover > \.dc-artboard-video-badge,[^{]*:focus-visible \{ opacity: 1; \}/s
    );
  });
});
