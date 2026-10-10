// V2-1.2 §7 T2 — the dgn table's per-message validators: fuzzing never throws, junk gives null,
// unknown keys are stripped, strings are capped at 4 000 and arrays at 10 000.

import { describe, expect, test } from 'bun:test';
import { DGN_TABLE, MAX_ARR, MAX_STR } from '../bridge/dgn-protocol.ts';

type Spec = { parse: (raw: Record<string, unknown>) => unknown };
const ALL: Array<[string, Spec]> = [
  ...Object.entries(DGN_TABLE.c2s as Record<string, Spec>),
  ...Object.entries(DGN_TABLE.s2c as Record<string, Spec>),
];

// A small deterministic PRNG so a failure reproduces.
let seed = 0x2a10;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const KEYS = [
  'id',
  'file',
  'tool',
  'mode',
  'seq',
  'insets',
  'selection',
  'tree',
  'payload',
  'v',
  'x',
];
function junk(depth = 0): unknown {
  const r = rnd();
  if (r < 0.1) return null;
  if (r < 0.15) return undefined;
  if (r < 0.25) return rnd() * 1e6 - 5e5;
  if (r < 0.3) return [Number.NaN, Number.POSITIVE_INFINITY, -0][Math.floor(rnd() * 3)];
  if (r < 0.4) return 'x'.repeat(Math.floor(rnd() * 20));
  if (r < 0.45) return rnd() < 0.5;
  if (r < 0.5) return () => 1;
  if (r < 0.55) return Symbol('s');
  if (depth > 3) return 1;
  if (r < 0.75) return Array.from({ length: Math.floor(rnd() * 4) }, () => junk(depth + 1));
  const o: Record<string, unknown> = {};
  for (let i = Math.floor(rnd() * 5); i > 0; i--)
    o[KEYS[Math.floor(rnd() * KEYS.length)]] = junk(depth + 1);
  return o;
}

