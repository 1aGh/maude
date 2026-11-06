// 2.0.7 B2 (decision `v2-207-pages-view`) — the canvas's Canvas | Pages view.
//
//   · Pages shows ONE artboard at a time, filling the view; the others step out of sight (not during a capture)
//   · the order is the Present order when one is set, else the layout order — skipped artboards stay in
//   · ‹ n / N › on the pill, PageDown / PageUp, and the shell's `run-action` page through it, held at the ends
//   · the pick is remembered per canvas, per Mac, through the view lane (`canvasView`), never the meta
//   · the shell is told `pages-view` (it turns Preview and Present off)
//   · Pages does not show in Preview or Present, nor outside the studio window (a capture renders the whole canvas)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setModeMessage } from '../client/v2/shell/canvas-mode.js';

type CanvasLib = typeof import('../canvas-lib.tsx');
type Pages = typeof import('../canvas-pages.ts');
type PagesView = typeof import('../canvas-pages-view.tsx');
type ModeStore = typeof import('../bridge/canvas-mode-store.ts');
let lib: CanvasLib;
let pages: Pages;
let view: PagesView;
let modeStore: ModeStore;

const HOST = { w: 1200, h: 800 };
const parentPosts: Array<Record<string, unknown>> = [];
const fakeParent = {
  postMessage(m: Record<string, unknown>) {
    parentPosts.push(m);
  },
};

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
    ['clientWidth', HOST.w],
    ['clientHeight', HOST.h],
  ] as const)
    Object.defineProperty(window.HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return isHost(this) ? v : 0;
      },
    });
  lib = await import('../canvas-lib.tsx');
  pages = await import('../canvas-pages.ts');
  view = await import('../canvas-pages-view.tsx');
  modeStore = await import('../bridge/canvas-mode-store.ts');
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const roots: Root[] = [];
const fetches: { url: string; body: Record<string, unknown> }[] = [];
const realFetch = globalThis.fetch;

/** The studio frames the canvas: `window.parent` is the shell, not the canvas itself. */
function framed(on: boolean) {
  Object.defineProperty(window, 'parent', {
    configurable: true,
    get: () => (on ? fakeParent : window),
  });
}

beforeEach(() => {
  pages.__resetCanvasPages();
  parentPosts.length = 0;
  fetches.length = 0;
  framed(true);
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    fetches.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response('{}', { status: 200 });
  };
  const w = window as unknown as Record<string, unknown>;
  // three artboards in one row: a (left) · b · c (right); the Present order puts c first, then a
  w.__canvas_meta__ = {
    layout: {
      artboards: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 600, y: 0 },
        { id: 'c', x: 1200, y: 0 },
      ],
    },
    present: { order: ['c', 'a'], skip: ['b'] },
  };
  w.__canvas_meta_file__ = undefined;
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-maude-pages');
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  framed(false);
});

async function mountCanvas(ids = ['a', 'b', 'c']) {
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
            <div data-testid={`content-${id}`}>{id}</div>
          </DCArtboard>
        ))}
      </DesignCanvas>
    );
  });
  return mount;
}
const q = (testid: string) =>
  document.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement | null;
const press = async (el: Element | null) => {
  if (!el) throw new Error('no element to press');
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
const keydown = async (key: string) => {
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
  });
};
const rule = () => document.getElementById('dc-pages-css')?.textContent ?? '';
const counter = () => q('canvas-pages-count')?.textContent ?? null;
const reports = () => parentPosts.filter((m) => m.dgn === 'pages-view');
const lastReport = () => reports()[reports().length - 1];

