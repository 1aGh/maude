// S1.2 — rename in place, the row menu, "Move to…" and the drag target (11 · pn-move, pn-trash inset).
// Double-click a name → a field; ↵ renames, esc keeps the name; a name the folder already has is refused under
// the field and nothing is sent. The row menu is Open · Pin · Rename · Duplicate · Move to… › · Copy link ·
// Move to trash; the old red × is gone. The registry's pin / sort / rename reach a mounted panel over the bus.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const D = '.design';
const ROOT = `${D}/ui`;
const PID = 'l0123456789abcdef';

function project() {
  const paths = [
    ...['ahoj', 'ahoj2', 'Test2', 'test'].map((n) => `${ROOT}/${n}.tsx`),
    `${ROOT}/legacy/old-1.tsx`,
    `${ROOT}/social/post-1.tsx`,
  ];
  const canvases = paths.map((p, i) => ({
    rel: p.slice(D.length + 1),
    kind: 'canvas',
    mtimeMs: 1000 + i,
    madeByAi: false,
    cover: null,
    artboards: [{ id: 'a', kind: 'web' }],
  }));
  return {
    groups: [
      {
        label: 'UI canvases',
        kind: 'canvas',
        fullPath: ROOT,
        paths,
        dirs: [`${ROOT}/legacy`, `${ROOT}/social`],
      },
    ],
    snapshot: { pid: PID, project: { designRel: D }, writer: { seq: 7 }, canvases },
  };
}

type Call = { url: string; method: string; body?: string };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
let stored: Record<string, unknown> = {};

function installFetch(snapshot: unknown) {
  calls = [];
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.startsWith('/_api/index')) return ok(snapshot);
    if (url === '/_api/pins' && method === 'GET') return ok({ v: 1, pins: [], opened: {} });
    if (url === '/_api/pins') return ok({ ok: true });
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
});

const settle = (ms = 420) => act(async () => new Promise((r) => setTimeout(r, ms)));

type Spy = {
  renames: Array<[string, string, unknown]>;
  moves: Array<[string, string]>;
  dups: string[];
  trashed: Array<[string, string]>;
  links: string[];
  opened: string[];
};

