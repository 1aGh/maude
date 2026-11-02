// S7.16 (07 · ve-long) — ruler markers ("Výkop", "TD 1") are part of the cut: `artboardMeta[id].markers`, written
// through `PATCH /_api/present-meta`, read back through `/_api/canvas-meta` (the agent's door). Strict for our writers
// (integer frame ≥ 0, plain-text name ≤ 60, ≤ 200, one per frame), tolerant for whatever a peer wrote, and a 1.x save
// keeps them. Roles: test/present-meta-route.test.ts (a view/comment role is refused, an edit role writes).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import {
  applyArtboardMetaPatch,
  parseArtboardMetaPatch,
  readArtboardVideoMeta,
} from '../kinds/meta.ts';
import {
  applyPresentPatch,
  MAX_MARKER_NAME,
  MAX_MARKERS,
  parsePresentPatch,
  readMarkers,
} from '../present/meta-schema.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const FILE = '.design/ui/Zapas.tsx';
const body = (markers: unknown) => ({ file: FILE, markers });

describe('the strict writer', () => {
  test('a list is accepted, sorted by frame, copied', () => {
    const r = parsePresentPatch(
      body({
        zapas: [
          { frame: 1320, name: 'TD 1' },
          { frame: 420, name: 'Výkop' },
        ],
      })
    );
    expect(r).toEqual({
      ok: true,
      patch: {
        file: FILE,
        markers: {
          zapas: [
            { frame: 420, name: 'Výkop' },
            { frame: 1320, name: 'TD 1' },
          ],
        },
      },
    });
  });

  test('null and [] take the markers away', () => {
    expect(parsePresentPatch(body({ zapas: null }))).toMatchObject({ ok: true });
    const cur = { artboardMeta: { zapas: { poster: 3, markers: [{ frame: 1, name: 'a' }] } } };
    for (const v of [null, []]) {
      const p = parsePresentPatch(body({ zapas: v }));
      if (!p.ok) throw new Error('parse');
      const r = applyPresentPatch(cur, p.patch, new Set(['zapas']));
      if (!r.ok) throw new Error('apply');
      expect(r.next.artboardMeta).toEqual({ zapas: { poster: 3 } });
    }
  });

  test('what is refused, and where', () => {
    const bad = (m: unknown, field: string, error = 'bad-field') =>
      expect(parsePresentPatch(body({ zapas: m }))).toEqual({ ok: false, error, field });
    bad({ frame: 1, name: 'x' }, 'markers.zapas'); // not a list
    bad([{ frame: 1.5, name: 'x' }], 'markers.zapas.0.frame');
    bad([{ frame: -1, name: 'x' }], 'markers.zapas.0.frame');
    bad([{ frame: '5', name: 'x' }], 'markers.zapas.0.frame');
    bad(
      [
        { frame: 5, name: 'a' },
        { frame: 5, name: 'b' },
      ],
      'markers.zapas.1.frame'
    ); // one per frame
    bad([{ frame: 5, name: 'x'.repeat(MAX_MARKER_NAME + 1) }], 'markers.zapas.0.name');
    bad([{ frame: 5, name: 'line\nbreak' }], 'markers.zapas.0.name'); // plain text
    bad([{ frame: 5, name: '<b>TD</b>' }], 'markers.zapas.0.name');
    bad([{ frame: 5, name: 7 }], 'markers.zapas.0.name');
    bad([{ frame: 5, name: 'x', colour: 'red' }], 'markers.zapas.0.colour', 'unknown-key');
    bad(
      Array.from({ length: MAX_MARKERS + 1 }, (_, i) => ({ frame: i, name: 'm' })),
      'markers.zapas'
    );
    expect(parsePresentPatch(body({ 'bad id': [] }))).toMatchObject({ ok: false });
    expect(
      parsePresentPatch(
        body({ zapas: Array.from({ length: MAX_MARKERS }, (_, i) => ({ frame: i, name: '' })) })
      )
    ).toMatchObject({ ok: true }); // the cap itself is fine
  });

  test('an artboard the canvas does not have is refused; every other key stays where it was', () => {
    const cur = {
      title: 'Zápas',
      layout: { artboards: [{ id: 'zapas', x: 0, y: 0 }] },
      artboardMeta: { zapas: { poster: 3, notes: 'n', futureKey: { a: 1 } } },
      newerPeerKey: [1, 2],
    };
    const p = parsePresentPatch(body({ zapas: [{ frame: 9, name: 'Výkop' }] }));
    if (!p.ok) throw new Error('parse');
    expect(applyPresentPatch(cur, p.patch, new Set(['other']))).toMatchObject({
      ok: false,
      error: 'unknown-artboard',
    });
    const r = applyPresentPatch(cur, p.patch, new Set(['zapas']));
    if (!r.ok) throw new Error('apply');
    expect(r.next).toEqual({
      ...cur,
      artboardMeta: {
        zapas: { ...cur.artboardMeta.zapas, markers: [{ frame: 9, name: 'Výkop' }] },
      },
    });
    expect(cur.artboardMeta.zapas).not.toHaveProperty('markers'); // the input is never mutated
  });
});

