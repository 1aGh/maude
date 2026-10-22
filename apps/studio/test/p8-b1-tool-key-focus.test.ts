// P8 bug sweep B1 — "F after opening a canvas from the Canvases panel arms Frame but opens no size picker".
// The shell replays a tool key into the canvas (`run-action tool.key`); the canvas arms the tool and asks the
// shell for the picker (`tool-panel-open`), which the shell admits only for a canvas it sees focused
// (EH-P4-2). With the keyboard still in the Canvases panel the ask was refused. The replay now hands the
// keyboard to the canvas first.
import { describe, expect, test } from 'bun:test';

import { SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';

type Handler = (d: unknown, a: { event: unknown; ctx?: unknown }) => void;

function fakeFrame(log: string[]) {
  return {
    tagName: 'IFRAME',
    focus: () => log.push('frame.focus'),
    contentWindow: { focus: () => log.push('window.focus') },
  };
}

describe('P8 B1 — a tool key pressed in a panel puts the keyboard in the canvas', () => {
  test('F from the shell focuses the active canvas BEFORE the replay, so its size picker is admitted', () => {
    const log: string[] = [];
    const d = {
      activePath: 'ui/Smoke.tsx',
      iframesRef: { current: new Map([['ui/Smoke.tsx', fakeFrame(log)]]) },
      postToActiveCanvas: (m: { id?: string }) => log.push(`post ${m.id}`),
    };
    const event = {
      key: 'f',
      code: 'KeyF',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: () => log.push('preventDefault'),
    };
    (SHELL_KEY_HANDLERS['tool.frame'] as Handler)(d, { event });
    expect(log).toEqual(['preventDefault', 'frame.focus', 'window.focus', 'post tool.key']);
  });

  test('with no canvas open the key still replays (nothing to focus)', () => {
    const posts: unknown[] = [];
    const d = {
      activePath: null,
      iframesRef: { current: new Map() },
      postToActiveCanvas: (m: unknown) => posts.push(m),
    };
    const event = { key: 'f', code: 'KeyF', preventDefault: () => {} };
    (SHELL_KEY_HANDLERS['tool.frame'] as Handler)(d, { event });
    expect(posts.length).toBe(1);
  });
});
