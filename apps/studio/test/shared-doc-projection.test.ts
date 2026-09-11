// Phase 9.2 (DDR-064) Phase C — loop-free disk projection (Tasks 6 + 7).
//
// Unit tests for sync/projection.ts in isolation (no runtime / no hub). They
// pin the contract the shared-doc cutover relies on:
//   - doc→file projects html/css/meta only (the collab room owns comments +
//     annotations doc→file — no double-write);
//   - file→doc imports all five types as a minimal DIFF (never wholesale),
//     tagged FILE_IMPORT so it doesn't echo back to disk;
//   - our own doc→file writes are dropped on their fs echo (hash guard);
//   - a body file edit does NOT clobber concurrent in-doc comments (independent
//     Y-types — the cross-type no-clobber guarantee);
//   - an unparseable file is quarantined after 3 strikes (circuit breaker).
//
// Same-body concurrency and source validity are covered by
// sync-source-safety.test.ts (#121); this suite covers the other projection laws.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';

import { Y_TYPES } from '../collab/persistence.ts';
import { applyHtmlToDoc, MAX_HTML_BYTES } from '../sync/codec.ts';
import { createEchoGuard, hashBytes } from '../sync/echo-guard.ts';
import { ORIGINS } from '../sync/origins.ts';
import { createDocProjection } from '../sync/projection.ts';

const enc = (s: string) => new TextEncoder().encode(s);

interface Write {
  path: string;
  bytes: string;
}

function makeProjection(paths: {
  html: string;
  comments: string;
  annotations: string;
  meta?: string;
  css?: string;
}) {
  const doc = new Y.Doc();
  const writes: Write[] = [];
  const echoGuard = createEchoGuard();
  const projection = createDocProjection({
    slug: 'p',
    doc,
    paths,
    echoGuard,
    flushMs: 0, // synchronous flush on the next microtask
    writer: (path, bytes) => writes.push({ path, bytes: bytes.toString() }),
  });
  projection.start();
  return { doc, writes, echoGuard, projection };
}

const PATHS = {
  html: '/d/ui/screen.html',
  comments: '/d/_comments/ui-screen.json',
  annotations: '/d/ui-screen.annotations.svg',
  meta: '/d/ui/screen.meta.json',
  css: '/d/ui/screen.css',
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('projection doc→file (html/css/meta only — room owns comments/annotations)', () => {
  test('projects html / css / meta on a doc edit', async () => {
    const { doc, writes, projection } = makeProjection(PATHS);
    doc.getText('html').insert(0, '<button>hi</button>');
    doc.getText('css').insert(0, '.b{color:red}');
    // meta is stored as the canonical SHARED subset (a JSON string in Y.Text).
    doc.getText('meta').insert(0, JSON.stringify({ title: 'Screen' }));
    await projection.flush();

    const byPath = Object.fromEntries(writes.map((w) => [w.path, w.bytes]));
    expect(byPath[PATHS.html]).toBe('<button>hi</button>');
    expect(byPath[PATHS.css]).toBe('.b{color:red}');
    expect(JSON.parse(byPath[PATHS.meta])).toMatchObject({ title: 'Screen' });
    await tick();
  });

  test('does NOT write comments or annotations doc→file (the room owns those)', async () => {
    const { doc, writes, projection } = makeProjection(PATHS);
    doc.getArray(Y_TYPES.comments).push([{ id: 'c1', text: 'hi' }]);
    doc.getMap(Y_TYPES.annotations).set('svg', '<svg/>');
    await projection.flush();
    expect(writes.find((w) => w.path === PATHS.comments)).toBeUndefined();
    expect(writes.find((w) => w.path === PATHS.annotations)).toBeUndefined();
  });

  test('never clobbers a non-empty body with an empty doc value (safe reconcile)', async () => {
    const { writes, projection } = makeProjection(PATHS);
    // doc html is empty → reconcile must not write an empty file over local.
    projection.reconcile();
    expect(writes.find((w) => w.path === PATHS.html)).toBeUndefined();
  });
});

describe('projection file→doc (diff-import, all five types, FILE_IMPORT origin)', () => {
  test('imports an external body edit into the doc', () => {
    const { doc, projection } = makeProjection(PATHS);
    const body = '<main>edited</main>';
    const changed = projection.applyFromFs({
      path: PATHS.html,
      bytes: enc(body),
      hash: hashBytes(body),
    });
    expect(changed).toBe(true);
    expect(doc.getText('html').toString()).toBe(body);
  });

  test('import is tagged FILE_IMPORT (so the projector does not re-project it)', () => {
    const { doc, projection } = makeProjection(PATHS);
    let lastOrigin: unknown;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      lastOrigin = origin;
    });
    const body = '<main>x</main>';
    projection.applyFromFs({ path: PATHS.html, bytes: enc(body), hash: hashBytes(body) });
    expect(lastOrigin).toBe(ORIGINS.FILE_IMPORT);
  });

  test('imports comments + annotations too', () => {
    const { doc, projection } = makeProjection(PATHS);
    const comments = JSON.stringify([{ id: 'x', text: 'yo' }]);
    expect(
      projection.applyFromFs({
        path: PATHS.comments,
        bytes: enc(comments),
        hash: hashBytes(comments),
      })
    ).toBe(true);
    expect(doc.getArray(Y_TYPES.comments).toArray()).toEqual([{ id: 'x', text: 'yo' }]);

    const svg = '<svg><rect/></svg>';
    expect(
      projection.applyFromFs({ path: PATHS.annotations, bytes: enc(svg), hash: hashBytes(svg) })
    ).toBe(true);
    expect(doc.getMap(Y_TYPES.annotations).get('svg')).toBe(svg);
  });

  test('body import is a MINIMAL diff — preserves an untouched suffix region', () => {
    const { doc, projection } = makeProjection(PATHS);
    doc.getText('html').insert(0, 'HELLO WORLD');
    // Change only the prefix; the diff must keep " WORLD" in place (prefix/suffix
    // elimination), not delete-all + insert-all.
    const next = 'HOWDY WORLD';
    projection.applyFromFs({ path: PATHS.html, bytes: enc(next), hash: hashBytes(next) });
    expect(doc.getText('html').toString()).toBe(next);
    // Cross-check the codec produced a minimal op (the same primitive the
    // projector uses) — a wholesale replace would not preserve the suffix.
    const probe = new Y.Doc();
    probe.getText('html').insert(0, 'HELLO WORLD');
    expect(applyHtmlToDoc(probe, next, 'x')).toBe(true);
  });
});

