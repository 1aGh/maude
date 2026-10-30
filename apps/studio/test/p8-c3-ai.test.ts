// P8 stage C round 3 (area AI on the canvas + chat): source pins for the pieces a render test cannot reach cheaply.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('P8 c3: the pinned AI chat is the board 420 column (03 ai-long-pinned)', () => {
  test('rightPanelWidth: inspector 264, history 372, the pinned AI 420 (wider when dragged), else the user width', async () => {
    const { rightPanelWidth } = await import('../client/v2/shell/panel-layout.js');
    expect(rightPanelWidth({ active: 'inspector', base: 304 })).toBe(264); // P8 c5: with the chat pinned too the slot is 420 (see p8-c5-aichat)
    expect(rightPanelWidth({ active: 'changes', base: 304 })).toBe(372);
    expect(rightPanelWidth({ active: null, base: 304, aiPinned: true })).toBe(420);
    expect(rightPanelWidth({ active: null, base: 470, aiPinned: true })).toBe(470);
    expect(rightPanelWidth({ active: 'comments', base: 304 })).toBe(304);
  });
});

describe('P8 c3: the v1 banner is gone (03 ai-working)', () => {
  test('canvas-shell mounts no "AI is editing this canvas" banner; the ring + tag say it', () => {
    const shell = read('canvas-shell.tsx');
    expect(shell).not.toContain("from './ai-banner.tsx'");
    expect(shell).not.toContain('<AiBanner');
  });
});
