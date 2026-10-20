// S10.13 — the pinned system rows rendered (13 · ds-where-*, ds-multi-panel, ds-multi-menu), the row's menu, the
// empty row's door, the inspector's "Uses …" link, and ⌘K's Design system rows.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body?: string }> = [];

function installFetch(handlers: Record<string, unknown> = {}) {
  calls = [];
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    const key = Object.keys(handlers).find((k) => url.startsWith(k));
    return new Response(JSON.stringify(key ? handlers[key] : { ok: true }), { status: 200 });
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
});

async function mount(el: React.ReactElement, settleMs = 20): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await act(async () => new Promise((r) => setTimeout(r, settleMs)));
  return host;
}
const q = (host: ParentNode, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const qa = (host: ParentNode, id: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
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
    dsFolders: [
      { name: 'alligators', folder: 'alligators' },
      { name: 'combine-2026', folder: 'combine-2026' },
    ],
  },
  {
    label: 'UI kit',
    kind: 'canvas',
    fullPath: '.design/ui',
    paths: ['.design/ui/Pricing.tsx'],
    tree: { 'Pricing.tsx': { __file: true, path: '.design/ui/Pricing.tsx', name: 'Pricing.tsx' } },
  },
];
const CFG = {
  designRel: '.design',
  designSystems: [
    { name: 'alligators', path: 'system/alligators', label: 'Alligators brand system' },
    { name: 'combine-2026', path: 'system/combine-2026', label: 'Combine 2026' },
  ],
  defaultDesignSystem: 'alligators',
  canvasDesignSystems: {
    '.design/ui/A.tsx': 'alligators',
    '.design/ui/B.tsx': 'alligators',
    '.design/ui/2026/combine/C.tsx': 'combine-2026',
  },
  dsConverted: { alligators: true, 'combine-2026': false },
};
const STATE = {
  format: 'maude.ds-state',
  v: 1,
  systems: [
    {
      name: 'alligators',
      label: 'Alligators brand system',
      level: 0,
      reasons: [],
      converted: true,
    },
    { name: 'combine-2026', label: 'Combine 2026', level: 11, reasons: [], converted: false },
  ],
};

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
    dsCfg: CFG,
    ...over,
  };
  // the pinned state read waits a beat after the tree settles
  return mount(<Sidebar {...(props as never)} />, 800);
}