describe('the order: the Present order when set, else the layout — skipped artboards stay in', () => {
  const rects = [
    { id: 'b', x: 600, y: 0, w: 400, h: 300 },
    { id: 'a', x: 0, y: 0, w: 400, h: 300 },
    { id: 'd', x: 0, y: 700, w: 400, h: 300 },
    { id: 'c', x: 1200, y: 0, w: 400, h: 300 },
  ];

  test('no Present order: rows, left to right', () => {
    expect(pages.pagesOrder(rects, undefined)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('a Present order goes first, the rest follow in layout order; skip is ignored', () => {
    expect(pages.pagesOrder(rects, { order: ['d', 'b'], skip: ['a'] })).toEqual([
      'd',
      'b',
      'a',
      'c',
    ]);
  });

  test('a stale or malformed order is dropped, never thrown on', () => {
    expect(pages.pagesOrder(rects, { order: ['gone', 7, 'c'] as never })).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
    expect(pages.pagesOrder(rects, { order: 'c' as never })).toEqual(['a', 'b', 'c', 'd']);
  });

  test('stepping is held at the ends; an unknown page is the first', () => {
    const order = ['a', 'b', 'c'];
    expect(pages.pageStep(order, 'a', 'next')).toBe('b');
    expect(pages.pageStep(order, 'c', 'next')).toBe('c');
    expect(pages.pageStep(order, 'a', 'prev')).toBe('a');
    expect(pages.pageStep(order, 'gone', 'next')).toBe('b');
    expect(pages.pageStep([], 'a', 'next')).toBeNull();
    expect(pages.pagePosition(order, 'c')).toEqual({ index: 2, total: 3, id: 'c' });
    expect(pages.pageCounter(1, 6)).toBe('2 / 6');
  });
});

describe('the camera fills the view with the one page, below the pill', () => {
  test('the page fits whole, centred in what the panels leave, under the pill', () => {
    const insets = { top: 0, right: 300, bottom: 0, left: 0 };
    const rect = { x: 600, y: 0, w: 400, h: 300 };
    const cam = pages.pageCamera(rect, HOST, insets);
    const left = rect.x * cam.zoom + cam.x;
    const top = rect.y * cam.zoom + cam.y;
    const right = left + rect.w * cam.zoom;
    const bottom = top + rect.h * cam.zoom;
    expect(top).toBeGreaterThanOrEqual(pages.PAGES_TOP_ROOM - 0.01);
    expect(bottom).toBeLessThanOrEqual(HOST.h - pages.PAGES_PAD + 0.01);
    expect(left).toBeGreaterThanOrEqual(pages.PAGES_PAD - 0.01);
    expect(right).toBeLessThanOrEqual(HOST.w - insets.right - pages.PAGES_PAD + 0.01);
    // it FILLS one axis (bigger than 1:1 when the page is small), it never crops
    const fillsW = Math.abs(rect.w * cam.zoom - (HOST.w - 300 - 2 * pages.PAGES_PAD)) < 0.5;
    const fillsH =
      Math.abs(rect.h * cam.zoom - (HOST.h - pages.PAGES_TOP_ROOM - pages.PAGES_PAD)) < 0.5;
    expect(fillsW || fillsH).toBe(true);
    expect(cam.zoom).toBeGreaterThan(1);
  });

  test('the rule leaves one artboard, and steps aside during a capture', () => {
    const css = pages.pagesHideCss('b"x');
    expect(css).toContain('[data-dc-screen="b\\"x"]');
    expect(css).toContain(':not(:has(#maude-capture-chrome))');
    expect(css).toContain('visibility:hidden');
  });
});

describe('where Pages shows', () => {
  test('Edit, Viewing, a free canvas — framed by the studio', () => {
    expect(pages.pagesApply('edit')).toBe(true);
    expect(pages.pagesApply('viewing')).toBe(true);
    expect(pages.pagesApply(null)).toBe(true);
  });
  test('not in Preview or Present', () => {
    expect(pages.pagesApply('preview')).toBe(false);
    expect(pages.pagesApply('present')).toBe(false);
  });
  test('not outside the studio window (an export / screenshot loads the canvas as the top document)', () => {
    framed(false);
    expect(pages.pagesApply('edit')).toBe(false);
  });
});

describe('the pill: Canvas | Pages beside Light | Dark, and ‹ n / N › in Pages', () => {
  test('Canvas by default: the switch is there, no pager, every artboard in sight', async () => {
    await mountCanvas();
    expect(q('canvas-view-canvas')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('canvas-view-pages')?.getAttribute('aria-pressed')).toBe('false');
    // beside Light | Dark, on the same pill
    expect(q('canvas-theme-pill')?.contains(q('canvas-view-pages'))).toBe(true);
    expect(q('canvas-pages-nav')).toBeNull();
    expect(rule()).toBe('');
    expect(lastReport()).toMatchObject({ v: 1, on: false });
  });

  test('Pages: the first page in the Present order, the others out of sight; the shell is told', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages'));
    expect(q('canvas-view-pages')?.getAttribute('aria-pressed')).toBe('true');
    expect(counter()).toBe('1 / 3');
    expect(rule()).toContain('[data-dc-screen="c"]');
    expect(document.documentElement.hasAttribute('data-maude-pages')).toBe(true);
    expect(lastReport()).toEqual({ dgn: 'pages-view', v: 1, on: true, index: 0, total: 3 });
    expect(q('canvas-pages-prev')?.disabled).toBe(true);
  });

  test('Next / Previous page through c → a → b, held at the end', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages'));
    await press(q('canvas-pages-next'));
    expect(counter()).toBe('2 / 3');
    expect(rule()).toContain('[data-dc-screen="a"]');
    await press(q('canvas-pages-next'));
    expect(counter()).toBe('3 / 3');
    expect(rule()).toContain('[data-dc-screen="b"]');
    expect(q('canvas-pages-next')?.disabled).toBe(true);
    await press(q('canvas-pages-prev'));
    expect(counter()).toBe('2 / 3');
    expect(lastReport()).toEqual({ dgn: 'pages-view', v: 1, on: true, index: 1, total: 3 });
  });

  test('PageDown / PageUp page (registry keys); in Canvas they do nothing', async () => {
    await mountCanvas();
    await keydown('PageDown');
    expect(counter()).toBeNull();
    await press(q('canvas-view-pages'));
    await keydown('PageDown');
    expect(counter()).toBe('2 / 3');
    await keydown('ArrowRight'); // nothing selected: → pages too
    expect(counter()).toBe('3 / 3');
    await keydown('PageUp');
    expect(counter()).toBe('2 / 3');
  });

  test('the shell’s run-action: view.pages toggles, pages.next steps', async () => {
    await mountCanvas();
    await act(async () => {
      expect(view.runPagesAction('view.pages')).toBe(true);
    });
    expect(pages.getCanvasView()).toBe('pages');
    await act(async () => {
      view.runPagesAction('pages.next');
    });
    expect(counter()).toBe('2 / 3');
    await act(async () => {
      view.runPagesAction('view.pages');
    });
    expect(pages.getCanvasView()).toBe('canvas');
    expect(rule()).toBe('');
    expect(view.runPagesAction('view.zoom-fit')).toBe(false);
  });

  test('back to Canvas: every artboard again', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages'));
    await press(q('canvas-view-canvas'));
    expect(rule()).toBe('');
    expect(document.documentElement.hasAttribute('data-maude-pages')).toBe(false);
    expect(lastReport()).toMatchObject({ on: false });
  });

  test('in Preview Pages does not show (the pill steps aside, the rule is off)', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages'));
    await act(async () => {
      window.dispatchEvent(
        new window.MessageEvent('message', {
          data: setModeMessage({
            seq: 99,
            mode: 'preview',
            caps: { edit: true, annotate: true, comment: true },
            tool: null,
          }),
          source: window.parent as unknown as Window,
        })
      );
    });
    expect(modeStore.canvasModeStore(window).get().mode).toBe('preview');
    expect(rule()).toBe('');
    expect(lastReport()).toMatchObject({ on: false });
    expect(q('canvas-theme-pill')).toBeNull();
    // back to Edit, so the tests after this one see the pill (the mode store lives on the window)
    await act(async () => {
      window.dispatchEvent(
        new window.MessageEvent('message', {
          data: setModeMessage({
            seq: 100,
            mode: 'edit',
            caps: { edit: true, annotate: true, comment: true },
            tool: null,
          }),
          source: window.parent as unknown as Window,
        })
      );
    });
    expect(modeStore.canvasModeStore(window).get().mode).toBe('edit');
  });
});

