// S1.1 — the Canvases panel as data (11 · pn-organise, 01 · cf-big-tree): folders with counts, the Pinned
// group, the three sorts + "Folders on top", the empty folder, search that folds accents, the window that
// keeps a 93-canvas project at ≤ 60 DOM rows, and the tree keys the virtualised list still answers.
import { describe, expect, test } from 'bun:test';
import { DEFAULT_SORT, normaliseSort, SORT_LABELS, sortItems } from '../client/v2/canvases/sort.js';
import {
  buildTree,
  DOM_CAP,
  designRelOf,
  emptyFolderWords,
  indexMeta,
  layoutRows,
  navigate,
  nothingCalled,
  panelFoot,
  plural,
  scrollToReveal,
  visibleRows,
  windowRange,
} from '../client/v2/canvases/tree-model.js';

const D = '.design';
const ROOT = `${D}/ui`;

/** The Alligators project (01 · cf-big-tree): 93 canvases in folders, four leftovers at the root. */
function alligators() {
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
  const dirs = new Set<string>(['2026', '2027']); // 2027 is empty
  for (const [dir, n] of Object.entries(folders)) {
    const parts = dir.split('/');
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    for (let i = 1; i <= n; i++) paths.push(`${ROOT}/${dir}/${dir.replace('/', '-')}-${i}.tsx`);
  }
  for (const n of ['test', 'Test2', 'ahoj', 'ahoj2']) paths.push(`${ROOT}/${n}.tsx`);
  return {
    groups: [
      {
        label: 'UI canvases',
        kind: 'canvas',
        fullPath: ROOT,
        paths,
        dirs: [...dirs].map((d) => `${ROOT}/${d}`),
      },
      { label: 'Design system', kind: 'canvas', fullPath: `${D}/system`, paths: [], dirs: [] },
    ],
    paths,
  };
}

const open = (...dirs: string[]) => {
  const s = new Set(dirs.map((d) => `${ROOT}/${d}`));
  return (p: string) => s.has(p);
};

describe('the tree', () => {
  test('93 canvases, folders counted recursively, the empty folder kept', () => {
    const { groups } = alligators();
    const t = buildTree({ groups, designRel: D });
    expect(t.total).toBe(93);
    expect(t.single).toBe(true);
    expect(t.byPath.get(`${ROOT}/2026`)?.count).toBe(16);
    expect(t.byPath.get(`${ROOT}/2026/combine`)?.count).toBe(6);
    expect(t.byPath.get(`${ROOT}/social`)?.count).toBe(31);
    expect(t.byPath.get(`${ROOT}/2027`)?.count).toBe(0);
  });

  test('the design system group is not part of the canvases tree', () => {
    const { groups } = alligators();
    groups[1].paths = [`${D}/system/project/preview/logo.tsx`];
    const t = buildTree({ groups, designRel: D });
    expect(t.total).toBe(93);
    expect(t.roots).toHaveLength(1);
  });

  test('a legacy .html canvas is a row; sidecars and media are not', () => {
    const { groups } = alligators();
    groups[0].paths.push(
      `${ROOT}/old.html`,
      `${ROOT}/test.meta.json`,
      `${ROOT}/test.css`,
      `${ROOT}/photo.png`
    );
    const t = buildTree({ groups, designRel: D });
    expect(t.total).toBe(94);
    const old = t.byPath.get(ROOT)?.canvases.find((c: { name: string }) => c.name === 'old');
    expect(old?.pinnable).toBe(false); // /_api/pins keys are .tsx only
  });

  test('rels are designRoot-relative — the key pins and "opened" use', () => {
    const { groups } = alligators();
    const t = buildTree({ groups, designRel: D });
    expect(t.byPath.get(ROOT)?.canvases.some((c: { rel: string }) => c.rel === 'ui/test.tsx')).toBe(
      true
    );
  });

  test('several canvas groups: each is a root folder named after it', () => {
    const t = buildTree({
      groups: [
        {
          label: 'UI canvases',
          kind: 'canvas',
          fullPath: `${D}/ui`,
          paths: [`${D}/ui/a.tsx`],
          dirs: [],
        },
        {
          label: 'Kits',
          kind: 'canvas',
          fullPath: `${D}/kits`,
          paths: [`${D}/kits/b.tsx`],
          dirs: [],
        },
      ],
      designRel: D,
    });
    expect(t.single).toBe(false);
    const rows = visibleRows(t, { projectLabel: 'P' });
    expect(rows.filter((r) => r.type === 'folder').map((r) => r.name)).toEqual([
      'UI canvases',
      'Kits',
    ]);
  });
});

