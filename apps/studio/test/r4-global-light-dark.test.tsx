// r4 #6 (decision `v2-michal-r4-global-light-dark`) — "light/dark on the design system switches only the intro
// artboards and leaves the rest in light … I'd like that button on normal canvases too, so it switches all artboards,
// and we drop Follow chrome and DS default from Advanced."
//
//   · the Design system canvas: Light | Dark switches EVERY artboard (the specimen pages too), not only the sections
//   · every ordinary canvas carries the same pill; it switches all of its artboards
//   · a canvas starts in its design system's default theme (Light without one)
//   · the pick is remembered per canvas per Mac, through the view lane (never the versioned meta)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

type CanvasLib = typeof import('../canvas-lib.tsx');
type Shell = typeof import('../canvas-shell.tsx');
type Theme = typeof import('../canvas-theme.ts');
let lib: CanvasLib;
let shell: Shell;
let theme: Theme;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class FakeRO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
  const isHost = (el: Element) => el.classList?.contains('dc-canvas');
  for (const [prop, v] of [
    ['clientWidth', 1200],
    ['clientHeight', 800],
  ] as const)
    Object.defineProperty(window.HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return isHost(this) ? v : 0;
      },
    });
  lib = await import('../canvas-lib.tsx');
  shell = await import('../canvas-shell.tsx');
  theme = await import('../canvas-theme.ts');
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const roots: Root[] = [];
const fetches: { url: string; body: Record<string, unknown> }[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  theme.__resetCanvasTheme();
  shell.__resetDsThemeProbeForTests();
  fetches.length = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    fetches.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response('{}', { status: 200 });
  };
  const w = window as unknown as Record<string, unknown>;
  w.__canvas_meta__ = {};
  w.__canvas_meta_file__ = undefined; // a canvas with a file opens a collab socket; set it once mounted
  // a system that defines both themes, as the probe and the token scan read it
  const style = document.createElement('style');
  style.textContent =
    '[data-theme="light"]{--bg-0:#fff;--fg-0:#111}[data-theme="dark"]{--bg-0:#000;--fg-0:#eee}';
  document.head.append(style);
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
});

/** An ordinary canvas: three artboards, each with its design system's theme wrapper inside. */
async function mountCanvas(ids = ['desktop', 'mobile', 'ds-own-page']) {
  const { DesignCanvas, DCArtboard } = lib;
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  roots.push(root);
  await act(async () => {
    root.render(
      <DesignCanvas>
        {ids.map((id) => (
          <DCArtboard key={id} id={id} label={id} width={400} height={300}>
            <div className="maude" data-theme="light" data-testid={`wrap-${id}`}>
              {id}
            </div>
          </DCArtboard>
        ))}
      </DesignCanvas>
    );
  });
  return mount;
}
const metaWrites = () => fetches.filter((f) => f.url === '/_api/canvas-meta');
const nameCanvas = () => {
  (window as unknown as Record<string, unknown>).__canvas_meta_file__ = '.design/ui/themed.tsx';
};
const pill = () => document.querySelector('[data-testid="canvas-theme-pill"]');
const mode = (m: string) =>
  document.querySelector(`[data-testid="canvas-theme-mode-${m}"]`) as HTMLButtonElement | null;
