// Phase 8 stage C round 2 (kit-advanced) — the kit glyphs the C4 patch asked for exist (corner, done, view,
// minus, spark, settings), and the 06 copy the critics named reads the board's words.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STICONS } from '../client/shell/icons.jsx';
import { COMPARE_PICTURES_WORDS } from '../client/v2/history/compare-words.js';
import { GIT_WORDS } from '../client/v2/history/git-model.js';
import { glyphFor } from '../client/v2/search/palette-icons.js';

const CLIENT = join(import.meta.dir, '..', 'client');
const src = (rel: string) => readFileSync(join(CLIENT, rel), 'utf8');

describe('kit glyphs (C4 patch request)', () => {
  test('corner, done, view, minus, spark and settings are in STICONS', () => {
    for (const n of ['corner', 'done', 'view', 'minus', 'spark', 'settings']) {
      expect(n in STICONS, n).toBe(true);
    }
  });
});

describe('06 copy: the app never names itself in running copy; the disclosure is Advanced', () => {
  test('the not-versioned sentence does not say Maude', () => {
    expect(GIT_WORDS.notVersioned).not.toMatch(/maude/i);
  });
  test('Compare is one word on the ghost button (06 ad-history)', () => {
    expect(COMPARE_PICTURES_WORDS.button).toBe('Compare');
  });
  test('the broken-canvas card names its disclosure Advanced, not "Show details"', () => {
    expect(src('v2/code/canvas-error-card.jsx')).not.toContain('label="Show details"');
  });
  test('Settings › Advanced: no "Maude checks…", no "the AI", server build in lower case', () => {
    const s = src('v2/settings/advanced-section.jsx');
    expect(s).not.toContain('Maude checks in the background');
    expect(s).not.toContain('so the AI remembers');
    expect(s).not.toContain('MAUDE-DEV-SRV');
  });
  test('Diagnostics › Server carries no v1 migration note', () => {
    expect(src('v2/diagnostics/diagnostics-sheet.jsx')).not.toContain('Was the status bar');
  });
});

describe('06 ad-search: a fold action carries the glyph of what it does, never a stand-in chevron', () => {
  const g = (name: string, where = '') => glyphFor({ name, where }, 'actions', 'chevron');
  test('the board mapping', () => {
    expect(g('Copy code', 'Inspector › Advanced')).toBe('duplicate');
    expect(g('Copy element id', 'Inspector › Advanced')).toBe('duplicate');
    expect(g('Copy file path', 'Canvases › Advanced')).toBe('folder');
    expect(g('Copy export command', 'Export › Advanced')).toBe('export');
    expect(g('Copy transcript', 'AI chat panel › Advanced')).toBe('comment');
    expect(g('Copy logs', 'Menu › Diagnostics › Logs')).toBe('sync');
  });
  test('every glyph it can return exists', () => {
    for (const n of [
      'duplicate',
      'folder',
      'export',
      'comment',
      'sync',
      'code',
      'history',
      'link',
      'sliders',
      'file',
      'chevron',
    ])
      expect(n in STICONS, n).toBe(true);
  });
  test('other groups keep their own default; an unknown action keeps the chevron', () => {
    expect(glyphFor({ name: 'Copy code' }, 'canvases', 'file')).toBe('file');
    expect(g('Frobnicate the widgets')).toBe('chevron');
  });
});
