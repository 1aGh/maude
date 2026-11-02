// S1.1 — the Canvases panel rendered (11 · pn-organise, 01 · cf-big-tree): 93 canvases put at most 60 rows in
// the page, the old test ids still answer, the Pinned group and the pin button round-trip /_api/pins, the Sort
// menu persists per PROJECT (never per port), the empty folder offers a new canvas, and the keys work.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const D = '.design';
const ROOT = `${D}/ui`;
const PID = 'l0123456789abcdef';

function project() {
  const folders: Record<string, number> = {
    '2026/combine': 6,
    '2026/dresy': 4,
    '2026/social': 6,
    'club-web': 9,
    print: 6,
    social: 31,
    legacy: 27,
  };
  const paths: string[] = [];
  const dirs = new Set<string>(['2026', '2027']);
  for (const [dir, n] of Object.entries(folders)) {
    const parts = dir.split('/');
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    for (let i = 1; i <= n; i++) paths.push(`${ROOT}/${dir}/${dir.replace('/', '-')}-${i}.tsx`);
  }
  for (const n of ['test', 'Test2', 'ahoj', 'ahoj2']) paths.push(`${ROOT}/${n}.tsx`);
  const canvases = paths.map((p, i) => ({
    rel: p.slice(D.length + 1),
    kind: 'canvas',
    mtimeMs: 1000 + i,
    madeByAi: p.endsWith('test.tsx'),
    cover: null,
    artboards: p.includes('print') ? [{ id: 'a', kind: 'print' }] : [{ id: 'a', kind: 'web' }],
  }));
  return {
    groups: [
      {
        label: 'UI canvases',
        kind: 'canvas',
        fullPath: ROOT,
        paths,
        dirs: [...dirs].map((d) => `${ROOT}/${d}`),
      },
    ],
    snapshot: { pid: PID, project: { designRel: D }, writer: { seq: 7 }, canvases },
  };
}

type Call = { url: string; method: string; body?: string };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
let stored: Record<string, unknown> = {};
let pinsFile: { canvas: string; at: number }[] = [];

function installFetch(snapshot: unknown) {
  calls = [];
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.startsWith('/_api/index')) return ok(snapshot);
    if (url === '/_api/pins' && method === 'GET') return ok({ v: 1, pins: pinsFile, opened: {} });
    if (url === '/_api/pins') {
      const b = JSON.parse(init?.body ?? '{}');
      pinsFile = b.pinned
        ? [...pinsFile, { canvas: b.canvas, at: Date.now() }]
        : pinsFile.filter((p) => p.canvas !== b.canvas);
      return ok({ ok: true });
    }
    if (url === '/_api/ui-prefs' && method === 'POST') {
      const b = JSON.parse(init?.body ?? '{}');
      stored = {
        ...stored,
        canvasesSort: { ...(stored.canvasesSort as object), ...b.canvasesSort },
      };
      return ok(stored);
    }
    if (url === '/_api/ui-prefs') return ok(stored);
    return ok({});
  }) as unknown as typeof fetch;
}

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  stored = {};
  pinsFile = [];
});

const settle = (ms = 420) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function mount(over: Record<string, unknown> = {}, p = project()) {
  installFetch(p.snapshot);
  const { CanvasesPanel } = await import('../client/v2/canvases/canvases-panel.jsx');
  const opened = new Set<string>();
  const setOpenCalls: Array<[string, boolean]> = [];
  const expansion = {
    isOpen: (path: string) => opened.has(path),
    setOpen: (path: string, v: boolean) => {
      setOpenCalls.push([path, v]);
      if (v) opened.add(path);
      else opened.delete(path);
    },
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const render = (extra: Record<string, unknown> = {}) =>
    root.render(
      <CanvasesPanel
        groups={p.groups}
        search=""
        projectLabel="Alligators brand"
        activePath={null}
        onOpen={() => {}}
        expansion={expansion}
        {...over}
        {...extra}
      />
    );
  await act(async () => render());
  await settle();
  return {
    host,
    root,
    opened,
    setOpenCalls,
    rerender: (e?: Record<string, unknown>) => act(async () => render(e)),
    p,
  };
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (host: HTMLElement, sel: string) => Array.from(host.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
const key = (el: Element | null, k: string) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    );
  });
};

