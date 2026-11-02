// T-S1a — the Canvases panel's row and foot slots (contract S1-canvas-row-slots.md). Providers (S9.21 access,
// S9.24 offline, S5.13 "Needs you") publish words into one external store; the panel merges them with a fixed
// precedence and never imports a provider. Pinned here: the precedence tables, a provider adding/removing a word
// without touching panel code, ghost rows at their path (not counted), the test ids, and that the windowed list
// still draws slot words on every drawn row.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  buildTree,
  panelFoot,
  panelFootLine,
  visibleRows,
} from '../client/v2/canvases/tree-model.js';

const D = '.design';
const ROOT = `${D}/ui`;
const PID = 'l0123456789abcdef';

// ── the store ───────────────────────────────────────────────────────────────────────────────────────

async function store() {
  const m = await import('../client/v2/canvases/row-slots.js');
  m.resetRowSlots();
  return m;
}

describe('precedence (the contract table)', () => {
  test('meta: ai ("Needs you") beats sync ("not sent"); one word per row', async () => {
    const s = await store();
    s.setRowSlots('sync', new Map([['ui/A.tsx', { meta: { word: 'not sent', tone: 'warn' } }]]));
    expect(s.getRowSlots().slotFor('ui/A.tsx')?.meta?.word).toBe('not sent');
    s.setRowSlots('ai', new Map([['ui/A.tsx', { meta: { word: 'Needs you', tone: 'azure' } }]]));
    const slot = s.getRowSlots().slotFor('ui/A.tsx');
    expect(slot?.meta?.word).toBe('Needs you');
    expect(slot?.metaSource).toBe('ai');
    s.setRowSlots('ai', null); // the provider clears: the sync word is back
    expect(s.getRowSlots().slotFor('ui/A.tsx')?.meta?.word).toBe('not sent');
  });

  test('sub: trash beats access', async () => {
    const s = await store();
    s.setRowSlots(
      'access',
      new Map([['ui/A.tsx', { sub: { text: 'Shared with you · Can view' } }]])
    );
    expect(s.getRowSlots().slotFor('ui/A.tsx')?.sub?.text).toBe('Shared with you · Can view');
    s.setRowSlots(
      'trash',
      new Map([['ui/A.tsx', { sub: { text: 'In the trash · open here', icon: 'trash' as const } }]])
    );
    const slot = s.getRowSlots().slotFor('ui/A.tsx');
    expect(slot?.sub?.text).toBe('In the trash · open here');
    expect(slot?.sub?.icon).toBe('trash');
    expect(slot?.subSource).toBe('trash');
  });

  test('a meta and a sub from different sources both show; dim from any source', async () => {
    const s = await store();
    s.setRowSlots('sync', new Map([['ui/A.tsx', { meta: { word: 'sending' } }]]));
    s.setRowSlots(
      'access',
      new Map([['ui/A.tsx', { sub: { text: 'Shared with you · Can comment' } }]])
    );
    s.setRowSlots('trash', new Map([['ui/A.tsx', { dim: true }]]));
    const slot = s.getRowSlots().slotFor('ui/A.tsx');
    expect(slot?.meta?.word).toBe('sending');
    expect(slot?.sub?.text).toBe('Shared with you · Can comment');
    expect(slot?.dim).toBe(true);
    expect(s.getRowSlots().slotFor('ui/other.tsx')).toBeNull();
  });

  test('foot: sync > jump > access > default', () => {
    const base = { total: 93, shown: 93, searching: false };
    const sync = { text: 'Sending 14 changes · 9 sent' };
    const access = { text: 'Only Combine-kampan was shared with you.' };
    const jump = { boards: [{ kind: 'digital' }, { kind: 'print' }], dynamic: false };
    expect(panelFoot(base)).toBe('93 canvases · ⌘K searches every project');
    expect(panelFootLine(base).source).toBe('default');
    expect(panelFoot({ ...base, foots: { access } })).toBe(access.text);
    expect(panelFootLine({ ...base, foots: { access } }).source).toBe('access');
    // the canvas-only foot loses to the jump foot…
    expect(panelFootLine({ ...base, jump, foots: { access } }).source).toBe('jump');
    // …and the offline foot beats both
    expect(panelFootLine({ ...base, jump, foots: { access, sync } })).toMatchObject({
      source: 'sync',
      text: sync.text,
    });
    // a search keeps no foot of its own against a sync foot either: the offline line is the urgent one
    expect(panelFootLine({ ...base, searching: true, shown: 3, foots: { sync } }).source).toBe(
      'sync'
    );
  });

  test('the store hands the foot with its source: sync > access', async () => {
    const s = await store();
    s.setFootSlot('access', { text: 'Only X was shared with you.' });
    expect(s.getRowSlots().foot).toMatchObject({
      text: 'Only X was shared with you.',
      source: 'access',
    });
    s.setFootSlot('sync', {
      text: '14 changes since yesterday 18:20 — kept on this Mac',
      tone: 'warn',
    });
    expect(s.getRowSlots().foot).toMatchObject({ source: 'sync', tone: 'warn' });
    s.setFootSlot('sync', null);
    expect(s.getRowSlots().foot?.source).toBe('access');
    s.setFootSlot('access', null);
    expect(s.getRowSlots().foot).toBeNull();
  });
});

