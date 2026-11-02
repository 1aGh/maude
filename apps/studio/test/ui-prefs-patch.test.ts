// validateUiPrefsPatch — the /_api/ui-prefs body whitelist, lifted out of http.ts (V2-2.7).
//
// Two jobs: (1) every message and status the route gave for the seven 1.x fields is unchanged, so the
// lift is behaviour-neutral for 1.x clients; (2) the v2 homes (version, pin, fold, seen, canvases,
// panelsHidden, migratedFrom) are accepted only in their exact shape, and writeUiPrefs merges them
// without touching what it was not given.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { uiPrefsPath, validateUiPrefsPatch, writeUiPrefs } from '../ui-prefs.ts';

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

describe('the seven 1.x fields keep their exact messages', () => {
  test('accepts a well-formed 1.x body and passes only the known keys through', () => {
    const body = {
      theme: 'light',
      minimap: true,
      zoom: false,
      annotations: true,
      autoOpenInspector: false,
      layersMode: 'in-inspector',
      panelSides: { tree: 'right' },
      somethingElse: 'ignored',
    };
    const { somethingElse: _x, ...expected } = body;
    expect(ok(body)).toEqual(expected);
  });

  test('every rejection is the text the route used to send', () => {
    expect(bad({ theme: 'neon' })).toBe('theme must be light|dark');
    for (const k of ['minimap', 'zoom', 'annotations', 'autoOpenInspector']) {
      expect(bad({ [k]: 'yes' })).toBe(`${k} must be a boolean`);
    }
    expect(bad({ layersMode: 'tabs' })).toBe('layersMode must be separate|in-inspector');
    expect(bad({ panelSides: 'left' })).toBe('panelSides must be an object');
    expect(bad({ panelSides: [] })).toBe('panelSides must be an object');
    expect(bad({ panelSides: null })).toBe('panelSides must be an object');
    expect(bad({ panelSides: { tree: 'middle' } })).toBe('panelSides values must be left|right');
  });

  test('an empty body is an empty patch', () => {
    expect(ok({})).toEqual({});
  });
});

describe('the v2 homes', () => {
  test('accepts the exact shapes the migration posts', () => {
    const body = {
      version: 2,
      migratedFrom: 1,
      pin: { on: false, widths: { left: 300, right: 480 } },
      fold: { 'inspector.advanced': true, 'canvases.advanced': false },
      seen: { 'v2-tour': true },
      canvases: { showHidden: true },
      panelsHidden: false,
    };
    expect(ok(body)).toEqual(body);
  });

  test.each([
    [{ version: 0 }, /version/],
    [{ version: 3 }, /version/],
    [{ version: '2' }, /version/],
    [{ version: 1.5 }, /version/],
    [{ migratedFrom: 2 }, /migratedFrom/],
    [{ migratedFrom: 0 }, /migratedFrom/],
    [{ pin: 'on' }, /pin/],
    [{ pin: { on: 'yes' } }, /pin\.on/],
    [{ pin: { widths: { left: -1 } } }, /pin\.widths\.left/],
    [{ pin: { widths: { right: 99999 } } }, /pin\.widths\.right/],
    [{ pin: { widths: { left: Number.NaN } } }, /pin\.widths\.left/],
    [{ pin: { widths: { middle: 5 } } }, /pin\.widths/],
    [{ pin: { surprise: 1 } }, /pin/],
    [{ fold: [] }, /fold/],
    [{ fold: { 'a b': true } }, /fold/],
    [{ fold: { ok: 'yes' } }, /fold/],
    [{ fold: { '': true } }, /fold/],
    [{ seen: { 'v2-tour': false } }, /seen/],
    [{ seen: { 'v2-tour': 1 } }, /seen/],
    [{ canvases: { showHidden: 1 } }, /canvases\.showHidden/],
    [{ canvases: { other: true } }, /canvases/],
    [{ panelsHidden: 'no' }, /panelsHidden/],
  ])('rejects %j', (body, msg) => {
    expect(bad(body as Record<string, unknown>)).toMatch(msg as RegExp);
  });

  test('refuses prototype keys and more than 256 entries in a map', () => {
    expect(bad(JSON.parse('{"fold":{"__proto__":true}}'))).toMatch(/fold/);
    const big: Record<string, boolean> = {};
    for (let i = 0; i < 257; i++) big[`f${i}`] = true;
    expect(bad({ fold: big })).toMatch(/fold/);
  });
});

describe('writeUiPrefs merges the v2 homes', () => {
  let dir: string;
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.MAUDE_UI_PREFS_PATH;
    dir = mkdtempSync(join(tmpdir(), 'ui-prefs-patch-'));
    process.env.MAUDE_UI_PREFS_PATH = join(dir, 'prefs.json');
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.MAUDE_UI_PREFS_PATH;
    else process.env.MAUDE_UI_PREFS_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  });
  const disk = () => JSON.parse(readFileSync(uiPrefsPath(), 'utf8'));

  test('fold, seen and canvases merge key by key; pin merges down into widths', () => {
    writeUiPrefs(
      ok({
        fold: { a: true },
        seen: { t1: true },
        canvases: { showHidden: true },
        pin: { on: true, widths: { left: 300 } },
      })
    );
    writeUiPrefs(ok({ fold: { b: true }, seen: { t2: true }, pin: { widths: { right: 400 } } }));
    const d = disk();
    expect(d.fold).toEqual({ a: true, b: true });
    expect(d.seen).toEqual({ t1: true, t2: true });
    expect(d.canvases).toEqual({ showHidden: true });
    expect(d.pin).toEqual({ on: true, widths: { left: 300, right: 400 } });
  });

  test('a fold can be closed again (false) without losing its siblings', () => {
    writeUiPrefs(ok({ fold: { a: true, b: true } }));
    writeUiPrefs(ok({ fold: { a: false } }));
    expect(disk().fold).toEqual({ a: false, b: true });
  });

  test('version only moves forward', () => {
    writeUiPrefs(ok({ version: 2 }));
    writeUiPrefs(ok({ version: 1 }));
    expect(disk().version).toBe(2);
  });

  test('a 1.x style patch leaves every v2 field alone', () => {
    writeUiPrefs(ok({ version: 2, fold: { a: true }, pin: { on: true } }));
    writeUiPrefs(ok({ theme: 'light' }));
    const d = disk();
    expect(d.theme).toBe('light');
    expect(d.version).toBe(2);
    expect(d.fold).toEqual({ a: true });
    expect(d.pin).toEqual({ on: true });
  });
});
