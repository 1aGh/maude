// 2.0.7 release fix — in Pages no selection is drawn on, or names, an artboard that is not on the page shown
// (decision `v2-207-pages-stale-selection`).
//
// The packaged check on 7389cfa52 found it (Michal: "with Pages on, there's a selection but no artboard anywhere"):
// click inside a page, press PageDown — the next page shows, but the selection stays on the now-hidden artboard and
// its outline is drawn on empty canvas. Picking that artboard again in Layers then did not turn back: the page turned
// only when the selected artboard CHANGED, and the reveal moved the camera to where the hidden artboard sits. And
// Layers drew the selection's layer path (from another artboard) under the marked row of an artboard whose own tree
// is empty.
//
// The rules pinned here:
//   1. a page turn by any route (keys, ‹ ›, a script, run-action, a left-panel jump) drops what is selected on the
//      artboard it leaves — what a real mouse click on › already did;
//   2. a pick (`select-by-id`) of an artboard always turns to its page, also when it is the one selected before;
//   3. dropping the selection does not stop a pick that follows at once; only a replay of exactly what was dropped
//      (a restore rung the shell had queued) yields;
//   4. Layers never draws another artboard's path under the marked row.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type CanvasLib = typeof import('../canvas-lib.tsx');
type Pages = typeof import('../canvas-pages.ts');

let lib: CanvasLib;
let pages: Pages;

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
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const roots: Root[] = [];
const realFetch = globalThis.fetch;

function framed(on: boolean) {
  Object.defineProperty(window, 'parent', {
    configurable: true,
    get: () => (on ? fakeParent : window),
  });
}

beforeEach(() => {
  pages.__resetCanvasPages();
  parentPosts.length = 0;
  framed(true);
  // every artboard mounted (no mount ring: happy-dom has no layout to put one near the viewport)
  (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(
    'http://localhost/?artboard-live=off'
  );
  (globalThis as unknown as { fetch: unknown }).fetch = async () =>
    new Response('{}', { status: 200 });
  const w = window as unknown as Record<string, unknown>;
  // three artboards in one row: a · b · c; the Present order puts c first, then a (b follows)
  w.__canvas_meta__ = {
    layout: {
      artboards: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 600, y: 0 },
        { id: 'c', x: 1200, y: 0 },
      ],
    },
    present: { order: ['c', 'a'] },
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
            <div data-cd-id={`el-${id}`}>{id}</div>
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
const fromShell = async (data: Record<string, unknown>) => {
  await act(async () => {
    window.dispatchEvent(
      new window.MessageEvent('message', { data, source: window.parent as unknown as Window })
    );
  });
};
/** Past the selection post's 50 ms debounce. */
const settle = (ms = 90) => act(async () => new Promise((r) => setTimeout(r, ms)));
const rule = () => document.getElementById('dc-pages-css')?.textContent ?? '';
const counter = () => q('canvas-pages-count')?.textContent ?? null;
/** What the canvas last told the shell is selected (`select-set`), as artboard ids; null = nothing. */
const shellSelection = (): Array<string | null> | null => {
  const sets = parentPosts.filter((m) => m.dgn === 'select-set');
  const last = sets[sets.length - 1]?.selection as
    | { artboardId?: string | null }
    | Array<{ artboardId?: string | null }>
    | null
    | undefined;
  if (last == null) return null;
  return (Array.isArray(last) ? last : [last]).map((s) => s.artboardId ?? null);
};
/** "Click inside that page": the element on artboard `id` becomes the selection. */
const selectInside = async (id: string) => {
  await fromShell({ dgn: 'select-by-id', id: `el-${id}`, artboardId: id, index: 0 });
  await settle();
};
/** A Layers row pick: `select-by-id {artboardId}` only (use-palette-and-panels.jsx `onSelectArtboard`). */
const layersPick = async (id: string) => {
  await fromShell({ dgn: 'select-by-id', artboardId: id });
  await settle();
};

describe('a page turn drops the selection it leaves behind (any route)', () => {
  test('PageDown: the next page shows and nothing stays selected on the hidden artboard', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages')); // c · a · b — on c
    await selectInside('c');
    expect(shellSelection()).toEqual(['c']);
    await keydown('PageDown');
    await settle();
    expect(counter()).toBe('2 / 3');
    expect(shellSelection()).toBeNull();
  });

  test('‹ › stepped by a script click (no pointer on the canvas) drops it too', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages'));
    await selectInside('c');
    await press(q('canvas-pages-next'));
    await settle();
    expect(counter()).toBe('2 / 3');
    expect(shellSelection()).toBeNull();
  });

  test('the shell’s run-action pages.next (the menu, ⌘K, the AI) drops it too', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages'));
    await selectInside('c');
    await fromShell({ dgn: 'run-action', v: 1, id: 'pages.next' });
    await settle();
    expect(counter()).toBe('2 / 3');
    expect(shellSelection()).toBeNull();
  });

  test('a left-panel jump (reveal-artboard) to another page drops it too', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages'));
    await selectInside('c');
    await fromShell({ dgn: 'reveal-artboard', artboardId: 'b', glide: false, flash: false });
    await settle();
    expect(rule()).toContain('[data-dc-screen="b"]');
    expect(shellSelection()).toBeNull();
  });

  test('a pick on another page keeps the pick (it is on the page it turns to)', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages'));
    await selectInside('c');
    await selectInside('b');
    expect(rule()).toContain('[data-dc-screen="b"]');
    expect(shellSelection()).toEqual(['b']);
  });

  test('in Canvas view nothing is dropped', async () => {
    await mountCanvas();
    await selectInside('c');
    pages.setPageAt('a');
    await settle();
    expect(shellSelection()).toEqual(['c']);
  });
});