describe('a provider adds and removes words without touching panel code', () => {
  test('registerRowSlot returns a disposer; an older disposer never removes a newer word', async () => {
    const s = await store();
    const off1 = s.registerRowSlot('sync', 'ui/A.tsx', { meta: { word: 'not sent' } });
    expect(s.getRowSlots().slotFor('ui/A.tsx')?.meta?.word).toBe('not sent');
    const off2 = s.registerRowSlot('sync', 'ui/A.tsx', { meta: { word: 'sending' } });
    off1(); // stale: the word was replaced since
    expect(s.getRowSlots().slotFor('ui/A.tsx')?.meta?.word).toBe('sending');
    off2();
    expect(s.getRowSlots().slotFor('ui/A.tsx')).toBeNull();
  });

  test('subscribers hear every change, and the snapshot is stable between changes', async () => {
    const s = await store();
    let heard = 0;
    const off = s.subscribeRowSlots(() => heard++);
    const a = s.getRowSlots();
    expect(s.getRowSlots()).toBe(a); // useSyncExternalStore needs a cached snapshot
    s.registerRowSlot('ai', 'ui/A.tsx', { meta: { word: 'Needs you' } });
    expect(heard).toBe(1);
    expect(s.getRowSlots()).not.toBe(a);
    s.setRowSlots('ai', null);
    s.setRowSlots('ai', null); // nothing to clear: no wake-up
    expect(heard).toBe(2);
    off();
    s.registerRowSlot('ai', 'ui/B.tsx', { meta: { word: 'x' } });
    expect(heard).toBe(2);
  });

  test('a slot with nothing in it is no slot; a word with no text is dropped', async () => {
    const s = await store();
    s.setRowSlots(
      'sync',
      new Map([
        ['ui/A.tsx', { meta: { word: '' } }],
        ['ui/B.tsx', {}],
      ])
    );
    expect(s.getRowSlots().slotFor('ui/A.tsx')).toBeNull();
    expect(s.getRowSlots().slotFor('ui/B.tsx')).toBeNull();
    expect(() => s.setRowSlots('nope' as never, null)).toThrow();
  });

  test('ghost rows are replaced as a whole by their source', async () => {
    const s = await store();
    const g = (path: string) => ({
      path,
      name: path,
      slot: { sub: { text: 'In the trash · open here', icon: 'trash' as const }, dim: true },
      onOpen() {},
    });
    s.setGhostRows('trash', [g('ui/A.tsx'), g('ui/B.tsx')]);
    expect(s.getRowSlots().ghosts.map((x: { path: string }) => x.path)).toEqual([
      'ui/A.tsx',
      'ui/B.tsx',
    ]);
    s.setGhostRows('trash', []);
    expect(s.getRowSlots().ghosts).toEqual([]);
  });
});

// ── the tree: ghost rows ────────────────────────────────────────────────────────────────────────────

const GROUPS = [
  {
    label: 'UI canvases',
    kind: 'canvas',
    fullPath: ROOT,
    paths: [`${ROOT}/a/One.tsx`, `${ROOT}/a/Two.tsx`, `${ROOT}/Three.tsx`],
    dirs: [`${ROOT}/a`],
  },
];

