// schema-drift.test.ts — contract V2-1.11 §5.2 / §7 (V2-2.4b): the format schemas equal their
// sources, follow the naming rule, and the zero-dep validator (cli/lib/json-schema-lite.mjs) the
// hooks and `maude design check` use gives Ajv 2020's verdict on every one of them.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import { compileSchema } from '../../../cli/lib/json-schema-lite.mjs';
import { annotationsJsonSchema, elementDefKey } from '../annotations/board-schema.ts';
import { migrateSvg } from '../annotations/migrate-v1.ts';
import { REGISTRY } from '../annotations/registry.ts';
import { serializeBoard } from '../annotations/schema.ts';
import { validateEdl } from '../footage/schema.ts';
import { FORMAT_SCHEMAS } from '../schema/formats.ts';

const STUDIO = join(import.meta.dir, '..');
const readJson = (rel: string) => JSON.parse(readFileSync(join(STUDIO, rel), 'utf8'));
const jsonRows = FORMAT_SCHEMAS.filter((f) => f.schema.endsWith('.json'));
const LITE_FORMATS = ['annotations', 'canvas-meta', 'edl', 'agent-handoff'];

const MIXED = JSON.parse(
  serializeBoard(
    migrateSvg(
      readFileSync(join(import.meta.dir, 'fixtures', 'annotations-v2', 'mixed-200.v1.svg'), 'utf8')
    ).elements
  )
);

function bothVerdicts(schema: object, ref: string | undefined, samples: unknown[]) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  if (ref) ajv.addSchema(schema, 's');
  const a = ajv.compile(ref ? { $ref: `s${ref}` } : schema);
  const l = compileSchema(schema, ref ? { ref } : {});
  return samples.map((s, i) => ({ i, ajv: a(s) === true, lite: l(s).length === 0 }));
}
const agree = (rows: { i: number; ajv: boolean; lite: boolean }[]) =>
  rows.filter((r) => r.ajv !== r.lite);

describe('generated schemas equal their TS source (gen-actions --check is the gate)', () => {
  test('annotations.v2.schema.json = annotationsJsonSchema()', () => {
    expect(readJson('schema/annotations.v2.schema.json')).toEqual(annotationsJsonSchema());
  });

  test('every built-in field declares what it accepts (no `{}` holes)', () => {
    const s = annotationsJsonSchema() as { $defs: Record<string, { properties: object }> };
    const holes: string[] = [];
    for (const t of REGISTRY.keys())
      for (const [k, v] of Object.entries(s.$defs[elementDefKey(t)]?.properties ?? {}))
        if (!v || Object.keys(v).length === 0) holes.push(`${t}.${k}`);
    expect(holes).toEqual([]);
  });

  test('a canonical board (the loader’s own output) is valid under the strict schema', () => {
    const r = bothVerdicts(annotationsJsonSchema(), undefined, [MIXED]);
    expect(r).toEqual([{ i: 0, ajv: true, lite: true }]);
  });
});

describe('naming (§5.2): <name>.vN.schema.json ⇔ $id https://maude.sh/schema/<name>/vN', () => {
  test('every format row points at a file whose $id is the one it names', () => {
    for (const f of jsonRows) {
      const s = readJson(f.schema);
      expect({ format: f.format, id: s.$id ?? null }).toEqual({
        format: f.format,
        id: f.id ?? null,
      });
      const m = /^(.+)\.v(\d+)\.schema\.json$/.exec(basename(f.schema));
      if (m) expect(s.$id).toBe(`https://maude.sh/schema/${m[1]}/v${m[2]}`);
    }
  });

  test('every JSON schema compiles under Ajv 2020; the lite ones compile under the lite validator', () => {
    for (const f of jsonRows) {
      const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
      expect(() => ajv.compile(readJson(f.schema))).not.toThrow();
      if (LITE_FORMATS.includes(f.format))
        expect(() => compileSchema(readJson(f.schema))).not.toThrow();
    }
  });
});

