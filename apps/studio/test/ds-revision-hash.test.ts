// S10.1 (V2-1.6 §5.6 / §5.7): design-system revisions are content-addressed. The id is the
// sha256 of the canonical body; every reader verifies it, and the CSS siblings are byte copies.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  buildRevision,
  canonicalJson,
  DsRevisionError,
  REVISION_MAX_BYTES,
  revisionId,
  revisionSiblings,
  revisionWritePlan,
  serializeRevision,
  sha256Hex,
  verifyRevision,
} from '../ds/revision.ts';
import { SCHEMA_DIR } from '../paths.ts';

const req = createRequire(import.meta.url);
const Ajv2020 = req('ajv/dist/2020.js').default;
const addFormats = req('ajv-formats');
const strict = (file: string) => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')));
};
const sha = (s: string) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

const DESIGN = join(import.meta.dir, '../../../.design');
const working = (ds: string) => {
  const read = (rel: string) => {
    try {
      return readFileSync(join(DESIGN, 'system', ds, rel), 'utf8');
    } catch {
      return null;
    }
  };
  const out: Record<string, string> = {};
  for (const rel of [
    'colors_and_type.css',
    'components.json',
    'preview/_components.css',
    'tokens.json',
  ]) {
    const t = read(rel);
    if (t !== null) out[rel] = t;
  }
  return out;
};

const FILES = {
  'colors_and_type.css': ':root { --accent: red; }\n',
  'preview/_components.css': '.btn { color: var(--accent); }\n',
  'tokens.json': '{}\n',
};

describe('canonical JSON (§5.6 hash rule)', () => {
  test('keys sorted by UTF-16 code unit at every depth, no whitespace, arrays in order', () => {
    expect(canonicalJson({ b: 1, a: [3, { z: 1, y: 'é' }], A: null })).toBe(
      '{"A":null,"a":[3,{"y":"é","z":1}],"b":1}'
    );
    // UTF-16 code-unit order, not code-point order: U+FF5E sorts after the U+1F600 surrogates.
    expect(canonicalJson({ '～': 1, '😀': 2, z: 3, é: 4 })).toBe('{"z":3,"é":4,"😀":2,"～":1}');
  });

  test('insertion order never changes the bytes', () => {
    const a = { x: { b: 2, a: 1 }, y: 'q' };
    const b = { y: 'q', x: { a: 1, b: 2 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  test('strings and numbers serialise exactly as JSON.stringify', () => {
    for (const v of ['a"b\\c\n ', 1.5, -0, 1e21, 0.1 + 0.2, '\u0000'])
      expect(canonicalJson(v)).toBe(JSON.stringify(v));
  });

  test('a value JSON cannot hold is refused, never silently dropped', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: () => 1 })).toThrow();
  });
});