describe('ghost rows in the tree', () => {
  const ghost = (path: string, name = 'Gone') => ({
    path,
    name,
    slot: { sub: { text: 'In the trash · open here', icon: 'trash' }, dim: true },
    onOpen() {},
  });

  test('a ghost sits in its folder, is not counted, and is in no other group', () => {
    const plain = buildTree({ groups: GROUPS, designRel: D });
    const tree = buildTree({ groups: GROUPS, designRel: D, ghosts: [ghost('ui/a/Gone.tsx')] });
    expect(tree.total).toBe(plain.total);
    expect(tree.byPath.get(`${ROOT}/a`).count).toBe(2);
    const rows = visibleRows(tree, { expanded: () => true, projectLabel: 'P' });
    const g = rows.filter((r: { type: string }) => r.type === 'ghost');
    expect(g).toHaveLength(1);
    expect(g[0].path).toBe(`${ROOT}/a/Gone.tsx`);
    expect(g[0].name).toBe('Gone');
    // the ghost is drawn between the folder row and the next folder's rows: inside "a"
    const at = rows.findIndex((r: { key: string }) => r.key === g[0].key);
    const dirA = rows.findIndex((r: { key: string }) => r.key === `dir:${ROOT}/a`);
    expect(at).toBeGreaterThan(dirA);
    expect(g[0].depth).toBe(rows[dirA].depth + 1);
    // a search never lists it, and Pinned never does
    const hits = visibleRows(tree, { query: 'Gone', projectLabel: 'P' });
    expect(hits.some((r: { type: string }) => r.type === 'ghost')).toBe(false);
  });

  test('a repo path and a designRoot-relative path both land; a vanished folder falls back to its parent', () => {
    const tree = buildTree({
      groups: GROUPS,
      designRel: D,
      ghosts: [ghost(`${ROOT}/Gone1.tsx`, 'Gone1'), ghost('ui/deleted/folder/Gone2.tsx', 'Gone2')],
    });
    const rows = visibleRows(tree, { expanded: () => true, projectLabel: 'P' });
    const names = rows
      .filter((r: { type: string }) => r.type === 'ghost')
      .map((r: { name: string }) => r.name);
    expect(names.sort()).toEqual(['Gone1', 'Gone2']);
  });

  test('a folder holding only a ghost is not "empty"', () => {
    const groups = [{ ...GROUPS[0], paths: [], dirs: [`${ROOT}/a`] }];
    const tree = buildTree({ groups, designRel: D, ghosts: [ghost('ui/a/Gone.tsx')] });
    const rows = visibleRows(tree, { expanded: () => true, projectLabel: 'P' });
    expect(rows.some((r: { type: string }) => r.type === 'empty')).toBe(false);
    expect(rows.some((r: { type: string }) => r.type === 'ghost')).toBe(true);
  });
});

// ── the panel ───────────────────────────────────────────────────────────────────────────────────────

function project() {
  const folders: Record<string, number> = { 'club-web': 9, print: 6, social: 31, legacy: 27 };
  const paths: string[] = [];
  const dirs = new Set<string>();
  for (const [dir, n] of Object.entries(folders)) {
    dirs.add(dir);
    for (let i = 1; i <= n; i++) paths.push(`${ROOT}/${dir}/${dir}-${i}.tsx`);
  }
  for (const n of ['test', 'Test2', 'ahoj', 'ahoj2']) paths.push(`${ROOT}/${n}.tsx`);
  // 9 + 6 + 31 + 27 + 4 = 77; pad to 93 at the top level
  for (let i = 1; i <= 16; i++) paths.push(`${ROOT}/extra-${i}.tsx`);
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
        dirs: [...dirs].map((d) => `${ROOT}/${d}`),
      },
    ],
    snapshot: { pid: PID, project: { designRel: D }, writer: { seq: 7 }, canvases },
  };
}

const realFetch = globalThis.fetch;
let pinsFile: { canvas: string; at: number }[] = [];

function installFetch(snapshot: unknown) {
  globalThis.fetch = (async (url: string) => {
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.startsWith('/_api/index')) return ok(snapshot);
    if (url === '/_api/pins') return ok({ v: 1, pins: pinsFile, opened: {} });
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
  pinsFile = [];
});

