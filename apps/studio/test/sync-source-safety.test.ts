// Regression #121: actual shared projection, including the file on disk.
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { applyHtmlToDoc, htmlFromDoc } from '../sync/codec.ts';
import { createEchoGuard, hashBytes } from '../sync/echo-guard.ts';
import { loadJournal } from '../sync/journal.ts';
import { migrateSeed } from '../sync/migrate-seed.ts';
import { createDocProjection } from '../sync/projection.ts';

const clean = 'export default function Canvas(){return <main>Healthy</main>}\n';
const dirs: string[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(body = clean) {
  const dir = mkdtempSync(join(tmpdir(), 'source-safety-'));
  dirs.push(dir);
  const paths = {
    html: join(dir, 'screen.tsx'),
    comments: join(dir, 'comments.json'),
    annotations: join(dir, 'annotations.svg'),
    css: join(dir, 'screen.css'),
  };
  writeFileSync(paths.html, body);
  const doc = new Y.Doc();
  const echoGuard = createEchoGuard();
  const journal = loadJournal(dir);
  const projection = createDocProjection({
    slug: 'screen',
    doc,
    paths,
    echoGuard,
    journal,
    flushMs: 0,
  });
  stops.push(
    () => projection.stop(),
    () => journal.stop(),
    () => doc.destroy()
  );
  projection.start();
  return { dir, paths, doc, projection, journal, echoGuard };
}
for (const invalid of [
  'export default () => <div title="broken',
  clean.repeat(2),
  'function A(){}\nfunction A(){}\nexport default A;',
  'import {x} from "x"; import {x} from "x";',
]) {
  test(`#121 refuses invalid/duplicate remote source: ${invalid.slice(0, 45)}`, async () => {
    const f = fixture();
    applyHtmlToDoc(f.doc, invalid, 'remote');
    await f.projection.flush();
    expect(readFileSync(f.paths.html, 'utf8')).toBe(clean);
    expect(f.journal.get('screen')).toBeNull();
    expect(f.echoGuard.consume(f.paths.html, hashBytes(invalid))).toBe(false);
  });
}
test('#121 concurrent shared seeds do not double either disk', async () => {
  const a = fixture(),
    b = fixture();
  await migrateSeed({ slug: 'screen', doc: a.doc, paths: a.paths });
  await migrateSeed({ slug: 'screen', doc: b.doc, paths: b.paths });
  const ua = Y.encodeStateAsUpdate(a.doc),
    ub = Y.encodeStateAsUpdate(b.doc);
  Y.applyUpdate(a.doc, ub);
  Y.applyUpdate(b.doc, ua);
  await a.projection.flush();
  await b.projection.flush();
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
  expect(htmlFromDoc(a.doc)).toBe(clean);
  expect(htmlFromDoc(b.doc)).toBe(clean);
  expect(readFileSync(a.paths.html, 'utf8')).toBe(clean);
  expect(readFileSync(b.paths.html, 'utf8')).toBe(clean);
});
test('#121 concurrent edits preserve unchanged interior anchors', () => {
  const a = new Y.Doc(),
    b = new Y.Doc();
  a.clientID = 101;
  b.clientID = 202;
  const base = 'export const X = <div a="old" b="old"/>;';
  applyHtmlToDoc(a, base);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  applyHtmlToDoc(a, 'export const X = <div a="new" b="new"/>;');
  applyHtmlToDoc(b, 'export const X = <div a="old" title="added" b="old"/>;');
  const ua = Y.encodeStateAsUpdate(a),
    ub = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, ub);
  Y.applyUpdate(b, ua);
  expect(htmlFromDoc(a)).toBe('export const X = <div a="new" title="added" b="new"/>;');
  expect(htmlFromDoc(b)).toBe(htmlFromDoc(a));
  a.destroy();
  b.destroy();
});
test('#121 pending remote flush cannot erase a local edit awaiting its watcher', async () => {
  const f = fixture();
  applyHtmlToDoc(f.doc, clean);
  await f.projection.flush();
  const repair = clean.replace('Healthy', 'Repair');
  writeFileSync(f.paths.html, repair);
  applyHtmlToDoc(f.doc, clean.replace('Healthy', 'Remote'), 'remote');
  await f.projection.flush();
  expect(readFileSync(f.paths.html, 'utf8')).toBe(repair);
});
test('#121 malformed local save never enters the shared document', () => {
  const f = fixture();
  applyHtmlToDoc(f.doc, clean);
  const bad = 'export default <div title="';
  writeFileSync(f.paths.html, bad);
  expect(
    f.projection.applyFromFs({ path: f.paths.html, bytes: Buffer.from(bad), hash: hashBytes(bad) })
  ).toBe(false);
  expect(htmlFromDoc(f.doc)).toBe(clean);
});