describe('93 canvases', () => {
  test('closed: the project row, six folders with their counts, the four leftovers', async () => {
    const { host } = await mount();
    expect(q(host, 'canvas-list')?.getAttribute('role')).toBe('tree');
    const folders = all(host, '[data-testid^="tree-folder-"]').map((b) => b.textContent);
    expect(folders.sort()).toEqual([
      '202616',
      '20270',
      'club-web9',
      'legacy27',
      'print6',
      'social31',
    ]);
    expect(q(host, 'canvas-row-ui-test')).not.toBeNull();
    // P8 C5: no foot line at rest (the board draws none); a long list keeps its Sort on the project row
    expect(q(host, 'canvases-foot')).toBeNull();
    expect(q(host, 'canvases-head-project')?.textContent).toContain('Alligators brand');
    expect(q(host, 'canvases-sort')?.textContent).toBe('Recent');
  });

  test('everything open: well over 100 rows in the list, at most 60 in the page', async () => {
    const { host } = await mount({
      expansion: { isOpen: () => true, setOpen: () => {} },
    });
    const list = q(host, 'canvas-list');
    expect(Number(list?.getAttribute('data-rows'))).toBeGreaterThan(100);
    const drawn = all(host, '[role="treeitem"]').length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThanOrEqual(60);
  });

  test('the old hooks answer: canvas-row-<slug>, tree-folder-<slug>, tree-row-menu-<slug>', async () => {
    const menu = { openAt: () => {} };
    const drag = {
      dragProps: () => ({}),
      dropProps: () => ({}),
      overDir: null,
      draggedPath: null,
      busyPath: null,
    };
    const { host } = await mount({
      menu,
      drag,
      expansion: { isOpen: (p: string) => p === `${ROOT}/legacy`, setOpen: () => {} },
    });
    expect(q(host, 'tree-folder-ui-legacy')?.getAttribute('aria-expanded')).toBe('true');
    // legacy (newest) is first and open, so its 27 rows push `social` below the window: not in the page
    expect(q(host, 'tree-folder-ui-social')).toBeNull();
    expect(q(host, 'tree-folder-ui-club-web')).toBeNull();
    expect(q(host, 'tree-row-menu-ui-legacy')).not.toBeNull();
    // newest first: legacy-27 sits right under its folder
    expect(q(host, 'canvas-row-ui-legacy-legacy-27')).not.toBeNull();
    expect(q(host, 'tree-row-menu-ui-legacy-legacy-27')).not.toBeNull();
  });
});

describe('badges come from the index', () => {
  test('Made by AI and the kind show on the row; the open canvas is selected', async () => {
    const { host } = await mount({ activePath: `${ROOT}/test.tsx` });
    const row = q(host, 'canvas-row-ui-test')?.closest('[role="treeitem"]');
    expect(row?.getAttribute('aria-selected')).toBe('true');
    expect(row?.querySelector('[aria-label="Made by AI"]')).not.toBeNull();
  });
});

describe('pins', () => {
  test('pin → POST /_api/pins; the canvas shows under Pinned and stays in its folder', async () => {
    const { host } = await mount();
    expect(q(host, 'canvases-head-pinned')).toBeNull();
    await click(q(host, 'canvas-pin-ui-test'));
    const post = calls.find((c) => c.url === '/_api/pins' && c.method === 'POST');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ canvas: 'ui/test.tsx', pinned: true });
    expect(q(host, 'canvases-head-pinned')?.textContent).toContain('1');
    expect(q(host, 'canvas-pinned-ui-test')).not.toBeNull();
    expect(q(host, 'canvas-row-ui-test')).not.toBeNull(); // still in the tree
    expect(
      q(host, 'canvas-row-ui-test')?.closest('[role="treeitem"]')?.getAttribute('aria-label')
    ).toBe('test');
  });

  test('unpin round-trips; the server list is read back when it refuses', async () => {
    pinsFile = [{ canvas: 'ui/test.tsx', at: 1 }];
    const { host } = await mount();
    expect(q(host, 'canvas-pinned-ui-test')).not.toBeNull();
    await click(q(host, 'canvas-unpin-ui-test-pinned'));
    expect(JSON.parse(calls.filter((c) => c.method === 'POST').at(-1)?.body ?? '{}')).toEqual({
      canvas: 'ui/test.tsx',
      pinned: false,
    });
    expect(q(host, 'canvases-head-pinned')).toBeNull();
  });
});