describe('the pick is remembered per canvas, per Mac — the view lane, never the meta', () => {
  test('a press tells the shell ONE pages-pick; the canvas writes nothing itself', async () => {
    await mountCanvas();
    (window as unknown as Record<string, unknown>).__canvas_meta_file__ = '.design/ui/paged.tsx';
    await press(q('canvas-view-pages'));
    // the canvas origin has no lane for it (routes/canvas-origin.ts): the shell writes the view file
    expect(fetches.filter((f) => f.url === '/_api/canvas-meta')).toHaveLength(0);
    expect(parentPosts.filter((m) => m.dgn === 'pages-pick')).toEqual([
      { dgn: 'pages-pick', v: 1, view: 'pages' },
    ]);
    // the page-load snapshot follows, so a soft remount reads the pick back
    expect(
      (window as unknown as { __canvas_meta__: { canvasView: string } }).__canvas_meta__.canvasView
    ).toBe('pages');
    // paging is not a pick
    await press(q('canvas-pages-next'));
    expect(parentPosts.filter((m) => m.dgn === 'pages-pick')).toHaveLength(1);
    await press(q('canvas-view-canvas'));
    expect(parentPosts.filter((m) => m.dgn === 'pages-pick').map((m) => m.view)).toEqual([
      'pages',
      'canvas',
    ]);
  });

  test('outside the studio window nothing is remembered', async () => {
    framed(false);
    await mountCanvas();
    await act(async () => pages.setCanvasView('pages'));
    expect(parentPosts.filter((m) => m.dgn === 'pages-pick')).toHaveLength(0);
  });

  test('the saved pick opens the canvas in Pages', async () => {
    (window as unknown as { __canvas_meta__: Record<string, unknown> }).__canvas_meta__.canvasView =
      'pages';
    await mountCanvas();
    expect(q('canvas-view-pages')?.getAttribute('aria-pressed')).toBe('true');
    expect(counter()).toBe('1 / 3');
  });
});