describe('the tolerant reader', () => {
  test('a peer’s half-bad list draws what it can; order by frame; capped', () => {
    const meta = {
      artboardMeta: {
        zapas: {
          markers: [
            { frame: 90, name: 'b' },
            { frame: 30, name: 'a' },
            { frame: -4, name: 'neg' },
            { frame: 2.5, name: 'frac' },
            { frame: 60, name: '<script>' },
            { frame: 30, name: 'dup wins' },
            'nope',
            null,
          ],
        },
        other: { markers: 'not a list' },
        'bad id': { markers: [{ frame: 1, name: 'x' }] },
      },
    };
    expect(readMarkers(meta)).toEqual({
      zapas: [
        { frame: 30, name: 'dup wins' },
        { frame: 90, name: 'b' },
      ],
    });
    expect(readMarkers(null)).toEqual({});
    expect(readMarkers({ artboardMeta: 7 })).toEqual({});
    const many = {
      artboardMeta: {
        z: { markers: Array.from({ length: 300 }, (_, i) => ({ frame: i, name: 'm' })) },
      },
    };
    expect(readMarkers(many).z).toHaveLength(MAX_MARKERS);
  });

  test('kinds/meta.ts reads the same, writes the same, and refuses the same', () => {
    const meta = {
      artboardMeta: {
        zapas: { markers: [{ frame: 9, name: 'a' }, { frame: 1, name: 'b' }, { frame: 2 }] },
      },
    };
    expect(readArtboardVideoMeta(meta, 'zapas').markers).toEqual([
      { frame: 1, name: 'b' },
      { frame: 9, name: 'a' },
    ]);
    expect(
      parseArtboardMetaPatch({ zapas: { markers: [{ frame: 1, name: 'a', x: 1 }] } })
    ).toMatchObject({
      ok: false,
      field: 'zapas.markers',
    });
    const p = parseArtboardMetaPatch({ zapas: { markers: [{ frame: 1, name: 'a' }] } });
    if (!p.ok) throw new Error('parse');
    const r = applyArtboardMetaPatch(
      { title: 'Z', artboardMeta: { zapas: { poster: 2 } } },
      p.patch,
      new Set(['zapas'])
    );
    if (!r.ok) throw new Error('apply');
    expect(r.next.artboardMeta).toEqual({
      zapas: { poster: 2, markers: [{ frame: 1, name: 'a' }] },
    });
  });
});

// ── over the real route ──────────────────────────────────────────────────────────────────────────────
const SOURCE = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Zapas() {
  return (
    <DesignCanvas>
      <DCArtboard id="zapas" label="Zápas" width={400} height={300}><main /></DCArtboard>
    </DesignCanvas>
  );
}
`;
const META = {
  title: 'Zápas',
  layout: { artboards: [{ id: 'zapas', x: 0, y: 0 }] },
  critic: { score: 4 },
  artboardMeta: { zapas: { poster: 3, futureKey: 'kept' } },
};
const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

describe('PATCH /_api/present-meta markers', () => {
  let base = '';
  let metaAbs = '';
  beforeAll(async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Zapas.tsx'), SOURCE);
    metaAbs = join(designRoot, 'ui', 'Zapas.meta.json');
    writeFileSync(metaAbs, `${JSON.stringify(META, null, 2)}\n`);
    const port = nextPort();
    procs.push(await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' }));
    base = `http://localhost:${port}`;
  });
  const patch = (b: unknown) =>
    fetch(`${base}/_api/present-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
  const onDisk = () => JSON.parse(readFileSync(metaAbs, 'utf8')) as Record<string, unknown>;
  const LIST = [
    { frame: 1320, name: 'TD 1' },
    { frame: 420, name: 'Výkop' },
  ];

  test('written next to the poster, answered back, and the agent reads them from canvas-meta', async () => {
    const res = await patch(body({ zapas: LIST }));
    expect(res.status).toBe(200);
    const sorted = [LIST[1], LIST[0]];
    expect(await res.json()).toMatchObject({
      ok: true,
      markers: { zapas: sorted },
      poster: { zapas: 3 },
    });
    expect(onDisk().artboardMeta).toEqual({
      zapas: { poster: 3, futureKey: 'kept', markers: sorted },
    });
    const read = await (
      await fetch(`${base}/_api/canvas-meta?file=${encodeURIComponent(FILE)}`)
    ).json();
    expect(
      (read as { artboardMeta: { zapas: { markers: unknown } } }).artboardMeta.zapas.markers
    ).toEqual(sorted);
  });

  test('a bad marker is a 400 with the field, and nothing is written', async () => {
    const before = readFileSync(metaAbs, 'utf8');
    for (const [bad, field] of [
      [[{ frame: 1.5, name: 'x' }], 'markers.zapas.0.frame'],
      [[{ frame: 1, name: '<i>' }], 'markers.zapas.0.name'],
      [[{ frame: 1, name: 'x'.repeat(61) }], 'markers.zapas.0.name'],
    ] as const) {
      const res = await patch(body({ zapas: bad }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad-field', field });
    }
    expect((await patch(body({ ghost: LIST }))).status).toBe(422);
    expect(readFileSync(metaAbs, 'utf8')).toBe(before);
  });

  test('a 1.x save (v1 layout drag through /_api/canvas-meta) keeps the markers and every unknown key', async () => {
    const before = onDisk();
    const drag = await fetch(`${base}/_api/canvas-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: FILE,
        patch: { layout: { artboards: [{ id: 'zapas', x: 40, y: 0 }] } },
      }),
    });
    expect(drag.status).toBe(200);
    const m = onDisk();
    expect(m.layout).toEqual({ artboards: [{ id: 'zapas', x: 40, y: 0 }] });
    expect(m.artboardMeta).toEqual(before.artboardMeta);
    expect(m.critic).toEqual(META.critic);
  });

  test('null takes them away and leaves the rest of the entry', async () => {
    const res = await patch(body({ zapas: null }));
    expect(res.status).toBe(200);
    expect(onDisk().artboardMeta).toEqual({ zapas: { poster: 3, futureKey: 'kept' } });
  });
});
