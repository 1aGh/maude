// S3.12 — "what each mode shows" as data (V2-1.2 §5.4 table, 04 md-model, A8 applied), and the sweep that fails
// when a consumer branches on a mode outside it.
//
// The expected table below is typed from the CONTRACT's rows (and md-model's extra rows), not read from the
// code under test: a cell edited in mode-shows.ts without the contract moving is a red test here.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_CAPS,
  type CanvasModeV2,
  holdsModuleUpdates,
  MODE_TOOLS,
  NO_CAPS,
} from '../bridge/canvas-modes.ts';
import {
  foldsPanels,
  holdsAiChanges,
  MODE_KEYS,
  MODE_SHOWS,
  type ModeKey,
  type ModeShowItem,
  modeCell,
  modeKey,
  modeShows,
  toolbarOf,
} from '../bridge/mode-shows.ts';

const STUDIO = join(import.meta.dir, '..');

// Columns: Edit · Preview · Present · Artboards · Present · Canvas · Viewing
const CONTRACT: Record<string, [string, string, string, string, string]> = {
  clicks: ['tool', 'live', 'next-artboard', 'pan-zoom', 'specs'],
  toolbar: ['edit', 'preview', 'none', 'none', 'viewing'],
  annotations: ['quiet', 'drawn', 'hidden', 'hidden', 'read-only'],
  'comment-pins': ['shown', 'shown', 'hidden', 'hidden', 'shown'],
  measure: ['on', 'on', 'off', 'off', 'on'],
  'ai-changes': ['live', 'live', 'held', 'live-unmarked', 'live'],
  'left-panels': ['shown', 'folded', 'hidden', 'hidden', 'shown'],
  'ai-panel': ['shown', 'folded', 'hidden', 'hidden', 'none'],
  'share-cluster': ['full', 'compact', 'hidden', 'hidden', 'full-access'],
  inspect: ['inspector', 'panel-on-cmd-click', 'hidden', 'hidden', 'panel-on-click'],
  'project-menu': ['pill', 'folded-pill', 'esc-first', 'esc-first', 'pill'],
  esc: ['steps-back', 'back-to-edit', 'settles-back', 'same-view', 'deselect'],
};
const COLUMNS: ModeKey[] = ['edit', 'preview', 'present-artboards', 'present-canvas', 'viewing'];

describe('the table is the contract’s, cell for cell', () => {
  test('every row and every cell', () => {
    expect(Object.keys(MODE_SHOWS).sort()).toEqual(Object.keys(CONTRACT).sort());
    for (const [row, cells] of Object.entries(CONTRACT))
      COLUMNS.forEach((col, i) => {
        expect(
          `${row}/${col}=${(MODE_SHOWS as Record<string, Record<string, string>>)[row][col]}`
        ).toBe(`${row}/${col}=${cells[i]}`);
      });
  });

  test('five columns, in the contract’s order, each reachable from a (mode, Present spec)', () => {
    expect([...MODE_KEYS]).toEqual(COLUMNS);
    expect(modeKey('edit')).toBe('edit');
    expect(modeKey('preview')).toBe('preview');
    expect(modeKey('viewing')).toBe('viewing');
    expect(modeKey('present', { kind: 'artboards' })).toBe('present-artboards');
    expect(modeKey('present', { kind: 'canvas' })).toBe('present-canvas');
    expect(modeKey('present')).toBe('present-canvas'); // no spec: Present · Canvas (the shell's default)
  });

  test('the table is frozen: no consumer edits a cell', () => {
    expect(Object.isFrozen(MODE_SHOWS)).toBe(true);
    expect(Object.isFrozen(MODE_SHOWS.clicks)).toBe(true);
  });
});

describe('the questions consumers ask are answers read from the table', () => {
  const MODES: Array<[CanvasModeV2, { kind: 'artboards' | 'canvas' } | null]> = [
    ['edit', null],
    ['preview', null],
    ['present', { kind: 'artboards' }],
    ['present', { kind: 'canvas' }],
    ['viewing', null],
  ];
  const EXPECT: Record<ModeShowItem, boolean[]> = {
    measure: [true, true, false, false, true],
    'inspect-panel': [false, true, false, false, true],
    'comment-pins': [true, true, false, false, true],
    'object-tools': [true, false, false, false, false],
    'live-design': [false, true, false, false, false],
    'annotations-editable': [false, true, false, false, false],
    chrome: [true, true, false, false, true],
  };
  for (const item of Object.keys(EXPECT) as ModeShowItem[])
    test(`modeShows(*, '${item}')`, () => {
      MODES.forEach(([m, p], i) => expect(modeShows(m, item, p)).toBe(EXPECT[item][i]));
    });

  test('an ungoverned canvas (no set-mode) keeps v1: measure, pins and the object’s chords are on', () => {
    for (const m of [null, undefined]) {
      expect(modeShows(m, 'measure')).toBe(true);
      expect(modeShows(m, 'comment-pins')).toBe(true);
      expect(modeShows(m, 'object-tools')).toBe(true);
      expect(modeShows(m, 'live-design')).toBe(false);
      expect(modeShows(m, 'inspect-panel')).toBe(false);
    }
  });

  test('A8: only Present · Artboards holds an AI write — and canvas-modes’ holdsModuleUpdates is that cell', () => {
    for (const [m, p] of MODES) {
      expect(holdsAiChanges(m, p)).toBe(modeCell('ai-changes', m, p) === 'held');
      expect(holdsModuleUpdates({ mode: m, present: p as never })).toBe(
        m === 'present' && p?.kind === 'artboards'
      );
    }
    expect(holdsModuleUpdates(null)).toBe(false);
    expect(holdsModuleUpdates({ mode: null, present: null })).toBe(false);
    // Preview shows live UNDER THE POINTER too (A8 applied): not held
    expect(holdsAiChanges('preview')).toBe(false);
  });

  test('Preview folds the panels; nothing else does', () => {
    expect(foldsPanels('preview')).toBe(true);
    for (const [m, p] of MODES.filter(([m]) => m !== 'preview'))
      expect(foldsPanels(m, p)).toBe(false);
  });
});