async function mount(over: Record<string, unknown> = {}, rename?: (...a: unknown[]) => unknown) {
  const p = project();
  installFetch(p.snapshot);
  const { CanvasesPanel } = await import('../client/v2/canvases/canvases-panel.jsx');
  const spy: Spy = { renames: [], moves: [], dups: [], trashed: [], links: [], opened: [] };
  const opened = new Set<string>();
  const expansion = {
    isOpen: (path: string) => opened.has(path),
    setOpen: (path: string, v: boolean) => {
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
        onOpen={(path: string) => spy.opened.push(path)}
        // a fresh isOpen per render, as the shell's expansion state gives when a folder opens
        expansion={{ isOpen: (path: string) => opened.has(path), setOpen: expansion.setOpen }}
        onRename={async (path: string, name: string, opts: unknown) => {
          spy.renames.push([path, name, opts]);
          return rename ? rename(path, name) : { ok: true };
        }}
        onMove={(path: string, dir: string) => spy.moves.push([path, dir])}
        onDuplicate={(path: string) => spy.dups.push(path)}
        onTrash={(path: string, name: string) => spy.trashed.push([path, name])}
        onCopyLink={(path: string) => spy.links.push(path)}
        {...over}
        {...extra}
      />
    );
  await act(async () => render());
  await settle();
  return {
    host,
    spy,
    opened,
    p,
    rerender: (e?: Record<string, unknown>) => act(async () => render(e)),
  };
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
const dbl = (el: Element | null) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
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
// Typing calls the input's own React onChange: react-dom decides at import time whether the page can hear
// `input` events and the imports are hoisted above happy-dom's registration (see v2-search-ui.test.tsx).
const type = (el: HTMLInputElement | null, v: string) => {
  if (!el) throw new Error('missing input');
  const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  const props = (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  return act(async () => {
    // The instance setter is React's value tracker: DOM and tracker agree, as after a real keystroke, so
    // the `change` happy-dom fires on ↵ does not read as a second edit.
    el.value = v;
    props.onChange({ target: el, currentTarget: el });
  });
};
const inputOf = (host: HTMLElement, slug: string) =>
  q(host, `canvas-rename-input-${slug}`) as HTMLInputElement | null;

describe('rename in place', () => {
  test('double-click turns the name into a field holding the name; ↵ renames and closes it', async () => {
    const { host, spy } = await mount();
    expect(inputOf(host, 'ui-ahoj')).toBeNull();
    await dbl(q(host, 'canvas-row-ui-ahoj'));
    const input = inputOf(host, 'ui-ahoj');
    expect(input?.value).toBe('ahoj');
    await type(input, 'Brno');
    await key(input, 'Enter');
    await settle(20);
    expect(spy.renames).toEqual([[`${ROOT}/ahoj.tsx`, 'Brno', { quiet: true }]]);
    expect(inputOf(host, 'ui-ahoj')).toBeNull();
  });

  test('esc keeps the name: nothing is sent and the field closes', async () => {
    const { host, spy } = await mount();
    await dbl(q(host, 'canvas-row-ui-ahoj'));
    const input = inputOf(host, 'ui-ahoj');
    await type(input, 'Something else');
    await key(input, 'Escape');
    await settle(20);
    expect(spy.renames).toEqual([]);
    expect(inputOf(host, 'ui-ahoj')).toBeNull();
    expect(q(host, 'canvas-row-ui-ahoj')?.textContent).toContain('ahoj');
  });

  test('↵ on the unchanged name sends nothing', async () => {
    const { host, spy } = await mount();
    await dbl(q(host, 'canvas-row-ui-ahoj'));
    await key(inputOf(host, 'ui-ahoj'), 'Enter');
    await settle(20);
    expect(spy.renames).toEqual([]);
    expect(inputOf(host, 'ui-ahoj')).toBeNull();
  });

  test('the canvas example "Combine — test barev" is refused with a suggestion; one ↵ more accepts it (S1.23c)', async () => {
    const { host, spy } = await mount();
    await dbl(q(host, 'canvas-row-ui-ahoj'));
    const input = inputOf(host, 'ui-ahoj');
    await type(input, 'Combine — test barev');
    await key(input, 'Enter');
    await settle(20);
    expect(spy.renames).toEqual([]);
    expect(q(host, 'canvas-rename-error')?.textContent).toBe(
      'Names can use letters, numbers, spaces, - and _. Try “Combine - test barev”.'
    );
    // the suggestion is already in the field, so one more ↵ takes it
    expect(inputOf(host, 'ui-ahoj')?.value).toBe('Combine - test barev');
    await key(inputOf(host, 'ui-ahoj'), 'Enter');
    await settle(20);
    expect(q(host, 'canvas-rename-error')).toBeNull();
    expect(spy.renames).toEqual([[`${ROOT}/ahoj.tsx`, 'Combine - test barev', { quiet: true }]]);
  });

  test('a character outside the set is refused under the field in CONTRACT words, nothing sent (S1.23c)', async () => {
    const { host, spy } = await mount();
    await dbl(q(host, 'canvas-row-ui-ahoj'));
    const input = inputOf(host, 'ui-ahoj');
    await type(input, 'Plan: draft');
    await key(input, 'Enter');
    await settle(20);
    expect(spy.renames).toEqual([]);
    expect(q(host, 'canvas-rename-error')?.textContent).toBe(
      'Names can use letters, numbers, spaces, - and _. Try “Plan draft”.'
    );
  });

  test('the field carries "↵ rename · esc keep “<name>”" until an error speaks (S1.23 G2)', async () => {
    const { host } = await mount();
    await dbl(q(host, 'canvas-row-ui-ahoj'));
    expect(q(host, 'canvas-rename-hint')?.textContent).toBe('↵ rename · esc keep “ahoj”');
    const input = inputOf(host, 'ui-ahoj');
    await type(input, 'a/b');
    await key(input, 'Enter');
    await settle(20);
    expect(q(host, 'canvas-rename-hint')).toBeNull();
    expect(q(host, 'canvas-rename-error')).not.toBeNull();
  });

  test('a name the folder already has is refused under the field — nothing sent, field stays', async () => {
    const { host, spy } = await mount();
    await dbl(q(host, 'canvas-row-ui-ahoj'));
    const input = inputOf(host, 'ui-ahoj');
    // folded: "TEST" is the canvas called "test"
    await type(input, 'TEST');
    await key(input, 'Enter');
    await settle(20);
    expect(spy.renames).toEqual([]);
    const err = q(host, 'canvas-rename-error');
    expect(err?.textContent).toBe('That name is already used in this folder.');
    expect(err?.getAttribute('role')).toBe('alert');
    expect(inputOf(host, 'ui-ahoj')?.getAttribute('aria-invalid')).toBe('true');
    // typing again clears the complaint
    await type(inputOf(host, 'ui-ahoj'), 'TEST 3');
    expect(q(host, 'canvas-rename-error')).toBeNull();
  });

  test('the same name in ANOTHER folder is fine', async () => {
    const { host, spy } = await mount({
      expansion: { isOpen: () => true, setOpen: () => {} },
    });
    await dbl(q(host, 'canvas-row-ui-legacy-old-1'));
    await type(inputOf(host, 'ui-legacy-old-1'), 'ahoj');
    await key(inputOf(host, 'ui-legacy-old-1'), 'Enter');
    await settle(20);
    expect(spy.renames.map((r) => r[1])).toEqual(['ahoj']);
  });

  test("the server's refusal is shown in the same slot and the field stays open", async () => {
    const { host } = await mount({}, () => ({
      ok: false,
      error: 'moving here would collide with another canvas',
    }));
    await dbl(q(host, 'canvas-row-ui-ahoj'));
    await type(inputOf(host, 'ui-ahoj'), 'Brno');
    await key(inputOf(host, 'ui-ahoj'), 'Enter');
    await settle(20);
    expect(q(host, 'canvas-rename-error')?.textContent).toBe(
      'moving here would collide with another canvas'
    );
    expect(inputOf(host, 'ui-ahoj')).not.toBeNull();
  });

  test('F2 renames the focused row; a viewer cannot rename', async () => {
    const { host } = await mount();
    const item = host
      .querySelector('[data-testid="canvas-row-ui-ahoj"]')
      ?.closest('[role="treeitem"]');
    await key(q(host, 'canvas-row-ui-ahoj'), 'F2');
    expect(item).not.toBeNull();
    expect(inputOf(host, 'ui-ahoj')).not.toBeNull();
  });

  test('read-only: double-click and F2 leave the name alone', async () => {
    const { host } = await mount({ readOnly: true });
    await dbl(q(host, 'canvas-row-ui-ahoj'));
    await key(q(host, 'canvas-row-ui-ahoj'), 'F2');
    expect(inputOf(host, 'ui-ahoj')).toBeNull();
  });
});

describe('the row menu', () => {
  test('⋯ opens Open · Pin · Rename · Duplicate · Move to… · Copy link · Move to trash — and no red ×', async () => {
    const { host } = await mount();
    expect(host.querySelector('.cv-act--del')).toBeNull();
    await click(q(host, 'tree-row-menu-ui-ahoj'));
    const labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map(
      (b) => b.textContent
    );
    expect(labels).toEqual([
      'Open',
      'Pin',
      'Rename',
      'Duplicate',
      'Move to…',
      'Copy link',
      'Move to trash',
    ]);
  });

  test('a viewer is offered Open · Pin · Copy link only', async () => {
    const { host } = await mount({ readOnly: true });
    await click(q(host, 'tree-row-menu-ui-ahoj'));
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent)
    ).toEqual(['Open', 'Pin', 'Copy link']);
  });

  // S10.21b — a canvas left out of its design system's update gets Update in its menu (ds.canvas-update)
  test('a left-out canvas offers Update, which runs ds.canvas-update with its design-root path', async () => {
    const R0 = 'a'.repeat(64);
    const R1 = 'b'.repeat(64);
    const dsCfg = {
      designRel: D,
      designSystems: [{ name: 'acme', path: 'system/acme' }],
      dsConverted: { acme: true },
      systemHeads: { acme: R1 },
      canvasDsRevs: { 'ui/ahoj.tsx': R0, 'ui/ahoj2.tsx': R1 },
    };
    const ran: Array<[string, unknown]> = [];
    const { host } = await mount({
      dsCfg,
      onDsAction: (id: string, p: unknown) => ran.push([id, p]),
    });
    await click(q(host, 'tree-row-menu-ui-ahoj'));
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent)
    ).toEqual([
      'Open',
      'Pin',
      'Rename',
      'Duplicate',
      'Move to…',
      'Update',
      'Copy link',
      'Move to trash',
    ]);
    await click(byId('canvas-menu-ds-update'));
    expect(ran).toEqual([['ds.canvas-update', { canvas: 'ui/ahoj.tsx' }]]);
    expect(byId('canvas-row-menu')).toBeNull();
    // a canvas at head has nothing to update
    await click(q(host, 'tree-row-menu-ui-ahoj2'));
    expect(byId('canvas-menu-ds-update')).toBeNull();
  });

  test('each row runs its function once and closes the menu', async () => {
    const { host, spy } = await mount();
    const path = `${ROOT}/ahoj.tsx`;
    for (const [id, check] of [
      ['open', () => spy.opened],
      ['duplicate', () => spy.dups],
      ['copy-link', () => spy.links],
    ] as const) {
      await click(q(host, 'tree-row-menu-ui-ahoj'));
      await click(byId(`canvas-menu-${id}`));
      expect(check(), id).toEqual([path]);
      expect(byId('canvas-row-menu')).toBeNull();
    }
    await click(q(host, 'tree-row-menu-ui-ahoj'));
    await click(byId('canvas-menu-trash'));
    expect(spy.trashed).toEqual([[path, 'ahoj']]);
    // Pin goes through /_api/pins
    await click(q(host, 'tree-row-menu-ui-ahoj'));
    await click(byId('canvas-menu-pin'));
    await settle(20);
    expect(calls.some((c) => c.url === '/_api/pins' && c.method === 'POST')).toBe(true);
  });

  // p8-sweep-advanced — the dead-control crawl clicked Open on the canvas that was already open and nothing happened
  test('the open canvas’s menu has no Open row; any other canvas keeps it', async () => {
    const { canvasMenuItems } = await import('../client/v2/canvases/row-menu.jsx');
    const row = { path: 'a.tsx', pinnable: true, pinned: false };
    const ids = (o: object) => canvasMenuItems(row, o).map((i: { id: string }) => i.id);
    expect(ids({})[0]).toBe('open');
    expect(ids({ isOpen: false })[0]).toBe('open');
    expect(ids({ isOpen: true })).not.toContain('open');
    expect(ids({ isOpen: true })[0]).toBe('pin');
  });

  test('Rename in the menu opens the field', async () => {
    const { host } = await mount();
    await click(q(host, 'tree-row-menu-ui-ahoj'));
    await click(byId('canvas-menu-rename'));
    expect(inputOf(host, 'ui-ahoj')).not.toBeNull();
  });

  test('Move to… lists the other folders; choosing one moves the canvas there', async () => {
    const { host, spy } = await mount();
    await click(q(host, 'tree-row-menu-ui-ahoj'));
    await click(byId('canvas-menu-move'));
    expect(byId('canvas-move-sheet')).not.toBeNull();
    // the two folders; the folder the canvas is in (the project itself) is not offered
    const targets = Array.from(
      document.querySelectorAll('[data-testid^="canvas-move-target-"]')
    ).map((el) => el.textContent);
    expect(targets).toEqual(['legacy', 'social']);
    await click(byId('canvas-move-target-ui-social'));
    expect(spy.moves).toEqual([[`${ROOT}/ahoj.tsx`, `${ROOT}/social`]]);
    expect(byId('canvas-row-menu')).toBeNull();
  });

  test('from inside a folder the project itself is offered, by its name', async () => {
    const { host } = await mount({ expansion: { isOpen: () => true, setOpen: () => {} } });
    await click(q(host, 'tree-row-menu-ui-legacy-old-1'));
    await click(byId('canvas-menu-move'));
    expect(
      Array.from(document.querySelectorAll('[data-testid^="canvas-move-target-"]')).map(
        (el) => el.textContent
      )
    ).toEqual(['Alligators brand', 'social']);
  });

  test('the folder list filters by what is typed and ↵ moves to the first match', async () => {
    const { host, spy } = await mount();
    await click(q(host, 'tree-row-menu-ui-ahoj'));
    await click(byId('canvas-menu-move'));
    const filter = byId('canvas-move-filter') as HTMLInputElement;
    await type(filter, 'LEG');
    expect(
      Array.from(document.querySelectorAll('[data-testid^="canvas-move-target-"]')).map(
        (el) => el.textContent
      )
    ).toEqual(['legacy']);
    await key(filter, 'Enter');
    expect(spy.moves).toEqual([[`${ROOT}/ahoj.tsx`, `${ROOT}/legacy`]]);
  });

  test('esc closes the menu', async () => {
    const { host } = await mount();
    await click(q(host, 'tree-row-menu-ui-ahoj'));
    expect(byId('canvas-row-menu')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(byId('canvas-row-menu')).toBeNull();
  });
});

