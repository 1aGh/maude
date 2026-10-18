// S8.8 — an artboard's export sizes in the versioned meta: `artboardMeta[id].exports`
// (decision maude/v2-S8-artboard-export-presets-in-meta; V2-1.12 R6).
//
//   - present/meta-schema.ts: the `exports` member of PATCH /_api/present-meta — strict for our writer,
//     tolerant of a peer's, and in agreement with schema/canvas-meta.v2.schema.json;
//   - the route: the write, the read after a reload (GET /_api/canvas-meta), and probe H — a v1
//     `/_api/canvas-meta` layout write keeps the sizes;
//   - the registry: ⇧⌘C (export.copy-png) is bound once per layer.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { ACTIONS } from '../actions/index.ts';
import { validateMeta } from '../check/meta.ts';
import {
  applyPresentPatch,
  type PresentPatch,
  parsePresentPatch,
  readExportPresets,
} from '../present/meta-schema.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const FILE = '.design/ui/Deck.tsx';
const KNOWN = new Set(['a', 'b', 'c']);
const patchOf = (body: Record<string, unknown>): PresentPatch => {
  const r = parsePresentPatch({ file: FILE, ...body });
  if (!r.ok) throw new Error(`${r.error} ${r.field}`);
  return r.patch;
};
const apply = (current: Record<string, unknown>, body: Record<string, unknown>, known = KNOWN) => {
  const r = applyPresentPatch(current, patchOf(body), known);
  if (!r.ok) throw new Error(`${r.error} ${r.ids}`);
  return r;
};

describe('parsePresentPatch — the exports member, exactly', () => {
  test('sizes parse: raster with a scale, svg without', () => {
    const r = parsePresentPatch({
      file: FILE,
      exports: { a: [{ format: 'png', scale: 2 }, { format: 'svg' }], b: null },
    });
    expect(r).toEqual({
      ok: true,
      patch: {
        file: FILE,
        exports: { a: [{ format: 'png', scale: 2 }, { format: 'svg' }], b: null },
      },
    });
  });

  test('bad sizes are refused, never trimmed', () => {
    const bad = (exportsBody: unknown) => {
      const r = parsePresentPatch({ file: FILE, exports: exportsBody });
      expect(r.ok).toBe(false);
      return r.ok ? '' : r.field;
    };
    expect(bad([])).toBe('exports');
    expect(bad({ 'not an id!': [{ format: 'png', scale: 1 }] })).toBe('exports');
    expect(bad({ a: 'png' })).toBe('exports.a');
    expect(bad({ a: [{ format: 'pdf' }] })).toBe('exports.a.0.format');
    expect(bad({ a: [{ format: 'png', scale: 9 }] })).toBe('exports.a.0.scale');
    expect(bad({ a: [{ format: 'png', scale: 0.1 }] })).toBe('exports.a.0.scale');
    expect(bad({ a: [{ format: 'png', scale: 'big' }] })).toBe('exports.a.0.scale');
    expect(bad({ a: [{ format: 'png', scale: 1, dpi: 300 }] })).toBe('exports.a.0.dpi');
    const nine = Array.from({ length: 9 }, () => ({ format: 'png', scale: 1 }));
    expect(bad({ a: nine })).toBe('exports.a');
  });
});

describe('applyPresentPatch — exports', () => {
  const base = () => ({
    title: 'Deck',
    artboardMeta: { a: { notes: 'Opening', poster: 3 } },
  });

  test('writes artboardMeta[id].exports and keeps every other field of the entry', () => {
    const r = apply(base(), {
      exports: { a: [{ format: 'png', scale: 2 }], b: [{ format: 'svg' }] },
    });
    expect(r.next.artboardMeta).toEqual({
      a: { notes: 'Opening', poster: 3, exports: [{ format: 'png', scale: 2 }] },
      b: { exports: [{ format: 'svg' }] },
    });
    expect(r.next.title).toBe('Deck');
    expect(r.changed).toBe(true);
  });

  test('null or an empty list takes the sizes back to the kind’s default; an empty entry goes', () => {
    const stored = apply(base(), { exports: { b: [{ format: 'png', scale: 1 }] } }).next;
    const r = apply(stored, { exports: { b: null, a: [] } });
    expect(r.next.artboardMeta).toEqual({ a: { notes: 'Opening', poster: 3 } });
    const none = apply({ title: 'Deck' }, { exports: { a: null } });
    expect(none.changed).toBe(false);
  });

  test('an id that is not an artboard of the canvas is refused; removing one is not', () => {
    const r = applyPresentPatch(
      {},
      patchOf({ exports: { zzz: [{ format: 'png', scale: 1 }] } }),
      KNOWN
    );
    expect(r).toEqual({ ok: false, error: 'unknown-artboard', ids: ['zzz'] });
    const gone = applyPresentPatch(
      { artboardMeta: { zzz: { exports: [{ format: 'png', scale: 1 }] } } },
      patchOf({ exports: { zzz: null } }),
      KNOWN
    );
    expect(gone.ok).toBe(true);
  });

  test('what it writes passes the canvas-meta v2 schema (strict reading)', () => {
    const r = apply(base(), {
      exports: {
        a: [
          { format: 'png', scale: 2 },
          { format: 'jpg', scale: 1 },
        ],
      },
    });
    expect(validateMeta(r.next, null)).toEqual([]);
  });
});

