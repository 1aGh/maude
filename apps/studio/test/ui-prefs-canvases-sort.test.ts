// S1.1 (shared) — `canvasesSort`: the Canvases panel's order, one entry per project id in the ui-prefs
// store (`~/.config/maude/prefs.json`). The body whitelist accepts only that exact shape, and a write
// merges the one project's entry in without touching another project's.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readUiPrefs, uiPrefsPath, validateUiPrefsPatch, writeUiPrefs } from '../ui-prefs.ts';

const A = 'l0123456789abcdef';
const B = 'lfedcba9876543210';
const ok = (body: Record<string, unknown>) => {
  const r = validateUiPrefsPatch(body);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.patch;
};
const bad = (body: Record<string, unknown>) => {
  const r = validateUiPrefsPatch(body);
  if (r.ok) throw new Error(`expected a rejection, got patch ${JSON.stringify(r.patch)}`);
  return r.error;
};

let dir = '';
const saved = process.env.MAUDE_UI_PREFS_PATH;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maude-canvases-sort-'));
  process.env.MAUDE_UI_PREFS_PATH = join(dir, 'prefs.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) Reflect.deleteProperty(process.env, 'MAUDE_UI_PREFS_PATH');
  else process.env.MAUDE_UI_PREFS_PATH = saved;
});

describe('the body whitelist', () => {
  test('accepts { <project id>: { by, foldersOnTop } } and passes it through', () => {
    const body = { canvasesSort: { [A]: { by: 'name', foldersOnTop: false } } };
    expect(ok(body)).toEqual(body);
  });

  test.each([
    [{ canvasesSort: [] }, /canvasesSort/],
    [{ canvasesSort: 'name' }, /canvasesSort/],
    [{ canvasesSort: { [A]: { by: 'colour', foldersOnTop: true } } }, /canvasesSort/],
    [{ canvasesSort: { [A]: { by: 'name', foldersOnTop: 'yes' } } }, /canvasesSort/],
    [{ canvasesSort: { [A]: { by: 'name', foldersOnTop: true, extra: 1 } } }, /canvasesSort/],
    [{ canvasesSort: { 'a b': { by: 'name', foldersOnTop: true } } }, /canvasesSort/],
    [{ canvasesSort: { [A]: null } }, /canvasesSort/],
  ])('refuses %j', (body, msg) => {
    expect(bad(body as Record<string, unknown>)).toMatch(msg as RegExp);
  });

  test('refuses prototype keys and a map past the cap', () => {
    expect(
      bad(JSON.parse('{"canvasesSort":{"__proto__":{"by":"name","foldersOnTop":true}}}'))
    ).toMatch(/canvasesSort/);
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) big[`p${i}`] = { by: 'name', foldersOnTop: true };
    expect(bad({ canvasesSort: big })).toMatch(/canvasesSort/);
  });
});

describe('the write', () => {
  test("one project's entry is merged in; another project's survives", () => {
    writeUiPrefs(ok({ canvasesSort: { [A]: { by: 'name', foldersOnTop: false } } }));
    writeUiPrefs(ok({ canvasesSort: { [B]: { by: 'kind', foldersOnTop: true } } }));
    expect(readUiPrefs().canvasesSort).toEqual({
      [A]: { by: 'name', foldersOnTop: false },
      [B]: { by: 'kind', foldersOnTop: true },
    });
    writeUiPrefs(ok({ canvasesSort: { [A]: { by: 'recent', foldersOnTop: true } } }));
    expect(readUiPrefs().canvasesSort).toEqual({
      [A]: { by: 'recent', foldersOnTop: true },
      [B]: { by: 'kind', foldersOnTop: true },
    });
  });

  test('writing it leaves the 1.x fields alone, and they survive a theme write', () => {
    writeUiPrefs({ theme: 'light' });
    writeUiPrefs(ok({ canvasesSort: { [A]: { by: 'name', foldersOnTop: true } } }));
    writeUiPrefs({ minimap: true });
    const disk = JSON.parse(readFileSync(uiPrefsPath(), 'utf8'));
    expect(disk.theme).toBe('light');
    expect(disk.minimap).toBe(true);
    expect(disk.canvasesSort[A]).toEqual({ by: 'name', foldersOnTop: true });
  });
});
