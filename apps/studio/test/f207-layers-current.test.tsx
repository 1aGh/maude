// 2.0.7 release fix — the Layers tab marks the artboard the person is on (decision `v2-207-layers-current`).
//
// The packaged check on d25f8f295 found the marked row (aria-current, the row the tree nests under) on the wrong
// artboard about half the time: a Layers pick in Canvas view marked the artboard the camera was nearest to, and in
// Pages a pick or a ‹ › step left the mark on the previous artboard. The tree only followed the viewport-centre
// artboard (and a click inside the canvas), and the mark preferred the tree's artboard over the selection's, so a
// tree that was late — or for another artboard — moved the mark with it.
//
// The rule pinned here: the mark is the artboard the person is on (the page in Pages, else the selection's artboard,
// else the tree's), the tree is drawn only under its own artboard's row (a tree for another artboard is never drawn
// under the mark; the row says it is busy until its own tree lands), and the tree is asked for that same artboard.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const realFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
});
afterAll(async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  globalThis.fetch = realFetch;
  await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

async function mount(el: React.ReactElement): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  return { host, root };
}

const FILE = '.design/ui/Math.tsx';
const BOARDS = [
  { id: 'a1', label: 'A7 · Matika bez plánu', kind: 'digital' },
  { id: 'a2', label: 'A7 · co se změnilo', kind: 'digital' },
  { id: 'a3', label: 'v3-onboarding', kind: 'digital' },
];
const treeOf = (artboardId: string) => ({
  artboardId,
  canvas: FILE,
  nodes: [
    { id: `${artboardId}-box`, index: 0, tag: 'div', label: `Box of ${artboardId}`, children: [] },
  ],
});
const noop = () => {};

async function layers(over: Record<string, unknown>) {
  const { InspectorPanel } = await import('../client/inspector/inspector-panel.jsx');
  const props = {
    testId: 'layers-panel',
    layersOnly: true,
    layersBoards: BOARDS,
    layersCanvasName: 'Math',
    artboardCount: 3,
    canvasFile: FILE,
    cfg: { designRel: '.design' },
    onClose: noop,
    onOptimistic: noop,
    onRecordEdit: noop,
    onUndoRedo: noop,
    ...over,
  };
  return mount(<InspectorPanel {...(props as never)} />);
}
const marked = (host: HTMLElement) =>
  host.querySelector('[aria-current="true"]')?.getAttribute('data-testid') ?? null;
const treeText = (host: HTMLElement) =>
  [...host.querySelectorAll('.ly2-tree')].map((t) => t.textContent ?? '').join('|');

describe('currentBoard — the artboard the person is on', () => {
  test('the artboard in view wins over the tree and the selection', async () => {
    const { currentBoard } = await import('../client/v2/layers/artboard-layers.jsx');
    expect(
      currentBoard({ boards: BOARDS, onBoard: 'a2', treeArtboard: 'a1', selectedArtboard: 'a1' })
    ).toBe('a2');
  });
  test("the selection's artboard wins over a tree for another artboard", async () => {
    const { currentBoard } = await import('../client/v2/layers/artboard-layers.jsx');
    expect(currentBoard({ boards: BOARDS, treeArtboard: 'a1', selectedArtboard: 'a3' })).toBe('a3');
  });
  test("with nothing chosen the tree's artboard is marked; an id not on this canvas never is", async () => {
    const { currentBoard } = await import('../client/v2/layers/artboard-layers.jsx');
    expect(currentBoard({ boards: BOARDS, treeArtboard: 'a1' })).toBe('a1');
    expect(currentBoard({ boards: BOARDS, onBoard: 'zz', treeArtboard: 'a1' })).toBe('a1');
    expect(currentBoard({ boards: BOARDS })).toBeNull();
  });
});

describe('the Layers tab marks the artboard you are on', () => {
  test('Canvas view: a pick in Layers marks the picked artboard, not the one the old tree is of', async () => {
    const { host } = await layers({
      selected: { artboardId: 'a3', file: FILE, selector: '[data-dc-screen="a3"]' },
      layersArtboard: 'a3',
      layersTree: treeOf('a1'),
    });
    expect(marked(host)).toBe('layers-artboard-a3');
    // the old artboard's tree is not drawn under the mark (or anywhere)
    expect(treeText(host)).not.toContain('Box of a1');
    expect(
      host.querySelector('[data-testid="layers-artboard-a3"]')?.getAttribute('aria-busy')
    ).toBe('true');
  });

  test('Pages: a page turned with ‹ › (the selection stays behind) moves the mark to the page', async () => {
    const { host } = await layers({
      selected: { artboardId: 'a1', file: FILE, id: 'a1-box', index: 0, selector: '#x' },
      layersArtboard: 'a2',
      layersTree: treeOf('a1'),
    });
    expect(marked(host)).toBe('layers-artboard-a2');
    expect(treeText(host)).not.toContain('Box of a1');
  });

  test('the tree that lands for the marked artboard nests under it, and the row is no longer busy', async () => {
    const { host } = await layers({
      selected: null,
      layersArtboard: 'a2',
      layersTree: treeOf('a2'),
    });
    expect(marked(host)).toBe('layers-artboard-a2');
    const row = host.querySelector('[data-testid="layers-artboard-a2"]');
    expect(row?.nextElementSibling?.textContent).toContain('Box of a2');
    expect(row?.getAttribute('aria-busy')).toBeNull();
  });

  test('browse mode (nothing selected, Canvas view): the tree of the artboard in view shows under it', async () => {
    const { host } = await layers({
      selected: null,
      layersArtboard: null,
      layersTree: treeOf('a1'),
    });
    expect(marked(host)).toBe('layers-artboard-a1');
    expect(treeText(host)).toContain('Box of a1');
  });
});

