// S7.24 — the kind filter chips (08 · ak-mixed-filter, 05 · es-filter). Pinned here: the counts come from the
// index's artboard kinds and a canvas counts ONCE per kind it has; the chip words and accessible names; the
// shared store (one filter for Canvases and Layers); the Canvases list under a filter (flat hits with their folder
// and "N of M" artboards, the Pinned head and the project row step aside, a search narrows within the filter);
// the foot sentence; a filter that hides everything says which one and clears in one click (the kit's block).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  allCanvases,
  buildTree,
  designRelOf,
  indexMeta,
  panelFootLine,
  visibleRows,
} from '../client/v2/canvases/tree-model.js';
import {
  chipName,
  countByKind,
  hitCount,
  kindFilterFoot,
  noCanvasesOfKind,
} from '../client/v2/kinds/kind-filter-model.js';
import {
  clearKindFilter,
  getDimKind,
  getKindFilter,
  pickKind,
  setKindFilter,
  subscribeKindFilter,
} from '../client/v2/kinds/kind-filter-store.js';

const D = '.design';
const ROOT = `${D}/ui`;
const PID = 'l0123456789abcdef';

type Board = { id: string; kind: string; label?: string };
type Fixture = Record<string, Board[]>;

/** Six canvases: video in three of them, print in two, a canvas with several kinds, one with no artboards. */
const MIXED: Fixture = {
  'social/video-hype.tsx': [
    { id: 'a1', kind: 'social' }, // the index's old name for digital
    { id: 'a2', kind: 'digital' },
    { id: 'v1', kind: 'video' },
  ],
  'social/video-recap.tsx': [
    { id: 'v1', kind: 'video' },
    { id: 'v2', kind: 'video' },
    { id: 'v3', kind: 'video' },
    { id: 'v4', kind: 'video' },
  ],
  'print/flyer.tsx': [
    { id: 'p1', kind: 'print' },
    { id: 'p2', kind: 'print' },
  ],
  'club-web.tsx': [{ id: 'w1', kind: 'web' }],
  'mixed.tsx': [
    { id: 'm1', kind: 'digital' },
    { id: 'm2', kind: 'print' },
    { id: 'm3', kind: 'web' },
    { id: 'm4', kind: 'video' },
  ],
  'empty.tsx': [],
};

function project(fx: Fixture = MIXED) {
  const rels = Object.keys(fx);
  const paths = rels.map((r) => `${ROOT}/${r}`);
  const dirs = new Set<string>();
  for (const r of rels) {
    const parts = r.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(`${ROOT}/${parts.slice(0, i).join('/')}`);
  }
  const groups = [{ label: 'UI canvases', kind: 'canvas', fullPath: ROOT, paths, dirs: [...dirs] }];
  const snapshot = {
    pid: PID,
    project: { designRel: D },
    writer: { seq: 7 },
    canvases: rels.map((r, i) => ({
      rel: `ui/${r}`,
      kind: 'canvas',
      mtimeMs: 1000 + i,
      madeByAi: false,
      cover: null,
      artboards: fx[r],
    })),
  };
  const meta = indexMeta(snapshot, D);
  const tree = buildTree({ groups, meta, designRel: designRelOf(snapshot, groups) });
  return { groups, snapshot, tree, canvases: allCanvases(tree) };
}

beforeEach(() => clearKindFilter());

describe('counts come from the index; a canvas counts once per kind', () => {
  test('All is the canvases; each kind is the canvases that HAVE it', () => {
    const p = project();
    expect(countByKind(p.canvases)).toEqual({ all: 6, digital: 2, web: 2, print: 2, video: 3 });
  });

  test('a canvas with six video artboards is still 1 under Video; `social` is digital', () => {
    const p = project({
      'a.tsx': [
        { id: '1', kind: 'video' },
        { id: '2', kind: 'video' },
        { id: '3', kind: 'video' },
        { id: '4', kind: 'social' },
      ],
    });
    expect(countByKind(p.canvases)).toEqual({ all: 1, digital: 1, web: 0, print: 0, video: 1 });
  });

  test('the chip reads "Print, 2" and a hit reads "N of M"', () => {
    expect(chipName('print', 2)).toBe('Print, 2');
    expect(chipName('digital', 61)).toBe('Fixed size, 61');
    expect(chipName('all', 93)).toBe('All, 93');
    const hype = project().canvases.find((c) => c.name === 'video-hype');
    expect(hitCount(hype, 'digital')).toBe('2 of 3');
    expect(hitCount(hype, 'video')).toBe('1 of 3');
  });

  test('the foot says how many have it, and that a canvas counts under each kind', () => {
    expect(kindFilterFoot({ kind: 'video', matching: 12, total: 93 })).toBe(
      '12 of 93 canvases have video. A canvas counts once under each kind it has.'
    );
    expect(kindFilterFoot({ kind: 'all', matching: 93, total: 93 })).toBe('');
  });

  test('a filter that hides everything names the filter and the way out', () => {
    expect(noCanvasesOfKind({ kind: 'print', project: 'Alligators brand', total: 5 })).toEqual({
      title: 'No print canvases in Alligators brand.',
      next: 'The Print filter is on. Clear it to see all 5 canvases.',
      action: 'Clear filter',
    });
  });
});

