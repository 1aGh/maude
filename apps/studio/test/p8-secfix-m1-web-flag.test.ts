// V2-8.9 M1 (decisions maude/v2-8.9-lead-m1-canvas-navigation-gate, maude/v2-8.9-m1-tab-web-flag-tauri-command):
// the studio page tells the desktop shell its "AI may › Search the web" switch — on load and on every
// change — through the caller-checked `set_tab_web` command, so the shell's navigation gate
// (windows.rs `navigation_allowed_for`) can keep the tab's canvas frames on loopback while it is off.
// A browser / cloud tab has no `window.__TAURI__` and does nothing.

import { afterEach, describe, expect, test } from 'bun:test';

import { MAY_KEY, tellShellWeb, writeMay } from '../client/v2/ai/ai-may.js';

function fakeWin() {
  const calls: Array<[string, unknown]> = [];
  const win = {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args: unknown) => {
          calls.push([cmd, args]);
          return Promise.resolve();
        },
      },
    },
  };
  return { win, calls };
}

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe('tellShellWeb', () => {
  test('desktop: one set_tab_web with the switch as a boolean', () => {
    const { win, calls } = fakeWin();
    expect(tellShellWeb({ assets: true, web: false }, win)).toBe(true);
    expect(tellShellWeb({ assets: false, web: true }, win)).toBe(true);
    expect(calls).toEqual([
      ['set_tab_web', { on: false }],
      ['set_tab_web', { on: true }],
    ]);
  });
  test('only an explicit false is off (the switch default is on)', () => {
    const { win, calls } = fakeWin();
    tellShellWeb({}, win);
    tellShellWeb(null, win);
    expect(calls.map(([, a]) => a)).toEqual([{ on: true }, { on: true }]);
  });
  test('browser / cloud tab: no __TAURI__, nothing sent, nothing thrown', () => {
    expect(tellShellWeb({ web: false }, {})).toBe(false);
    expect(tellShellWeb({ web: false }, undefined)).toBe(false);
  });
  test('a rejected or throwing invoke never escapes', async () => {
    const reject = { __TAURI__: { core: { invoke: () => Promise.reject(new Error('refused')) } } };
    const thrower = {
      __TAURI__: {
        core: {
          invoke: () => {
            throw new Error('x');
          },
        },
      },
    };
    expect(tellShellWeb({ web: false }, reject)).toBe(true);
    expect(tellShellWeb({ web: false }, thrower)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('the switch reaches the shell on every change', () => {
  test('writeMay stores AND tells the shell', () => {
    const { win, calls } = fakeWin();
    const storage = memStorage();
    writeMay({ assets: true, web: false }, storage, win);
    expect(JSON.parse(storage.getItem(MAY_KEY) as string)).toEqual({ assets: true, web: false });
    expect(calls).toEqual([['set_tab_web', { on: false }]]);
  });
  test('blocked storage still tells the shell (the in-memory switch changed)', () => {
    const { win, calls } = fakeWin();
    const blocked = {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
    };
    writeMay({ web: false }, blocked, win);
    expect(calls).toEqual([['set_tab_web', { on: false }]]);
  });
});

describe('and on load', () => {
  const g = globalThis as Record<string, unknown>;
  const had = 'window' in g;
  const prev = g.window;
  afterEach(() => {
    if (had) g.window = prev;
    else Reflect.deleteProperty(g, 'window');
  });
  test('loading the module tells the shell the stored switch', async () => {
    const { win, calls } = fakeWin();
    g.window = {
      ...win,
      localStorage: memStorage({ [MAY_KEY]: JSON.stringify({ assets: true, web: false }) }),
    };
    await import('../client/v2/ai/ai-may.js?m1-load');
    expect(calls).toEqual([['set_tab_web', { on: false }]]);
  });
});
