// V2-8.17 (#121) — the legacy shared document detects overlapping offline edits
// on reconnect. Unit level, no hub: one peer's projection (ours) and a bare
// Y.Doc for the teammate, both on the same base. The hub's order is modelled by
// WHEN the teammate's update is delivered relative to `noteConfirmed()` — before
// it, the hub took theirs first (we are the side that acts); after it, ours was
// first (we do nothing). The end-to-end lanes against a real hub live in
// sync-accepted-offline-resume.test.ts.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import { applyHtmlToDoc, htmlFromDoc } from '../sync/codec.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { syncUpdateFromMessage } from '../sync/offline-overlap.ts';
import { type BodyRejection, createDocProjection } from '../sync/projection.ts';

const src = (title: string, color = 'black') =>
  `export default function Home() {\n  return <h1 title="${title}" color="${color}">Home</h1>;\n}\n`;

const dirs: string[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REMOTE = { hub: true };

function pair(base = src('base')) {
  const dir = mkdtempSync(join(tmpdir(), 'offline-overlap-'));
  dirs.push(dir);
  const file = join(dir, 'home.tsx');
  writeFileSync(file, base);
  const ours = new Y.Doc();
  applyHtmlToDoc(ours, base);
  const theirs = new Y.Doc();
  Y.applyUpdate(theirs, Y.encodeStateAsUpdate(ours));
  // Everything our side sends (its edit, and any repair), as the hub would relay it.
  const sent: Uint8Array[] = [];
  ours.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) sent.push(u);
  });
  const conflicts: BodyRejection[] = [];
  let recovered = 0;
  const projection = createDocProjection({
    slug: 'home',
    doc: ours,
    paths: { html: file, comments: join(dir, 'c.json'), annotations: join(dir, 'a.json') },
    historyDir: join(dir, 'history'),
    flushMs: 0,
    isRemoteOrigin: (o) => o === REMOTE,
    onConflict: (c) => conflicts.push(c),
    onRecovered: () => recovered++,
  });
  stops.push(
    () => projection.stop(),
    () => ours.destroy(),
    () => theirs.destroy()
  );
  projection.start();
  projection.reconcile();
  const save = (body: string) => {
    writeFileSync(file, body);
    return projection.applyFromFs({ path: file, bytes: Buffer.from(body), hash: hashBytes(body) });
  };
  /** The teammate edits on their own replica; returns the update as the hub forwards it. */
  const teammate = (body: string) => {
    const sv = Y.encodeStateVector(theirs);
    applyHtmlToDoc(theirs, body, { peer: 'teammate' });
    return Y.encodeStateAsUpdate(theirs, sv);
  };
  /** The provider path: raw frame first, then the apply. */
  const deliver = (u: Uint8Array) => {
    projection.noteRemoteUpdate(u);
    Y.applyUpdate(ours, u, REMOTE);
  };
  const recovery = (slot: string) =>
    readFileSync(join(dir, 'history', 'sync-recovery', `${slot}.tsx`), 'utf8');
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    await projection.flush();
  };
  return {
    file,
    ours,
    theirs,
    sent,
    projection,
    conflicts,
    recovered: () => recovered,
    save,
    teammate,
    deliver,
    recovery,
    settle,
    disk: () => readFileSync(file, 'utf8'),
  };
}

describe('legacy shared document: overlapping edits made while apart (#121)', () => {
  test('the hub took theirs first: this disk keeps mine, the project keeps theirs, the conflict is surfaced', async () => {
    const p = pair();
    expect(p.save(src('designer frozen'))).toBe(true);
    // Not acknowledged yet — the teammate's overlapping edit arrives.
    p.deliver(p.teammate(src('teammate frozen')));
    await p.settle();
    expect(p.conflicts.map((c) => c.reason)).toEqual(['offline-overlap']);
    expect(p.disk()).toBe(src('designer frozen'));
    // No character-level interleaving left in the shared document.
    expect(htmlFromDoc(p.ours)).toBe(src('teammate frozen'));
    expect(p.recovery('incoming')).toBe(src('teammate frozen'));
    expect(p.recovery('local')).toBe(src('designer frozen'));
  });

  test("the teammate's replica ends on its own version, not the interleaving", async () => {
    const p = pair();
    p.save(src('designer frozen'));
    const theirEdit = p.teammate(src('teammate frozen'));
    p.deliver(theirEdit);
    await p.settle();
    // The hub relays everything this side sent — its offline edit, then the repair.
    for (const u of p.sent) Y.applyUpdate(p.theirs, u, REMOTE);
    expect(htmlFromDoc(p.theirs)).toBe(src('teammate frozen'));
    expect(htmlFromDoc(p.theirs)).toBe(htmlFromDoc(p.ours));
  });

  test('our edit was acknowledged first: this side does nothing (the other side acts)', async () => {
    const p = pair();
    p.save(src('designer frozen'));
    p.projection.noteConfirmed();
    p.deliver(p.teammate(src('teammate frozen')));
    await p.settle();
    expect(p.conflicts).toEqual([]);
  });

  test('edits to different parts while apart still merge silently', async () => {
    const p = pair();
    p.save(src('designer', 'black'));
    p.deliver(p.teammate(src('base', 'red')));
    await p.settle();
    expect(p.conflicts).toEqual([]);
    expect(htmlFromDoc(p.ours)).toBe(src('designer', 'red'));
    expect(p.disk()).toBe(src('designer', 'red'));
  });

  test('a later remote change while held keeps the disk and the conflict', async () => {
    const p = pair();
    p.save(src('designer frozen'));
    p.deliver(p.teammate(src('teammate frozen')));
    await p.settle();
    p.deliver(p.teammate(src('teammate again')));
    await p.settle();
    expect(p.disk()).toBe(src('designer frozen'));
    expect(p.conflicts.at(-1)?.reason).toBe('offline-overlap');
    expect(p.recovered()).toBe(0);
  });

  test('the next save resolves the held conflict and goes to the project', async () => {
    const p = pair();
    p.save(src('designer frozen'));
    p.deliver(p.teammate(src('teammate frozen')));
    await p.settle();
    expect(p.conflicts).toHaveLength(1);
    // Authored on top of the version the conflict showed.
    expect(p.save(src('designer decided'))).toBe(true);
    expect(p.recovered()).toBe(1);
    expect(htmlFromDoc(p.ours)).toBe(src('designer decided'));
  });
});

describe('syncUpdateFromMessage', () => {
  const frame = (type: number, sync: number | null, payload: Uint8Array) => {
    const e = encoding.createEncoder();
    encoding.writeVarString(e, 'project/ui-home');
    encoding.writeVarUint(e, type);
    if (sync !== null) encoding.writeVarUint(e, sync);
    encoding.writeVarUint8Array(e, payload);
    return encoding.toUint8Array(e);
  };
  const u = new Uint8Array([1, 2, 3, 4]);

  test('a sync update and a sync step 2 carry the update', () => {
    expect(syncUpdateFromMessage(frame(0, 2, u))).toEqual(u);
    expect(syncUpdateFromMessage(frame(0, 1, u))).toEqual(u);
  });

  test('step 1, awareness and garbage carry none', () => {
    expect(syncUpdateFromMessage(frame(0, 0, u))).toBeNull();
    expect(syncUpdateFromMessage(frame(1, null, u))).toBeNull();
    expect(syncUpdateFromMessage(new Uint8Array([0xff]))).toBeNull();
  });
});
