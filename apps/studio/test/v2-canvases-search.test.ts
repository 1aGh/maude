// S1.3 — search inside the Canvases panel (01 · cf-panel-search): "treneri" finds "Trenéři", an artboard
// inside a canvas answers for the canvas, a swapped letter still finds it, and every mark maps back to the
// UNFOLDED text so the row wraps the letters the person sees.
import { describe, expect, test } from 'bun:test';
import {
  foldMapped,
  markRanges,
  searchCanvases,
  splitMarks,
} from '../client/v2/canvases/panel-search.js';
import { buildTree, indexMeta, visibleRows } from '../client/v2/canvases/tree-model.js';

const D = '.design';
const ROOT = `${D}/ui`;

const canvas = (
  name: string,
  boards: { id: string; label: string; kind: string }[] = [],
  extra = {}
) => ({
  type: 'canvas',
  path: `${ROOT}/${name}.tsx`,
  name,
  boards,
  sortKinds: [...new Set(boards.map((b) => b.kind))],
  ...extra,
});

const LETAK = canvas('LetakA6', [
  { id: 'a', label: 'Náborový leták A6 · FLAG', kind: 'print' },
  { id: 'b', label: 'Náborový leták A6 · TACKLE', kind: 'print' },
  { id: 'c', label: 'Náborový leták A6 · FLAG (zadní)', kind: 'print' },
  { id: 'd', label: 'Náborový leták A6 · TACKLE (zadní)', kind: 'print' },
]);
const TRENERI = canvas('Trenéři');
const OTHER = canvas('Pricing');

describe('S1.3 panel search — one matcher, accents, typos', () => {
  test('typing "treneri" finds "Trenéři", with the mark on the unfolded letters', () => {
    const hits = searchCanvases([TRENERI, OTHER], 'treneri');
    expect(hits.map((h) => h.canvas.name)).toEqual(['Trenéři']);
    const [a, b] = hits[0].nameMarks[0];
    expect('Trenéři'.slice(a, b)).toBe('Trenéři');
    expect(splitMarks('Trenéři', hits[0].nameMarks)).toEqual([{ t: 'Trenéři', m: true }]);
  });

  test('marks map back to the unfolded text — a mid-word match and a precomposed accent', () => {
    expect(markRanges('Náborový leták A6 · FLAG', ['letak'])).toEqual([[9, 14]]);
    const text = 'Náborový leták A6 · FLAG';
    expect(text.slice(9, 14)).toBe('leták');
    // decomposed input ("e" + combining acute) maps to the same letters
    const decomposed = 'Tréneri';
    const { text: folded, map } = foldMapped(decomposed);
    expect(folded).toBe('treneri');
    expect(map[3]).toBe(4); // the combining mark takes an index of its own in the original
    expect(markRanges(decomposed, ['neri'])).toEqual([[4, 8]]);
  });

  test('an artboard hit answers for its canvas: "letak" finds LetakA6 and says which artboard', () => {
    const hits = searchCanvases([OTHER, LETAK], 'letak');
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.canvas.name).toBe('LetakA6');
    expect(h.matched.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
    // the canvas NAME matched too ("LetakA6" has letak), so this is not an "artboard hit"
    expect(h.viaBoards).toBe(false);
  });

  test('a canvas whose name does not match is a hit through its artboard, with the quoted one-liner', () => {
    const c = canvas('Combine-kampan', [
      { id: 'x', label: 'Náborový leták A6 · FLAG', kind: 'print' },
      { id: 'y', label: 'Pozvánka · story', kind: 'digital' },
    ]);
    const hits = searchCanvases([c], 'letak');
    expect(hits[0].viaBoards).toBe(true);
    expect(hits[0].matched.map((m) => m.id)).toEqual(['x']);
    expect(hits[0].boardSub?.text).toBe('print · “Náborový leták A6 · FLAG”');
    const [a, b] = hits[0].boardSub!.marks[0];
    expect(hits[0].boardSub!.text.slice(a, b)).toBe('leták');
  });

  test('"and N more" when several artboards of one canvas answer', () => {
    const c = canvas('Kampan', [
      { id: '1', label: 'Leták přední', kind: 'print' },
      { id: '2', label: 'Leták zadní', kind: 'print' },
      { id: '3', label: 'Leták boční', kind: 'print' },
      { id: '4', label: 'Story', kind: 'digital' },
    ]);
    const h = searchCanvases([c], 'letak')[0];
    expect(h.boardSub?.text).toBe('print · “Leták přední” and 2 more');
  });

  test('every word counts, in any order, across the artboard name and its canvas name', () => {
    const hits = searchCanvases([LETAK, TRENERI], 'predni letak a6');
    expect(hits).toHaveLength(0); // "přední" is nowhere in LetakA6's artboards
    const c = canvas('LetakA6', [{ id: 'p', label: 'A · přední FLAG', kind: 'print' }]);
    const h = searchCanvases([c], 'letak a6 predni')[0];
    expect(h.matched.map((m) => m.id)).toEqual(['p']);
  });

  test('one letter off still finds it (and says so); a word that matches nothing drops the canvas', () => {
    const c = canvas('Uniformy-2027');
    const h = searchCanvases([c], 'unifromy 2027');
    expect(h).toHaveLength(1);
    expect(h[0].canvas.name).toBe('Uniformy-2027');
    expect(searchCanvases([c], 'unifromy 2099')).toEqual([]);
    expect(searchCanvases([c], '   ')).toEqual([]);
  });

  test('a number is not a typo: "2023" does not find 2026', () => {
    const c = canvas('Combine-letak-registrace');
    expect(searchCanvases([c], 'letak 2023', { folderOf: () => '2026/combine' })).toEqual([]);
    expect(searchCanvases([c], 'letak 2026', { folderOf: () => '2026/combine' })).toHaveLength(1);
  });

  test('ties keep the Sort order the person chose', () => {
    const a = canvas('Plakat A');
    const b = canvas('Plakat B');
    expect(searchCanvases([a, b], 'plakat', { order: [b, a] }).map((h) => h.canvas.name)).toEqual([
      'Plakat B',
      'Plakat A',
    ]);
  });

  test('the folder is searched too, and its words are marked', () => {
    const c = canvas('Banner');
    const h = searchCanvases([c], 'combine', { folderOf: () => '2026/combine' });
    expect(h).toHaveLength(1);
    expect(h[0].folderMarks).toEqual([[5, 12]]);
  });
});

