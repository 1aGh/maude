// Finding 1d — client/shell-bus.js. Tauri delivers every `emit_to(<label>)` to each JS listener
// registered with the `Any` target in every webview, so a page must hear the shell ONLY on the
// Channel it hands `shell_subscribe` (bus.rs keeps it under the page's own label). These pin:
// one channel per page however many surfaces listen, messages routed by kind, unlisten, the
// browser no-op, a refusal that rejects (and is retried), and that no Tauri event listener is
// ever registered.

import { afterEach, describe, expect, test } from 'bun:test';
import { listen as githubListen } from '../client/github.js';
import { shellListen } from '../client/home/home-api.js';
import { listen } from '../client/shell-bus.js';

type Msg = { kind: string; payload: unknown };
type Ch = { onmessage?: (m: Msg) => void };

const g = globalThis as unknown as { window?: Record<string, unknown> };
// The window this file found, exactly: a real one (happy-dom) only loses the stubs; anything else —
// no `window`, or an own `window: undefined` another file left — is put back as it was. Keeping a
// `{}` stub here left `window` without `document` for every later file in the same bun process,
// and their `typeof window === 'undefined'` happy-dom guards skipped registering (V2-5 suite-fix A3).
const before = Object.getOwnPropertyDescriptor(g, 'window');
const hadWindow = !!g.window;
afterEach(() => {
  if (hadWindow && g.window) {
    g.window.__TAURI__ = undefined;
    g.window.__maudeShellBus = undefined;
  } else if (before) Object.defineProperty(g, 'window', before);
  else Reflect.deleteProperty(g, 'window');
});

function shell(refuse = 0) {
  const subs: Ch[] = [];
  const events: string[] = [];
  let refusals = refuse;
  if (!g.window) g.window = {};
  g.window.__maudeShellBus = undefined;
  g.window.__TAURI__ = {
    core: {
      Channel: class {
        onmessage?: (m: Msg) => void;
      },
      invoke: async (cmd: string, args: { onMessage: Ch }) => {
        if (cmd !== 'shell_subscribe') return null;
        if (refusals > 0) {
          refusals--;
          throw new Error("This window isn't showing its project.");
        }
        subs.push(args.onMessage);
        return null;
      },
    },
    event: {
      listen: async (ev: string) => {
        events.push(ev);
        return () => {};
      },
    },
  };
  const fire = (m: Msg) => {
    for (const s of subs) s.onmessage?.(m);
  };
  return { subs, events, fire };
}

describe('shell-bus', () => {
  test('one channel per page; each kind reaches only its own handlers', async () => {
    const { subs, events, fire } = shell();
    const got: string[] = [];
    await listen('shell://state', (p) => got.push(`state:${JSON.stringify(p)}`));
    await githubListen('github://device-code', (p) => got.push(`code:${JSON.stringify(p)}`));
    await shellListen('index://changed', (p) => got.push(`index:${JSON.stringify(p)}`));
    expect(subs.length).toBe(1);
    expect(events).toEqual([]);
    fire({ kind: 'shell://state', payload: { projects: [] } });
    fire({ kind: 'index://changed', payload: { pids: ['a'] } });
    fire({ kind: 'github://device-code', payload: { user_code: 'X' } });
    fire({ kind: 'menu://action', payload: { id: 'nobody-listens' } });
    expect(got).toEqual([
      'state:{"projects":[]}',
      'index:{"pids":["a"]}',
      'code:{"user_code":"X"}',
    ]);
  });

  test('unlisten stops that handler only', async () => {
    const { fire } = shell();
    const got: string[] = [];
    const off = await listen('shell://navigate', () => got.push('a'));
    await listen('shell://navigate', () => got.push('b'));
    off();
    fire({ kind: 'shell://navigate', payload: {} });
    expect(got).toEqual(['b']);
  });

  test('a refused subscribe rejects the listen, and the next listen asks again', async () => {
    const { subs, fire } = shell(1);
    await expect(listen('shell://state', () => {})).rejects.toThrow('showing its project');
    const got: unknown[] = [];
    await listen('shell://state', (p) => got.push(p));
    expect(subs.length).toBe(1);
    fire({ kind: 'shell://state', payload: 1 });
    expect(got).toEqual([1]);
    // home-api's wrapper swallows a refusal into a no-op unlisten
    shell(1);
    expect(typeof (await shellListen('shell://state', () => {}))).toBe('function');
  });

  test('outside the desktop app: a no-op unlisten, nothing subscribed', async () => {
    if (!g.window) g.window = {};
    g.window.__TAURI__ = undefined;
    g.window.__maudeShellBus = undefined;
    const off = await listen('shell://state', () => {
      throw new Error('never');
    });
    expect(typeof off).toBe('function');
    off();
  });
});
