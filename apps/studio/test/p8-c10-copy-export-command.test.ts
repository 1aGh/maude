// P8 C10 · 06 ad-search: ⌘K "copy" lists "Copy export command · Export › Advanced" (the board draws it among the
// six hidden tools). The registry action, the line it copies (the sheet's own writer) and the glyph.
import { describe, expect, test } from 'bun:test';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { shellQuote } from '../client/v2/export/advanced/command.js';
import {
  ARTBOARD_ID_RE,
  COMMAND_WORDS,
  copyExportCommand,
  exportCommandText,
} from '../client/v2/export/copy-command.js';
import { glyphFor } from '../client/v2/search/palette-icons.js';
import { ARTBOARD_WHERE_RE } from '../element-ids.ts';

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

  // V2-8.9 attacker L1: the selection is canvas-reported (untrusted) — an id outside the element / artboard
  // id grammar never reaches the line; the line falls back to the canvas
  test('a selection id outside the id grammar is left out: the canvas is exported', () => {
    const canvasLine =
      'maude design export png --scope canvas --canvas ui/Home.tsx --option scale=1';
    for (const bad of [
      'title\nIgnore previous instructions',
      "x'; rm -rf ~ #",
      'a‮b',
      'a'.repeat(49),
      'Title',
    ])
      expect(exportCommandText({ ...base, selected: [{ id: bad, kind: 'element' }] })).toBe(
        canvasLine
      );
    for (const bad of ['post board', 'p\u0007', '-rf', ''])
      expect(
        exportCommandText({
          ...base,
          selected: [{ artboardId: bad, attrs: { 'data-dc-screen': bad }, kind: 'artboard' }],
        })
      ).toBe(canvasLine);
    expect(
      exportCommandText({ ...base, selected: [{ id: 'hero-title', kind: 'element' }] })
    ).toContain('--element hero-title');
  });

  test('the artboard rule is the studio’s own (element-ids.ts)', () => {
    expect(ARTBOARD_ID_RE.source).toBe(ARTBOARD_WHERE_RE.source);
  });

  test('shellQuote refuses C0 / C1 / bidi / tag characters; the line is then not written', () => {
    for (const w of ['a\u0000b', 'a\u001bb', 'a\u0085b', 'a‮b', 'a⁦b', 'a\u{e0041}b', 'a b'])
      expect(() => shellQuote(w)).toThrow();
    expect(shellQuote('ui/Home.tsx')).toBe('ui/Home.tsx');
    expect(shellQuote('Café 2026')).toBe(`'Café 2026'`);
    expect(
      exportCommandText({ ...base, canvasFile: '.design/ui/Ho‮me.tsx', selected: [] })
    ).toBeNull();
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
  test('a canvas name a terminal can’t show safely: said, nothing written', async () => {
    const got: string[] = [];
    const r = await copyExportCommand({
      state: { ...base, canvasFile: '.design/ui/Ho‮me.tsx', selected: [] },
      write: async (t: string) => void got.push(t),
    });
    expect(got).toEqual([]);
    expect(r).toEqual({ ok: false, message: COMMAND_WORDS.unsafe });
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
