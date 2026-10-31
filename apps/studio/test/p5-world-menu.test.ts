// P5 (UX audit F17, TD6) — the empty-canvas menu speaks the View menu's words and has ONE export route.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { worldMenuSections } from '../editing/world-menu.ts';

const calls: string[] = [];
const sections = worldMenuSections({
  addComment: () => calls.push('comment'),
  fit: () => calls.push('fit'),
  actualSize: () => calls.push('actual'),
  paste: () => calls.push('paste'),
  openExport: () => calls.push('export'),
});
const rows = sections.flat();

describe('the empty-canvas menu', () => {
  test('zoom rows carry the View menu words and keys (one name per ⌘0)', () => {
    const fit = ACTIONS_BY_ID.get('view.zoom-fit');
    const actual = ACTIONS_BY_ID.get('view.zoom-actual');
    const f = rows.find((r) => r.id === 'fit-view');
    const a = rows.find((r) => r.id === 'reset-view');
    expect(f?.label).toBe(fit?.label);
    expect(f?.shortcut).toBe('⌘0');
    expect(a?.label).toBe(actual?.label);
    expect(a?.shortcut).toBe('⇧0');
    expect(rows.map((r) => r.label)).not.toContain('Fit to view');
    expect(rows.map((r) => r.label)).not.toContain('Reset view');
  });

  test('no export route besides the one sheet: no "as separate", no "(ZIP)"', () => {
    const labels = rows.map((r) => String(r.label));
    expect(labels.filter((l) => /export/i.test(l))).toEqual(['Export…']);
    expect(rows.find((r) => r.id === 'export-canvas')?.shortcut).toBe(
      ACTIONS_BY_ID.get('export.open')?.keys?.[0]?.chord
    );
  });

  test('rows run their dep; Paste is absent without a clipboard', () => {
    for (const r of rows) r.onSelect({} as never);
    expect(calls).toEqual(['comment', 'paste', 'fit', 'actual', 'export']);
    const bare = worldMenuSections({
      addComment: () => {},
      fit: () => {},
      actualSize: () => {},
      openExport: () => {},
    }).flat();
    expect(bare.map((r) => r.id)).not.toContain('paste-world');
  });
});

describe('the stale words are gone from every menu source', () => {
  for (const f of ['canvas-shell.tsx', 'context-menu.tsx']) {
    test(`${f} names no second export route and no v1 zoom words`, () => {
      const src = readFileSync(join(import.meta.dir, '..', f), 'utf8');
      expect(src.includes('Export canvas as separate')).toBe(false);
      expect(src.includes('Export project (ZIP)')).toBe(false);
      expect(src.includes("'Fit to view'")).toBe(false);
      expect(src.includes("'Reset view'")).toBe(false);
    });
  }
  test('canvas-shell builds its world menu from worldMenuSections', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'canvas-shell.tsx'), 'utf8');
    expect(src.includes('worldMenuSections(')).toBe(true);
  });
});