describe('drag onto a folder', () => {
  const drag = (over: string | null, dragged: string | null) => ({
    dragProps: () => ({}),
    dropProps: () => ({}),
    overDir: over,
    draggedPath: dragged,
    busyPath: null,
  });

  test('the folder under the drag says "Move here"', async () => {
    const { host } = await mount({ drag: drag(`${ROOT}/legacy`, `${ROOT}/ahoj.tsx`) });
    expect(q(host, 'tree-folder-ui-legacy')?.textContent).toContain('Move here');
    expect(host.querySelectorAll('[data-testid="canvases-drop-tag"]')).toHaveLength(1);
  });

  test('the folder the canvas already sits in does not', async () => {
    const { host } = await mount({ drag: drag(`${ROOT}/legacy`, `${ROOT}/legacy/old-1.tsx`) });
    expect(host.querySelector('[data-testid="canvases-drop-tag"]')).toBeNull();
  });

  test('the project row takes a drop too', async () => {
    const { host } = await mount({ drag: drag(ROOT, `${ROOT}/legacy/old-1.tsx`) });
    expect(q(host, 'canvases-head-project')?.textContent).toContain('Move here');
  });
});

describe('what the registry asks of the panel (left-panel bus)', () => {
  test('canvases.pin / unpin write /_api/pins for the open canvas', async () => {
    const { host } = await mount();
    const bus = await import('../client/v2/left-panel/left-panel-bus.js');
    bus.requestCanvasesOp({ op: 'pin', path: `${ROOT}/ahoj.tsx`, pinned: true });
    await settle(20);
    const post = calls.filter((c) => c.url === '/_api/pins' && c.method === 'POST');
    expect(post).toHaveLength(1);
    expect(JSON.parse(post[0].body ?? '{}')).toEqual({ canvas: 'ui/ahoj.tsx', pinned: true });
    expect(q(host, 'canvas-unpin-ui-ahoj')).not.toBeNull();
    bus.requestCanvasesOp({ op: 'pin', path: `${ROOT}/ahoj.tsx`, pinned: false });
    await settle(20);
    expect(
      JSON.parse(calls.filter((c) => c.url === '/_api/pins' && c.method === 'POST')[1].body ?? '{}')
    ).toEqual({ canvas: 'ui/ahoj.tsx', pinned: false });
  });

  test('a request that comes before the panel is mounted is answered when it mounts', async () => {
    const bus = await import('../client/v2/left-panel/left-panel-bus.js');
    bus.requestCanvasesOp({ op: 'rename', path: `${ROOT}/ahoj.tsx` });
    const { host } = await mount();
    await settle(20);
    expect(inputOf(host, 'ui-ahoj')).not.toBeNull();
  });

  test('canvas.rename opens the folders above the canvas and puts the field on its row', async () => {
    const { host, opened, rerender } = await mount();
    const bus = await import('../client/v2/left-panel/left-panel-bus.js');
    bus.requestCanvasesOp({ op: 'rename', path: `${ROOT}/legacy/old-1.tsx` });
    await settle(20);
    expect(opened.has(`${ROOT}/legacy`)).toBe(true);
    await rerender(); // the shell re-renders on the folder opening; the field follows it
    await settle(20);
    expect(inputOf(host, 'ui-legacy-old-1')).not.toBeNull();
  });

  test('canvases.sort opens the Sort menu', async () => {
    const { host } = await mount();
    const bus = await import('../client/v2/left-panel/left-panel-bus.js');
    bus.requestCanvasesOp({ op: 'sort' });
    await settle(20);
    expect(q(host, 'canvases-sort-menu')).not.toBeNull();
  });
});