describe('the shared store', () => {
  test('one value, moved by a chip; the chip that is on clears it; junk means all', () => {
    const seen: string[] = [];
    const off = subscribeKindFilter(() => seen.push(getKindFilter()));
    expect(getKindFilter()).toBe('all');
    pickKind('print');
    expect(getKindFilter()).toBe('print');
    pickKind('video');
    expect(getKindFilter()).toBe('video');
    pickKind('video'); // the chip that is on
    expect(getKindFilter()).toBe('all');
    setKindFilter('print');
    setKindFilter('banana');
    expect(getKindFilter()).toBe('all');
    off();
    expect(seen).toEqual(['print', 'video', 'all', 'print', 'all']);
  });
});

describe('what dims the open canvas', () => {
  test('a Canvases chip narrows the list and dims nothing; a Layers pick dims', () => {
    setKindFilter('all');
    pickKind('print', 'canvases');
    expect(getKindFilter()).toBe('print');
    expect(getDimKind()).toBe('all');
    setKindFilter('all');
    pickKind('print', 'layers');
    expect(getDimKind()).toBe('print');
    pickKind('print', 'layers');
    expect(getDimKind()).toBe('all');
    // the Layers chips and the relay use the one dim value (never the list's)
    const relay = readFileSync(
      join(import.meta.dir, '..', 'client/v2/kinds/kind-dim-relay.js'),
      'utf8'
    );
    expect(relay).toContain('getDimKind()');
    expect(relay).not.toContain('getKindFilter()');
  });
});

describe('the Canvases list under a filter', () => {
  const rows = (p: ReturnType<typeof project>, extra: Record<string, unknown> = {}) =>
    visibleRows(p.tree, { projectLabel: 'Alligators brand', ...extra });

  test('no filter: the list is the tree (project row, folders)', () => {
    const r = rows(project());
    expect(r.some((x: { key: string }) => x.key === 'head:project')).toBe(true);
    expect(rows(project(), { kind: 'all' })).toEqual(r);
  });

  test('Video: only canvases with video, flat, each with its folder and "N of M"', () => {
    const r = rows(project(), { kind: 'video' });
    expect(r.map((x: { name: string }) => x.name).sort()).toEqual([
      'mixed',
      'video-hype',
      'video-recap',
    ]);
    expect(r.every((x: { type: string }) => x.type === 'canvas')).toBe(true);
    expect(r.some((x: { key: string }) => x.key === 'head:project')).toBe(false);
    const hype = r.find((x: { name: string }) => x.name === 'video-hype');
    expect(hype.sub).toBe('social');
    expect(hype.kindCount).toBe('1 of 3');
    const recap = r.find((x: { name: string }) => x.name === 'video-recap');
    expect(recap.kindCount).toBe('4 of 4');
    expect(r.map((x: { posinset: number }) => x.posinset)).toEqual([1, 2, 3]);
    expect(r[0].setsize).toBe(3);
  });

  test('a pinned canvas that is not of the kind is not shown; the Pinned head steps aside', () => {
    const p = project();
    const r = rows(p, {
      kind: 'print',
      pins: new Set(['ui/club-web.tsx']),
      pinOrder: ['ui/club-web.tsx'],
    });
    expect(r.map((x: { name: string }) => x.name).sort()).toEqual(['flyer', 'mixed']);
    expect(r.some((x: { key: string }) => x.key === 'head:pinned')).toBe(false);
  });

  test('a search narrows within the filter', () => {
    const r = rows(project(), { kind: 'video', query: 'recap' });
    expect(r.map((x: { name: string }) => x.name)).toEqual(['video-recap']);
    expect(r[0].kindCount).toBe('4 of 4');
    expect(rows(project(), { kind: 'print', query: 'recap' })).toEqual([]);
  });

  test('a kind nobody has is an empty list (the panel says which filter)', () => {
    const p = project({ 'a.tsx': [{ id: '1', kind: 'web' }] });
    expect(rows(p, { kind: 'print' })).toEqual([]);
  });

  test('the foot while filtered: the kind sentence; the offline foot still wins', () => {
    const base = { total: 6, shown: 3, searching: false };
    const line = panelFootLine({ ...base, kind: 'video', kindMatching: 3 });
    expect(line.source).toBe('kind');
    expect(line.text).toBe(
      '3 of 6 canvases have video. A canvas counts once under each kind it has.'
    );
    const sync = { text: 'Sending 14 changes · 9 sent' };
    expect(panelFootLine({ ...base, kind: 'video', kindMatching: 3, foots: { sync } }).source).toBe(
      'sync'
    );
    expect(panelFootLine(base).source).toBe('default');
  });
});