describe('the index joins in as row meta', () => {
  const snapshot = {
    project: { designRel: D },
    canvases: [
      {
        rel: 'ui/test.tsx',
        kind: 'canvas',
        mtimeMs: 500,
        madeByAi: true,
        cover: { key: 'abc' },
        artboards: [
          { id: 'a', kind: 'web' },
          { id: 'b', kind: 'print' },
        ],
      },
    ],
  };

  test('print / video show as badges, web and digital do not; AI and the cover come along', () => {
    const { groups } = alligators();
    const meta = indexMeta(snapshot, D);
    const t = buildTree({ groups, meta, designRel: D });
    const c = t.byPath.get(ROOT)?.canvases.find((x: { name: string }) => x.name === 'test');
    expect(c.kinds).toEqual(['print']);
    expect(c.ai).toBe(true);
    expect(c.cover).toBe('abc');
    expect(c.artboards).toBe(2);
  });

  test('a canvas the index has not seen is still a row, with no badges', () => {
    const { groups } = alligators();
    const t = buildTree({ groups, meta: indexMeta(snapshot, D), designRel: D });
    const c = t.byPath.get(ROOT)?.canvases.find((x: { name: string }) => x.name === 'Test2');
    expect(c.kinds).toEqual([]);
    expect(c.ai).toBe(false);
  });

  test('designRel: the index says; without it, the first segment of a group root', () => {
    const { groups } = alligators();
    expect(designRelOf(snapshot, groups)).toBe('.design');
    expect(designRelOf(null, groups)).toBe('.design');
  });
});

describe('sort', () => {
  const items = [
    { type: 'canvas', name: 'Test10', mtimeMs: 1, openedAt: null, kinds: [] },
    { type: 'canvas', name: 'test2', mtimeMs: 1, openedAt: null, kinds: [] },
    { type: 'folder', name: 'zeta', mtimeMs: 1, openedAt: null, kinds: [] },
    { type: 'canvas', name: 'Leták', mtimeMs: 1, openedAt: null, kinds: ['print'] },
    { type: 'canvas', name: 'Clip', mtimeMs: 1, openedAt: null, kinds: ['video'] },
    { type: 'canvas', name: 'Site', mtimeMs: 1, openedAt: null, kinds: ['web'] },
  ];
  const names = (xs: { name: string }[]) => xs.map((x) => x.name);

  test('Name is natural and accent-insensitive, folders on top by default', () => {
    expect(names(sortItems(items, { by: 'name', foldersOnTop: true }))).toEqual([
      'zeta',
      'Clip',
      'Leták',
      'Site',
      'test2',
      'Test10',
    ]);
  });

  test('Folders on top off: folders mix in by the same order', () => {
    expect(names(sortItems(items, { by: 'name', foldersOnTop: false }))).toEqual([
      'Clip',
      'Leták',
      'Site',
      'test2',
      'Test10',
      'zeta',
    ]);
  });

  test('Kind: web, social, print, video, then the ones with none', () => {
    expect(names(sortItems(items, { by: 'kind', foldersOnTop: false }))).toEqual([
      'Site',
      'Leták',
      'Clip',
      'test2',
      'Test10',
      'zeta',
    ]);
  });

  test('Recently opened: opened first (newest first), then the rest by when they changed', () => {
    const rec = [
      { type: 'canvas', name: 'old', mtimeMs: 5, openedAt: 100, kinds: [] },
      { type: 'canvas', name: 'new', mtimeMs: 1, openedAt: 900, kinds: [] },
      { type: 'canvas', name: 'never-new', mtimeMs: 800, openedAt: null, kinds: [] },
      { type: 'canvas', name: 'never-old', mtimeMs: 10, openedAt: null, kinds: [] },
    ];
    expect(names(sortItems(rec, { by: 'recent', foldersOnTop: true }))).toEqual([
      'new',
      'old',
      'never-new',
      'never-old',
    ]);
  });

  test('a stored value that is not a sort falls back to Recently opened, folders on top', () => {
    expect(normaliseSort(undefined)).toEqual(DEFAULT_SORT);
    expect(normaliseSort({ by: 'colour', foldersOnTop: 'yes' })).toEqual(DEFAULT_SORT);
    expect(normaliseSort({ by: 'name', foldersOnTop: false })).toEqual({
      by: 'name',
      foldersOnTop: false,
    });
  });

  test("the menu words are the artboard's", () => {
    expect(SORT_LABELS).toEqual({ recent: 'Recently opened', name: 'Name', kind: 'Kind' });
  });
});