describe('a pick always turns to its page', () => {
  test('the repro: click inside A, PageDown, pick A in Layers → back on A', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages')); // on c
    await layersPick('a');
    expect(counter()).toBe('2 / 3');
    await selectInside('a');
    await keydown('PageDown'); // on b
    await settle();
    expect(counter()).toBe('3 / 3');
    await layersPick('a');
    expect(counter()).toBe('2 / 3');
    expect(rule()).toContain('[data-dc-screen="a"]');
    expect(shellSelection()).toEqual(['a']);
  });

  test('the same artboard picked again with its selection still in place turns back (keyed on the pick)', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages'));
    await layersPick('a'); // a selected, on a
    // a page moved by the store alone, under a selection nothing dropped (the pick must not rely on rule 1)
    const { __pagesDropOff } = await import('../canvas-pages-view.tsx');
    __pagesDropOff(true);
    try {
      pages.setPageAt('b');
      await settle();
    } finally {
      __pagesDropOff(false);
    }
    expect(rule()).toContain('[data-dc-screen="b"]');
    expect(shellSelection()).toEqual(['a']);
    await layersPick('a'); // unchanged selection, still a pick
    expect(rule()).toContain('[data-dc-screen="a"]');
  });
});

describe('a dropped selection yields only to a replay of itself', () => {
  test('a restore rung re-posting what was dropped does not bring it (or its page) back', async () => {
    await mountCanvas();
    await press(q('canvas-view-pages'));
    await selectInside('c');
    await keydown('PageDown'); // on a
    // inside the yield window, a queued restore rung sends back the old selection
    await fromShell({ dgn: 'select-by-id', id: 'el-c', artboardId: 'c', index: 0 });
    await settle();
    expect(counter()).toBe('2 / 3');
    expect(shellSelection()).toBeNull();
  });
});

describe('Layers never draws another artboard’s path under the marked row', () => {
  const FILE = '.design/ui/Math.tsx';
  const BOARDS = [
    { id: 'v3', label: 'NOVÝ v3 · A1', kind: 'digital' },
    { id: 'spine', label: 'A1 · co se změnilo', kind: 'digital' },
  ];
  test('the marked artboard’s own tree is empty: its row shows no path of the selection on another artboard', async () => {
    const { InspectorPanel } = await import('../client/inspector/inspector-panel.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const noop = () => {};
    await act(async () =>
      root.render(
        <InspectorPanel
          {...({
            testId: 'layers-panel',
            layersOnly: true,
            layersBoards: BOARDS,
            layersCanvasName: 'Math',
            artboardCount: 2,
            canvasFile: FILE,
            cfg: { designRel: '.design' },
            onClose: noop,
            onOptimistic: noop,
            onRecordEdit: noop,
            onUndoRedo: noop,
            // the page shows v3; its tree has landed and is empty; the selection is still on the spine artboard
            layersArtboard: 'v3',
            layersTree: { artboardId: 'v3', canvas: FILE, nodes: [] },
            selected: {
              artboardId: 'spine',
              file: FILE,
              id: 'el-spine',
              index: 0,
              selector: '#x',
              dom_path: ['article[data-dc-screen="spine"]', 'div.spine-card'],
            },
          } as never)}
        />
      )
    );
    expect(host.querySelector('[aria-current="true"]')?.getAttribute('data-testid') ?? null).toBe(
      'layers-artboard-v3'
    );
    expect(host.textContent ?? '').not.toContain('data-dc-screen="spine"');
    expect(host.textContent ?? '').not.toContain('div.spine-card');
  });
});
