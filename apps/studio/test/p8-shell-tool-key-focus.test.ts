// P8 bug sweep B2 — "F after opening a canvas from the Canvases panel arms Frame but opens no size
// picker". The shell replays a tool key into the active canvas (`run-action tool.key`) while the shell
// holds the focus; the canvas answers F with `tool-panel-open {panel:'sizes'}`, and the shell's EH-P4-2
// gate (use-tool-panels.js) drops every panel request from an iframe that is not the shell's
// `document.activeElement`. So the pick was refused silently. A tool key is the person driving the
// canvas: the handler hands the canvas the focus before it posts the key.
import { describe, expect, test } from 'bun:test';
import { SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';

describe('shell tool keys focus the active canvas before replaying', () => {
  test('tool.frame (F) focuses the active frame, then posts tool.key', () => {
    const calls: string[] = [];
    const frame = { focus: () => calls.push('focus') };
    const d = {
      activePath: 'ui/Smoke.tsx',
      iframesRef: { current: new Map([['ui/Smoke.tsx', frame]]) },
      postToActiveCanvas: (m: { id?: string }) => calls.push(`post:${m.id}`),
    };
    const h = SHELL_KEY_HANDLERS['tool.frame'];
    expect(typeof h).toBe('function');
    h(d, { event: { key: 'f', preventDefault() {}, shiftKey: false } });
    expect(calls).toEqual(['focus', 'post:tool.key']);
  });

  test('no frame for the active path: still posts, never throws', () => {
    const calls: string[] = [];
    const d = {
      activePath: 'ui/Gone.tsx',
      iframesRef: { current: new Map() },
      postToActiveCanvas: (m: { id?: string }) => calls.push(`post:${m.id}`),
    };
    SHELL_KEY_HANDLERS['tool.frame'](d, {
      event: { key: 'f', preventDefault() {}, shiftKey: false },
    });
    expect(calls).toEqual(['post:tool.key']);
  });
});