describe('the rows', () => {
  const { groups } = alligators();
  const tree = buildTree({ groups, designRel: D });

  test('closed: the project row, the folders with counts, the four leftovers', () => {
    const rows = visibleRows(tree, {
      projectLabel: 'Alligators brand',
      sort: { by: 'name', foldersOnTop: true },
    });
    expect(rows[0]).toMatchObject({ type: 'head', id: 'project', label: 'Alligators brand' });
    const folders = rows.filter((r) => r.type === 'folder');
    expect(folders.map((f) => `${f.name} ${f.count}`)).toEqual([
      '2026 16',
      '2027 0',
      'club-web 9',
      'legacy 27',
      'print 6',
      'social 31',
    ]);
    expect(rows.filter((r) => r.type === 'canvas').map((r) => r.name)).toEqual([
      'ahoj',
      'ahoj2',
      'test',
      'Test2',
    ]);
  });

  test('open folders list their children one level deeper', () => {
    const rows = visibleRows(tree, {
      projectLabel: 'P',
      sort: { by: 'name', foldersOnTop: true },
      expanded: open('2026', '2026/combine'),
    });
    const combine = rows.findIndex((r) => r.key === `dir:${ROOT}/2026/combine`);
    expect(rows[combine]).toMatchObject({ depth: 1, open: true, count: 6 });
    expect(rows[combine + 1]).toMatchObject({ type: 'canvas', depth: 2 });
    expect(rows[combine + 1].level).toBe(3);
  });

  test("an open empty folder says so, in the contract's words", () => {
    const rows = visibleRows(tree, { projectLabel: 'P', expanded: open('2027') });
    const i = rows.findIndex((r) => r.type === 'empty');
    expect(rows[i]).toMatchObject({ folderName: '2027', folderPath: `${ROOT}/2027`, depth: 1 });
    expect(emptyFolderWords('2027')).toEqual({
      title: 'Nothing in 2027 yet.',
      body: 'Drag canvases in, or start one here.',
      action: 'New canvas in 2027',
    });
  });

  test('Pinned comes first, in the order they were pinned; the canvas is still in its folder', () => {
    const k = `${ROOT}/2026/combine/2026-combine-1.tsx`;
    const rel = 'ui/2026/combine/2026-combine-1.tsx';
    const rows = visibleRows(tree, {
      projectLabel: 'P',
      pins: new Set([rel, 'ui/test.tsx']),
      pinOrder: [rel, 'ui/test.tsx'],
      expanded: open('2026', '2026/combine'),
    });
    expect(rows[0]).toMatchObject({ type: 'head', id: 'pinned', aside: '2' });
    expect(rows[1]).toMatchObject({ path: k, pinned: true, inPinned: true });
    expect(rows[2]).toMatchObject({ path: `${ROOT}/test.tsx`, inPinned: true });
    expect(rows[3]).toMatchObject({ type: 'head', id: 'project' });
    const inTree = rows.find((r) => r.key === `row:${k}`);
    expect(inTree?.pinned).toBe(true);
    expect(inTree?.inPinned).toBeUndefined();
  });

  test('no pins, no Pinned group', () => {
    expect(visibleRows(tree, { projectLabel: 'P' }).some((r) => r.id === 'pinned')).toBe(false);
  });

  test('a pin whose canvas is gone is not a row', () => {
    const rows = visibleRows(tree, {
      projectLabel: 'P',
      pins: new Set(['ui/gone.tsx']),
      pinOrder: ['ui/gone.tsx'],
    });
    expect(rows.some((r) => r.id === 'pinned')).toBe(false);
  });

  test('the open canvas is current', () => {
    const rows = visibleRows(tree, { projectLabel: 'P', activePath: `${ROOT}/test.tsx` });
    expect(rows.find((r) => r.current)?.path).toBe(`${ROOT}/test.tsx`);
  });

  test('search flattens, folds accents, wants every word, and says where each hit lives', () => {
    const t = buildTree({
      groups: [
        {
          label: 'UI canvases',
          kind: 'canvas',
          fullPath: ROOT,
          paths: [
            `${ROOT}/2026/combine/Combine-letak-registrace.tsx`,
            `${ROOT}/legacy/letak-nabor-2023-FINAL.tsx`,
            `${ROOT}/Leták A6.tsx`,
            `${ROOT}/Other.tsx`,
          ],
          dirs: [`${ROOT}/2026`, `${ROOT}/2026/combine`, `${ROOT}/legacy`],
        },
      ],
      designRel: D,
    });
    const hits = visibleRows(t, { projectLabel: 'P', query: 'letak' });
    expect(hits.map((r) => r.name).sort()).toEqual([
      'Combine-letak-registrace',
      'Leták A6',
      'letak-nabor-2023-FINAL',
    ]);
    expect(hits.find((r) => r.name === 'Combine-letak-registrace')?.sub).toBe('2026/combine');
    expect(visibleRows(t, { projectLabel: 'P', query: 'letak 2023' }).map((r) => r.name)).toEqual([
      'letak-nabor-2023-FINAL',
    ]);
    expect(visibleRows(t, { projectLabel: 'P', query: 'pricng' })).toEqual([]);
  });

  test("the words: counts read for one and for many; nothing found is the contract's line", () => {
    expect(plural(1, 'canvas', 'canvases')).toBe('1 canvas');
    expect(panelFoot({ total: 93, shown: 93, searching: false })).toBe(
      '93 canvases · ⌘K searches every project'
    );
    expect(panelFoot({ total: 93, shown: 3, searching: true })).toBe(
      '3 results · ⌘K searches every project'
    );
    expect(nothingCalled(' pricng ')).toBe(
      'Nothing called “pricng”. Try another word, or ask AI to find it.'
    );
  });
});

