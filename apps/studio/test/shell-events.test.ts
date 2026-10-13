// shell-events — a project window and the Rust shell's own events (V2-3.3 / V2-3.5, contract
// V2-1.1 §5.4 + §5.10): `shell://navigate {canvas, artboard}` opens the canvas and focuses the
// artboard through the `?open=` / `maude design open` road, and opened-existing / tabs-restored
// are toasts — tabs-restored also pulled once on start, because Rust emits it before the page is up.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register({ url: 'http://localhost:4400/' });
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { invoke, listenHere } from '../client/github.js';
import {
  applyShellNavigate,
  navigatePlan,
  openedExistingWords,
  startShellEvents,
  tabsRestoredWords,
} from '../client/shell-events.js';
import { OPEN_LADDER_MS } from '../client/ui-open.js';

type Handler = (e: { payload: unknown }) => void;
let here: Record<string, Handler> = {};
let global: Record<string, Handler> = {};
let invokes: string[] = [];
let answers: Record<string, unknown> = {};

// The Tauri global a project webview sees: `emit_to` events reach the current webview window.
function installTauri() {
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: {
      invoke: async (cmd: string) => {
        invokes.push(cmd);
        if (!(cmd in answers)) throw new Error(`command ${cmd} not found`);
        return answers[cmd];
      },
    },
    event: {
      listen: async (name: string, cb: Handler) => {
        global[name] = cb;
        return () => delete global[name];
      },
    },
    webviewWindow: {
      getCurrentWebviewWindow: () => ({
        listen: async (name: string, cb: Handler) => {
          here[name] = cb;
          return () => delete here[name];
        },
      }),
    },
  };
}

const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  here = {};
  global = {};
  invokes = [];
  answers = {};
  installTauri();
});

function start() {
  const toasts: string[] = [];
  const navs: unknown[] = [];
  const stop = startShellEvents({
    invoke,
    listen: listenHere,
    toast: (t: string) => toasts.push(t),
    onNavigate: (p: unknown) => navs.push(p),
  });
  return { toasts, navs, stop };
}

describe('shell events reach this window', () => {
  test('words are the contract §5.10 words', () => {
    expect(openedExistingWords('Alligators brand')).toBe(
      'Alligators brand is open in this window.'
    );
    expect(tabsRestoredWords(20)).toBe('20 tabs reopened. Each one starts when you open it.');
  });

  test('opened-existing → toast; listened on this window, not app-wide', async () => {
    const s = start();
    await tick();
    expect(Object.keys(here).sort()).toEqual(
      ['shell://navigate', 'shell://opened-existing', 'shell://tabs-restored'].sort()
    );
    expect(Object.keys(global)).toEqual([]);
    here['shell://opened-existing']?.({ payload: { name: 'Alligators brand' } });
    here['shell://opened-existing']?.({ payload: { name: '' } });
    expect(s.toasts).toEqual(['Alligators brand is open in this window.']);
    s.stop();
    expect(Object.keys(here)).toEqual([]);
  });

  test('tabs-restored emitted before the page existed is pulled once on start', async () => {
    answers.take_tabs_restored = { count: 20 };
    const s = start();
    await tick();
    expect(invokes).toContain('take_tabs_restored');
    expect(s.toasts).toEqual(['20 tabs reopened. Each one starts when you open it.']);
    // the event arriving too (page was up in time) never toasts twice
    here['shell://tabs-restored']?.({ payload: { count: 20 } });
    expect(s.toasts.length).toBe(1);
  });

  test('a shell without take_tabs_restored still toasts from the event', async () => {
    const s = start();
    await tick();
    expect(s.toasts).toEqual([]);
    here['shell://tabs-restored']?.({ payload: { count: 3 } });
    expect(s.toasts).toEqual(['3 tabs reopened. Each one starts when you open it.']);
  });

  test('shell://navigate is handed on; a parked navigate (new tab from a link) is pulled once', async () => {
    answers.take_pending_navigate = { canvas: 'ui/Hero.tsx', artboard: 'cover' };
    const s = start();
    await tick();
    expect(s.navs).toEqual([{ canvas: 'ui/Hero.tsx', artboard: 'cover' }]);
    here['shell://navigate']?.({ payload: { canvas: 'ui/Plakat.tsx', artboard: null } });
    expect(s.navs.length).toBe(2);
    s.stop();
    // after stop nothing lands
    answers.take_pending_navigate = null;
  });
});

