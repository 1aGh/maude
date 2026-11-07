// r5-7 — "dark/light mode doesn't work in canvases, for example '02 Onboarding'".
//
// Root cause: the v2 kit's artboards wrap their content in `<div class="maude-v2 k-v2 k-stage" data-theme="…">`, and the
// design system scopes its theme blocks to `.maude-v2[data-theme=…]`. The probe found the wrapper by trying the WHOLE
// className ("maude-v2 k-v2 k-stage") — which it applies as three classes, so it works — but the follow rule then
// escaped that string into ONE class (`.maude-v2\ k-v2\ k-stage`), which matches nothing: the pill was live and
// switched nothing. The rule must match every wrapper that carries the DS's theme class, however many other classes
// (`k-v2`, `k-stage`, `ob-closeup`…) it also has.
//
// Second half: a canvas that can't switch says so in words on the pill — no dead control.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

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
const realFetch = globalThis.fetch;

/** the v2 design system's own shape: its theme blocks are scoped to `.maude-v2[data-theme=…]` only */
const V2_DS_CSS =
  '.maude-v2[data-theme="light"]{--bg-0:#fff;--fg-0:#111}.maude-v2[data-theme="dark"]{--bg-0:#000;--fg-0:#eee}';

beforeEach(() => {
  theme.__resetCanvasTheme();
  shell.__resetDsThemeProbeForTests();
  (globalThis as unknown as { fetch: unknown }).fetch = async () =>
    new Response('{}', { status: 200 });
  const w = window as unknown as Record<string, unknown>;
  w.__canvas_meta__ = {};
  w.__canvas_meta_file__ = undefined;
  // a canvas with a file opens a collab socket; there is no server here
  class FakeWS {
    readyState = 0;
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  }
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
  (window as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
});

/** The kit's shape: each artboard's content wrapper carries the DS class PLUS kit classes, and they differ per board. */
async function mountKitCanvas() {
  const { DesignCanvas, DCArtboard } = lib;
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  roots.push(root);
  await act(async () => {
    root.render(
      <DesignCanvas>
        <DCArtboard id="stage" label="stage" width={400} height={300}>
          <div className="maude-v2 k-v2 k-stage" data-theme="light" data-testid="wrap-stage">
            stage
          </div>
        </DCArtboard>
        <DCArtboard id="close" label="close" width={400} height={300}>
          <div className="maude-v2 k-v2 ob-closeup" data-theme="light" data-testid="wrap-close">
            close
          </div>
        </DCArtboard>
      </DesignCanvas>
    );
  });
  return mount;
}
const mode = (m: string) =>
  document.querySelector(`[data-testid="canvas-theme-mode-${m}"]`) as HTMLButtonElement | null;
const followRule = () => document.getElementById('dc-artboard-theme-css')?.textContent ?? '';
const press = async (el: Element | null) => {
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
const ruleMatches = (el: Element) => {
  const sel = followRule().split('{')[0];
  return !!sel && el.matches(sel);
};

describe('r5-7 · a kit canvas whose wrappers carry several classes switches', () => {
  test('Dark reaches every wrapper, whatever other classes it has beside the design system class', async () => {
    const style = document.createElement('style');
    style.textContent = V2_DS_CSS;
    document.head.append(style);
    const mount = await mountKitCanvas();
    expect(mode('dark')?.disabled).toBe(false);
    await press(mode('dark'));
    expect(followRule()).toContain('--bg-0:#000');
    for (const id of ['stage', 'close'])
      expect(ruleMatches(mount.querySelector(`[data-testid="wrap-${id}"]`) as Element)).toBe(true);
  });
});

describe('r5-7 · a canvas that cannot switch says so', () => {
  test('a one-theme design system: the other mode is greyed AND the pill says why in words', async () => {
    const style = document.createElement('style');
    style.textContent = '.maude-v2[data-theme="light"]{--bg-0:#fff}';
    document.head.append(style);
    await mountCanvasOneTheme();
    expect(mode('dark')?.disabled).toBe(true);
    const note = document.querySelector('[data-testid="canvas-theme-note"]');
    expect(note?.textContent).toBe('This canvas has no Dark');
    // 2.0.7 — icons only: the words live in the greyed button's tooltip; the note is for screen readers
    expect(note?.className).toBe('dc-theme-pill-sr');
    expect(mode('dark')?.title).toBe('This canvas has no Dark');
    expect(mode('dark')?.textContent).toBe('');
    expect(mode('dark')?.getAttribute('aria-label')).toBe('Dark');
    expect(mode('light')?.querySelector('svg')).not.toBeNull();
  });

  test('a canvas that can switch shows no such note', async () => {
    const style = document.createElement('style');
    style.textContent = V2_DS_CSS;
    document.head.append(style);
    await mountKitCanvas();
    expect(document.querySelector('[data-testid="canvas-theme-note"]')).toBeNull();
  });
});

async function mountCanvasOneTheme() {
  await mountKitCanvas();
}

// r5-8 — "I miss the file path somewhere; I'd put it on the pill with Light | Dark" — the canvas's project-relative
// path (`.design/ui/v2/02 Onboarding.tsx`, the one "Copy file path" always gave), shortened when long; a click copies
// the whole path and the pill says "Copied".
describe('r5-8 · the pill carries the canvas path, and a click copies it', () => {
  const LONG = '.design/ui/v2/some/deep/folder/02 Onboarding.tsx';
  const pathBtn = () =>
    document.querySelector('[data-testid="canvas-theme-path"]') as HTMLButtonElement | null;
  const withFile = (file: string | undefined) => {
    (window as unknown as Record<string, unknown>).__canvas_meta_file__ = file;
  };
  const setup = () => {
    const style = document.createElement('style');
    style.textContent = V2_DS_CSS;
    document.head.append(style);
  };

  test('a short path is shown whole', async () => {
    setup();
    withFile('.design/ui/Home.tsx');
    await mountKitCanvas();
    expect(pathBtn()?.textContent).toBe('.design/ui/Home.tsx');
  });

  test('a long path is shortened from the front, the file name always kept', async () => {
    setup();
    withFile(LONG);
    await mountKitCanvas();
    const shown = pathBtn()?.textContent ?? '';
    expect(shown.length).toBeLessThanOrEqual(36);
    expect(shown.startsWith('…/')).toBe(true);
    expect(shown.endsWith('02 Onboarding.tsx')).toBe(true);
    expect(pathBtn()?.getAttribute('title')).toContain(LONG);
  });

  test('clicking copies the whole path and says Copied', async () => {
    setup();
    withFile(LONG);
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          written.push(t);
        },
      },
    });
    await mountKitCanvas();
    await press(pathBtn());
    expect(written).toEqual([LONG]);
    expect(pathBtn()?.textContent).toBe('Copied');
  });

  test('a canvas with no file shows no path', async () => {
    setup();
    withFile(undefined);
    await mountKitCanvas();
    expect(pathBtn()).toBeNull();
  });
});
