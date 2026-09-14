// Audit 2026-09-13 P0 #1 / plan T2 — a valid local save that was authored on
// an older base must not be imported as a whole-file replacement of a peer's
// newer body. The projection's baseline (`lastHtml`, the body disk and doc last
// agreed on) is the merge base: independent edits keep both authors' work, and
// anything the merge cannot prove independent is preserved and blocked — never
// imported over the peer, and never silently marked resolved.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as Y from 'yjs';

import { applyHtmlToDoc, htmlFromDoc } from '../sync/codec.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { loadJournal } from '../sync/journal.ts';
import { migrateSeed } from '../sync/migrate-seed.ts';
import { type BodyRejection, createDocProjection } from '../sync/projection.ts';
import { mergeSource } from '../sync/source-merge.ts';

const base = 'export default () => <div title="old" color="black"/>;\n';

describe('mergeSource', () => {
  test('independent edits on one line keep both', () => {
    const merged = mergeSource(
      base,
      base.replace('"black"', '"red"'),
      base.replace('"old"', '"new"')
    );
    expect(merged).toEqual({
      ok: true,
      merged: 'export default () => <div title="new" color="red"/>;\n',
    });
  });

  test('either side unchanged takes the other', () => {
    const other = base.replace('old', 'x');
    expect(mergeSource(base, base, other)).toEqual({ ok: true, merged: other });
    expect(mergeSource(base, other, base)).toEqual({ ok: true, merged: other });
  });

  test('the same edit on both sides is applied once', () => {
    const both = base.replace('"old"', '"new"');
    expect(mergeSource(base, both, both)).toEqual({ ok: true, merged: both });
  });

  test('edits to the same value, or touching ones, are not guessed at', () => {
    expect(mergeSource(base, base.replace('old', 'mine'), base.replace('old', 'theirs'))).toEqual({
      ok: false,
      reason: 'overlap',
    });
    // Touching: one side replaces the value, the other appends right after it.
    expect(mergeSource(base, base.replace('old"', 'old2"'), base.replace('old', 'new'))).toEqual({
      ok: false,
      reason: 'overlap',
    });
  });

  test('two insertions at one point are ambiguous in order', () => {
    const a = base.replace('/>', ' a="1"/>');
    const b = base.replace('/>', ' b="2"/>');
    expect(mergeSource(base, a, b)).toEqual({ ok: false, reason: 'overlap' });
  });
});