describe('applyShellNavigate — the ?open= road plus the artboard focus', () => {
  const PATHS = ['.design/ui/Hero.tsx', '.design/ui/Plakat.tsx', '.design/assets/logo.svg'];
  function run(payload: unknown, activePath: string | null = null) {
    const calls: string[] = [];
    const posted: unknown[] = [];
    const timers: number[] = [];
    const frame = { contentWindow: { postMessage: (m: unknown) => posted.push(m) } };
    const plan = applyShellNavigate(payload, {
      paths: PATHS,
      designRel: '.design',
      activePath,
      openLinkedFile: (rel: string) => calls.push(`link:${rel}`),
      openTab: (f: string) => calls.push(`tab:${f}`),
      frameFor: () => frame,
      setPresent: () => calls.push('present'),
      schedule: (fn: () => void, ms: number) => {
        timers.push(ms);
        fn();
      },
    });
    return { plan, calls, posted, timers };
  }

  test('canvas + artboard → that tab opens and the artboard is focused on the ladder', () => {
    const r = run({ canvas: 'ui/Hero.tsx', artboard: 'cover' });
    expect(r.calls).toEqual(['tab:.design/ui/Hero.tsx']);
    expect(r.timers).toEqual(OPEN_LADDER_MS);
    expect(r.posted[0]).toEqual({
      dgn: 'run-action',
      v: 1,
      id: 'view.zoom-to-artboard',
      params: { id: 'cover' },
    });
  });

  test('canvas only → the link opener (same as ?open=), no artboard posts', () => {
    const r = run({ canvas: 'ui/Plakat.tsx', artboard: null });
    expect(r.calls).toEqual(['link:ui/Plakat.tsx']);
    expect(r.posted).toEqual([]);
  });

  test('a canvas not in this tree → the link opener says "Not here yet"', () => {
    const r = run({ canvas: 'ui/Gone.tsx', artboard: 'a' });
    expect(r.plan?.file).toBeNull();
    expect(r.calls).toEqual(['link:ui/Gone.tsx']);
  });

  test('artboard only → focused in the open canvas', () => {
    const r = run({ canvas: null, artboard: 'cover' }, '.design/ui/Hero.tsx');
    expect(r.calls).toEqual(['tab:.design/ui/Hero.tsx']);
    expect(r.posted.length).toBeGreaterThan(0);
  });

  test('untrusted junk does nothing', () => {
    for (const p of [
      null,
      'x',
      { canvas: '../../etc/passwd' },
      { canvas: 'ui/a\\b.tsx' },
      { canvas: null, artboard: 'x' },
      { canvas: null, artboard: 'a\nb' },
    ])
      expect(run(p).plan).toBeNull();
    expect(
      navigatePlan(
        { canvas: 'ui/Hero.tsx', artboard: 'x'.repeat(129) },
        {
          paths: PATHS,
          designRel: '.design',
          activePath: null,
        }
      )?.artboard
    ).toBeNull();
  });

  test('use-tabs subscribes it once the tree is loaded, reading the live openers through a ref', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'client', 'hooks', 'use-tabs.jsx'),
      'utf8'
    );
    const at = src.indexOf('return startShellEvents({');
    expect(at).toBeGreaterThan(0);
    const call = src.slice(at, src.indexOf('});', at));
    for (const k of [
      'listen: listenHere',
      'onNavigate: (p) => applyShellNavigate(p, shellNavRef.current)',
    ])
      expect({ k, present: call.includes(k) }).toEqual({ k, present: true });
    const ref = src.slice(src.indexOf('shellNavRef.current = {'), at);
    for (const k of ['openLinkedFile,', 'openTab,', 'iframesRef.current.get'])
      expect({ k, present: ref.includes(k) }).toEqual({ k, present: true });
  });
});
