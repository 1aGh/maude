// P8 C5 (V2-8.5 stage C round 5) — the Canvases panel is the board's island (01 / 02 / 05 / 11): no accent
// "Make a design system" row, no Trash row while the trash is empty, no foot line at rest, the board's search
// well, the project row's count where the board draws it, and the "+ New canvas" row named by its words.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CANVASES_FOLD } from '../client/v2/left-panel/canvas-file-menu.js';

const realFetch = globalThis.fetch;
function installFetch(handlers: Record<string, unknown> = {}) {
  globalThis.fetch = (async (url: string) => {
    const key = Object.keys(handlers).find((k) => url.startsWith(k));
    return new Response(JSON.stringify(key ? handlers[key] : { ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
}
const TRASH = {
  entries: [
    {
      trashRel: '_trash/2026-10-14T10-00-00Z__ahoj/ahoj.tsx',
      sourceRel: 'ui/ahoj.tsx',
      reason: 'deleted',
      at: Date.now() - 60_000,
      size: 10,
    },
  ],
  total: 1,
  bytes: 10,
};
const NO_TRASH = { entries: [], total: 0, bytes: 0 };

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
/** The Advanced fold is one process-wide store: this file puts it back how a fresh Mac shows it. */
async function resetFold() {
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set(CANVASES_FOLD, false);
}
afterAll(async () => {
  await resetFold();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await act(async () => new Promise((r) => setTimeout(r, 320)));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return host;
}
const q = (host: ParentNode, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};

/** The Advanced fold is remembered per Mac, so an earlier test may have left it open: open it only if shut. */
async function openAdvanced(host: ParentNode) {
  const fold = q(host, 'canvases-advanced');
  if (fold?.getAttribute('aria-expanded') !== 'true') await click(fold);
}

const GROUPS = [
  {
    label: 'UI kit',
    kind: 'canvas',
    fullPath: '.design/ui',
    paths: ['.design/ui/Pricing.tsx'],
    tree: { 'Pricing.tsx': { __file: true, path: '.design/ui/Pricing.tsx', name: 'Pricing.tsx' } },
  },
];
const many = (n: number) => ({
  label: 'UI kit',
  kind: 'canvas',
  fullPath: '.design/ui',
  paths: Array.from({ length: n }, (_, i) => `.design/ui/C${i}.tsx`),
  tree: Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `C${i}.tsx`,
      { __file: true, path: `.design/ui/C${i}.tsx`, name: `C${i}.tsx` },
    ])
  ),
});

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
    project: 'Studio site',
    ...over,
  };
  return mount(<Sidebar {...(props as never)} />);
}

describe('the Canvases panel is the board island', () => {
  test('"+ New canvas" is named by its words (WCAG 2.5.3), one control', async () => {
    installFetch({ '/_api/sync/trash': NO_TRASH });
    const host = await sidebar();
    const row = q(host, 'canvases-new-row') as HTMLElement;
    const main = row.querySelector('button.lp-newrow-main') as HTMLElement;
    expect(main.getAttribute('aria-label')).toBe('New canvas');
    expect(main.textContent).toContain('New canvas');
    expect(host.querySelectorAll('[aria-label="New canvas"]').length).toBe(1);
    expect(host.querySelector('[aria-label="New blank brief board"]')).toBeNull();
  });

  test('a project without a design system has no accent row above the list', async () => {
    installFetch({ '/_api/sync/trash': NO_TRASH, '/_api/ds/state': { systems: [] } });
    const host = await sidebar({ onDsAction: () => {} });
    expect(q(host, 'canvases-pinned')).toBeNull();
    expect(host.textContent).not.toContain('Make a design system');
  });

  test('no Trash row while the trash is empty; it comes with the first trashed thing; Advanced lists Trash either way', async () => {
    installFetch({ '/_api/sync/trash': NO_TRASH });
    let host = await sidebar();
    expect(q(host, 'canvases-trash-row')).toBeNull();
    await openAdvanced(host);
    expect(q(host, 'canvases-advanced-trash')).not.toBeNull();
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    installFetch({ '/_api/sync/trash': TRASH });
    host = await sidebar();
    expect(q(host, 'canvases-trash-row')?.textContent).toContain('Trash');
  });

  // (the foot with a search — "6 results · ⌘K searches every project" — is pinned in v2-canvases-panel-render)
  test('no foot line at rest', async () => {
    installFetch({ '/_api/sync/trash': NO_TRASH });
    const rest = await sidebar();
    expect(q(rest, 'canvases-foot')).toBeNull();
    expect(rest.textContent).not.toContain('⌘K searches every project');
  });

  test('the search well is the board\'s: "Search" with ⌘K, still a filter with a name that says so', async () => {
    installFetch({ '/_api/sync/trash': NO_TRASH });
    const host = await sidebar();
    const input = q(host, 'canvas-search') as HTMLInputElement;
    expect(input.placeholder).toBe('Search');
    expect(input.getAttribute('aria-label')).toBe('Search canvases');
    expect(input.closest('.st-search-box')?.querySelector('.kbd')?.textContent).toBe('⌘K');
  });

  test('the project row says how many canvases at rest (the board\'s "6 canvases"); a long list shows its Sort', async () => {
    installFetch({ '/_api/sync/trash': NO_TRASH });
    const small = await sidebar({ groups: [many(6)] });
    const sort = q(small, 'canvases-sort') as HTMLElement;
    expect(sort.textContent).toBe('6 canvases');
    // the control is still there, and its name holds the words the eye reads
    expect(sort.getAttribute('aria-label')).toContain('6 canvases');
    expect(sort.getAttribute('aria-label')).toMatch(/sort/i);
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    const big = await sidebar({ groups: [many(30)] });
    expect(q(big, 'canvases-sort')?.textContent).toBe('Recent');
  });
});