test('#121 rejected bodies retain valid recovery across repeated migration', async () => {
  const f = fixture();
  const historyDir = join(f.dir, 'history');
  applyHtmlToDoc(f.doc, clean);
  await migrateSeed({ slug: 'screen', doc: f.doc, paths: f.paths, historyDir });
  const bad = 'export default <div title="';
  writeFileSync(f.paths.html, bad);
  applyHtmlToDoc(f.doc, bad);
  await migrateSeed({ slug: 'screen', doc: f.doc, paths: f.paths, historyDir });
  expect(readFileSync(join(historyDir, 'pre-shared-doc-migration/screen.tsx'), 'utf8')).toBe(clean);
  expect(readFileSync(join(historyDir, 'sync-recovery/last-valid.tsx'), 'utf8')).toBe(clean);
});

test('#121 initial projection waits for cold-start reconciliation', async () => {
  const f = fixture();
  f.projection.stop();
  const p = createDocProjection({
    slug: 'screen',
    doc: f.doc,
    paths: f.paths,
    waitForReconcile: true,
    flushMs: 0,
  });
  stops.push(() => p.stop());
  p.start();
  const remote = clean.replace('Healthy', 'Remote');
  applyHtmlToDoc(f.doc, remote);
  await p.flush();
  expect(readFileSync(f.paths.html, 'utf8')).toBe(clean);
  p.reconcile();
  expect(readFileSync(f.paths.html, 'utf8')).toBe(remote);
});

test('#121 malformed candidate emits one conflict, and a valid repair can sync', async () => {
  const f = fixture();
  f.projection.stop();
  const conflicts: string[] = [];
  const historyDir = join(f.dir, 'history');
  const p = createDocProjection({
    slug: 'screen',
    doc: f.doc,
    paths: f.paths,
    historyDir,
    flushMs: 0,
    onConflict: (c) => conflicts.push(c.reason),
  });
  stops.push(() => p.stop());
  p.start();
  const bad = clean.replace('Healthy', 'Other').repeat(2);
  applyHtmlToDoc(f.doc, bad);
  await p.flush();
  p.reconcile();
  expect(conflicts).toEqual(['invalid-source']);
  expect(readFileSync(join(historyDir, 'sync-recovery/incoming.tsx'), 'utf8')).toBe(bad);
  expect(readFileSync(join(historyDir, 'sync-recovery/last-valid.tsx'), 'utf8')).toBe(clean);
  const repair = clean.replace('Healthy', 'Repair');
  writeFileSync(f.paths.html, repair);
  expect(
    p.applyFromFs({ path: f.paths.html, bytes: Buffer.from(repair), hash: hashBytes(repair) })
  ).toBe(true);
  expect(htmlFromDoc(f.doc)).toBe(repair);
  const remote = repair.replace('Repair', 'Next');
  applyHtmlToDoc(f.doc, remote);
  await p.flush();
  expect(readFileSync(f.paths.html, 'utf8')).toBe(remote);
});

test('#121 source validity includes legal TypeScript declaration merging', async () => {
  const { sourceError } = await import('../sync/source-validation.ts');
  for (const source of [
    'export interface A {x:number}; export interface A {y:string};',
    'export function f(x:number):number; export function f(x:string):string; export function f(x:unknown){return x}',
    'const {a, b: [c]} = {a:1,b:[2]}; export {a,c};',
    'export type T = string; export const T = 1;',
    'export default () => <div>Český 🐊 text</div>;',
  ])
    expect(sourceError('screen.tsx', source)).toBeNull();
  for (const source of [
    'export default 1; export default 2;',
    'const {a}={a:1}; const a=2;',
    'const a=1; export {a as x}; export {a as x};',
  ])
    expect(sourceError('screen.tsx', source)).not.toBeNull();
});

test('#121 three shared seeders converge with CSS and preserve unrelated lanes', async () => {
  const peers = [fixture(), fixture(), fixture()];
  const css = '.card {color:green}\n';
  for (const f of peers) {
    writeFileSync(f.paths.css, css);
    await migrateSeed({ slug: 'screen', doc: f.doc, paths: f.paths });
  }
  const updates = peers.map((f) => Y.encodeStateAsUpdate(f.doc));
  for (const f of peers) for (const update of updates) Y.applyUpdate(f.doc, update);
  // Exchange the elected seeder's repair too, just as the provider transports it.
  for (const f of peers)
    for (const other of peers) Y.applyUpdate(f.doc, Y.encodeStateAsUpdate(other.doc));
  peers[0].doc.getArray('comments').push([{ id: 'kept', text: 'Independent comment' }]);
  for (const f of peers) {
    await f.projection.flush();
    expect(htmlFromDoc(f.doc)).toBe(clean);
    expect(f.doc.getText('css').toString()).toBe(css);
    expect(readFileSync(f.paths.html, 'utf8')).toBe(clean);
    expect(readFileSync(f.paths.css, 'utf8')).toBe(css);
  }
  expect(peers[0].doc.getArray('comments').length).toBe(1);
});