describe('S1.3 panel search — through the tree', () => {
  const snapshot = {
    project: { designRel: D },
    canvases: [
      {
        rel: 'ui/Kampan.tsx',
        kind: 'canvas',
        artboards: [
          { id: 'x', label: 'Náborový leták A6 · FLAG', kind: 'print' },
          { id: 'y', label: 'Pozvánka · story', kind: 'digital' },
        ],
      },
      { rel: 'ui/Trenéři.tsx', kind: 'canvas', artboards: [] },
    ],
  };
  const tree = buildTree({
    groups: [
      {
        label: 'UI canvases',
        kind: 'canvas',
        fullPath: ROOT,
        paths: [`${ROOT}/Kampan.tsx`, `${ROOT}/Trenéři.tsx`],
        dirs: [],
      },
    ],
    meta: indexMeta(snapshot, D),
    designRel: D,
  });

  test('indexMeta keeps the artboards (id, label, kind) the jump list and the search read', () => {
    const c = tree.roots[0].canvases.find((x: { name: string }) => x.name === 'Kampan');
    expect(c.boards.map((b: { id: string }) => b.id)).toEqual(['x', 'y']);
  });

  test('"treneri" flattens to Trenéři; an artboard-only hit opens its canvas to the matching artboards', () => {
    const rows = visibleRows(tree, { projectLabel: 'P', query: 'treneri' });
    expect(rows.map((r) => r.name)).toEqual(['Trenéři']);

    const hit = visibleRows(tree, { projectLabel: 'P', query: 'letak' });
    expect(hit.map((r) => `${r.type}:${r.name}`)).toEqual([
      'canvas:Kampan',
      'board:Náborový leták A6 · FLAG',
    ]);
    expect(hit[1].artboardId).toBe('x');
    expect(hit[1].nameMarks).toEqual([[9, 14]]);
    // the person closed it: back to the one-liner under the name
    const closed = visibleRows(tree, {
      projectLabel: 'P',
      query: 'letak',
      jumpOpen: new Map([[`${ROOT}/Kampan.tsx`, false]]),
    });
    expect(closed.map((r) => r.type)).toEqual(['canvas']);
    expect(closed[0].sub).toBe('print · “Náborový leták A6 · FLAG”');
  });
});