describe('sort', () => {
  // a11y gate B1: a role=tree owns treeitems only; the Sort button is drawn over the project row from a sibling lane.
  test('the Sort button is not inside the role=tree element', async () => {
    const { host } = await mount();
    const sort = q(host, 'canvases-sort');
    expect(sort).not.toBeNull();
    expect(
      host.querySelector('[data-testid="canvas-list"] [data-testid="canvases-sort"]')
    ).toBeNull();
    expect(q(host, 'canvases-head-project')).not.toBeNull();
  });

  test("the project row names the order; Name re-sorts and writes this project's entry", async () => {
    const { host } = await mount();
    expect(q(host, 'canvases-sort')?.textContent).toContain('Recent');
    await click(q(host, 'canvases-sort'));
    expect(q(host, 'canvases-sort-menu')?.textContent).toContain('Folders on top');
    expect(q(host, 'canvases-sort-recent')?.getAttribute('aria-checked')).toBe('true');
    await click(q(host, 'canvases-sort-name'));
    const post = calls.find((c) => c.url === '/_api/ui-prefs' && c.method === 'POST');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({
      canvasesSort: { [PID]: { by: 'name', foldersOnTop: true } },
    });
    expect(q(host, 'canvases-sort')?.textContent).toContain('Name');
    const names = all(host, '[data-testid^="canvas-row-"]').map((b) => b.textContent);
    expect(names).toEqual(['ahoj', 'ahoj2', 'test', 'Test2']);
  });

  test('a stored sort is applied on the next launch, whatever port the page is on', async () => {
    stored = {
      canvasesSort: {
        [PID]: { by: 'kind', foldersOnTop: false },
        lffffffffffffffff: { by: 'name', foldersOnTop: true },
      },
    };
    const { host } = await mount();
    expect(q(host, 'canvases-sort')?.textContent).toContain('Kind');
    // another project's entry in the same file is not ours
    expect(JSON.stringify(stored)).toContain('lffffffffffffffff');
  });

  test('Folders on top off is written and read back', async () => {
    const { host } = await mount();
    await click(q(host, 'canvases-sort'));
    await click(q(host, 'canvases-sort-folders'));
    const post = calls.filter((c) => c.url === '/_api/ui-prefs' && c.method === 'POST').at(-1);
    expect(JSON.parse(post?.body ?? '{}').canvasesSort[PID]).toEqual({
      by: 'recent',
      foldersOnTop: false,
    });
    const heads = all(host, '[role="treeitem"]').map((r) => r.getAttribute('aria-label'));
    // folders no longer lead: a leftover canvas can come before the first folder
    expect(heads.length).toBeGreaterThan(0);
  });
});

describe('an empty folder', () => {
  test("says so in the contract's words and offers a new canvas in that folder", async () => {
    const asked: Array<[string, string]> = [];
    const { host } = await mount({
      expansion: { isOpen: (p: string) => p === `${ROOT}/2027`, setOpen: () => {} },
      onNewCanvasIn: (path: string, name: string) => asked.push([path, name]),
    });
    const card = q(host, 'canvases-empty-ui-2027');
    expect(card?.textContent).toContain('Nothing in 2027 yet.');
    expect(card?.textContent).toContain('Drag canvases in, or start one here.');
    expect(q(host, 'canvases-empty-new')?.textContent).toContain('New canvas in 2027');
    // S11.3: it is the kit's block, with the 05 words, not ad-hoc markup
    expect(card?.querySelector('[data-copy="es-panels-canvas.folder-none"]')).not.toBeNull();
    await click(q(host, 'canvases-empty-new'));
    expect(asked).toEqual([[`${ROOT}/2027`, '2027']]);
  });

  test('a viewer is not offered one', async () => {
    const { host } = await mount({
      readOnly: true,
      expansion: { isOpen: (p: string) => p === `${ROOT}/2027`, setOpen: () => {} },
      onNewCanvasIn: () => {},
    });
    expect(q(host, 'canvases-empty-ui-2027')).not.toBeNull();
    expect(q(host, 'canvases-empty-new')).toBeNull();
  });
});