// ── the panel ───────────────────────────────────────────────────────────────────────────────────────

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
  clearKindFilter(); // the store is module-wide: leave nothing for the next file
});
const settle = (ms = 420) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function mount(fx: Fixture = MIXED, over: Record<string, unknown> = {}) {
  const p = project(fx);
  installFetch(p.snapshot);
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
        expansion={{ isOpen: () => true, setOpen: () => {} }}
        {...over}
        {...extra}
      />
    );
  await act(async () => render());
  await settle();
  return { host, rerender: (e?: Record<string, unknown>) => act(async () => render(e)) };
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: HTMLElement | null) =>
  act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
const names = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>('.cv-item[role="treeitem"] .cv-name')).map(
    (e) => e.textContent
  );

describe('the Canvases panel', () => {
  test('five chips with the index counts; every name is "<word>, <n>"', async () => {
    const { host } = await mount();
    const chips = Array.from(host.querySelectorAll<HTMLElement>('[data-testid^="kind-chip-"]'));
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      'All, 6',
      'Fixed size, 2',
      'Web page, 2',
      'Print, 2',
      'Video, 3',
    ]);
    expect(q(host, 'kind-chip-all')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('Video: the list becomes the three canvases that have video, with their folder and N of M', async () => {
    const { host } = await mount();
    await click(q(host, 'kind-chip-video'));
    expect(q(host, 'kind-chip-video')?.getAttribute('aria-pressed')).toBe('true');
    expect(q(host, 'kind-chip-video')?.textContent).toContain('Video'); // the chip that is on shows its word
    expect(names(host).sort()).toEqual(['mixed', 'video-hype', 'video-recap']);
    expect(q(host, 'canvas-row-kind-ui-social-video-hype')?.textContent).toBe('1 of 3');
    expect(q(host, 'canvas-row-kind-ui-social-video-recap')?.textContent).toBe('4 of 4');
    expect(q(host, 'canvases-foot')?.textContent).toBe(
      '3 of 6 canvases have video. A canvas counts once under each kind it has.'
    );
    expect(q(host, 'canvases-foot')?.getAttribute('data-slot')).toBe('kind');
  });

  test('pressing the chip that is on, or All, brings the tree back', async () => {
    const { host } = await mount();
    await click(q(host, 'kind-chip-print'));
    expect(names(host).sort()).toEqual(['flyer', 'mixed']);
    await click(q(host, 'kind-chip-print'));
    expect(getKindFilter()).toBe('all');
    expect(q(host, 'canvases-foot')).toBeNull(); // P8 C5: no foot line at rest
    await click(q(host, 'kind-chip-web'));
    await click(q(host, 'kind-chip-all'));
    expect(getKindFilter()).toBe('all');
    expect(names(host)).toContain('social'); // a folder row again
  });

  test('the filter is the store: set from outside (the Layers tab, ⌘K) and the list follows', async () => {
    const { host } = await mount();
    await act(async () => setKindFilter('print'));
    expect(names(host).sort()).toEqual(['flyer', 'mixed']);
    expect(q(host, 'kind-chip-print')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('a filter that hides everything says which one, and Clear filter undoes it in one click', async () => {
    const { host } = await mount({
      'a.tsx': [{ id: '1', kind: 'web' }],
      'b.tsx': [{ id: '1', kind: 'web' }],
      // P8 C3: the chips come once the project mixes kinds (a one-kind project draws none)
      'c.tsx': [{ id: '1', kind: 'video' }],
    });
    await click(q(host, 'kind-chip-print'));
    expect(q(host, 'kind-chip-print')?.getAttribute('data-zero')).toBe('true');
    const none = q(host, 'canvases-kind-none');
    expect(none?.textContent).toContain('No print canvases in Alligators brand.');
    expect(none?.textContent).toContain('The Print filter is on. Clear it to see all 3 canvases.');
    await click(q(host, 'canvases-kind-clear'));
    expect(getKindFilter()).toBe('all');
    expect(q(host, 'canvases-kind-none')).toBeNull();
    expect(names(host).sort()).toEqual(['a', 'b', 'c']);
  });

  test('a project of one kind draws no chips; a mixed one does; a filter that is on keeps them (P8 C3)', async () => {
    const one = await mount({
      'a.tsx': [{ id: '1', kind: 'web' }],
      'b.tsx': [{ id: '1', kind: 'web' }],
    });
    expect(q(one.host, 'kind-chips')).toBeNull();
    const mixed = await mount({
      'a.tsx': [{ id: '1', kind: 'web' }],
      'c.tsx': [{ id: '1', kind: 'video' }],
    });
    expect(q(mixed.host, 'kind-chips')).not.toBeNull();
  });

  test('a search narrows inside the filter', async () => {
    const { host, rerender } = await mount();
    await click(q(host, 'kind-chip-video'));
    await rerender({ search: 'hype' });
    expect(names(host)).toEqual(['video-hype']);
  });
});
