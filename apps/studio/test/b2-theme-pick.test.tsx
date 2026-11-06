// 2.0.7 B2 follow-up — the canvas's Light | Dark pick is remembered again.
//
// The canvas origin may PATCH only `layout` and `viewport` of /_api/canvas-meta (routes/canvas-origin.ts,
// CANVAS_ORIGIN_META_KEYS), so the frame's own `canvasTheme` PATCH was refused (403) whenever the origin split was on
// — the default: the pick was lost on every reload. Like Canvas | Pages, the frame now says `theme-pick` and the shell
// writes `canvasTheme` on the main origin for the canvas it has open. The allowlist stays as it is.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

type Theme = typeof import('../canvas-theme.ts');
type Bridge = typeof import('../bridge/dgn-protocol.ts');
type Pick = typeof import('../client/v2/shell/pages-pick.js');
type Origin = typeof import('../routes/canvas-origin.ts');
let theme: Theme;
let bridge: Bridge;
let pick: Pick;
let origin: Origin;

const posts: Array<Record<string, unknown>> = [];
const fetches: string[] = [];
const realFetch = globalThis.fetch;
const fakeParent = { postMessage: (m: Record<string, unknown>) => posts.push(m) };
const framed = (on: boolean) =>
  Object.defineProperty(window, 'parent', {
    configurable: true,
    get: () => (on ? fakeParent : window),
  });

beforeAll(async () => {
  GlobalRegistrator.register();
  theme = await import('../canvas-theme.ts');
  bridge = await import('../bridge/dgn-protocol.ts');
  pick = await import('../client/v2/shell/pages-pick.js');
  origin = await import('../routes/canvas-origin.ts');
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
beforeEach(() => {
  theme.__resetCanvasTheme();
  posts.length = 0;
  fetches.length = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    fetches.push(url);
    return new Response('{}');
  };
  const w = window as unknown as Record<string, unknown>;
  w.__canvas_meta__ = {};
  w.__canvas_meta_file__ = '.design/ui/themed.tsx';
  framed(true);
});
afterEach(() => {
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  framed(false);
});

describe('the canvas tells the shell; it writes nothing itself', () => {
  test('a pick posts ONE theme-pick and no canvas-origin PATCH', () => {
    theme.setCanvasTheme('dark');
    expect(fetches).toEqual([]);
    expect(posts.filter((m) => m.dgn === 'theme-pick')).toEqual([
      { dgn: 'theme-pick', v: 1, theme: 'dark' },
    ]);
    // the page-load snapshot follows, so a soft remount reads it back
    expect(
      (window as unknown as { __canvas_meta__: { canvasTheme: string } }).__canvas_meta__
        .canvasTheme
    ).toBe('dark');
  });

  test('a preview remembers nothing', () => {
    theme.setCanvasTheme('dark', { persist: false });
    expect(posts.filter((m) => m.dgn === 'theme-pick')).toEqual([]);
    expect(fetches).toEqual([]);
  });

  test('outside the studio window nothing is remembered', () => {
    framed(false);
    theme.setCanvasTheme('dark');
    expect(posts).toEqual([]);
    expect(fetches).toEqual([]);
  });
});

describe('the shell writes it on the main origin, for the canvas it has open', () => {
  test('the body names the open canvas and only `canvasTheme`', () => {
    expect(pick.themePickBody('ui/themed.tsx', '.design', 'dark')).toEqual({
      file: '.design/ui/themed.tsx',
      patch: { canvasTheme: 'dark' },
    });
    expect(pick.themePickBody('ui/themed.tsx', '.design', 'sepia')).toBeNull();
    expect(pick.themePickBody('__system__', '.design', 'dark')).toBeNull();
  });

  test('`theme-pick` from the active canvas only, light | dark only', () => {
    const ORIGIN = 'http://canvas.test';
    const active = { name: 'active' } as unknown as Window;
    const ev = (data: unknown, source: unknown) =>
      ({ data, source, origin: ORIGIN }) as unknown as MessageEvent;
    const ctx = { canvasOrigin: ORIGIN, active };
    const msg = { dgn: 'theme-pick', v: 1, theme: 'light' };
    expect(bridge.acceptFromCanvas(ev(msg, active), ctx)).toEqual(msg as never);
    expect(bridge.acceptFromCanvas(ev({ ...msg, theme: 'sepia' }, active), ctx)).toBeNull();
    expect(bridge.acceptFromCanvas(ev(msg, { name: 'sibling' }), ctx)).toBeNull();
  });

  test('the canvas-origin PATCH allowlist is not widened', () => {
    expect([...origin.CANVAS_ORIGIN_META_KEYS].sort()).toEqual(['layout', 'viewport']);
  });
});
