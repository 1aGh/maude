// p8-fix-e (F8) — the legacy offline-overlap gaps V2-8.17 left (PR.md "Legacy sync gaps after V2-8.17"):
//   (a) the sibling `.css` text was not covered: two people who changed the same rule while apart got the
//       character-level merge and nobody was told;
//   (b) the `MAUDE_SHARED_DOC=0` lane (the two-doc agent, sync/agent.ts) had no overlap check at all.
// Same model as sync-offline-overlap.test.ts: one peer (ours) + a bare Y.Doc for the teammate on the same
// base; the hub's order is WHEN the teammate's update is delivered relative to `noteConfirmed()` — before it,
// the hub took theirs first and this side acts; after it, ours was first and this side does nothing.
// Both directions: the side that acts ends with its own text on disk and the project's (theirs) in the doc,
// and the teammate's replica, once this side's repair reaches it, holds its own version, not the interleaving.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as Y from 'yjs';

import { createCanvasSyncAgent } from '../sync/agent.ts';
import { applyCssToDoc, applyHtmlToDoc, cssFromDoc, htmlFromDoc } from '../sync/codec.ts';
import { createEchoGuard, hashBytes } from '../sync/echo-guard.ts';
import { offlineOverlapNotice } from '../sync/offline-overlap.ts';
import { type BodyRejection, createDocProjection } from '../sync/projection.ts';

const body = (title: string) =>
  `import './home.css';\nexport default function Home() {\n  return <h1 title="${title}">Home</h1>;\n}\n`;
const css = (color: string, pad = '4px') =>
  `.hero {\n  color: ${color};\n}\n.card {\n  padding: ${pad};\n}\n`;

const dirs: string[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REMOTE = { hub: true };

type Lane = 'projection' | 'agent';

/** One peer on `lane`, its teammate's bare replica, and the hub's relay between them. */
function pair(lane: Lane) {
  const dir = mkdtempSync(join(tmpdir(), 'overlap-gaps-'));
  dirs.push(dir);
  const html = join(dir, 'home.tsx');
  const cssFile = join(dir, 'home.css');
  writeFileSync(html, body('base'));
  writeFileSync(cssFile, css('black'));
  const ours = new Y.Doc();
  applyHtmlToDoc(ours, body('base'));
  applyCssToDoc(ours, css('black'));
  const theirs = new Y.Doc();
  Y.applyUpdate(theirs, Y.encodeStateAsUpdate(ours));
  const sent: Uint8Array[] = [];
  ours.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) sent.push(u);
  });
  const conflicts: (BodyRejection | Record<string, unknown>)[] = [];
  let recovered = 0;
  const paths = {
    html,
    css: cssFile,
    comments: join(dir, 'c.json'),
    annotations: join(dir, 'a.json'),
  };
  const historyDir = join(dir, 'history');
  const echoGuard = createEchoGuard();
  const peer =
    lane === 'projection'
      ? createDocProjection({
          slug: 'home',
          doc: ours,
          paths,
          historyDir,
          flushMs: 0,
          isRemoteOrigin: (o) => o === REMOTE,
          onConflict: (c) => conflicts.push(c),
          onRecovered: () => recovered++,
        })
      : createCanvasSyncAgent({
          slug: 'home',
          doc: ours,
          paths,
          echoGuard,
          flushMs: 0,
          historyDir,
          isRemoteOrigin: (o) => o === REMOTE,
          onConflict: (c) => conflicts.push(c),
          onRecovered: () => recovered++,
        });
  stops.push(
    () => peer.stop(),
    () => ours.destroy(),
    () => theirs.destroy()
  );
  peer.start();
  void peer.reconcile();
  const save = (file: string, text: string) => {
    writeFileSync(file, text);
    return peer.applyFromFs({ path: file, bytes: Buffer.from(text), hash: hashBytes(text) });
  };
  /** The teammate edits on their own replica; returns the update as the hub forwards it. */
  const teammate = (edit: (d: Y.Doc) => void) => {
    const sv = Y.encodeStateVector(theirs);
    edit(theirs);
    return Y.encodeStateAsUpdate(theirs, sv);
  };
  /** The provider path: raw frame first, then the apply. */
  const deliver = (u: Uint8Array) => {
    peer.noteRemoteUpdate(u);
    Y.applyUpdate(ours, u, REMOTE);
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    await peer.flush();
  };
  const recovery = (slot: string, ext: string) =>
    readFileSync(join(historyDir, 'sync-recovery', `${slot}.${ext}`), 'utf8');
  return {
    html,
    cssFile,
    ours,
    theirs,
    sent,
    peer,
    conflicts,
    recovered: () => recovered,
    save,
    teammate,
    deliver,
    settle,
    recovery,
    read: (f: string) => readFileSync(f, 'utf8'),
    historyDir,
  };
}