describe('the toolbar row against the toolbars as data (MODE_TOOLS)', () => {
  test('Viewing: Hand, plus Comment with the cap; Can view sees none (md-edge-viewer)', () => {
    expect(toolbarOf('viewing', { comment: true })).toBe('viewing');
    expect(toolbarOf('viewing', { comment: false })).toBe('none');
    expect(toolbarOf('edit', ALL_CAPS)).toBe('edit');
    expect(toolbarOf('preview', NO_CAPS)).toBe('preview');
    expect(toolbarOf('present', ALL_CAPS, { kind: 'artboards' })).toBe('none');
    expect(toolbarOf('present', ALL_CAPS, { kind: 'canvas' })).toBe('none');
  });

  test('the cell says "none" exactly where MODE_TOOLS hides the bar (Present) — and names a real bar elsewhere', () => {
    expect(MODE_TOOLS.present.hidden).toBe(true);
    for (const m of ['edit', 'preview', 'viewing'] as const) {
      expect(MODE_TOOLS[m].hidden).toBeFalsy();
      expect(modeCell('toolbar', m)).toBe(m);
    }
    expect(modeCell('toolbar', 'present', { kind: 'artboards' })).toBe('none');
  });
});

// ─── the sweep: a consumer that decides what shows by comparing a mode literal fails here ─────────────
//
// The canvas and the shell used to branch on `mode === 'edit'` / `'preview'` wherever they needed to know what
// a mode shows. Each of the consumers below now asks the table. This is not a global ban — the state machine
// (canvas-modes.ts, canvas-mode.js), a mode's own chrome (the PreviewBar, Present's controls) and the mode
// switch name their modes — it pins the files whose branching WAS "what shows".
const CONSUMERS = [
  'annotations-layer.tsx',
  'link-chip-overlay.tsx',
  'inspect-overlay.tsx',
  'inspect-canvas.ts',
  'input-router.tsx',
  'measure-overlay.tsx',
  'client/v2/shell/share-cluster.jsx',
  'client/v2/shell/share-cluster-host.jsx',
  'client/v2/inspect/inspect-host.jsx',
  'client/v2/inspect/inspect-model.js',
  'client/hooks/use-shell-core.jsx',
];
// `mode`, `snap.mode`, `click.mode` … compared to a mode word (both operators, both orders)
const MODE_COMPARE =
  /(?:\bmode\s*[!=]==\s*'(?:edit|preview|present|viewing)')|(?:'(?:edit|preview|present|viewing)'\s*[!=]==\s*(?:[\w.]*\.)?mode\b)/;

describe('no consumer branches on a mode literal outside the table', () => {
  for (const f of CONSUMERS)
    test(f, () => {
      const src = readFileSync(join(STUDIO, f), 'utf8');
      const hit = src
        .split('\n')
        .map((l, i) => [i + 1, l] as const)
        .filter(
          ([, l]) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && MODE_COMPARE.test(l)
        );
      expect(hit.map(([n, l]) => `${f}:${n}: ${l.trim()}`)).toEqual([]);
    });

  test('the folded Canvases / AI panels come from the table, not from `mode === preview`', () => {
    const src = readFileSync(join(STUDIO, 'client/v2/shell/use-canvas-mode-lane.js'), 'utf8');
    expect(src).toContain('foldsPanels(mode, snap.present)');
    expect(src).not.toMatch(/mode === 'preview' && snap\.nonce/);
  });

  test('the folded project pill follows the table’s project-menu row', () => {
    const src = readFileSync(join(STUDIO, 'client/v2/preview/preview-chrome-host.jsx'), 'utf8');
    expect(src).toContain("modeCell('project-menu', snap.mode, snap.present) === 'folded-pill'");
  });

  test('the sweep itself sees what it should (a planted branch is caught)', () => {
    expect(MODE_COMPARE.test("if (snap.mode !== 'preview') return;")).toBe(true);
    expect(MODE_COMPARE.test("return mode === null || mode === 'edit';")).toBe(true);
    expect(MODE_COMPARE.test("if ('viewing' === click.mode) return;")).toBe(true);
    expect(MODE_COMPARE.test("if (modeShows(mode, 'live-design')) return;")).toBe(false);
  });
});