const dirs: string[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The audit's exact shape: base projected; a peer edit reaches the doc but
 *  not yet the disk (flush pending); the local editor saves from the old base. */
function staleSave(localBody: string, remoteBody: string, start = base) {
  const dir = mkdtempSync(join(tmpdir(), 'stale-import-'));
  dirs.push(dir);
  const file = join(dir, 'screen.tsx');
  writeFileSync(file, start);
  const doc = new Y.Doc();
  applyHtmlToDoc(doc, start);
  const conflicts: BodyRejection[] = [];
  let recovered = 0;
  const projection = createDocProjection({
    slug: 'screen',
    doc,
    paths: { html: file, comments: join(dir, 'c.json'), annotations: join(dir, 'a.svg') },
    historyDir: join(dir, 'history'),
    flushMs: 60_000,
    onConflict: (c) => conflicts.push(c),
    onRecovered: () => recovered++,
  });
  stops.push(
    () => projection.stop(),
    () => doc.destroy()
  );
  projection.start();
  projection.reconcile();
  applyHtmlToDoc(doc, remoteBody, { peer: 'B' });
  writeFileSync(file, localBody);
  const imported = projection.applyFromFs({
    path: file,
    bytes: Buffer.from(localBody),
    hash: hashBytes(localBody),
  });
  return { dir, file, doc, projection, conflicts, recovered: () => recovered, imported };
}

describe('a stale whole-file save against a newer peer body', () => {
  test('title/color race: the peer title and the local colour both survive', async () => {
    const s = staleSave(base.replace('"black"', '"red"'), base.replace('"old"', '"new"'));
    const want = 'export default () => <div title="new" color="red"/>;\n';
    expect(htmlFromDoc(s.doc)).toBe(want);
    expect(s.conflicts).toEqual([]);
    await s.projection.flush();
    expect(readFileSync(s.file, 'utf8')).toBe(want);
  });

  test('the same race in the other order', async () => {
    const s = staleSave(base.replace('"old"', '"new"'), base.replace('"black"', '"red"'));
    const want = 'export default () => <div title="new" color="red"/>;\n';
    expect(htmlFromDoc(s.doc)).toBe(want);
    await s.projection.flush();
    expect(readFileSync(s.file, 'utf8')).toBe(want);
  });

  test('an overlapping edit is preserved and blocked, never imported over the peer', async () => {
    const local = base.replace('"old"', '"mine"');
    const remote = base.replace('"old"', '"theirs"');
    const s = staleSave(local, remote);
    expect(s.imported).toBe(false);
    expect(htmlFromDoc(s.doc)).toBe(remote);
    expect(s.conflicts).toMatchObject([{ kind: 'body-rejected', reason: 'local-edit' }]);
    expect(s.recovered()).toBe(0);
    // Both versions are recoverable, and the local file is not overwritten.
    expect(readFileSync(join(s.dir, 'history/sync-recovery/local.tsx'), 'utf8')).toBe(local);
    expect(readFileSync(join(s.dir, 'history/sync-recovery/incoming.tsx'), 'utf8')).toBe(remote);
    await s.projection.flush();
    expect(readFileSync(s.file, 'utf8')).toBe(local);
    expect(s.recovered()).toBe(0);
  });

  test('the conflict stays until a real resolution, then clears once', async () => {
    const remote = base.replace('"old"', '"theirs"');
    const s = staleSave(base.replace('"old"', '"mine"'), remote);
    // A later valid save that takes the peer's value and adds an independent
    // change resolves it: the merge now proves both sides are kept.
    const resolved = remote.replace('"black"', '"red"');
    writeFileSync(s.file, resolved);
    s.projection.applyFromFs({
      path: s.file,
      bytes: Buffer.from(resolved),
      hash: hashBytes(resolved),
    });
    expect(htmlFromDoc(s.doc)).toBe(resolved);
    expect(s.recovered()).toBe(1);
  });

  test('a merge that would produce invalid source is blocked', () => {
    // Each side is valid alone; merged, both declare `c`.
    const start = 'const a = 1;\nconst b = 2;\nexport default () => <p>{a + b}</p>;\n';
    const local = start.replace('const a', 'const c');
    const remote = start.replace('const b', 'const c');
    const s = staleSave(local, remote, start);
    expect(s.imported).toBe(false);
    expect(htmlFromDoc(s.doc)).toBe(remote);
    expect(s.conflicts).toMatchObject([{ kind: 'body-rejected' }]);
    expect(existsSync(join(s.dir, 'history/sync-recovery/incoming.tsx'))).toBe(true);
  });
});

// T2 "restart with an unresolved candidate": the journal only knows the base's
// HASH, so a cold start used to fall back to newest-wins — one side kept, the
// other only in a snapshot. The projection now saves the base body beside the
// checkpoint, and the cold start merges or holds from it.
describe('across a restart', () => {
  function restart(offlineLocal: string, hubBody: string, opts: { dropBase?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'stale-restart-'));
    dirs.push(dir);
    const file = join(dir, 'screen.tsx');
    const paths = { html: file, comments: join(dir, 'c.json'), annotations: join(dir, 'a.svg') };
    const historyDir = join(dir, 'history');
    writeFileSync(file, base);

    // Session 1 — disk and doc agree on `base`; the checkpoint is recorded.
    const journal1 = loadJournal(dir, { flushMs: 0 });
    const doc1 = new Y.Doc();
    applyHtmlToDoc(doc1, base);
    const first = createDocProjection({
      slug: 'screen',
      doc: doc1,
      paths,
      historyDir,
      journal: journal1,
      flushMs: 0,
    });
    first.start();
    first.reconcile();
    first.stop();
    journal1.stop();
    doc1.destroy();
    if (opts.dropBase) rmSync(join(historyDir, 'sync-recovery/base.tsx'));

    // Offline: this machine edits the file; the project moves on without it.
    writeFileSync(file, offlineLocal);
    const hub = new Y.Doc();
    applyHtmlToDoc(hub, hubBody, { peer: 'B' });

    // Session 2 — the real boot order: projection built, seed, then reconcile.
    const journal = loadJournal(dir, { flushMs: 0 });
    const conflicts: BodyRejection[] = [];
    let recovered = 0;
    const projection = createDocProjection({
      slug: 'screen',
      doc: hub,
      paths,
      historyDir,
      journal,
      flushMs: 0,
      waitForReconcile: true,
      onConflict: (c) => conflicts.push(c),
      onRecovered: () => recovered++,
    });
    stops.push(
      () => projection.stop(),
      () => journal.stop(),
      () => hub.destroy()
    );
    projection.start();
    return {
      file,
      hub,
      projection,
      conflicts,
      recovered: () => recovered,
      seed: () =>
        migrateSeed({
          slug: 'screen',
          doc: hub,
          paths,
          historyDir,
          journal,
          onHold: (b) => projection.adoptBase(b),
        }),
    };
  }

  test('independent offline and project edits merge on the next boot', async () => {
    const r = restart(base.replace('"black"', '"red"'), base.replace('"old"', '"new"'));
    expect(await r.seed()).toBe('conflict-merged');
    r.projection.reconcile();
    const want = 'export default () => <div title="new" color="red"/>;\n';
    expect(htmlFromDoc(r.hub)).toBe(want);
    expect(readFileSync(r.file, 'utf8')).toBe(want);
  });

  test('an overlapping offline edit is held — neither side overwritten — until resolved', async () => {
    const local = base.replace('"old"', '"mine"');
    const remote = base.replace('"old"', '"theirs"');
    const r = restart(local, remote);
    expect(await r.seed()).toBe('conflict-held');
    r.projection.reconcile();
    expect(htmlFromDoc(r.hub)).toBe(remote);
    expect(readFileSync(r.file, 'utf8')).toBe(local);
    expect(r.conflicts).toMatchObject([{ kind: 'body-rejected', reason: 'local-edit' }]);

    // The designer takes the project's value and keeps an independent change.
    const resolved = remote.replace('"black"', '"red"');
    writeFileSync(r.file, resolved);
    r.projection.applyFromFs({
      path: r.file,
      bytes: Buffer.from(resolved),
      hash: hashBytes(resolved),
    });
    expect(htmlFromDoc(r.hub)).toBe(resolved);
    expect(r.recovered()).toBe(1);
  });

  test('without a saved base the DDR-102 newest-wins table is unchanged', async () => {
    const r = restart(base.replace('"black"', '"red"'), base.replace('"old"', '"new"'), {
      dropBase: true,
    });
    expect(['conflict-local-wins', 'conflict-hub-wins']).toContain(await r.seed());
  });
});