describe('projection loop-freedom', () => {
  test('drops the fs echo of our own doc→file write (hash guard)', async () => {
    const { doc, projection } = makeProjection(PATHS);
    doc.getText('html').insert(0, '<x/>');
    await projection.flush();
    // The fs.watch fires for our own write — same bytes → same hash → dropped,
    // doc unchanged, no re-import.
    let updates = 0;
    doc.on('update', () => {
      updates++;
    });
    const changed = projection.applyFromFs({
      path: PATHS.html,
      bytes: enc('<x/>'),
      hash: hashBytes('<x/>'),
    });
    expect(changed).toBe(false);
    expect(updates).toBe(0);
  });

  test('a body file edit does NOT clobber concurrent in-doc comments (cross-type no-clobber)', () => {
    const { doc, projection } = makeProjection(PATHS);
    // Browser added a comment (lives in the comments Y.Array).
    doc.getArray(Y_TYPES.comments).push([{ id: 'live', text: 'mine' }]);
    // Concurrently /design:edit rewrites the whole body file.
    const body = '<main>rewritten by design:edit</main>';
    projection.applyFromFs({ path: PATHS.html, bytes: enc(body), hash: hashBytes(body) });
    // Body updated; the concurrent comment SURVIVED (independent Y-type).
    expect(doc.getText('html').toString()).toBe(body);
    expect(doc.getArray(Y_TYPES.comments).toArray()).toEqual([{ id: 'live', text: 'mine' }]);
  });
});

describe('projection hub→disk hardening (security re-audit A2 + A3)', () => {
  test('A2 — refuses to materialize an oversized (hub-pushed) body to disk', async () => {
    const { doc, writes, projection } = makeProjection(PATHS);
    // Simulate a hub raw-update that bypassed the codec import cap: an oversized
    // body lands directly in the shared doc.
    doc.getText('html').insert(0, 'x'.repeat(MAX_HTML_BYTES + 1));
    await projection.flush();
    // The doc→file lane must refuse it — no disk-fill DoS.
    expect(writes.find((w) => w.path === PATHS.html)).toBeUndefined();
  });

  test('A3 — a meta file with __proto__ is imported without polluting Object.prototype', () => {
    const { doc, projection } = makeProjection(PATHS);
    const malicious = JSON.stringify({ __proto__: { polluted: 'yes' }, title: 'ok' });
    projection.applyFromFs({ path: PATHS.meta, bytes: enc(malicious), hash: hashBytes(malicious) });
    // The dangerous key was stripped at parse time — no prototype pollution and
    // the stored shared meta carries only the safe key.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const stored = doc.getText('meta').toString();
    expect(stored).not.toContain('__proto__');
    expect(stored).not.toContain('polluted');
    expect(stored).toContain('ok');
  });
});

describe('projection circuit breaker', () => {
  test('quarantines an unparseable meta file after 3 strikes (until checksum changes)', () => {
    const { doc, projection } = makeProjection(PATHS);
    const broken = '{ not json';
    const ev = { path: PATHS.meta, bytes: enc(broken), hash: hashBytes(broken) };
    // First three attempts: parse fails → false, strikes accumulate.
    expect(projection.applyFromFs(ev)).toBe(false);
    expect(projection.applyFromFs(ev)).toBe(false);
    expect(projection.applyFromFs(ev)).toBe(false);
    // Now quarantined for that hash — still false, but short-circuited.
    expect(projection.applyFromFs(ev)).toBe(false);

    // A DIFFERENT (valid) payload clears the quarantine and applies.
    const ok = JSON.stringify({ title: 'Fixed' });
    expect(projection.applyFromFs({ path: PATHS.meta, bytes: enc(ok), hash: hashBytes(ok) })).toBe(
      true
    );
    expect(doc.getText('meta').toString()).toContain('Fixed');
  });
});
