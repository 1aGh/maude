// V2-4.4a — the left panel rendered: the Canvases tab's order (Design system pinned on top, Trash the
// last row, Advanced under it), Advanced holding Refresh + Hidden files, the Trash list, the Assets tab.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Fetch = (url: string, init?: { method?: string; body?: string }) => Promise<Response>;
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body?: string }> = [];

const TRASH = {
  entries: [
    {
      trashRel: '_trash/2026-10-14T10-00-00Z__ahoj/ahoj.tsx',
      sourceRel: 'ui/ahoj.tsx',
      reason: 'deleted',
      at: Date.now() - 60_000,
      size: 10,
    },
    {
      trashRel: '_trash/old/a-conflict-1700000000000',
      sourceRel: null,
      reason: 'conflict',
      at: Date.now() - 86400_000 * 3,
      size: 5,
    },
  ],
  total: 2,
  bytes: 15,
};

function installFetch(handlers: Record<string, unknown> = {}) {
  calls = [];
  const f: Fetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    const key = Object.keys(handlers).find((k) => url.startsWith(k));
    const body = key ? handlers[key] : { ok: true };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  globalThis.fetch = f as unknown as typeof fetch;
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
  // unmount, or an earlier panel's open-trash listener would swallow a later test's request
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

async function mount(el: React.ReactElement): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  // the trash read is debounced 250 ms; let its answer land inside act
  await act(async () => new Promise((r) => setTimeout(r, 320)));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return { host, root };
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};

const GROUPS = [
  {
    label: 'Design system',
    kind: 'canvas',
    fullPath: '.design/system',
    paths: [],
    tree: {},
    dsFolders: [{ name: 'alligators', folder: 'alligators' }],
  },
  {
    label: 'UI kit',
    kind: 'canvas',
    fullPath: '.design/ui',
    paths: ['.design/ui/Pricing.tsx'],
    tree: { 'Pricing.tsx': { __file: true, path: '.design/ui/Pricing.tsx', name: 'Pricing.tsx' } },
  },
];

async function sidebar(over: Record<string, unknown> = {}) {
  const { Sidebar } = await import('../client/tree/tree.jsx');
  const props = {
    cloud: {},
    groups: GROUPS,
    activePath: null,
    activeDsName: null,
    onOpen: () => {},
    onPreview: () => {},
    onOpenSystem: () => {},
    wsConnected: true,
    search: '',
    setSearch: () => {},
    commentsByFile: {},
    showHidden: false,
    sectionsExpanded: {},
    onToggleSection: () => {},
    treeExpansion: { isOpen: () => true, setOpen: () => {} },
    onNewBoard: async () => ({ ok: true }),
    onRefresh: () => {},
    refreshing: false,
    onToggleShowHidden: () => {},
    onCollapse: () => {},
    filesReady: true,
    project: 'demo',
    ...over,
  };
  return mount(<Sidebar {...(props as never)} />);
}

