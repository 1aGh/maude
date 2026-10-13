// V2-3.4 — the webview half of the native menu's one event (V2-1.3 §5.8): menu.rs sends
// `menu://action {id}` (registry id) to the focused window; `onMenuAction` hears it on THIS
// window only and hands the callback the id. `menu://new-project` is retired.

import { afterEach, describe, expect, test } from 'bun:test';
import * as github from '../client/github.js';

type Handler = (e: { payload: unknown }) => void;

const g = globalThis as unknown as { window?: { __TAURI__?: unknown } };
const hadWindow = 'window' in g;
afterEach(() => {
  if (hadWindow && g.window) g.window.__TAURI__ = undefined;
  else Reflect.deleteProperty(g, 'window');
});

function shell() {
  const here: Record<string, Handler> = {};
  const global: string[] = [];
  const t = {
    event: {
      listen: async (ev: string) => {
        global.push(ev);
        return () => {};
      },
    },
    webviewWindow: {
      getCurrentWebviewWindow: () => ({
        listen: async (ev: string, h: Handler) => {
          here[ev] = h;
          return () => {};
        },
      }),
    },
  };
  if (!g.window) g.window = {};
  g.window.__TAURI__ = t;
  return { here, global };
}

describe('onMenuAction (menu://action)', () => {
  test('subscribes on this window and passes the registry id', async () => {
    const { here, global } = shell();
    const seen: unknown[] = [];
    await github.onMenuAction((id: unknown) => seen.push(id));
    expect(Object.keys(here)).toEqual(['menu://action']);
    expect(global).toEqual([]); // window-scoped, never the global bus
    const fire = here['menu://action'];
    fire?.({ payload: { id: 'canvas.new' } });
    fire?.({ payload: { id: 'project.new' } });
    fire?.({ payload: null });
    expect(seen).toEqual(['canvas.new', 'project.new', undefined]);
  });

  test('the v1 New Project event has no listener helper any more', () => {
    expect('onMenuNewProject' in github).toBe(false);
  });
});