describe('the registry handlers (menu runner)', () => {
  const PATH = `${ROOT}/ahoj.tsx`;
  async function handlers() {
    const { createMenuHandlers } = await import('../client/v2/shell/menu-runner.js');
    const calls: string[] = [];
    const h = createMenuHandlers({
      activePath: PATH,
      canvasName: 'ahoj',
      openPanelExclusive: (id: string) => calls.push(`panel:${id}`),
      toast: () => {},
    });
    return { h, calls };
  }

  test('canvas.rename asks the panel for the field — it never opens a window.prompt', async () => {
    const bus = await import('../client/v2/left-panel/left-panel-bus.js');
    bus.takeCanvasesOps();
    const realPrompt = window.prompt;
    let prompted = false;
    window.prompt = () => {
      prompted = true;
      return null;
    };
    try {
      const { h, calls } = await handlers();
      h['canvas.rename']();
      expect(prompted).toBe(false);
      expect(calls).toContain('panel:tree');
      expect(bus.takeCanvasesOps()).toEqual([{ op: 'rename', path: PATH }]);
    } finally {
      window.prompt = realPrompt;
    }
  });

  test('canvases.pin / unpin / sort queue what the panel does', async () => {
    const bus = await import('../client/v2/left-panel/left-panel-bus.js');
    bus.takeCanvasesOps();
    const { h } = await handlers();
    h['canvases.pin']();
    h['canvases.unpin']();
    h['canvases.sort']();
    expect(bus.takeCanvasesOps()).toEqual([
      { op: 'pin', path: PATH, pinned: true },
      { op: 'pin', path: PATH, pinned: false },
      { op: 'sort' },
    ]);
  });

  test('canvas.copy-link and canvas.trash tell the shell, with the open canvas', async () => {
    const bus = await import('../client/v2/left-panel/left-panel-bus.js');
    const seen: Array<{ op: string; path: string; label?: string }> = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(bus.CANVAS_OP_EVENT, on);
    try {
      const { h } = await handlers();
      h['canvas.copy-link']();
      h['canvas.trash']();
    } finally {
      window.removeEventListener(bus.CANVAS_OP_EVENT, on);
    }
    expect(seen).toEqual([
      { op: 'copy-link', path: PATH, label: undefined },
      { op: 'trash', path: PATH, label: 'ahoj' },
    ]);
  });
});