describe('Canvases tab', () => {
  test('header says Canvases, never Files; the old header Refresh and live count are gone', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar();
    expect(host.querySelector('.cv-sb-title')?.textContent).toBe('Canvases');
    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe('Canvases');
    expect(host.querySelector('.cv-sb-hd .sh-refresh')).toBeNull();
    expect(host.querySelector('.cv-sb-hd .st-live')).toBeNull();
  });

  // V2-4.gate (design-critic blockers 1 + warnings): the group count was `.sh-pill`, which the project
  // pill's `position:absolute` island rule also matched — it floated over the header. The header row
  // repeated the tab name and carried a second fold control.
  // S1.1: the section header became the project row (11 · pn-organise) — the project's name and its Sort,
  // with the count in words under the list; hidden files on brings the old section headers back.
  test('the project row replaces the section header; the count is words under the list, never an `.sh-pill`', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar({ project: 'Alligators brand' });
    const hd = q(host, 'canvases-head-project') as HTMLElement;
    expect(hd.querySelector('.sh-pill')).toBeNull();
    expect(hd.textContent).toContain('Alligators brand');
    // P8 C5: the count is on the project row ("1 canvas"), not a foot line the board does not draw
    expect(q(host, 'canvases-foot')).toBeNull();
    expect(q(host, 'canvases-sort')?.textContent).toBe('1 canvas');
    expect(host.querySelector('.sh-tree-sec-hd')).toBeNull();
  });

  // P8 C10 (06 ad-left): Show hidden files is the SAME tree with the supporting files dimmed in place — no
  // v1 file view (section headers, flat rows) any more; the rows the board draws: sidecars under their canvas,
  // a folder's loose notes, the runtime entries at the root.
  test('hidden files on draws the canvas tree with the supporting rows in place, not the file view', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const groups = [
      GROUPS[0],
      {
        label: 'UI kit',
        kind: 'canvas',
        fullPath: '.design/ui',
        paths: [
          '.design/ui/Pricing.tsx',
          '.design/ui/Pricing.meta.json',
          '.design/ui/Pricing.css',
          '.design/ui/NOTES.md',
        ],
        tree: {},
      },
      {
        label: 'Runtime',
        kind: 'runtime',
        fullPath: '.design',
        paths: ['.design/_history', '.design/_canvas-state'],
        tree: {},
      },
    ];
    const { host } = await sidebar({ showHidden: true, groups });
    expect(host.querySelector('.sh-tree-sec-hd')).toBeNull();
    const names = [...host.querySelectorAll('[data-testid^="file-row-"] .cv-name')].map(
      (n) => n.textContent
    );
    expect(names).toEqual([
      'Pricing.css',
      'Pricing.meta.json',
      'NOTES.md',
      '_canvas-state/',
      '_history/',
    ]);
    // the sidecars sit one level under their canvas; the runtime entries at the root
    const level = (id: string) =>
      q(host, id)?.closest('[role="treeitem"]')?.getAttribute('aria-level');
    expect(level('file-row-ui-pricing-css')).toBe('2');
    expect(level('file-row-ui-notes-md')).toBe('1');
    expect(level('file-row-history')).toBe('1');
    // a supporting file keeps its ⋯ menu; the runtime entries are inert (process state)
    expect(q(host, 'tree-row-menu-ui-notes-md')).not.toBeNull();
    expect(q(host, 'tree-row-menu-history')).toBeNull();
  });

  test('hidden files off: no supporting row at all', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar({ showHidden: false });
    expect(host.querySelector('[data-testid^="file-row-"]')).toBeNull();
  });

  // P8 C4 (lead call v2-p8-lead-canvases-header-and-switcher): the header's "+" / folder pair is gone; the
  // board's "+ New canvas" row ends the list and carries the hooks the pair did.
  test('the header row carries no create buttons; "+ New canvas" ends the list and keeps the hooks', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar();
    const hd = host.querySelector('.cv-sb-hd') as HTMLElement | null;
    expect(hd?.querySelectorAll('button').length ?? 0).toBe(0);
    expect(host.querySelector('[aria-label="Collapse sidebar"]')).toBeNull();
    const row = q(host, 'canvases-new-row') as HTMLElement;
    expect(row.textContent).toContain('New canvas');
    const main = row.querySelector('[aria-label="New canvas"]') as HTMLElement;
    expect(main).toBeTruthy();
    expect(row.querySelector('[data-testid="tree-new-folder"]')).toBeTruthy();
    // it sits after the list and before the Trash row
    const list = q(host, 'canvas-list') as HTMLElement;
    const trash = q(host, 'canvases-trash-row') as HTMLElement;
    expect(list.compareDocumentPosition(row) & 4).toBeTruthy();
    expect(row.compareDocumentPosition(trash) & 4).toBeTruthy();
    // the header has no "+" glyph button left over
    expect(host.querySelectorAll('[aria-label="New canvas"]').length).toBe(1);
  });

  // R2-P2 (TD2, F06): the row asked for a name IS the field, in place; nothing is written until it is committed.
  const typeInto = async (input: HTMLInputElement, value: string) => {
    const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps')) as string;
    const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[
      propsKey
    ];
    await act(async () => props.onChange({ target: { value } }));
  };
  const key = (el: Element, k: string) =>
    act(async () => {
      el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
    });

  test('New canvas turns its own row into the name field: "Untitled canvas", selected, nothing written yet', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar();
    await click(host.querySelector('[aria-label="New canvas"]'));
    const input = q(host, 'canvases-new-name') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Canvas name');
    expect(input.value).toBe('Untitled canvas');
    // in place: the field sits in the "+ New canvas" row, not in a composer at the top of the panel
    expect(q(host, 'canvases-new-row')?.contains(input)).toBe(true);
    expect(host.querySelector('.cv-newboard')).toBeNull();
    expect(host.querySelector('[aria-label="New canvas"]')).toBeNull();
    // no file yet: a rename after the fact would re-key the slug sidecars (DDR-198)
    expect(calls.some((c) => c.url.startsWith('/_api/canvas') && c.method === 'POST')).toBe(false);
  });

  test('Enter commits the name: ONE blank-canvas POST carries it, and the canvas opens', async () => {
    installFetch({
      '/_api/sync/trash': TRASH,
      '/_api/canvas': { ok: true, file: 'ui/Pricing v2.tsx' },
    });
    const { host } = await sidebar();
    await click(host.querySelector('[aria-label="New canvas"]'));
    const input = q(host, 'canvases-new-name') as HTMLInputElement;
    await typeInto(input, 'Pricing v2');
    await key(input, 'Enter');
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    const posts = calls.filter((c) => c.url === '/_api/canvas' && c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0].body ?? '{}')).toEqual({ kind: 'blank', name: 'Pricing v2' });
    // committed: the row is a button again
    expect(q(host, 'canvases-new-name')).toBeNull();
    expect(host.querySelector('[aria-label="New canvas"]')).toBeTruthy();
  });

  test('Esc, or leaving the field, writes nothing and gives the row back', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar();
    await click(host.querySelector('[aria-label="New canvas"]'));
    await key(q(host, 'canvases-new-name') as HTMLElement, 'Escape');
    expect(q(host, 'canvases-new-name')).toBeNull();
    await click(host.querySelector('[aria-label="New canvas"]'));
    await act(async () => {
      (q(host, 'canvases-new-name') as HTMLElement).dispatchEvent(
        new window.FocusEvent('focusout', { bubbles: true })
      );
    });
    expect(q(host, 'canvases-new-name')).toBeNull();
    expect(calls.some((c) => c.url === '/_api/canvas' && c.method === 'POST')).toBe(false);
  });

  test('a name the server refuses stays in the field with the reason beside it', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
      if (url === '/_api/canvas')
        return new Response(
          JSON.stringify({ ok: false, error: 'a canvas called "Pricing" is already here' }),
          {
            status: 409,
          }
        );
      return new Response(
        JSON.stringify(url.startsWith('/_api/sync/trash') ? TRASH : { ok: true })
      );
    }) as unknown as typeof fetch;
    const { host } = await sidebar();
    await click(host.querySelector('[aria-label="New canvas"]'));
    const input = q(host, 'canvases-new-name') as HTMLInputElement;
    await typeInto(input, 'Pricing');
    await key(input, 'Enter');
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(q(host, 'canvases-new-name')).not.toBeNull();
    expect(host.querySelector('.cv-newboard-err')?.textContent).toContain('already here');
  });

  test('New folder asks the same way, in the same place', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar();
    await click(q(host, 'tree-new-folder'));
    const input = q(host, 'canvases-new-name') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Folder name');
    expect(q(host, 'canvases-new-row')?.contains(input)).toBe(true);
  });

  test('the brief composer is a door of its own (the new-brief op), and its words are canvas, not board', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar();
    const { requestCanvasesOp } = await import('../client/v2/left-panel/left-panel-bus.js');
    await act(async () => requestCanvasesOp({ op: 'new-brief' }));
    const input = host.querySelector(
      'input[aria-label="New brief canvas name"]'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe('Brief canvas name…');
    expect(host.querySelector('[aria-label="Create brief canvas"]')).toBeTruthy();
    expect(host.textContent).not.toMatch(/board/i);
  });

  test('a viewer gets no new-canvas row', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar({ readOnly: true });
    expect(q(host, 'canvases-new-row')).toBeNull();
    expect(host.querySelector('[aria-label="New canvas"]')).toBeNull();
  });

  test('the Design system row is pinned above the list; Trash is the last row, Advanced under it', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar();
    const ds = q(host, 'canvases-ds-row');
    const list = q(host, 'canvas-list');
    const trash = q(host, 'canvases-trash-row');
    const adv = q(host, 'canvases-advanced');
    expect(ds && list && trash && adv).toBeTruthy();
    expect(ds?.textContent).toContain('Design system');
    const order = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order(ds as Element, list as Element)).toBe(true);
    expect(order(list as Element, trash as Element)).toBe(true);
    expect(order(trash as Element, adv as Element)).toBe(true);
    // nothing else sits between the list and the Trash row: it is the last ROW
    // (S7.24 wrapped the list in `.cv-listwrap` with the Sort lane beside it, so the Trash row follows the
    // wrapper, not the tree element itself — same order on screen, stale sibling check.)
    // P8 C4: the "+ New canvas" row ends the list, so it is the one thing between the list and Trash.
    const wrap = list?.closest('.cv-listwrap') ?? list;
    expect(wrap?.nextElementSibling).toBe(q(host, 'canvases-new-row'));
    expect(q(host, 'canvases-new-row')?.nextElementSibling).toBe(trash);
    expect(trash?.textContent).toContain('2'); // the count
    // …and the DESIGN SYSTEM section is not in the default list any more
    expect(host.querySelector('[data-testid="tree-section-design-system"]')).toBeNull();
  });

  test('the Design system row opens the design-system view', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const opened: string[] = [];
    const { host } = await sidebar({ onOpenSystem: (n: string) => opened.push(n) });
    await click(q(host, 'canvases-ds-row'));
    expect(opened).toEqual(['alligators']);
  });

  test('Advanced is closed to start; open, it holds Refresh tree and the Hidden files switch', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    let refreshed = 0;
    let hidden = 0;
    const { host } = await sidebar({
      onRefresh: () => {
        refreshed++;
      },
      onToggleShowHidden: () => {
        hidden++;
      },
    });
    expect(q(host, 'canvases-refresh')).toBeNull();
    expect(q(host, 'canvases-hidden-files')).toBeNull();
    await click(q(host, 'canvases-advanced'));
    const sw = q(host, 'canvases-hidden-files');
    expect(sw?.getAttribute('role')).toBe('switch');
    expect(sw?.getAttribute('aria-checked')).toBe('false');
    await click(sw);
    await click(q(host, 'canvases-refresh'));
    expect({ refreshed, hidden }).toEqual({ refreshed: 1, hidden: 1 });
    // the design system's FILES live here now, not in the list
    expect(
      host.querySelector(
        '[data-testid="canvases-advanced-fold"] [data-testid="tree-section-design-system"]'
      )
    ).not.toBeNull();
    // …and Trash is listed here too
    expect(q(host, 'canvases-advanced-trash')).not.toBeNull();
  });

  test('Trash opens today’s list, Restore posts to the same route, the back arrow returns', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar();
    await click(q(host, 'canvases-trash-row'));
    expect(q(host, 'canvases-trash')).not.toBeNull();
    expect(q(host, 'canvas-list')).toBeNull();
    expect(host.querySelectorAll('[data-testid="canvases-trash-item"]').length).toBe(2);
    // only the entry that knows where it came from can be restored
    expect(host.querySelectorAll('[data-testid="canvases-trash-restore"]').length).toBe(1);
    await click(q(host, 'canvases-trash-restore'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/_api/sync/trash');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({
      action: 'restore',
      trashRel: TRASH.entries[0]?.trashRel,
    });
    await click(q(host, 'canvases-trash-back'));
    expect(q(host, 'canvas-list')).not.toBeNull();
  });

  test('Clear out asks first, and only offers itself to someone who can change things', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar();
    await click(q(host, 'canvases-trash-row'));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await click(q(host, 'canvases-trash-clear'));
    expect(q(host, 'canvases-trash-ask')?.textContent).toContain('Clear out the trash?');
    expect(calls.some((c) => c.method === 'POST')).toBe(false); // asked, did nothing
    await click(q(host, 'canvases-trash-clear-yes'));
    const post = calls.find((c) => c.method === 'POST');
    expect(JSON.parse(post?.body ?? '{}').action).toBe('prune');
  });

  test('a viewer has no Trash row, no Restore and no Clear out', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { host } = await sidebar({ readOnly: true });
    expect(q(host, 'canvases-trash-row')).toBeNull();
    expect(calls.some((c) => c.url.startsWith('/_api/sync/trash'))).toBe(false);
  });

  test('an empty trash says so in the contract’s words', async () => {
    installFetch({ '/_api/sync/trash': { entries: [], total: 0, bytes: 0 } });
    const { host } = await sidebar();
    // P8 C5: no Trash row while the trash is empty (01 / 02 / 05 draw none); Advanced still opens it
    expect(q(host, 'canvases-trash-row')).toBeNull();
    // (the fold remembers it was open from the test before: open it only if it is shut)
    const fold = q(host, 'canvases-advanced');
    if (fold?.getAttribute('aria-expanded') !== 'true') await click(fold);
    await click(q(host, 'canvases-advanced-trash'));
    expect(q(host, 'canvases-trash-empty')?.textContent).toContain('Trash is empty.');
    expect(q(host, 'canvases-trash-clear')).toBeNull();
  });

  test('⌘K "Trash" (the bus) opens the list on a Canvases panel that mounts later', async () => {
    installFetch({ '/_api/sync/trash': TRASH });
    const { requestTrash } = await import('../client/v2/left-panel/left-panel-bus.js');
    requestTrash();
    const { host } = await sidebar();
    expect(q(host, 'canvases-trash')).not.toBeNull();
  });
});