describe('dgn validators (T2)', () => {
  test('fuzzing every validator never throws and yields an object or null', () => {
    for (const [type, spec] of ALL) {
      for (let i = 0; i < 300; i++) {
        const raw = junk() as Record<string, unknown>;
        let out: unknown;
        try {
          out = spec.parse(raw);
        } catch (err) {
          throw new Error(`${type} threw on ${String(raw)}: ${String(err)}`);
        }
        expect(out === null || (typeof out === 'object' && !Array.isArray(out))).toBe(true);
      }
    }
  });

  test('a non-object raw message is junk for every row', () => {
    for (const [, spec] of ALL) {
      for (const raw of [null, 'x', 3, [], [1]]) expect(spec.parse(raw as never)).toBeNull();
    }
  });

  test('valid payloads pass, and unknown keys are stripped', () => {
    const ok: Array<[string, Record<string, unknown>]> = [
      ['loaded', { file: '.design/ui/A.tsx' }],
      ['select-set', { selection: null }],
      ['select-set', { selection: [{ id: 'a' }, { id: 'b' }] }],
      [
        'apply-edit',
        { requestId: 'r1', op: 'css', canvas: 'ui/A.tsx', id: 'h', key: 'color', value: 'red' },
      ],
      ['resize-request', { id: 'h', patch: { width: '10px' }, idIndex: 0 }],
      ['insert-request', { refId: 'h', position: 'after', kind: 'text' }],
      ['key', { v: 1, chord: '⌘K' }],
      ['tool-cursor', { tool: 'hand' }],
      ['mode-request', { mode: 'back', cause: 'esc' }],
      ['select-by-id', { id: 'h', artboardId: 'main', index: 0 }],
      ['view-chrome', { minimap: true }],
      ['run-action', { v: 1, id: 'edit.undo' }],
      ['export-result', { id: 'e', ok: true, jobId: 'j' }],
      [
        'set-mode',
        {
          v: 2,
          seq: 1,
          mode: 'preview',
          present: null,
          tool: 'browse',
          caps: { edit: false, annotate: false, comment: true },
        },
      ],
      ['occluded-insets', { seq: 3, insets: { top: 64, right: 360.4, bottom: 88, left: 320 } }],
      ['present-step', { to: 'next' }],
      ['force-clear', {}],
    ];
    for (const [type, raw] of ok) {
      const spec =
        (DGN_TABLE.c2s as Record<string, Spec>)[type] ??
        (DGN_TABLE.s2c as Record<string, Spec>)[type];
      const out = spec.parse({
        ...raw,
        dgn: type,
        evil: '<script>',
        __proto__: { polluted: 1 },
      } as never) as Record<string, unknown> | null;
      expect(out, type).not.toBeNull();
      expect(
        Object.keys(out ?? {}).every((k) => k in raw),
        type
      ).toBe(true);
      expect(out && 'evil' in out).toBe(false);
      expect(out && 'dgn' in out).toBe(false);
    }
    const ins = DGN_TABLE.s2c['occluded-insets'].parse({
      seq: 1,
      insets: { top: 1.6, right: 0, bottom: 0, left: 0 },
    });
    expect(ins?.insets).toEqual({ top: 2, right: 0, bottom: 0, left: 0 }); // clampInsets rounds
  });

  test('wrong types, bad enums and missing required keys give null', () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['loaded', {}],
      ['loaded', { file: 3 }],
      ['key', { v: 2, chord: '⌘K' }],
      ['reorder-revert', { seq: 1, dir: 'sideways' }],
      [
        'set-mode',
        {
          v: 2,
          seq: 1,
          mode: 'zen',
          present: null,
          caps: { edit: true, annotate: true, comment: true },
        },
      ],
      [
        'set-mode',
        {
          v: 2,
          seq: 1,
          mode: 'edit',
          present: null,
          tool: 'laser',
          caps: { edit: true, annotate: true, comment: true },
        },
      ],
      ['occluded-insets', { seq: 1, insets: { top: -1, right: 0, bottom: 0, left: 0 } }],
      ['occluded-insets', { seq: 1, insets: { top: 1e9, right: 0, bottom: 0, left: 0 } }],
      ['occluded-insets', { seq: Number.NaN, insets: { top: 0, right: 0, bottom: 0, left: 0 } }],
      ['resize-request', { id: 'h', patch: { width: 10 } }],
      ['select-by-id', { id: { toString: () => 'h' } }],
    ];
    for (const [type, raw] of bad) {
      const spec =
        (DGN_TABLE.c2s as Record<string, Spec>)[type] ??
        (DGN_TABLE.s2c as Record<string, Spec>)[type];
      expect(spec.parse(raw), `${type} ${JSON.stringify(raw)}`).toBeNull();
    }
  });

  test('strings are capped at 4 000 and arrays at 10 000, at any depth', () => {
    const s2c = DGN_TABLE.s2c;
    const c2s = DGN_TABLE.c2s;
    expect(s2c['op-toast'].parse({ message: 'x'.repeat(MAX_STR) })).not.toBeNull();
    expect(s2c['op-toast'].parse({ message: 'x'.repeat(MAX_STR + 1) })).toBeNull();
    expect(s2c['locked-set'].parse({ locked: Array(MAX_ARR).fill('k') })).not.toBeNull();
    expect(s2c['locked-set'].parse({ locked: Array(MAX_ARR + 1).fill('k') })).toBeNull();
    // opaque payloads: the caps apply inside them too
    expect(
      c2s['layers-tree'].parse({ artboardId: 'a', tree: [{ label: 'x'.repeat(MAX_STR + 1) }] })
    ).toBeNull();
    expect(
      c2s['comment-submit'].parse({ payload: { list: Array(MAX_ARR + 1).fill(0) } })
    ).toBeNull();
    let deep: Record<string, unknown> = {};
    const top = deep;
    for (let i = 0; i < 40; i++) {
      const next: Record<string, unknown> = {};
      deep.c = next;
      deep = next;
    }
    expect(c2s['comment-submit'].parse({ payload: top })).toBeNull();
  });
});
