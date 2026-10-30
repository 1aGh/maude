// annotations-validate-strict.test.ts — contract V2-1.11 §5.2 / §7 (V2-2.4b): `validateBoard(text,
// {strict:true})` errors where the lenient loader drops or repairs; `strict:false` is parseBoard.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { migrateSvg } from '../annotations/migrate-v1.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import { validateBoard } from '../annotations/validate-board.ts';

const FIX = join(import.meta.dir, 'fixtures', 'annotations-v2');
const MIXED = serializeBoard(
  migrateSvg(readFileSync(join(FIX, 'mixed-200.v1.svg'), 'utf8')).elements
);

const doc = (elements: unknown[]) =>
  JSON.stringify({ format: 'maude.annotations', v: 2, elements });
const sticky = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'sticky',
  index: 'a0',
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  text: 'hi',
  author: { kind: 'ai' },
  ...extra,
});
const codes = (r: ReturnType<typeof validateBoard>) => r.errors.map((e) => e.code);

describe('validateBoard — lenient (the studio’s reads, older peers) is parseBoard', () => {
  test('same elements, drops as warnings, no errors — on a real 200-element board', () => {
    const planted = MIXED.replace(
      '"elements":[\n',
      '"elements":[\n{"id":"bad","type":"sticky"},\n'
    );
    for (const text of [MIXED, planted]) {
      const v = validateBoard(text);
      const p = parseBoard(text);
      expect(v.elements).toEqual(p.elements);
      expect(v.dropped).toEqual(p.dropped);
      expect(v.errors).toEqual([]);
      expect(v.warnings.length).toBe(p.dropped.length);
    }
  });
});

describe('validateBoard — strict (AI writes)', () => {
  test('a canonical board written over itself passes (nothing changed, nothing judged)', () => {
    expect(validateBoard(MIXED, { strict: true, against: MIXED }).errors).toEqual([]);
  });

  test('a clean AI-authored element passes', () => {
    expect(validateBoard(doc([sticky('s1')]), { strict: true, against: null }).errors).toEqual([]);
  });

  test('a lenient-loader drop is an error (missing required field)', () => {
    expect(codes(validateBoard(doc([{ id: 'x', type: 'sticky' }]), { strict: true }))).toContain(
      'board-drop'
    );
  });

  test('a value the loader silently repairs is an error (the loader keeps the element quietly)', () => {
    const bad = doc([sticky('s1', { fill: 'red', fontSize: 9000 })]);
    expect(parseBoard(bad).dropped).toEqual([]); // lenient: no report at all
    const r = validateBoard(bad, { strict: true });
    expect(codes(r)).toEqual(['invalid-value', 'invalid-value']);
    expect(r.errors.map((e) => e.field)).toEqual(['/fill', '/fontSize']);
  });

  test('unknown fields are errors — top level and nested', () => {
    const top = validateBoard(doc([sticky('s1', { colour: '#fff' })]), { strict: true });
    expect(codes(top)).toEqual(['unknown-field']);
    expect(top.errors[0]?.fix).toContain('sticky fields:');
    const nested = validateBoard(doc([sticky('s1', { author: { kind: 'ai', model: 'x' } })]), {
      strict: true,
    });
    expect(codes(nested)).toEqual(['unknown-field']);
    const docKey = validateBoard(
      JSON.stringify({ format: 'maude.annotations', v: 2, elements: [], x: 1 }),
      {
        strict: true,
      }
    );
    expect(codes(docKey)).toEqual(['unknown-field']);
  });

  test('an invalid order key is an error (the loader would re-index it)', () => {
    expect(codes(validateBoard(doc([sticky('s1', { index: 'a00' })]), { strict: true }))).toEqual([
      'index-invalid',
    ]);
  });

  test('creating an unknown type is an error; a newer peer’s untouched one is not', () => {
    const stamp = { id: 'v1', type: 'vote-stamp', index: 'a1', votes: 3 };
    expect(codes(validateBoard(doc([stamp]), { strict: true }))).toEqual([
      'unknown-type',
      'author-missing',
    ]);
    const before = doc([sticky('s1'), stamp]);
    const after = doc([sticky('s1', { text: 'edited' }), stamp]);
    expect(validateBoard(after, { strict: true, against: before }).errors).toEqual([]);
    const touched = doc([sticky('s1'), { ...stamp, votes: 4 }]);
    expect(codes(validateBoard(touched, { strict: true, against: before }))).toEqual([
      'unknown-type',
    ]);
  });

  test('peer compat: a newer peer’s extension field the AI left alone passes (V2-1.12 R5)', () => {
    // `laneHint` stands for a field from a format NEWER than this build.
    const peer = sticky('s1', { laneHint: 'hero' });
    const before = doc([peer, sticky('s2')]);
    const after = doc([{ ...peer, text: 'moved on' }, sticky('s2')]);
    expect(validateBoard(after, { strict: true, against: before }).errors).toEqual([]);
    const changed = doc([{ ...peer, laneHint: 'other' }, sticky('s2')]);
    expect(codes(validateBoard(changed, { strict: true, against: before }))).toEqual([
      'unknown-field',
    ]);
    // …and the lenient reader still keeps the field (it never drops it)
    expect(parseBoard(after).elements[0]?.laneHint).toBe('hero');
    // A format-2 field this build knows (S4.1) is a schema'd field, not an unknown one.
    const member = sticky('s1', { parentArtboard: 'hero' });
    const moved = doc([{ ...member, parentArtboard: 'other' }, sticky('s2')]);
    expect(
      validateBoard(moved, { strict: true, against: doc([member, sticky('s2')]) }).errors
    ).toEqual([]);
  });

  test('author is immutable; a new element is authored by AI', () => {
    const human = sticky('s1', { author: { kind: 'human', name: 'Tereza' } });
    const before = doc([human]);
    const r = validateBoard(doc([{ ...human, author: { kind: 'ai' } }]), {
      strict: true,
      against: before,
    });
    expect(codes(r)).toEqual(['author-changed']);
    const added = validateBoard(doc([human, sticky('s2', { author: undefined })]), {
      strict: true,
      against: before,
    });
    expect(codes(added)).toEqual(['author-missing']);
    // an AI can't claim a new element is a person's
    const claimed = validateBoard(
      doc([human, sticky('s3', { author: { kind: 'human', name: 'Tereza' } })]),
      { strict: true, against: before }
    );
    expect(codes(claimed)).toEqual(['author-missing']);
  });

  test('a locked element keeps every field but index/groups/locked, and stays', () => {
    const locked = sticky('s1', { locked: true });
    const before = doc([locked, sticky('s2')]);
    expect(
      codes(
        validateBoard(doc([{ ...locked, text: 'no' }, sticky('s2')]), {
          strict: true,
          against: before,
        })
      )
    ).toEqual(['locked-changed']);
    expect(
      validateBoard(doc([{ ...locked, index: 'a1' }, sticky('s2')]), {
        strict: true,
        against: before,
      }).errors
    ).toEqual([]);
    expect(codes(validateBoard(doc([sticky('s2')]), { strict: true, against: before }))).toEqual([
      'locked-deleted',
    ]);
    const unlocked = validateBoard(doc([{ ...locked, locked: false, text: 'ok' }, sticky('s2')]), {
      strict: true,
      against: before,
    });
    expect(unlocked.errors).toEqual([]);
    expect(unlocked.warnings.map((w) => w.code)).toEqual(['unlocked']);
  });

  test('a wrong `v` is an error; a non-board stays one drop (no pile-up)', () => {
    expect(
      codes(
        validateBoard(JSON.stringify({ format: 'maude.annotations', v: 1, elements: [] }), {
          strict: true,
        })
      )
    ).toEqual(['board-shape']);
    expect(codes(validateBoard('{"nope":1}', { strict: true }))).toEqual(['board-drop']);
  });

  test('budget: strict over a 5,000-element board stays inside the fast tier', () => {
    const many = doc(Array.from({ length: 5000 }, (_, i) => sticky(`s${i}`, { x: i })));
    const t0 = performance.now();
    const r = validateBoard(many, { strict: true, against: null });
    expect(r.errors).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(600);
  });
});