describe('revision id and bytes', () => {
  test('id = lowercase hex sha256 of the UTF-8 canonical body', () => {
    const { id, body } = buildRevision('studio-site', FILES);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).toBe(sha(canonicalJson(body)));
    expect(revisionId(body)).toBe(id);
    expect(body.files['tokens.json'].sha256).toBe(sha('{}\n'));
    expect(sha256Hex('é')).toBe(sha('é'));
  });

  test('the same input gives the same id and the same bytes twice; key order is irrelevant', () => {
    const a = buildRevision('studio-site', FILES);
    const reversed = Object.fromEntries(Object.entries(FILES).reverse());
    const b = buildRevision('studio-site', reversed);
    expect(b.id).toBe(a.id);
    expect(b.bytes).toBe(a.bytes);
  });

  test('one changed byte in one file changes the id', () => {
    const a = buildRevision('studio-site', FILES);
    const b = buildRevision('studio-site', {
      ...FILES,
      'colors_and_type.css': ':root { --accent: rex; }\n',
    });
    expect(b.id).not.toBe(a.id);
  });

  test('on-disk bytes: sorted keys, 2-space indent, LF, one trailing newline', () => {
    const { bytes, body } = buildRevision('studio-site', FILES);
    expect(bytes).toBe(`${JSON.stringify(JSON.parse(canonicalJson(body)), null, 2)}\n`);
    expect(bytes).toBe(serializeRevision(body));
    expect(bytes.endsWith('}\n')).toBe(true);
    expect(bytes.endsWith('\n\n')).toBe(false);
    expect(bytes).not.toContain('\r');
    expect(bytes.indexOf('"files"')).toBeLessThan(bytes.indexOf('"format"'));
  });

  test('the body carries no time, author, parent or message', () => {
    const { body } = buildRevision('studio-site', FILES);
    expect(Object.keys(body).sort()).toEqual(['files', 'format', 'schemaVersion', 'system', 'v']);
  });

  test('a bad system name or file key is refused at build', () => {
    expect(() => buildRevision('Studio Site', FILES)).toThrow(DsRevisionError);
    expect(() => buildRevision('s', { '../x.css': 'a' })).toThrow(DsRevisionError);
    expect(() => buildRevision('s', { '/abs.css': 'a' })).toThrow(DsRevisionError);
    expect(() => buildRevision('s', {})).toThrow(DsRevisionError);
  });

  test('> 2 MiB is refused with 413 and code ds-revision-too-large', () => {
    expect(REVISION_MAX_BYTES).toBe(2 * 1024 * 1024);
    let err: unknown = null;
    try {
      buildRevision('s', { 'colors_and_type.css': 'x'.repeat(REVISION_MAX_BYTES) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DsRevisionError);
    expect((err as DsRevisionError).code).toBe('ds-revision-too-large');
    expect((err as DsRevisionError).status).toBe(413);
    // just under the cap is fine
    const room = REVISION_MAX_BYTES - buildRevision('s', { 'a.css': '' }).bytes.length;
    expect(() => buildRevision('s', { 'a.css': 'x'.repeat(room) })).not.toThrow();
    expect(() => buildRevision('s', { 'a.css': 'x'.repeat(room + 1) })).toThrow(DsRevisionError);
  });
});

describe('integrity (every reader, every time)', () => {
  const { id, bytes } = buildRevision('studio-site', FILES);

  test('a good revision verifies', () => {
    const r = verifyRevision(id, bytes);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.files['tokens.json'].text).toBe('{}\n');
  });

  test('pretty-printing differences do not matter; the canonical body does', () => {
    const doc = JSON.parse(bytes);
    expect(verifyRevision(id, JSON.stringify(doc)).ok).toBe(true);
  });

  test('a filename / id mismatch is invalid', () => {
    const other = `${id.slice(0, 63)}${id[63] === '0' ? '1' : '0'}`;
    expect(verifyRevision(other, bytes)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(verifyRevision('not-hex', bytes)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(verifyRevision(id.toUpperCase(), bytes)).toMatchObject({ ok: false, reason: 'invalid' });
  });

  test('a tampered text is invalid — with or without a fixed-up file sha', () => {
    const doc = JSON.parse(bytes);
    doc.files['colors_and_type.css'].text = ':root { --accent: blue; }\n';
    expect(verifyRevision(id, JSON.stringify(doc))).toMatchObject({ ok: false, reason: 'invalid' });
    // a fully re-hashed forgery has a different id, so it is invalid under the old name
    doc.files['colors_and_type.css'].sha256 = sha(doc.files['colors_and_type.css'].text);
    expect(verifyRevision(id, JSON.stringify(doc))).toMatchObject({ ok: false, reason: 'invalid' });
    // and a forgery whose id matches but whose per-file sha lies is invalid too
    doc.files['colors_and_type.css'].sha256 = '0'.repeat(64);
    const forgedId = sha(canonicalJson(doc));
    expect(verifyRevision(forgedId, JSON.stringify(doc))).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  test('an unknown v is unreadable (fall back), not invalid', () => {
    const doc = JSON.parse(bytes);
    doc.v = 2;
    doc.extra = { future: true };
    const fid = sha(canonicalJson(doc));
    expect(verifyRevision(fid, JSON.stringify(doc))).toMatchObject({
      ok: false,
      reason: 'unreadable',
    });
  });

  test('a v1 file with an unknown key, a null file or a bad key is invalid', () => {
    for (const mutate of [
      (d: Record<string, unknown>) => {
        d.message = 'hi';
      },
      (d: Record<string, unknown>) => {
        (d.files as Record<string, unknown>)['tokens.json'] = null;
      },
      (d: Record<string, unknown>) => {
        (d.files as Record<string, unknown>)['../x.css'] = { sha256: sha(''), text: '' };
      },
      (d: Record<string, unknown>) => {
        d.format = 'maude.ds-head';
      },
      (d: Record<string, unknown>) => {
        d.files = {};
      },
    ]) {
      const doc = JSON.parse(bytes);
      mutate(doc);
      const fid = sha(canonicalJson(doc));
      expect(verifyRevision(fid, JSON.stringify(doc))).toMatchObject({
        ok: false,
        reason: 'invalid',
      });
    }
  });

  test('not JSON, or over the cap, is invalid', () => {
    expect(verifyRevision(id, '{')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(verifyRevision(id, ' '.repeat(REVISION_MAX_BYTES + 1))).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('siblings and the write plan', () => {
  const rev = buildRevision('studio-site', FILES);

  test('siblings are the tokens and components texts, byte for byte', () => {
    const s = revisionSiblings(rev.id, rev.body);
    expect(s).toEqual([
      { path: `revisions/${rev.id}.tokens.css`, text: FILES['colors_and_type.css'] },
      { path: `revisions/${rev.id}.components.css`, text: FILES['preview/_components.css'] },
    ]);
  });

  test('the tokens key follows tokensCssRel; a missing components file has no sibling', () => {
    const r = buildRevision('s', { 'tokens/main.css': ':root{}\n' });
    expect(revisionSiblings(r.id, r.body, 'tokens/main.css')).toEqual([
      { path: `revisions/${r.id}.tokens.css`, text: ':root{}\n' },
    ]);
  });

  test('write order: revision, siblings, working files; head.json is not in the plan', () => {
    const plan = revisionWritePlan(() => null, rev, FILES);
    expect(plan.map((w) => w.path)).toEqual([
      `revisions/${rev.id}.json`,
      `revisions/${rev.id}.tokens.css`,
      `revisions/${rev.id}.components.css`,
      'colors_and_type.css',
      'preview/_components.css',
      'tokens.json',
    ]);
    expect(plan[0].text).toBe(rev.bytes);
  });

  test('an empty publish writes 0 bytes', () => {
    const disk: Record<string, string> = { ...FILES };
    for (const w of revisionWritePlan(() => null, rev, FILES)) disk[w.path] = w.text;
    const read = (p: string) => (Object.hasOwn(disk, p) ? disk[p] : null);
    const again = buildRevision('studio-site', FILES);
    expect(revisionWritePlan(read, again, FILES)).toEqual([]);
  });

  test('a mismatched sibling is rewritten; an existing valid revision file is never rewritten', () => {
    const disk: Record<string, string> = { ...FILES };
    for (const w of revisionWritePlan(() => null, rev, FILES)) disk[w.path] = w.text;
    disk[`revisions/${rev.id}.tokens.css`] = 'tampered';
    disk[`revisions/${rev.id}.json`] = JSON.stringify(JSON.parse(rev.bytes)); // valid, other bytes
    const read = (p: string) => (Object.hasOwn(disk, p) ? disk[p] : null);
    expect(revisionWritePlan(read, rev, FILES)).toEqual([
      { path: `revisions/${rev.id}.tokens.css`, text: FILES['colors_and_type.css'] },
    ]);
  });

  test('an existing INVALID file under the id refuses the plan (never repaired)', () => {
    const read = (p: string) => (p === `revisions/${rev.id}.json` ? '{"x":1}' : null);
    expect(() => revisionWritePlan(read, rev, FILES)).toThrow(DsRevisionError);
  });
});

describe('real systems (maude, maude-v2)', () => {
  for (const ds of ['maude', 'maude-v2']) {
    test(`${ds}: deterministic, verifies, siblings equal the working CSS`, () => {
      const files = working(ds);
      const a = buildRevision(ds, files);
      const b = buildRevision(ds, working(ds));
      expect(b.id).toBe(a.id);
      expect(b.bytes).toBe(a.bytes);
      expect(verifyRevision(a.id, a.bytes).ok).toBe(true);
      const sib = revisionSiblings(a.id, a.body);
      expect(sib[0].text).toBe(files['colors_and_type.css']);
      expect(sib[1]?.text).toBe(files['preview/_components.css']);
      expect(Buffer.byteLength(a.bytes)).toBeLessThan(REVISION_MAX_BYTES);
    });
  }
});

describe('schemas', () => {
  test('ds-revision-v1.schema.json compiles strict; a built revision validates', () => {
    const v = strict('ds-revision-v1.schema.json');
    expect(v(JSON.parse(buildRevision('studio-site', FILES).bytes))).toBe(true);
    expect(v(JSON.parse(buildRevision('maude-v2', working('maude-v2')).bytes))).toBe(true);
    const bad = JSON.parse(buildRevision('studio-site', FILES).bytes);
    bad.at = '2026-10-09T10:00:00Z';
    expect(v(bad)).toBe(false);
  });

  const head = {
    format: 'maude.ds-head',
    v: 1,
    system: 'studio-site',
    head: 'a'.repeat(64),
    base: 'a'.repeat(64),
    drafts: [
      {
        rev: 'b'.repeat(64),
        label: 'Warm paper',
        direction: 'b',
        by: { kind: 'ai' },
        at: '2026-10-09T10:00:00Z',
      },
    ],
    log: [
      {
        rev: 'a'.repeat(64),
        parent: 'c'.repeat(64),
        action: 'publish',
        at: '2026-10-09T10:02:00Z',
        by: { kind: 'person', name: 'Michal' },
        summary: 'Accent → Deeper azure',
        updated: 4,
        leftOut: 1,
      },
    ],
    library: null,
  };

  test('ds-head-v1.schema.json compiles strict; the §5.7 example validates', () => {
    expect(strict('ds-head-v1.schema.json')(head)).toBe(true);
  });

  test('head.json is additive (R1): unknown keys are allowed at every level', () => {
    const v = strict('ds-head-v1.schema.json');
    const later = structuredClone(head) as Record<string, unknown> & typeof head;
    (later as Record<string, unknown>).pending = { from: 'v1.1' };
    (later.log[0] as Record<string, unknown>).note = 'x';
    (later.drafts[0] as Record<string, unknown>).thumb = 'y';
    expect(v(later)).toBe(true);
  });

  test('head.json: head may be null only as a value; ids are 64 hex; action / by.kind are closed', () => {
    const v = strict('ds-head-v1.schema.json');
    expect(v({ ...head, head: null })).toBe(true);
    expect(v({ ...head, head: 'xyz' })).toBe(false);
    expect(v({ ...head, v: 2 })).toBe(false);
    expect(v({ ...head, log: [{ ...head.log[0], action: 'delete' }] })).toBe(false);
    expect(v({ ...head, log: [{ ...head.log[0], by: { kind: 'robot' } }] })).toBe(false);
    expect(v({ ...head, log: Array.from({ length: 51 }, () => head.log[0]) })).toBe(false);
  });
});