describe('F8a — the sibling stylesheet: overlapping edits made while apart (legacy shared document)', () => {
  test('the hub took theirs first: this disk keeps my styles, the project keeps theirs, the conflict names the stylesheet', async () => {
    const p = pair('projection');
    expect(p.save(p.cssFile, css('rebeccapurple'))).toBe(true);
    p.deliver(p.teammate((d) => applyCssToDoc(d, css('teal'))));
    await p.settle();
    expect(p.conflicts.map((c) => [c.reason, (c as BodyRejection).file])).toEqual([
      ['offline-overlap', 'css'],
    ]);
    expect(p.read(p.cssFile)).toBe(css('rebeccapurple'));
    expect(cssFromDoc(p.ours)).toBe(css('teal'));
    expect(p.recovery('incoming', 'css')).toBe(css('teal'));
    expect(p.recovery('local', 'css')).toBe(css('rebeccapurple'));
    // The teammate's replica, once this side's repair reaches it, ends on its own styles.
    for (const u of p.sent) Y.applyUpdate(p.theirs, u, REMOTE);
    expect(cssFromDoc(p.theirs)).toBe(css('teal'));
  });

  test('the notice names the styles and the .css copy, not the body', () => {
    const text = offlineOverlapNotice('home', { file: 'css', snapshotFailed: false });
    expect(text).toContain('the styles of home');
    expect(text).toContain('_history/home/sync-recovery/incoming.css');
    expect(offlineOverlapNotice('home', { snapshotFailed: false })).toContain('incoming.tsx');
  });

  test('our styles were acknowledged first: this side does nothing (the other side acts)', async () => {
    const p = pair('projection');
    p.save(p.cssFile, css('rebeccapurple'));
    p.peer.noteConfirmed();
    p.deliver(p.teammate((d) => applyCssToDoc(d, css('teal'))));
    await p.settle();
    expect(p.conflicts).toEqual([]);
  });

  test('styles changed in different rules while apart still merge silently', async () => {
    const p = pair('projection');
    p.save(p.cssFile, css('rebeccapurple'));
    p.deliver(p.teammate((d) => applyCssToDoc(d, css('black', '12px'))));
    await p.settle();
    expect(p.conflicts).toEqual([]);
    expect(p.read(p.cssFile)).toBe(css('rebeccapurple', '12px'));
  });

  test('a later remote change keeps my styles on disk until my next save resolves the hold', async () => {
    const p = pair('projection');
    p.save(p.cssFile, css('rebeccapurple'));
    p.deliver(p.teammate((d) => applyCssToDoc(d, css('teal'))));
    await p.settle();
    p.deliver(p.teammate((d) => applyCssToDoc(d, css('navy'))));
    await p.settle();
    expect(p.read(p.cssFile)).toBe(css('rebeccapurple'));
    expect(p.save(p.cssFile, css('rebeccapurple', '8px'))).toBe(true);
    expect(p.recovered()).toBe(1);
    expect(cssFromDoc(p.ours)).toBe(css('rebeccapurple', '8px'));
  });
});