describe('Assets tab', () => {
  const ASSETS = {
    ok: true,
    assets: [
      { path: 'assets/aa11bb22.jpg', name: 'IMG_2231.jpg', size: 4096, kind: 'image' },
      { path: 'assets/cc33dd44.mp4', name: 'drone.mp4', size: 99999, kind: 'video' },
    ],
  };

  test('lists the library grouped by kind and searches names', async () => {
    installFetch({ '/_api/assets': ASSETS });
    const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
    const { host } = await mount(<AssetsPanel designRel=".design" />);
    expect(host.querySelectorAll('[data-testid="assets-tile"]').length).toBe(2);
    expect(host.textContent).toContain('Photos');
    expect(host.textContent).toContain('Video');
    expect(q(host, 'assets-search')).not.toBeNull();
  });

  test('search reads names, every word, case-insensitively; kinds group as Photos · Video · Sound', async () => {
    const { filterAssets, groupAssets } = await import('../client/v2/left-panel/assets-panel.jsx');
    const list = ASSETS.assets;
    expect(filterAssets(list, 'DRONE').map((a) => a.name)).toEqual(['drone.mp4']);
    expect(filterAssets(list, 'img 2231').map((a) => a.name)).toEqual(['IMG_2231.jpg']);
    expect(filterAssets(list, '')).toBe(list);
    expect(filterAssets(list, 'nothing')).toEqual([]);
    expect(groupAssets(list).map((g) => g.title)).toEqual(['Photos', 'Video']);
  });

  test('no assets shows the empty-state copy from 05 · es-panels-make', async () => {
    installFetch({ '/_api/assets': { ok: true, assets: [] } });
    const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
    const { host } = await mount(<AssetsPanel designRel=".design" />);
    const empty = q(host, 'assets-empty');
    expect(empty?.textContent).toContain('No images or footage yet.');
    expect(empty?.textContent).toContain(
      'Drop photos, logos, video or music here — or anywhere on the canvas.'
    );
  });

  test('a viewer cannot add files', async () => {
    installFetch({ '/_api/assets': ASSETS });
    const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
    const { host } = await mount(<AssetsPanel designRel=".design" readOnly />);
    expect(q(host, 'assets-add')).toBeNull();
    expect(q(host, 'assets-from-mac')).toBeNull();
  });

  test('S3.15 · 04 md-edit-image: "From this Mac…" under the photos opens the existing file picker', async () => {
    installFetch({ '/_api/assets': ASSETS });
    const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
    const { host } = await mount(<AssetsPanel designRel=".design" />);
    const row = q(host, 'assets-from-mac');
    expect(row?.textContent).toBe('From this Mac…');
    // the same path as the head's "Add files…": a hidden <input type=file> for images, video and sound
    const clicked: HTMLInputElement[] = [];
    const proto = HTMLInputElement.prototype as unknown as { click: () => void };
    const real = proto.click;
    proto.click = function (this: HTMLInputElement) {
      clicked.push(this);
    };
    try {
      await click(row);
    } finally {
      proto.click = real;
    }
    expect(clicked.length).toBe(1);
    expect(clicked[0]?.type).toBe('file');
    expect(clicked[0]?.accept).toBe('image/*,video/*,audio/*');
    clicked[0]?.remove();
  });
});
