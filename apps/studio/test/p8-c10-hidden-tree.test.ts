// P8 C10 · 06 ad-left — Canvases › Advanced › Show hidden files draws the ONE canvas tree with the supporting
// files dimmed in place (the board's "both ON" frame), not the v1 file view.
import { describe, expect, test } from 'bun:test';
import { supportIcon, supportIndex } from '../client/v2/canvases/support-model.js';
import {
  buildTree,
  navigate,
  rowHeight,
  ROW_H,
  visibleRows,
} from '../client/v2/canvases/tree-model.js';

const D = '.design';
const ROOT = `${D}/ui`;

const GROUPS = [
  {
    label: 'UI canvases',
    kind: 'canvas',
    fullPath: ROOT,
    paths: [
      `${ROOT}/combine/Combine-kampan.tsx`,
      `${ROOT}/combine/Combine-kampan.meta.json`,
      `${ROOT}/combine/Combine-kampan.css`,
      `${ROOT}/combine/NOTES.md`,
      `${ROOT}/combine/hero.png`,
      `${ROOT}/Home.tsx`,
    ],
    dirs: [`${ROOT}/combine`],
  },
  {
    label: 'Design system',
    kind: 'canvas',
    fullPath: `${D}/system`,
    paths: [`${D}/system/x/tokens.css`],
    dirs: [],
  },
  {
    label: 'Runtime',
    kind: 'runtime',
    fullPath: D,
    paths: [`${D}/_history`, `${D}/_canvas-state`, `${D}/_active.json`],
  },
];

const open = new Set([`${ROOT}/combine`]);

describe('supportIndex', () => {
  const idx = supportIndex(GROUPS);

  test('a canvas keeps its sidecars, in name order', () => {
    expect(
      idx.byCanvas.get(`${ROOT}/combine/Combine-kampan.tsx`)?.map((f: { name: string }) => f.name)
    ).toEqual(['Combine-kampan.css', 'Combine-kampan.meta.json']);
  });

  test('a folder keeps its loose notes; pictures are the Assets panel’s', () => {
    expect(idx.byDir.get(`${ROOT}/combine`)?.map((f: { name: string }) => f.name)).toEqual([
      'NOTES.md',
    ]);
  });

  test('the design system group is not a canvas group: its files stay under Advanced', () => {
    expect(idx.byDir.get(`${D}/system/x`)).toBeUndefined();
  });

  test('runtime entries: a name with no extension is a folder', () => {
    expect(idx.runtime.map((r: { name: string; dir: boolean }) => [r.name, r.dir])).toEqual([
      ['_active.json', false],
      ['_canvas-state', true],
      ['_history', true],
    ]);
  });

  test('the glyphs the board names', () => {
    expect(supportIcon('_history')).toBe('history');
    expect(supportIcon('_canvas-state')).toBe('laptop');
    expect(supportIcon('Combine-kampan.css')).toBe('file');
  });
});

describe('visibleRows with support', () => {
  const tree = buildTree({ groups: GROUPS });
  const rows = visibleRows(tree, {
    expanded: (p: string) => open.has(p),
    fileNames: true,
    support: supportIndex(GROUPS),
  });
  const shape = rows
    .filter((r: { type: string }) => r.type !== 'head')
    .map((r: { type: string; name: string; depth: number }) => `${r.type}:${r.name}:${r.depth}`);

  test('sidecars sit under their canvas, a folder’s notes after its canvases, runtime at the root', () => {
    expect(shape).toEqual([
      'folder:combine:0',
      'canvas:Combine-kampan:1',
      'support:Combine-kampan.css:2',
      'support:Combine-kampan.meta.json:2',
      'support:NOTES.md:1',
      'canvas:Home:0',
      'support:_active.json:0',
      'support:_canvas-state/:0',
      'support:_history/:0',
    ]);
  });

  test('the canvas keeps its file name line (Show file names) next to the supporting rows', () => {
    const c = rows.find((r: { type: string }) => r.type === 'canvas') as { fileName?: string };
    expect(c.fileName).toBe('Combine-kampan.tsx');
  });

  test('a supporting row is one plain line and is a stop for the arrow keys', () => {
    const i = rows.findIndex((r: { type: string }) => r.type === 'support');
    expect(rowHeight(rows[i])).toBe(ROW_H);
    expect(navigate(rows, i, 'ArrowDown')).toEqual({ focus: i + 1 });
  });

  test('hidden off: not a single supporting row', () => {
    const plain = visibleRows(tree, { expanded: (p: string) => open.has(p) });
    expect(plain.some((r: { type: string }) => r.type === 'support')).toBe(false);
  });

  test('a search shows canvases only', () => {
    const hits = visibleRows(tree, { query: 'combine', support: supportIndex(GROUPS) });
    expect(hits.some((r: { type: string }) => r.type === 'support')).toBe(false);
  });
});