describe('json-schema-lite gives Ajv’s verdict', () => {
  test('fails closed on a keyword it does not implement, and on a remote $ref', () => {
    expect(() => compileSchema({ if: { type: 'string' } })).toThrow(/unsupported keyword "if"/);
    expect(() => compileSchema({ $ref: 'https://example.com/x' })).toThrow(/local \$ref/);
  });

  test('every supported keyword, one schema at a time', () => {
    const cases: [object, unknown[]][] = [
      [{ oneOf: [{ type: 'number' }, { type: 'integer' }] }, [1, 1.5, 'x']],
      [{ anyOf: [{ type: 'string' }, { type: 'null' }] }, ['a', null, 1]],
      [{ not: { pattern: '^/' } }, ['a/b', '/a', 3]],
      [
        { type: 'array', uniqueItems: true, minItems: 1, maxItems: 2 },
        [[1], [1, 1], [], [1, 2, 3], [{ a: 1 }, { a: 1 }]],
      ],
      [
        { type: 'object', propertyNames: { pattern: '^--' }, maxProperties: 1, minProperties: 1 },
        [{ '--a': 1 }, { a: 1 }, {}, { '--a': 1, '--b': 2 }],
      ],
      [{ type: 'number', minimum: 0, maximum: 1, exclusiveMinimum: 0 }, [0, 0.5, 1, 1.1]],
      [{ type: 'number', exclusiveMaximum: 1 }, [0.99, 1]],
      [{ type: 'integer' }, [1, 1.5, '1']],
      [{ const: { a: [1] } }, [{ a: [1] }, { a: [2] }]],
      [{ enum: ['a', null] }, ['a', null, 'b']],
      [{ type: 'string', minLength: 2, maxLength: 3 }, ['a', 'ab', 'abcd', '👍👍']],
      [
        {
          type: 'object',
          required: ['a'],
          properties: { a: { type: 'string' } },
          additionalProperties: { type: 'number' },
        },
        [{ a: 'x', b: 1 }, { a: 'x', b: 'y' }, { b: 1 }],
      ],
      [{ allOf: [{ type: 'string' }, { maxLength: 1 }] }, ['a', 'ab']],
      [
        { $defs: { n: { type: 'number' } }, items: { $ref: '#/$defs/n' }, type: 'array' },
        [
          [1, 2],
          [1, 'x'],
        ],
      ],
    ];
    for (const [schema, samples] of cases)
      expect(agree(bothVerdicts(schema, undefined, samples))).toEqual([]);
  });

  test('annotations: valid elements and planted faults', () => {
    const el = MIXED.elements as Record<string, unknown>[];
    const sticky = el.find((e) => e.type === 'sticky') ?? {
      id: 'a',
      type: 'sticky',
      index: 'a0',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    };
    const arrow = el.find((e) => e.type === 'arrow');
    const docs = [
      MIXED,
      { ...MIXED, v: 1 },
      { ...MIXED, extra: true },
      { format: 'maude.annotations', v: 2, elements: [{ ...sticky, colour: '#fff' }] },
      { format: 'maude.annotations', v: 2, elements: [{ ...sticky, fill: 'red' }] },
      { format: 'maude.annotations', v: 2, elements: [{ ...sticky, author: { kind: 'robot' } }] },
      { format: 'maude.annotations', v: 2, elements: [{ ...sticky, x: 2e6 }] },
      { format: 'maude.annotations', v: 2, elements: [{ ...sticky, groups: ['g', 'g'] }] },
      {
        format: 'maude.annotations',
        v: 2,
        elements: [{ id: 'u', type: 'vote-stamp', index: 'a0', any: 1 }],
      },
      { format: 'maude.annotations', v: 2, elements: [{ id: 'u', type: 'Bad Type', index: 'a0' }] },
      ...(arrow
        ? [
            {
              format: 'maude.annotations',
              v: 2,
              elements: [{ ...arrow, start: { el: 'x', nx: 2 } }],
            },
            { format: 'maude.annotations', v: 2, elements: [{ ...arrow, start: { x: 1 } }] },
          ]
        : []),
    ];
    const rows = bothVerdicts(annotationsJsonSchema(), undefined, docs);
    expect(agree(rows)).toEqual([]);
    expect(rows.map((r) => r.ajv)).toEqual(docs.map((_, i) => i === 0 || i === 8));
  });

  test('canvas-meta v2', () => {
    const s = readJson('schema/canvas-meta.v2.schema.json');
    const ok = {
      title: 'Deck',
      sections: [
        { id: 'main', title: 'Main', artboards: [{ id: 'hero', width: 1280, height: 820 }] },
      ],
      present: { order: ['hero'] },
      artboardMeta: { hero: { maxFrames: 5400, madeBy: { kind: 'ai' } } },
      dsPairing: { '--a': '--b' },
    };
    const docs = [
      ok,
      { ...ok, viewport: { x: 0, y: 0, zoom: 1 } },
      { ...ok, formatVersion: 2 },
      { ...ok, present: { order: ['hero', 'hero'] } },
      { ...ok, artboardMeta: { 'bad id!': {} } },
      { ...ok, artboardMeta: { hero: { maxFrames: 18001 } } },
      { ...ok, dsPairing: { a: '--b' } },
      { ...ok, kind: 'video-comp' },
      { subtitle: 'x' },
    ];
    const rows = bothVerdicts(s, undefined, docs);
    expect(agree(rows)).toEqual([]);
    expect(rows.map((r) => r.ajv)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  test('agent-handoff/1 (both roles)', () => {
    const s = readJson('../../cli/lib/handoff.schema.json');
    const inDoc = {
      contract: 'maude.agent-handoff/1',
      role: 'in',
      runId: 'r_abcd1234',
      agent: 'design:design-critic',
      task: 'review',
      owns: ['.design/_runs/r_abcd1234/handoff/design-critic-0.out.json'],
      output: '.design/_runs/r_abcd1234/handoff/design-critic-0.out.json',
    };
    const ins = [
      inDoc,
      { ...inDoc, owns: [] },
      { ...inDoc, output: '../x' },
      { ...inDoc, context: { x: 1 } },
      { ...inDoc, n: 64 },
    ];
    const r1 = bothVerdicts(s, '#/$defs/in', ins);
    expect(agree(r1)).toEqual([]);
    expect(r1.map((r) => r.ajv)).toEqual([true, false, false, false, false]);
    const outDoc = {
      contract: 'maude.agent-handoff/1',
      role: 'out',
      agent: 'design:design-critic',
      status: 'done',
      summary: 'ok',
      changed: [{ file: '.design/x.tsx', kind: 'edit' }],
      decisions: [],
      findings: [{ severity: 'blocker', what: 'contrast' }],
      open_questions: [],
    };
    const outs = [
      outDoc,
      { ...outDoc, status: 'maybe' },
      { ...outDoc, findings: [{ severity: 'info' }] },
      { ...outDoc, extra: 1 },
    ];
    const r2 = bothVerdicts(s, '#/$defs/out', outs);
    expect(agree(r2)).toEqual([]);
    expect(r2.map((r) => r.ajv)).toEqual([true, false, false, false]);
  });

  test('edl v1 — and the schema gives validateEdl’s verdict (the runtime source)', () => {
    const s = readJson('schema/edl.v1.schema.json');
    const ok = {
      version: 1,
      title: 'Recap',
      fps: 30,
      beats: [
        {
          clip: 'assets/0123abcd.mp4',
          startSec: 1.5,
          durationFrames: 45,
          transition: { presentation: 'fade', frames: 8 },
        },
        { clip: 'assets/0123abcd.mp4', overlay: { kind: 'title', text: 'Hi' }, transition: null },
      ],
      music: { asset: 'assets/89abcdef.mp3', fadeOutFrames: 30 },
      audioTracks: [{ asset: 'assets/89abcdef.mp3', kind: 'voiceover', gainDb: -6 }],
      captions: { cues: [{ startSec: 0, endSec: 1, text: 'Hi' }], style: 'top' },
    };
    const docs = [
      ok,
      { ...ok, extra: 1 },
      { ...ok, fps: 0 },
      { ...ok, beats: [{ startSec: 1 }] },
      { ...ok, beats: [{ clip: '/abs.mp4' }] },
      { ...ok, beats: [{ clip: 'assets/0123abcd.mp4', durationFrames: 1.5 }] },
      { ...ok, beats: [{ clip: 'assets/0123abcd.mp4', transition: { presentation: 'spin' } }] },
      { ...ok, music: { fadeOutFrames: 1 } },
      { ...ok, audioTracks: [{ asset: 'assets/89abcdef.mp3', kind: 'drums' }] },
      { ...ok, captions: { cues: [{ text: 'x', startSec: -1 }] } },
      { ...ok, captions: { style: 'top' } },
      { title: null, fps: null, music: null, captions: null, beats: null },
      [],
    ];
    const rows = bothVerdicts(s, undefined, docs);
    expect(agree(rows)).toEqual([]);
    const runtime = docs.map((d) => validateEdl(d).ok);
    expect(rows.map((r) => r.ajv)).toEqual(runtime);
    expect(runtime).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
  });
});
