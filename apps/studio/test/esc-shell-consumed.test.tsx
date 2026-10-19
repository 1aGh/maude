// gate-a-kernel — Esc the shell already consumed never reaches the canvas.
//
// S3.14 (decision v2-S3.14-esc-forwards-to-canvas) forwards a shell-focused Esc to the canvas as
// `run-action ui.step-back`, so the canvas replays its esc ladder (tool → Hand → Edit). The tree's
// search field (`[data-testid="canvas-search"]`) handles Esc itself — it prevents the key and clears
// or blurs — and React runs that before the shell's window listener, which then sees focus on BODY.
// The v1-keys characterization (`browser/canvas/text Escape`, `browser/timeline/text Escape`) showed
// the canvas stepping its ladder on top. A press something in the shell already consumed is that
// widget's step; the canvas and the shell's mode keep still. Unconsumed chrome / select presses
// still forward.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';
import { shellMode } from '../client/v2/shell/use-canvas-mode-lane.js';

function shell() {
  const posted: unknown[] = [];
  const d = {
    presentMode: false,
    viewerMode: false,
    focusedCommentId: null,
    setFocusedCommentId: () => {},
    activePath: '.design/ui/a.tsx',
    postToActiveCanvas: (m: unknown) => posted.push(m),
    tlKeyRef: { current: {} },
  };
  return { d, posted };
}
const esc = (consumed: boolean) => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  if (consumed) e.preventDefault(); // the search field's own onKeyDown ran first
  return e;
};
const press = (d: unknown, e: KeyboardEvent, focus: string) =>
  SHELL_KEY_HANDLERS['ui.step-back'](d, { event: e, ctx: { focus, facts: new Set<string>() } });

describe('shell Esc forwards to the canvas only when the shell did not consume it', () => {
  test('the search field cleared/blurred (PREVENTED, focus now BODY): nothing is forwarded', () => {
    act(() => shellMode.select('edit'));
    const { d, posted } = shell();
    press(d, esc(true), 'chrome');
    expect(posted).toEqual([]);
  });

  test('a consumed press does not move the shell’s mode either (Preview stays)', () => {
    act(() => shellMode.select('preview'));
    const { d, posted } = shell();
    press(d, esc(true), 'chrome');
    expect(posted).toEqual([]);
    expect(shellMode.get().mode).toBe('preview');
    act(() => shellMode.select('edit'));
  });

  test('chrome focus, nothing consumed: the press is forwarded (S3.14 stays)', () => {
    act(() => shellMode.select('edit'));
    const { d, posted } = shell();
    const e = esc(false);
    press(d, e, 'chrome');
    expect(posted.length).toBe(1);
    expect(JSON.stringify(posted[0])).toContain('ui.step-back');
    expect(e.defaultPrevented).toBe(true);
  });

  test('a focused <select>, nothing consumed: still forwarded', () => {
    const { d, posted } = shell();
    press(d, esc(false), 'select');
    expect(posted.length).toBe(1);
  });
});