describe('the window (virtualised: 93+ canvases, ≤ 60 DOM rows)', () => {
  const { groups } = alligators();
  const tree = buildTree({ groups, designRel: D });
  const everything = visibleRows(tree, {
    projectLabel: 'P',
    expanded: () => true,
  });
  const layout = layoutRows(everything);

  test('everything open is more than 100 rows', () => {
    expect(everything.length).toBeGreaterThan(100);
  });

  test('from the top, from the middle and from the end, never more than 60 rows are drawn', () => {
    for (const top of [0, 1500, layout.height - 600, layout.height]) {
      for (const vh of [0, 400, 600, 2400]) {
        const { start, end } = windowRange(everything, layout, top, vh);
        expect(end - start).toBeLessThanOrEqual(DOM_CAP);
        expect(end).toBeLessThanOrEqual(everything.length);
        expect(start).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('the window follows the scroll: row 60 is drawn when you are there', () => {
    const top = layout.tops[60];
    const { start, end } = windowRange(everything, layout, top, 600);
    expect(start).toBeLessThanOrEqual(60);
    expect(end).toBeGreaterThan(60);
    expect(windowRange(everything, layout, 0, 600).end).toBeLessThan(40);
  });

  test('revealing a row only scrolls when it is out of view', () => {
    expect(scrollToReveal(everything, layout, 3, 0, 600)).toBe(0);
    const down = scrollToReveal(everything, layout, 80, 0, 600);
    expect(down).toBeGreaterThan(0);
    expect(layout.tops[80] + 30).toBeLessThanOrEqual(down + 600);
    expect(scrollToReveal(everything, layout, 1, 900, 600)).toBe(layout.tops[1]);
  });

  test('an empty list has an empty window', () => {
    expect(windowRange([], layoutRows([]), 0, 600)).toEqual({ start: 0, end: 0 });
  });
});

describe('keyboard (the tree keys the old FileTree answered)', () => {
  const { groups } = alligators();
  const tree = buildTree({ groups, designRel: D });
  const rows = visibleRows(tree, {
    projectLabel: 'P',
    sort: { by: 'name', foldersOnTop: true },
    expanded: open('2026'),
  });
  const at = (key: string) => rows.findIndex((r) => r.key === key);
  const y2026 = at(`dir:${ROOT}/2026`);
  const combine = at(`dir:${ROOT}/2026/combine`);

  test('↓ and ↑ skip the project row; Home and End reach the ends', () => {
    expect(rows[0].type).toBe('head');
    expect(navigate(rows, y2026, 'ArrowDown')).toEqual({ focus: combine });
    expect(navigate(rows, combine, 'ArrowUp')).toEqual({ focus: y2026 });
    expect(navigate(rows, y2026, 'Home')).toEqual({ focus: y2026 });
    expect(navigate(rows, y2026, 'End')).toEqual({ focus: rows.length - 1 });
  });

  test('→ opens a closed folder, steps into an open one', () => {
    expect(navigate(rows, combine, 'ArrowRight')).toEqual({ toggle: combine });
    expect(navigate(rows, y2026, 'ArrowRight')).toEqual({ focus: y2026 + 1 });
  });

  test('← closes an open folder, else goes to the parent', () => {
    expect(navigate(rows, y2026, 'ArrowLeft')).toEqual({ toggle: y2026 });
    expect(navigate(rows, combine, 'ArrowLeft')).toEqual({ focus: y2026 });
  });

  test('↵ and Space open a canvas and toggle a folder', () => {
    const canvas = rows.findIndex((r) => r.type === 'canvas');
    expect(navigate(rows, canvas, 'Enter')).toEqual({ activate: canvas });
    expect(navigate(rows, y2026, ' ')).toEqual({ toggle: y2026 });
  });

  test('a letter jumps to the next row that starts with it, wrapping round', () => {
    const t = rows.findIndex((r) => r.name === 'test');
    expect(navigate(rows, y2026, 't')).toEqual({ focus: t });
    expect(navigate(rows, t, 'a')).toEqual({ focus: rows.findIndex((r) => r.name === 'ahoj') });
    expect(navigate(rows, t, 'F1')).toBeNull();
  });

  test('↑ from the first row stays; a list with no rows answers nothing', () => {
    expect(navigate(rows, y2026, 'ArrowUp')).toEqual({ focus: y2026 });
    expect(navigate([], 0, 'ArrowDown')).toBeNull();
  });
});