// S4.5 — the format-2 extension fields and types obey the same strict rules as every other field.
describe('validateBoard — strict, format-2 fields (S4.5)', () => {
  const NOW = '2026-10-18T10:00:00Z';
  const arrow = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'arrow',
    index: 'a0',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    author: { kind: 'ai' },
    ...extra,
  });

  test('a new AI sticky with resolved / parentArtboard / source / timeRange passes', () => {
    const el = sticky('s1', {
      resolved: { by: 'AI', at: NOW },
      parentArtboard: 'desktop',
      source: { kind: 'figjam', author: 'Klara' },
      timeRange: { artboard: 'clip', start: 1, end: 2 },
    });
    expect(validateBoard(doc([el]), { strict: true, against: null }).errors).toEqual([]);
  });

  test('a bound arrow end (startHost / endHost) passes; a magnet of one coordinate does not', () => {
    const ok = arrow('a1', { endHost: { ref: 'el:desktop/cta', label: 'Book a call' } });
    expect(validateBoard(doc([ok]), { strict: true, against: null }).errors).toEqual([]);
    const half = arrow('a1', { endHost: { ref: 'el:desktop/cta', label: 'x', nx: 0.5 } });
    expect(codes(validateBoard(doc([half]), { strict: true, against: null }))).toEqual([
      'invalid-value',
    ]);
  });

  test('an extension field on a type that does not carry it is unknown, and the fix names the ones it has', () => {
    const shape = {
      id: 'sh1',
      type: 'shape',
      index: 'a0',
      x: 0,
      y: 0,
      w: 100,
      h: 60,
      resolved: { by: 'AI', at: NOW },
      author: { kind: 'ai' },
    };
    const r = validateBoard(doc([shape]), { strict: true, against: null });
    expect(codes(r)).toEqual(['unknown-field']);
    expect(r.errors[0]?.fix).toContain('parentArtboard');
  });

  test('a made-up field next to the real extension fields is still an error', () => {
    const r = validateBoard(doc([sticky('s1', { resolvedBy: 'AI' })]), {
      strict: true,
      against: null,
    });
    expect(codes(r)).toEqual(['unknown-field']);
  });

  test('resolving a LOCKED sticky is an edit to a locked item', () => {
    const locked = sticky('s1', { locked: true });
    const r = validateBoard(doc([{ ...locked, resolved: { by: 'AI', at: NOW } }]), {
      strict: true,
      against: doc([locked]),
    });
    expect(codes(r)).toEqual(['locked-changed']);
    expect(r.errors[0]?.what).toContain('resolved');
  });

  test('the author of a resolved sticky is still immutable', () => {
    const before = sticky('s1', { author: { kind: 'human', name: 'Tereza' } });
    const r = validateBoard(
      doc([{ ...before, author: { kind: 'ai' }, resolved: { by: 'AI', at: NOW } }]),
      { strict: true, against: doc([before]) }
    );
    expect(codes(r)).toEqual(['author-changed']);
  });

  test('a new stamp is judged like any element (new → authored by AI)', () => {
    const stamp = {
      id: 'stamp-x',
      type: 'stamp',
      index: 'a0',
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      kind: 'plus-one',
    };
    expect(codes(validateBoard(doc([stamp]), { strict: true, against: null }))).toContain(
      'author-missing'
    );
  });
});
