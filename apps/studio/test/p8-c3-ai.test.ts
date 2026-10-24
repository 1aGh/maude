// P8 stage C round 3 (area AI on the canvas + chat): source pins for the pieces a render test cannot reach cheaply.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('P8 c3: the v1 banner is gone (03 ai-working)', () => {
  test('canvas-shell mounts no "AI is editing this canvas" banner; the ring + tag say it', () => {
    const shell = read('canvas-shell.tsx');
    expect(shell).not.toContain("from './ai-banner.tsx'");
    expect(shell).not.toContain('<AiBanner');
  });
});