test('#121 a failed recovery write refuses materialization and does not checkpoint', async () => {
  const f = fixture();
  f.projection.stop();
  const historyDir = join(f.dir, 'not-a-directory');
  writeFileSync(historyDir, 'occupied');
  const failures: boolean[] = [];
  const p = createDocProjection({
    slug: 'screen',
    doc: f.doc,
    paths: f.paths,
    historyDir,
    journal: f.journal,
    flushMs: 0,
    onConflict: (info) => failures.push(info.snapshotFailed),
  });
  stops.push(() => p.stop());
  p.start();
  applyHtmlToDoc(f.doc, clean.replace('Healthy', 'Remote'));
  await p.flush();
  expect(readFileSync(f.paths.html, 'utf8')).toBe(clean);
  expect(f.journal.get('screen')).toBeNull();
  expect(failures).toEqual([true]);
});

test('#121 a corrupted first migration uses the newest valid existing history', async () => {
  const f = fixture('export default <div title="');
  const historyDir = join(f.dir, 'history');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(historyDir);
  writeFileSync(join(historyDir, '2026-09-09.tsx'), clean);
  writeFileSync(join(historyDir, '2026-09-10.tsx'), clean.repeat(2));
  applyHtmlToDoc(f.doc, clean.repeat(2));
  await migrateSeed({ slug: 'screen', doc: f.doc, paths: f.paths, historyDir });
  expect(readFileSync(join(historyDir, 'pre-shared-doc-migration', 'screen.tsx'), 'utf8')).toBe(
    clean
  );
  expect(htmlFromDoc(f.doc)).toBe(clean.repeat(2)); // preserved for explicit repair
});

test('#121 rejected body cannot replace its coupled CSS', async () => {
  const f = fixture();
  writeFileSync(f.paths.css, '.healthy{}');
  f.doc.transact(() => {
    applyHtmlToDoc(f.doc, clean.repeat(2));
    f.doc.getText('css').insert(0, '.corrupt{}');
  });
  await f.projection.flush();
  expect(readFileSync(f.paths.css, 'utf8')).toBe('.healthy{}');
});

test('#121 bounded replacement fails before modifying the document', () => {
  const f = fixture();
  const before = `export const text = "${'a'.repeat(6000)}";`;
  const after = `export const text = "${'z'.repeat(6000)}";`;
  applyHtmlToDoc(f.doc, before);
  expect(() => applyHtmlToDoc(f.doc, after)).toThrow('safe merge budget');
  expect(htmlFromDoc(f.doc)).toBe(before);
});

test('#121 Unicode edits preserve surrogate pairs and round-trip', () => {
  const f = fixture();
  for (const body of [
    'export const text = "🐊 čau 🦊";',
    'export const text = "🦊 ahoj 🐊";',
    'export const text = "🐊";',
  ]) {
    applyHtmlToDoc(f.doc, body);
    expect(htmlFromDoc(f.doc)).toBe(body);
  }
});

test('#121 cold-start still repairs a proven repeat of the valid local TSX', async () => {
  const f = fixture();
  applyHtmlToDoc(f.doc, clean.repeat(2));
  expect(await migrateSeed({ slug: 'screen', doc: f.doc, paths: f.paths })).toBe(
    'recover-seed-dup'
  );
  expect(htmlFromDoc(f.doc)).toBe(clean);
});

test('#121 synchronous peer changes during import still pass the write guard', async () => {
  const f = fixture();
  applyHtmlToDoc(f.doc, clean);
  await f.projection.flush();
  const repair = clean.replace('Healthy', 'Repair');
  writeFileSync(f.paths.html, repair);
  f.doc.once('update', () => f.doc.getText('html').insert(0, 'const broken = "'));
  f.projection.applyFromFs({
    path: f.paths.html,
    bytes: Buffer.from(repair),
    hash: hashBytes(repair),
  });
  await f.projection.flush();
  expect(readFileSync(f.paths.html, 'utf8')).toBe(repair);
  expect(f.journal.get('screen')?.bodyHash).toBe(hashBytes(clean));
});

test('#121 accepting valid remote source preserves an invalid local draft too', async () => {
  const draft = 'export default <div title="unfinished local work';
  const f = fixture(draft);
  f.projection.stop();
  const historyDir = join(f.dir, 'history');
  const p = createDocProjection({
    slug: 'screen',
    doc: f.doc,
    paths: f.paths,
    historyDir,
    flushMs: 0,
  });
  stops.push(() => p.stop());
  p.start();
  applyHtmlToDoc(f.doc, clean);
  await p.flush();
  expect(readFileSync(f.paths.html, 'utf8')).toBe(clean);
  expect(readFileSync(join(historyDir, 'sync-recovery/local.tsx'), 'utf8')).toBe(draft);
});
