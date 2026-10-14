// V2-3.4 — the webview half of the native menu's one message (V2-1.3 §5.8): menu.rs sends
// `menu://action {id}` (registry id) to the focused window; `onMenuAction` hears it on THIS
// page only and hands the callback the id. `menu://new-project` is retired.
// Finding 1d: the message arrives on the page's own `shell_subscribe` Channel
// (client/shell-bus.js), never a Tauri event — a global or window-scoped `listen` registers a
// target an `emit_to` aimed at another webview also reaches.

import { afterEach, describe, expect, test } from 'bun:test';
import * as github from '../client/github.js';

type Msg = { kind: string; payload: unknown };

const g = globalThis as unknown as { window?: Record<string, unknown> };
const hadWindow = 'window' in g;
afterEach(() => {
  if (hadWindow && g.window) {
    g.window.__TAURI__ = undefined;
    g.window.__maudeShellBus = undefined;
  } else Reflect.deleteProperty(g, 'window');
});

function shell() {
  const listens: string[] = [];
  const box: { ch: { onmessage?: (m: Msg) => void } | null } = { ch: null };
  const t = {
    core: {
      Channel: class {
        onmessage?: (m: Msg) => void;
      },
      invoke: async (cmd: string, args: { onMessage: { onmessage?: (m: Msg) => void } }) => {
        if (cmd === 'shell_subscribe') box.ch = args.onMessage;
        return null;
      },
    },
    event: {
      listen: async (ev: string) => {
        listens.push(ev);
        return () => {};
      },
    },
    webviewWindow: {
      getCurrentWebviewWindow: () => ({
        listen: async (ev: string) => {
          listens.push(`here:${ev}`);
          return () => {};
        },
      }),
    },
  };
  if (!g.window) g.window = {};
  g.window.__TAURI__ = t;
  g.window.__maudeShellBus = undefined;
  return { listens, fire: (m: Msg) => box.ch?.onmessage?.(m) };
}

describe('onMenuAction (menu://action)', () => {
  test('hears it on this page’s own channel and passes the registry id', async () => {
    const { listens, fire } = shell();
    const seen: unknown[] = [];
    await github.onMenuAction((id: unknown) => seen.push(id));
    expect(listens).toEqual([]); // no Tauri event listener of any kind
    fire({ kind: 'menu://action', payload: { id: 'canvas.new' } });
    fire({ kind: 'menu://action', payload: { id: 'project.new' } });
    fire({ kind: 'github://device-code', payload: { id: 'not-a-menu-action' } });
    fire({ kind: 'menu://action', payload: null });
    expect(seen).toEqual(['canvas.new', 'project.new', undefined]);
  });

  test('the v1 New Project event has no listener helper any more', () => {
    expect('onMenuNewProject' in github).toBe(false);
  });
});