describe('F8b — the MAUDE_SHARED_DOC=0 lane (two-doc agent): the same check, body and stylesheet', () => {
  test('body: the hub took theirs first — this disk keeps mine, the project keeps theirs, both versions saved', async () => {
    const p = pair('agent');
    await p.settle();
    expect(p.save(p.html, body('designer frozen'))).toBe(true);
    p.deliver(p.teammate((d) => applyHtmlToDoc(d, body('teammate frozen'))));
    await p.settle();
    expect(p.conflicts.map((c) => c.reason)).toEqual(['offline-overlap']);
    expect(p.read(p.html)).toBe(body('designer frozen'));
    expect(htmlFromDoc(p.ours)).toBe(body('teammate frozen'));
    expect(p.recovery('incoming', 'tsx')).toBe(body('teammate frozen'));
    expect(p.recovery('local', 'tsx')).toBe(body('designer frozen'));
    for (const u of p.sent) Y.applyUpdate(p.theirs, u, REMOTE);
    expect(htmlFromDoc(p.theirs)).toBe(body('teammate frozen'));
  });

  test('stylesheet: the same, and the conflict names the stylesheet', async () => {
    const p = pair('agent');
    await p.settle();
    p.save(p.cssFile, css('rebeccapurple'));
    p.deliver(p.teammate((d) => applyCssToDoc(d, css('teal'))));
    await p.settle();
    expect(p.conflicts.map((c) => [c.reason, (c as BodyRejection).file])).toEqual([
      ['offline-overlap', 'css'],
    ]);
    expect(p.read(p.cssFile)).toBe(css('rebeccapurple'));
    expect(cssFromDoc(p.ours)).toBe(css('teal'));
    expect(p.recovery('incoming', 'css')).toBe(css('teal'));
  });

  test('ours acknowledged first: nothing (the other side acts); different parts: silent merge', async () => {
    const p = pair('agent');
    await p.settle();
    p.save(p.html, body('designer frozen'));
    p.peer.noteConfirmed();
    p.deliver(p.teammate((d) => applyHtmlToDoc(d, body('teammate frozen'))));
    await p.settle();
    expect(p.conflicts).toEqual([]);
    const q = pair('agent');
    await q.settle();
    q.save(q.cssFile, css('rebeccapurple'));
    q.deliver(q.teammate((d) => applyCssToDoc(d, css('black', '12px'))));
    await q.settle();
    expect(q.conflicts).toEqual([]);
    expect(q.read(q.cssFile)).toBe(css('rebeccapurple', '12px'));
    expect(existsSync(join(q.historyDir, 'sync-recovery'))).toBe(false);
  });

  test('a drop with the edit in flight ends the check (V2-8.9 M1 holds on this lane too)', async () => {
    const p = pair('agent');
    await p.settle();
    p.peer.noteConnection(true);
    p.save(p.html, body('designer frozen'));
    p.peer.noteConnection(false);
    p.deliver(p.teammate((d) => applyHtmlToDoc(d, body('teammate frozen'))));
    await p.settle();
    expect(p.conflicts).toEqual([]);
  });

  test('the next save resolves the held body and goes to the project', async () => {
    const p = pair('agent');
    await p.settle();
    p.save(p.html, body('designer frozen'));
    p.deliver(p.teammate((d) => applyHtmlToDoc(d, body('teammate frozen'))));
    await p.settle();
    p.deliver(p.teammate((d) => applyHtmlToDoc(d, body('teammate again'))));
    await p.settle();
    expect(p.read(p.html)).toBe(body('designer frozen'));
    expect(p.save(p.html, body('designer decided'))).toBe(true);
    expect(p.recovered()).toBe(1);
    expect(htmlFromDoc(p.ours)).toBe(body('designer decided'));
  });
});