describe('the tree is asked for the artboard you are on', () => {
  test('layersArtboardOf: the page, else the selection on this canvas, else the artboard in view', async () => {
    const { layersArtboardOf } = await import('../client/v2/layers/layers-request.js');
    const sel = { artboardId: 'a1', file: FILE };
    expect(layersArtboardOf({ selected: sel, activePath: FILE, pagesAt: 'a2', inView: 'a3' })).toBe(
      'a2'
    );
    expect(layersArtboardOf({ selected: [sel], activePath: FILE, inView: 'a3' })).toBe('a1');
    expect(
      layersArtboardOf({ selected: { ...sel, file: 'other.tsx' }, activePath: FILE, inView: 'a3' })
    ).toBe('a3');
    expect(layersArtboardOf({ selected: null, activePath: FILE })).toBeNull();
  });

  function Probe(p: Record<string, unknown>) {
    // biome-ignore lint/suspicious/noExplicitAny: test probe
    (Probe as any).hook(p);
    return null;
  }

  test('asks on every change of the artboard; with a tree in hand only while it is for another artboard', async () => {
    const { useLayersTreeRequest } = await import('../client/v2/layers/layers-request.js');
    // biome-ignore lint/suspicious/noExplicitAny: test probe
    (Probe as any).hook = useLayersTreeRequest;
    const posts: unknown[] = [];
    const post = (m: unknown) => posts.push(m);
    const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
    const { root } = await mount(<Probe activePath={FILE} want="a1" post={post} delay={10} />);
    await wait(30);
    expect(posts).toEqual([{ dgn: 'request-layers', artboardId: 'a1' }]);
    // the heal: a tree for another artboard is in hand → ask again for the one you are on
    posts.length = 0;
    await act(async () =>
      root.render(<Probe activePath={FILE} want="a2" have="a1" post={post} delay={10} />)
    );
    await wait(30);
    expect(posts).toEqual([{ dgn: 'request-layers', artboardId: 'a2' }]);
    // the right tree is in hand → nothing more is asked
    posts.length = 0;
    await act(async () =>
      root.render(<Probe activePath={FILE} want="a2" have="a2" post={post} delay={10} />)
    );
    await wait(30);
    expect(posts).toEqual([]);
    // a late tree for the previous artboard lands → ask again, the stale one never stays
    await act(async () =>
      root.render(<Probe activePath={FILE} want="a2" have="a1" post={post} delay={10} />)
    );
    await wait(30);
    expect(posts).toEqual([{ dgn: 'request-layers', artboardId: 'a2' }]);
  });
});

describe('the canvas re-posts the artboard it was last asked for', () => {
  test('a structural change while a request for another artboard lands re-posts THAT artboard, not the old one', async () => {
    const { LayersLiveSync } = await import('../canvas-shell.tsx');
    for (const id of ['a1', 'a2']) {
      const ab = document.createElement('article');
      ab.setAttribute('data-dc-screen', id);
      ab.innerHTML = `<div data-cd-id="${id}-box"></div>`;
      document.body.append(ab);
    }
    const w = window as unknown as { __maudeLastLayersArt?: string | null };
    w.__maudeLastLayersArt = 'a1';
    const posted: Array<{ dgn?: string; artboardId?: string }> = [];
    const realPost = window.postMessage.bind(window);
    window.postMessage = ((m: { dgn?: string; artboardId?: string }) => {
      posted.push(m);
    }) as typeof window.postMessage;
    try {
      await mount(<LayersLiveSync />);
      // a structural change on a1 (an HMR remount, a reflow) …
      await act(async () => {
        document.querySelector('[data-dc-screen="a1"]')?.append(document.createElement('span'));
        await new Promise((r) => setTimeout(r, 5));
      });
      // … then, inside the debounce, the shell asks for a2 (request-layers posts it and makes it the tracked one)
      w.__maudeLastLayersArt = 'a2';
      await act(async () => new Promise((r) => setTimeout(r, 150)));
      const trees = posted.filter((m) => m?.dgn === 'layers-tree');
      expect(trees.length).toBeGreaterThan(0);
      expect(trees.at(-1)?.artboardId).toBe('a2');
      expect(w.__maudeLastLayersArt).toBe('a2');
    } finally {
      window.postMessage = realPost;
    }
  });
});