const followRule = () => document.getElementById('dc-artboard-theme-css')?.textContent ?? '';
const press = async (el: Element | null) => {
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
/** the declared selector of the follow rule matches this element */
const ruleMatches = (el: Element) => {
  const sel = followRule().split('{')[0];
  return !!sel && el.matches(sel);
};

describe('an ordinary canvas carries the Light | Dark pill, and it switches every artboard', () => {
  test('the pill is on the canvas, in Light, with both buttons', async () => {
    await mountCanvas();
    expect(pill()).not.toBeNull();
    expect(mode('light')?.getAttribute('aria-pressed')).toBe('true');
    expect(mode('dark')?.getAttribute('aria-pressed')).toBe('false');
    expect(mode('dark')?.disabled).toBe(false);
    // an export never carries it
    expect(pill()?.hasAttribute('data-dc-overlay')).toBe(true);
  });

  test('Dark re-declares the dark tokens on EVERY artboard, specimen-style ones included', async () => {
    const mount = await mountCanvas();
    await press(mode('dark'));
    expect(mode('dark')?.getAttribute('aria-pressed')).toBe('true');
    expect(followRule()).toContain('--bg-0:#000');
    expect(followRule()).not.toContain(':not(');
    for (const id of ['desktop', 'mobile', 'ds-own-page'])
      expect(ruleMatches(mount.querySelector(`[data-testid="wrap-${id}"]`) as Element)).toBe(true);
    await press(mode('light'));
    expect(followRule()).toContain('--bg-0:#fff');
  });

  test('the app theme is not consulted any more: Follow chrome is gone', async () => {
    await mountCanvas();
    document.documentElement.dataset.maudeTheme = 'dark';
    await act(async () => {
      lib.__registerDesignSystem({ name: 'x', themeDefault: 'light' });
    });
    expect(followRule()).toContain('--bg-0:#fff'); // the app is dark, the canvas stays in its own Light
    document.documentElement.removeAttribute('data-maude-theme');
  });

  test('a one-theme design system greys out the other mode instead of lying', async () => {
    document.head.innerHTML = '<style>[data-theme="light"]{--bg-0:#fff}</style>';
    shell.__resetDsThemeProbeForTests();
    await mountCanvas();
    expect(mode('light')?.getAttribute('aria-pressed')).toBe('true');
    expect(mode('dark')?.disabled).toBe(true);
  });
});

describe("a canvas starts in its design system's own default theme", () => {
  test('without a system: Light', async () => {
    await mountCanvas();
    expect(theme.getCanvasTheme()).toBe('light');
  });

  test('a system whose default is dark: the canvas opens in Dark, nothing was picked or written', async () => {
    lib.__registerDesignSystem({ name: 'night-owl', themeDefault: 'dark' });
    await mountCanvas();
    expect(mode('dark')?.getAttribute('aria-pressed')).toBe('true');
    expect(followRule()).toContain('--bg-0:#000');
    nameCanvas();
    expect(metaWrites()).toEqual([]);
  });

  test('the saved pick beats the default', async () => {
    lib.__registerDesignSystem({ name: 'night-owl', themeDefault: 'dark' });
    (window as unknown as { __canvas_meta__: unknown }).__canvas_meta__ = { canvasTheme: 'light' };
    await mountCanvas();
    expect(mode('light')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the pick is remembered per canvas, per Mac — through the view lane, never the meta', () => {
  test('a press tells the studio ONE theme-pick (the shell writes the view file — b2-theme-pick)', async () => {
    const posts: Array<Record<string, unknown>> = [];
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get: () => ({ postMessage: (m: Record<string, unknown>) => posts.push(m) }),
    });
    await mountCanvas();
    nameCanvas();
    await press(mode('dark'));
    Object.defineProperty(window, 'parent', { configurable: true, get: () => window });
    // the canvas origin may PATCH only layout + viewport: the canvas never writes the pick itself
    expect(metaWrites()).toEqual([]);
    expect(posts.filter((m) => m.dgn === 'theme-pick')).toEqual([
      { dgn: 'theme-pick', v: 1, theme: 'dark' },
    ]);
    // the page-load snapshot follows, so a soft remount reads the pick back
    expect(
      (window as unknown as { __canvas_meta__: { canvasTheme: string } }).__canvas_meta__
        .canvasTheme
    ).toBe('dark');
  });

  test('a preview (the app’s ds.set-theme-preview, ?dsMode=) shows a mode and remembers nothing', async () => {
    await mountCanvas();
    nameCanvas();
    await act(async () => theme.setCanvasTheme('dark', { persist: false }));
    expect(mode('dark')?.getAttribute('aria-pressed')).toBe('true');
    expect(metaWrites()).toEqual([]);
  });
});

describe('Design system canvas: one mode for the whole canvas', () => {
  const model = {
    system: 'maude',
    label: 'Maude',
    rootClass: 'maude',
    themes: { light: 'light', dark: 'dark', default: 'light' },
    tokens: [],
    pendingCount: 0,
  };

  test('a specimen page carries the system root class and ds-dark, exactly as a section does', async () => {
    const board = await import('../ds/board/index.tsx');
    board.__registerBoardModel(model as never, { 'preview/page.tsx': () => <p>specimen</p> });
    const html = (m: 'light' | 'dark') =>
      renderToStaticMarkup(<board.Specimen src="preview/page.tsx" mode={m} />);
    expect(html('dark')).toContain('data-theme="dark"');
    expect(html('dark')).toMatch(/class="[^"]*\bmaude\b[^"]*"/);
    expect(html('dark')).toMatch(/class="[^"]*\bds-dark\b[^"]*"/);
    expect(html('light')).not.toContain('ds-dark');
    const st = await import('../ds/board/state.ts');
    st.__resetBoardState();
  });

  test('the bar’s Dark and the canvas’s mode are the same thing: every artboard follows, the pill steps aside', async () => {
    const board = await import('../ds/board/index.tsx');
    const st = await import('../ds/board/state.ts');
    board.__registerBoardModel(model as never, {});
    const mount = await mountCanvas(['ds-colour', 'ds-own-page']);
    expect(pill()).toBeNull(); // the DS canvas draws its own bar over the same mode
    await act(async () => st.setBoardMode('dark'));
    expect(theme.getCanvasTheme()).toBe('dark');
    expect(followRule()).toContain('--bg-0:#000');
    for (const id of ['ds-colour', 'ds-own-page'])
      expect(ruleMatches(mount.querySelector(`[data-testid="wrap-${id}"]`) as Element)).toBe(true);
    st.__resetBoardState();
  });
});
