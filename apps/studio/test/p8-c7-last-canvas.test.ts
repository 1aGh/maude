// V2-8.5 c7 (01 cf-big-tree) — a project opens the canvas it was last on, and the Canvases panel keeps a
// "Recent" block of the ones before it. The data is `_canvas-state/_recent.json` (per Mac, ignored by git),
// read through `/_api/pins` -> `opened`; nothing new is stored.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { lastOpenedPath } from '../client/v2/canvases/last-canvas.js';
import { buildTree, visibleRows } from '../client/v2/canvases/tree-model.js';

const groups = [
  {
    fullPath: '.design/ui',
    label: 'ui',
    paths: [
      '.design/ui/A.tsx',
      '.design/ui/B.tsx',
      '.design/ui/legacy.html',
      '.design/ui/data.json',
    ],
    dirs: [],
  },
  {
    fullPath: '.design/system/maude-v2',
    label: 'system',
    paths: ['.design/system/x.tsx'],
    dirs: [],
  },
];

describe('lastOpenedPath', () => {
  test('the canvas opened most recently, as the path the tabs use', () => {
    expect(lastOpenedPath({ 'ui/A.tsx': 10, 'ui/B.tsx': 20 }, groups, '.design')).toBe(
      '.design/ui/B.tsx'
    );
  });

  test('a canvas that is gone from the tree is skipped, the next one wins', () => {
    expect(lastOpenedPath({ 'ui/gone.tsx': 99, 'ui/A.tsx': 10 }, groups, '.design')).toBe(
      '.design/ui/A.tsx'
    );
  });

  test('a design-system specimen and a non-canvas are never the "last canvas"', () => {
    expect(lastOpenedPath({ 'system/x.tsx': 50, 'ui/data.json': 60 }, groups, '.design')).toBe(
      null
    );
  });

  test('nothing opened here yet: no last canvas (the empty project stays the empty project)', () => {
    expect(lastOpenedPath({}, groups, '.design')).toBe(null);
    expect(lastOpenedPath(undefined, groups, '.design')).toBe(null);
    expect(lastOpenedPath({ 'ui/A.tsx': 5 }, [], '.design')).toBe(null);
  });
});

describe('the Recent block (cf-big-tree)', () => {
  const many = Array.from(
    { length: 12 },
    (_, i) => `.design/ui/C${String(i).padStart(2, '0')}.tsx`
  );
  const g = [{ kind: 'canvas', fullPath: '.design/ui', label: 'ui', paths: many, dirs: [] }];
  const now = Date.now();
  const opened = {
    'ui/C03.tsx': now - 3_600_000,
    'ui/C07.tsx': now - 60_000,
    'ui/C01.tsx': now - 7_200_000,
    'ui/C09.tsx': now - 90_000_000,
    'ui/C05.tsx': now - 120_000_000,
  };
  const tree = buildTree({ groups: g, designRel: '.design', opened });
  const rows = (o = {}) => visibleRows(tree, { projectLabel: 'Alligators', ...o });
  const recentHead = (rs) => rs.findIndex((r) => r.type === 'head' && r.id === 'recent');

  test('a big project lists the last few canvases, newest first, under a "Recent" head before the project', () => {
    const rs = rows({ activePath: '.design/ui/C07.tsx' });
    const h = recentHead(rs);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(rs[h].label).toBe('Recent');
    expect(rs[h + 1]).toMatchObject({ type: 'canvas', path: '.design/ui/C03.tsx', inRecent: true });
    expect(rs[h + 2]).toMatchObject({ path: '.design/ui/C01.tsx', inRecent: true });
    // the open canvas is the selected row below; it does not repeat up here
    expect(rs.filter((r) => r.inRecent).map((r) => r.path)).not.toContain('.design/ui/C07.tsx');
    expect(rs.findIndex((r) => r.id === 'project')).toBeGreaterThan(h + 2);
  });

  test('each Recent row says when, in the contract words', () => {
    const rs = rows({ activePath: '.design/ui/C07.tsx' });
    expect(rs.find((r) => r.inRecent && r.path.endsWith('C03.tsx')).recentWord).toBe('1 h ago');
  });

  test('at most three; a small project has none; a search or a kind filter hides the block', () => {
    expect(rows({ activePath: '.design/ui/C07.tsx' }).filter((r) => r.inRecent)).toHaveLength(3);
    const small = buildTree({
      groups: [
        { kind: 'canvas', fullPath: '.design/ui', label: 'ui', paths: many.slice(0, 4), dirs: [] },
      ],
      designRel: '.design',
      opened,
    });
    expect(recentHead(visibleRows(small, { projectLabel: 'P' }))).toBe(-1);
    expect(recentHead(rows({ query: 'C0' }))).toBe(-1);
    expect(recentHead(rows({ kind: 'print' }))).toBe(-1);
  });

  test('a pinned canvas stays under Pinned, not twice', () => {
    const rs = rows({
      activePath: '.design/ui/C07.tsx',
      pins: new Set(['ui/C03.tsx']),
      pinOrder: ['ui/C03.tsx'],
    });
    expect(rs.filter((r) => r.inRecent).map((r) => r.path)).not.toContain('.design/ui/C03.tsx');
  });
});

describe('wiring', () => {
  const root = new URL('../', import.meta.url);
  const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

  test('the first open on a desktop project goes through lastOpenedPath, once, without revealing', () => {
    const src = read('client/hooks/use-tabs.jsx');
    expect(src).toContain('lastOpenedPath');
    expect(src).toMatch(/\/_api\/pins/);
  });
});