describe('readExportPresets — tolerant of any writer', () => {
  test('absent is the kind’s default; a malformed member is dropped, never thrown on', () => {
    expect(readExportPresets(null)).toEqual({});
    expect(readExportPresets({ artboardMeta: { a: { exports: 'x' } } })).toEqual({});
    expect(
      readExportPresets({
        artboardMeta: {
          a: {
            exports: [
              { format: 'png', scale: 2 },
              { format: 'tiff', scale: 1 },
              { format: 'jpg', scale: 99 },
              { format: 'svg', extra: true },
              7,
            ],
          },
          'bad id!': { exports: [{ format: 'png', scale: 1 }] },
        },
      })
    ).toEqual({ a: [{ format: 'png', scale: 2 }, { format: 'svg' }] });
  });
});

describe('PATCH /_api/present-meta { exports } on a local studio', () => {
  const SOURCE = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Deck() {
  return (
    <DesignCanvas>
      <DCArtboard id="a" label="One" width={400} height={300}><main /></DCArtboard>
      <DCArtboard id="b" label="Two" width={400} height={300}><main /></DCArtboard>
    </DesignCanvas>
  );
}
`;
  const META = {
    title: 'Deck',
    layout: { artboards: [{ id: 'a', x: 0, y: 0 }] },
    critic: { score: 4 },
    artboardMeta: { a: { poster: 3 } },
  };
  const procs: Subprocess[] = [];
  let base = '';
  let metaAbs = '';
  beforeAll(async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Deck.tsx'), SOURCE);
    metaAbs = join(designRoot, 'ui', 'Deck.meta.json');
    writeFileSync(metaAbs, `${JSON.stringify(META, null, 2)}\n`);
    const port = nextPort();
    procs.push(await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' }));
    base = `http://localhost:${port}`;
  });
  afterAll(async () => {
    for (const p of procs) await killProc(p);
  });
  const onDisk = () => JSON.parse(readFileSync(metaAbs, 'utf8')) as Record<string, unknown>;
  const patch = (body: unknown) =>
    fetch(`${base}/_api/present-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const reload = async () =>
    (await (await fetch(`${base}/_api/canvas-meta?file=${encodeURIComponent(FILE)}`)).json()) as {
      artboardMeta?: Record<string, { exports?: unknown }>;
    };

  test('the sizes are stored per artboard and come back after a reload', async () => {
    const res = await patch({
      file: FILE,
      exports: {
        a: [
          { format: 'png', scale: 1 },
          { format: 'jpg', scale: 2 },
        ],
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exports: unknown };
    expect(body.exports).toEqual({
      a: [
        { format: 'png', scale: 1 },
        { format: 'jpg', scale: 2 },
      ],
    });
    expect(onDisk().artboardMeta).toEqual({
      a: {
        poster: 3,
        exports: [
          { format: 'png', scale: 1 },
          { format: 'jpg', scale: 2 },
        ],
      },
    });
    // a fresh GET — what the inspector reads when it mounts again
    expect((await reload()).artboardMeta?.a?.exports).toEqual([
      { format: 'png', scale: 1 },
      { format: 'jpg', scale: 2 },
    ]);
    // and an empty-body PATCH reads them too (the sheet's way)
    expect(((await (await patch({ file: FILE })).json()) as { exports: unknown }).exports).toEqual({
      a: [
        { format: 'png', scale: 1 },
        { format: 'jpg', scale: 2 },
      ],
    });
  });

  test('probe H: a v1 layout write through /_api/canvas-meta keeps the sizes and every other key', async () => {
    const before = onDisk();
    const drag = await fetch(`${base}/_api/canvas-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: FILE,
        patch: { layout: { artboards: [{ id: 'a', x: 40, y: 0 }] } },
      }),
    });
    expect(drag.status).toBe(200);
    const m = onDisk();
    expect(m.artboardMeta).toEqual(before.artboardMeta);
    expect(m.critic).toEqual(META.critic);
    // the v1 route does not write them either (it ignores artboardMeta)
    const plant = await fetch(`${base}/_api/canvas-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: FILE, patch: { artboardMeta: { a: { exports: [] } } } }),
    });
    expect(plant.status).toBe(200);
    expect(onDisk().artboardMeta).toEqual(before.artboardMeta);
  });

  test('a bad size is a 400, an artboard that is not there a 422, and nothing is written', async () => {
    const before = readFileSync(metaAbs, 'utf8');
    const bad = await patch({ file: FILE, exports: { a: [{ format: 'pdf' }] } });
    expect(bad.status).toBe(400);
    const nope = await patch({ file: FILE, exports: { zzz: [{ format: 'png', scale: 1 }] } });
    expect(nope.status).toBe(422);
    expect(readFileSync(metaAbs, 'utf8')).toBe(before);
  });

  test('null takes an artboard back to the kind’s default', async () => {
    const res = await patch({ file: FILE, exports: { a: null } });
    expect(res.status).toBe(200);
    expect(onDisk().artboardMeta).toEqual({ a: { poster: 3 } });
    expect(((await res.json()) as { exports: unknown }).exports).toEqual({});
  });
});

describe('the registry — ⇧⌘C is Copy as PNG, once per layer', () => {
  test('export.copy-png: ⇧⌘C on the selection layer, reachable from the canvas', () => {
    const def = ACTIONS.find((a) => a.id === 'export.copy-png');
    expect(def).toBeTruthy();
    expect(def?.fromCanvas).toBe(true);
    expect(def?.keys?.[0]).toMatchObject({ chord: '⇧⌘C', layer: 'selection' });
  });

  test('no other action takes ⇧⌘C on the same layer', () => {
    const seen = new Map<string, string[]>();
    for (const a of ACTIONS)
      for (const k of a.keys ?? []) {
        if (k.chord !== '⇧⌘C') continue;
        seen.set(k.layer, [...(seen.get(k.layer) ?? []), a.id]);
      }
    for (const [layer, ids] of seen) expect({ layer, ids: ids.length }).toEqual({ layer, ids: 1 });
  });
});