describe('the pinned system rows', () => {
  test('two lines per row, "Design systems · 2 in use" over them, the amber dot on the old one', async () => {
    installFetch({ '/_api/ds/state': STATE, '/_api/sync/trash': { entries: [], total: 0 } });
    const host = await sidebar({ onDsAction: () => {} });
    const rows = qa(host, 'canvases-ds-row');
    expect(rows.map((r) => r.getAttribute('data-ds'))).toEqual(['alligators', 'combine-2026']);
    expect(q(host, 'canvases-ds-head')?.textContent).toBe('Design systems2 in use');
    expect(qa(host, 'canvases-ds-row-sub').map((e) => e.textContent)).toEqual([
      'Default · 2 canvases',
      'Made before the schema',
    ]);
    expect(rows[0].getAttribute('data-default')).toBe('true');
    // only Combine 2026 is amber
    const warn = qa(host, 'canvases-ds-row-warn');
    expect(warn).toHaveLength(1);
    expect(warn[0].closest('[data-ds]')?.getAttribute('data-ds')).toBe('combine-2026');
    expect(warn[0].getAttribute('aria-label')).toBe('Made before the schema');
  });

  test('a converted system opens its canvas through ds.go-to; an older one opens today’s view', async () => {
    installFetch({ '/_api/ds/state': STATE, '/_api/sync/trash': { entries: [], total: 0 } });
    const ran: Array<[string, unknown]> = [];
    const opened: string[] = [];
    const host = await sidebar({
      onDsAction: (id: string, p: unknown) => ran.push([id, p]),
      onOpenSystem: (n: string) => opened.push(n),
    });
    const [gator, camp] = qa(host, 'canvases-ds-row');
    await click(gator);
    expect(ran).toEqual([['ds.go-to', { ds: 'alligators' }]]);
    await click(camp);
    expect(opened).toEqual(['combine-2026']);
  });

  test('the menu: Open · Use for new canvases (now …); the default row says "Default for new canvases"', async () => {
    installFetch({ '/_api/ds/state': STATE, '/_api/sync/trash': { entries: [], total: 0 } });
    const ran: Array<[string, Record<string, unknown>]> = [];
    const host = await sidebar({
      onDsAction: (id: string, p: Record<string, unknown>) => ran.push([id, p]),
    });
    const [, campMenu] = qa(host, 'canvases-ds-row-menu');
    await click(campMenu);
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(items.map((i) => i.querySelector('.st-dd-lead')?.textContent)).toEqual([
      'Open Combine 2026',
      'Use for new canvases',
    ]);
    expect(items[1].querySelector('.lp-dd-note')?.textContent).toBe('now Alligators brand system');
    await click(items[1]);
    expect(ran).toEqual([['ds.set-default', { ds: 'combine-2026', label: 'Combine 2026' }]]);
    // the default's own menu has nothing to choose
    const [gatorMenu] = qa(host, 'canvases-ds-row-menu');
    await click(gatorMenu);
    const again = Array.from(document.querySelectorAll('[role="menuitem"]'));
    const dflt = again.find((i) => i.textContent?.includes('Default for new canvases'));
    expect(dflt?.hasAttribute('disabled')).toBe(true);
  });

  test('Can view sees the rows and Open — and no way to change the default', async () => {
    installFetch({ '/_api/ds/state': STATE, '/_api/sync/trash': { entries: [], total: 0 } });
    const host = await sidebar({ readOnly: true, onDsAction: () => {} });
    await click(qa(host, 'canvases-ds-row-menu')[1]);
    const labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map(
      (i) => i.querySelector('.st-dd-lead')?.textContent
    );
    expect(labels).toEqual(['Open Combine 2026']);
  });

  test('a project without a system shows "Make a design system", and the door runs ds.make', async () => {
    installFetch({ '/_api/ds/state': { format: 'maude.ds-state', v: 1, systems: [] } });
    const ran: Array<[string, unknown]> = [];
    const host = await sidebar({
      groups: [GROUPS[1]],
      dsCfg: { ...CFG, designSystems: [], canvasDesignSystems: {}, dsConverted: {} },
      onDsAction: (id: string, p: unknown) => ran.push([id, p]),
    });
    expect(qa(host, 'canvases-ds-row')).toHaveLength(0);
    const make = q(host, 'canvases-ds-make');
    expect(make?.textContent).toContain('Make a design system');
    await click(make);
    expect(ran).toEqual([['ds.make', {}]]);
  });

  test('someone who cannot edit is not offered the door', async () => {
    installFetch({ '/_api/ds/state': { format: 'maude.ds-state', v: 1, systems: [] } });
    const host = await sidebar({
      groups: [GROUPS[1]],
      readOnly: true,
      dsCfg: { ...CFG, designSystems: [], canvasDesignSystems: {}, dsConverted: {} },
      onDsAction: () => {},
    });
    expect(q(host, 'canvases-ds-make')).toBeNull();
  });

  test('the open Design system canvas is the highlighted row', async () => {
    installFetch({ '/_api/ds/state': STATE, '/_api/sync/trash': { entries: [], total: 0 } });
    const host = await sidebar({
      onDsAction: () => {},
      activePath: '.design/system/alligators/design-system.tsx',
    });
    const [gator, camp] = qa(host, 'canvases-ds-row');
    expect(gator.getAttribute('aria-current')).toBe('true');
    expect(camp.getAttribute('aria-current')).toBeNull();
  });
});

describe('the inspector’s “Uses …” link', () => {
  test('is a door to the system’s canvas (ds.go-to) and names the system for people', async () => {
    const { UsesLink } = await import('../client/v2/ds/uses-link.jsx');
    const ran: Array<[string, unknown]> = [];
    const host = await mount(
      <UsesLink
        ds="alligators"
        cfg={CFG}
        onShellAction={(id: string, p: unknown) => ran.push([id, p])}
      />
    );
    expect(q(host, 'inspector-uses')?.textContent).toBe('Uses Alligators brand system');
    await click(q(host, 'inspector-uses-link'));
    expect(ran).toEqual([['ds.go-to', { ds: 'alligators' }]]);
  });

  test('without a shell to run it, it is the plain line it always was', async () => {
    const { UsesLink } = await import('../client/v2/ds/uses-link.jsx');
    const host = await mount(<UsesLink ds="alligators" cfg={CFG} />);
    expect(q(host, 'inspector-uses')?.textContent).toBe('Uses Alligators brand system');
    expect(q(host, 'inspector-uses-link')).toBeNull();
  });
});
