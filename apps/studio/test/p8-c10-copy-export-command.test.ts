// P8 C10 · 06 ad-search: ⌘K "copy" lists "Copy export command · Export › Advanced" (the board draws it among the
// six hidden tools). The registry action, the line it copies (the sheet's own writer) and the glyph.
import { describe, expect, test } from 'bun:test';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { glyphFor } from '../client/v2/search/palette-icons.js';
import {
  COMMAND_WORDS,
  copyExportCommand,
  exportCommandText,
} from '../client/v2/export/copy-command.js';

const base = { canvasFile: '.design/ui/Home.tsx', designRel: '.design' };

describe('registry', () => {
  const def = ACTIONS_BY_ID.get('export.copy-command') as unknown as {
    label: string;
    exec: string;
    search?: { where?: string };
    enabled?: { facts?: string[] };
  };
  test('a ⌘K command named for what it copies, homed at Export › Advanced', () => {
    expect(def.label).toBe('Copy export command');
    expect(def.exec).toBe('shell');
    expect(def.search?.where).toBe('Export › Advanced');
    expect(def.enabled?.facts).toEqual(['canvasOpen']);
  });
  test('wears the export glyph, not the stand-in chevron', () => {
    expect(glyphFor({ name: def.label, where: 'Export › Advanced' }, 'actions', 'chevron')).toBe(
      'export'
    );
  });
});

describe('the line it copies', () => {
  test('nothing selected: this canvas, as a PNG, from a terminal', () => {
    expect(exportCommandText({ ...base, selected: [] })).toBe(
      'maude design export png --scope canvas --canvas ui/Home.tsx --option scale=1'
    );
  });
  test('an artboard selected: that artboard', () => {
    const t = exportCommandText({
      ...base,
      selected: [{ artboardId: 'post', attrs: { 'data-dc-screen': 'post' }, kind: 'artboard' }],
    });
    expect(t).toContain('--scope selection');
    expect(t).toContain('--canvas ui/Home.tsx');
  });
  test('no canvas open: no line', () => {
    expect(exportCommandText({ ...base, canvasFile: null, selected: [] })).toBeNull();
  });
});

describe('copyExportCommand', () => {
  test('puts the line on the clipboard and says so', async () => {
    const got: string[] = [];
    const r = await copyExportCommand({
      state: { ...base, selected: [] },
      write: async (t: string) => void got.push(t),
    });
    expect(got).toEqual([
      'maude design export png --scope canvas --canvas ui/Home.tsx --option scale=1',
    ]);
    expect(r).toMatchObject({ ok: true, message: COMMAND_WORDS.copied });
  });
  test('no canvas: one plain line, nothing written', async () => {
    const got: string[] = [];
    const r = await copyExportCommand({
      state: { ...base, canvasFile: null, selected: [] },
      write: async (t: string) => void got.push(t),
    });
    expect(got).toEqual([]);
    expect(r).toEqual({ ok: false, message: COMMAND_WORDS.noCanvas });
  });
  test('a refused clipboard is said, not thrown', async () => {
    const r = await copyExportCommand({
      state: { ...base, selected: [] },
      write: async () => {
        throw new Error('denied');
      },
    });
    expect(r).toEqual({ ok: false, message: COMMAND_WORDS.failed });
  });
});