const settle = (ms = 420) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function mount(over: Record<string, unknown> = {}, p = project()) {
  installFetch(p.snapshot);
  const slots = await store();
  const { CanvasesPanel } = await import('../client/v2/canvases/canvases-panel.jsx');
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
        expansion={{ isOpen: () => false, setOpen: () => {} }}
        {...over}
        {...extra}
      />
    );
  await act(async () => render());
  await settle();
  return { host, slots, rerender: (e?: Record<string, unknown>) => act(async () => render(e)), p };
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (host: HTMLElement, sel: string) => Array.from(host.querySelectorAll<HTMLElement>(sel));
const run = (fn: () => void) => act(async () => fn());

describe('the Canvases panel reads the slots', () => {
  test('a meta word draws on the row; the provider clearing it removes it again', async () => {
    const { host, slots } = await mount();
    expect(q(host, 'canvas-row-meta-ui-extra-16')).toBeNull();
    await run(() =>
      slots.setRowSlots(
        'sync',
        new Map([['ui/extra-16.tsx', { meta: { word: 'not sent', tone: 'warn' } }]])
      )
    );
    const el = q(host, 'canvas-row-meta-ui-extra-16');
    expect(el?.textContent).toBe('not sent');
    expect(el?.getAttribute('data-tone')).toBe('warn');
    expect(el?.getAttribute('data-source')).toBe('sync');
    // ai wins on the same row
    await run(() =>
      slots.registerRowSlot('ai', 'ui/extra-16.tsx', { meta: { word: 'Needs you', tone: 'azure' } })
    );
    expect(q(host, 'canvas-row-meta-ui-extra-16')?.textContent).toBe('Needs you');
    await run(() => {
      slots.setRowSlots('ai', null);
      slots.setRowSlots('sync', null);
    });
    expect(q(host, 'canvas-row-meta-ui-extra-16')).toBeNull();
    // the row is still the same row, with its old hook
    expect(q(host, 'canvas-row-ui-extra-16')).not.toBeNull();
  });

  test('sub and dim: the second words and the faded row', async () => {
    const { host, slots } = await mount();
    await run(() =>
      slots.setRowSlots(
        'trash',
        new Map([
          [
            'ui/extra-16.tsx',
            { sub: { text: 'In the trash · open here', icon: 'trash' as const }, dim: true },
          ],
        ])
      )
    );
    expect(q(host, 'canvas-row-sub-ui-extra-16')?.textContent).toContain(
      'In the trash · open here'
    );
    const row = q(host, 'canvas-row-ui-extra-16')?.closest('.cv-row');
    expect(row?.classList.contains('is-dim')).toBe(true);
  });

  test('the Pinned copy carries the same slots under its own ids', async () => {
    pinsFile = [{ canvas: 'ui/extra-16.tsx', at: 1 }];
    const { host, slots } = await mount();
    await run(() =>
      slots.setRowSlots('sync', new Map([['ui/extra-16.tsx', { meta: { word: 'sending' } }]]))
    );
    expect(q(host, 'canvas-pinned-meta-ui-extra-16')?.textContent).toBe('sending');
    expect(q(host, 'canvas-row-meta-ui-extra-16')?.textContent).toBe('sending');
  });

  test("while searching, the search's own sub wins over a slot sub", async () => {
    const { host, slots } = await mount({ search: 'extra-16' });
    await run(() =>
      slots.setRowSlots(
        'access',
        new Map([['ui/extra-16.tsx', { sub: { text: 'Shared with you · Can view' } }]])
      )
    );
    const sub = q(host, 'canvas-row-sub-ui-extra-16');
    expect(sub).toBeNull(); // the folder line the search already draws stays; no second sub
    expect(host.textContent).not.toContain('Shared with you');
  });

  test('the foot: default → access → sync, with data-slot saying which', async () => {
    const { host, slots } = await mount();
    // P8 C5: at rest the foot is not drawn (the board draws none); the slots below still are
    expect(q(host, 'canvases-foot')).toBeNull();
    await run(() =>
      slots.setFootSlot('access', { text: 'Only Combine-kampan was shared with you.' })
    );
    expect(q(host, 'canvases-foot')?.textContent).toBe('Only Combine-kampan was shared with you.');
    expect(q(host, 'canvases-foot')?.getAttribute('data-slot')).toBe('access');
    await run(() =>
      slots.setFootSlot('sync', { text: 'Sending 14 changes · 9 sent', tone: 'warn' })
    );
    expect(q(host, 'canvases-foot')?.textContent).toBe('Sending 14 changes · 9 sent');
    expect(q(host, 'canvases-foot')?.getAttribute('data-slot')).toBe('sync');
    await run(() => {
      slots.setFootSlot('sync', null);
      slots.setFootSlot('access', null);
    });
    expect(q(host, 'canvases-foot')).toBeNull();
  });

  test('a ghost row draws at its path with its words, opens its tab, and is not counted', async () => {
    let opened = 0;
    const { host, slots } = await mount();
    const before = Number(q(host, 'canvas-list')?.getAttribute('data-rows'));
    await run(() =>
      slots.setGhostRows('trash', [
        {
          path: 'ui/Gone.tsx',
          name: 'Gone',
          current: true,
          slot: { sub: { text: 'In the trash · open here', icon: 'trash' }, dim: true },
          onOpen: () => {
            opened++;
          },
        },
      ])
    );
    expect(Number(q(host, 'canvas-list')?.getAttribute('data-rows'))).toBe(before + 1);
    const ghost = q(host, 'canvas-row-trashed-ui-gone');
    expect(ghost).not.toBeNull();
    expect(ghost?.textContent).toContain('Gone');
    expect(ghost?.textContent).toContain('In the trash · open here');
    expect(ghost?.closest('.cv-row')?.classList.contains('is-dim')).toBe(true);
    // round 7 (10 co-trashed): a two-line row — the name, then the words under it — and it is the OPEN tab's row
    expect(ghost?.querySelector('.cv-names > .cv-name')?.textContent).toBe('Gone');
    expect(ghost?.querySelector('.cv-names > .cv-sub--slot')?.textContent).toContain('open here');
    expect(ghost?.closest('.cv-row')?.classList.contains('is-sel')).toBe(true);
    expect(ghost?.closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true');
    const ghostItem = ghost?.closest('[role="treeitem"]') as HTMLElement;
    expect(ghostItem.style.height).toBe('42px');
    expect(q(host, 'canvases-foot')).toBeNull(); // not counted: and no foot at rest to count it in
    await act(async () => {
      ghost?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(opened).toBe(1);
    // Enter on the focused ghost row opens it too
    const item = ghost?.closest('[role="treeitem"]') as HTMLElement;
    expect(item).not.toBeNull();
    await act(async () => {
      item.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    expect(opened).toBe(2);
    // the provider clearing it removes the row
    await run(() => slots.setGhostRows('trash', []));
    expect(q(host, 'canvas-row-trashed-ui-gone')).toBeNull();
    expect(Number(q(host, 'canvas-list')?.getAttribute('data-rows'))).toBe(before);
  });

  test('virtualised: with a word on every canvas, every drawn row shows it and at most 60 rows are in the page', async () => {
    const p = project();
    const { host, slots } = await mount(
      { expansion: { isOpen: () => true, setOpen: () => {} } },
      p
    );
    const map = new Map<string, { meta: { word: string } }>();
    for (const c of p.snapshot.canvases) map.set(c.rel, { meta: { word: 'not sent' } });
    await run(() => slots.setRowSlots('sync', map));
    const drawn = all(host, '[role="treeitem"]');
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThanOrEqual(60);
    expect(Number(q(host, 'canvas-list')?.getAttribute('data-rows'))).toBeGreaterThan(93);
    const canvasRows = all(host, '[data-testid^="canvas-row-ui-"]').filter(
      (e) => !e.getAttribute('data-testid')?.startsWith('canvas-row-meta-')
    );
    expect(canvasRows.length).toBeGreaterThan(10);
    for (const r of canvasRows) {
      const slug = r.getAttribute('data-testid')?.slice('canvas-row-'.length);
      expect(q(host, `canvas-row-meta-${slug}`)?.textContent).toBe('not sent');
    }
    expect(all(host, '[data-testid^="canvas-row-meta-"]').length).toBe(canvasRows.length);
  });
});