describe('the Sort menu from the keyboard', () => {
  test('opening takes the focus to the chosen sort; ↓ ↑ Home End walk; esc closes and returns to the button', async () => {
    const { host } = await mount();
    const button = q(host, 'canvases-sort') as HTMLButtonElement;
    await click(button);
    const menu = q(host, 'canvases-sort-menu') as HTMLElement;
    const items = Array.from(menu.querySelectorAll('button'));
    expect(items.length).toBeGreaterThan(3);
    const checked = items.find((i) => i.getAttribute('aria-checked') === 'true');
    expect(document.activeElement).toBe(checked);
    const start = items.indexOf(checked as HTMLButtonElement);
    await key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(items[(start + 1) % items.length]);
    await key(document.activeElement, 'End');
    expect(document.activeElement).toBe(items[items.length - 1]);
    await key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(items[0]);
    await key(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(items[items.length - 1]);
    await act(async () => {
      document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(q(host, 'canvases-sort-menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe('the Sort menu stays on screen (S1.23 G1, 11 · pn-organise)', () => {
  const rect = (left: number, right: number) => ({
    left,
    right,
    top: 100,
    bottom: 124,
    width: right - left,
    height: 24,
    x: left,
    y: 100,
    toJSON() {},
  });
  async function openAt(left: number, right: number) {
    const { host } = await mount();
    const button = q(host, 'canvases-sort') as HTMLButtonElement;
    button.getBoundingClientRect = () => rect(left, right) as DOMRect;
    await click(button);
    return q(host, 'canvases-sort-menu') as HTMLElement;
  }

  test('260 wide, placed in the window at the button, pulled back off the right edge', async () => {
    const vw = window.innerWidth;
    const menu = await openAt(vw - 40, vw - 12);
    expect(menu.style.position).toBe('fixed');
    // a 260 wide menu: its left edge is at most vw - 8 - 260, so its right edge is on screen
    expect(parseFloat(menu.style.left)).toBe(vw - 8 - 260);
    expect(menu.style.top).toBe('128px');
  });

  test('a button near the left edge never puts the menu off the left (the clipped "ort by")', async () => {
    const menu = await openAt(-30, -6);
    expect(parseFloat(menu.style.left)).toBe(8);
  });

  test('a button with room puts the menu at its left edge', async () => {
    const menu = await openAt(120, 144);
    expect(parseFloat(menu.style.left)).toBe(120);
  });
});