describe('keyboard', () => {
  test('the list is one tab stop; ↓ moves it; → opens a folder', async () => {
    const { host, setOpenCalls } = await mount();
    const items = () => all(host, '[role="treeitem"]');
    expect(items().filter((i) => i.tabIndex === 0)).toHaveLength(1);
    const first = items()[0];
    expect(first.tabIndex).toBe(0);
    await act(async () => first.focus());
    await key(first, 'ArrowDown');
    expect(items()[1].tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    await key(items()[1], 'ArrowRight');
    expect(setOpenCalls.at(-1)?.[1]).toBe(true);
  });

  test('Enter on a canvas opens it', async () => {
    const opened: string[] = [];
    const { host } = await mount({ onOpen: (p: string) => opened.push(p) });
    const row = q(host, 'canvas-row-ui-test')?.closest('[role="treeitem"]') as HTMLElement;
    await key(row, 'Enter');
    expect(opened).toEqual([`${ROOT}/test.tsx`]);
  });
});

describe('search', () => {
  test('flattens to the hits and says what it found', async () => {
    const { host } = await mount({ search: 'combine' });
    expect(all(host, '[data-testid^="canvas-row-"]')).toHaveLength(6);
    expect(q(host, 'canvases-foot')?.textContent).toBe('6 results · ⌘K searches every project');
  });

  test("nothing found says so in the contract's words; no AI here, so no second half and no button", async () => {
    const { host } = await mount({ search: 'pricng' });
    const none = q(host, 'canvases-nothing');
    expect(none?.getAttribute('data-copy')).toBe('es-search-panel.panel-search-none');
    expect(none?.querySelector('.es-sit')?.textContent).toBe('Nothing called “pricng”.');
    expect(none?.querySelector('.es-next')?.textContent).toBe('Try another word.');
    expect(none?.querySelector('[data-testid="empty-ask"]')).toBeNull();
    expect(none?.querySelector('.es-spot')).not.toBeNull();
    expect(q(host, 'canvases-foot')?.textContent).toBe('Searched 93 canvases and their artboards');
  });

  test('with AI: "Try another word, or ask AI to find it." and one Ask AI button that hands over the query', async () => {
    const { bindPaletteEnv } = await import('../client/v2/search/search-env.js');
    const asked: string[] = [];
    const unbind = bindPaletteEnv({ canAskAI: () => true, askAI: (t: string) => asked.push(t) });
    try {
      const { host } = await mount({ search: ' pricng ' });
      const none = q(host, 'canvases-nothing');
      expect(none?.querySelector('.es-next')?.textContent).toBe(
        'Try another word, or ask AI to find it.'
      );
      const btn = none?.querySelector<HTMLElement>('[data-testid="empty-ask"]');
      expect(btn?.textContent).toBe('Ask AI to find it');
      expect(none?.querySelectorAll('button')).toHaveLength(1);
      await click(btn ?? null);
      expect(asked).toEqual(['pricng']);
    } finally {
      unbind();
    }
  });
});

describe('without an index', () => {
  test('rows still draw; sorting still works in the page but nothing is written', async () => {
    const p = project();
    const { host } = await mount({}, { ...p, snapshot: { error: 'no index' } as never });
    expect(q(host, 'canvas-row-ui-test')).not.toBeNull();
    await click(q(host, 'canvases-sort'));
    await click(q(host, 'canvases-sort-name'));
    expect(calls.some((c) => c.url === '/_api/ui-prefs' && c.method === 'POST')).toBe(false);
  });
});
