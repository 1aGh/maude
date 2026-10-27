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

// V2-8.9 final review, M1 — the order "their change before our ack" only says
// the hub took theirs first while ONE connection carried both. Our edit can
// reach the hub and lose its ack to a drop; a teammate then builds on it, and
// the reconnect replays their work onto a shadow WITHOUT our edit. The
// invariant: a reconnect never writes a body neither side wrote, and the notice
// never states something untrue — so those cases fall back to the CRDT merge.
describe('a drop before the ack (V2-8.9 M1)', () => {
  // Our edit inserts " bbb". The teammate, who saw it, deletes the base "a"
  // next to it: that touches ours yet needs nothing of ours, so the shadow
  // applies it cleanly and reads "aa" — a body nobody wrote.
  const mine = src('aaa bbb');
  const touched = src('aa bbb');
  // …and here they also append " ccc" after OUR "bbb", which the shadow
  // cannot place without our edit (Yjs leaves it pending).
  const built = src('aa bbb ccc');

  function hubTookOurs(p: ReturnType<typeof pair>) {
    for (const u of p.sent.splice(0)) Y.applyUpdate(p.theirs, u, REMOTE);
  }

  test('our edit reached the hub, the ack was lost, a teammate built on it: the reconnect keeps what they wrote', async () => {
    const p = pair(src('aaa'));
    expect(p.save(mine)).toBe(true);
    hubTookOurs(p);
    p.projection.noteConnection(false); // the socket drops before SyncStatus
    const theirEdit = p.teammate(touched);
    p.projection.noteConnection(true);
    p.deliver(theirEdit); // the reconnect's sync step 2
    await p.settle();
    expect(p.conflicts).toEqual([]);
    expect(htmlFromDoc(p.ours)).toBe(touched);
    expect(p.disk()).toBe(touched);
  });

  test('a remote change that depends on our unconfirmed edit ends the check, even with no drop seen', async () => {
    // A hub that relays work built on ours but withholds our ack: the shadow
    // cannot apply it, which proves the "taken before ours" premise broke.
    const p = pair(src('aaa'));
    expect(p.save(mine)).toBe(true);
    hubTookOurs(p);
    p.deliver(p.teammate(built));
    await p.settle();
    expect(p.conflicts).toEqual([]);
    expect(htmlFromDoc(p.ours)).toBe(built);
    expect(p.disk()).toBe(built);
  });

  test('an edit made offline is still checked across failed reconnect attempts', async () => {
    const p = pair();
    p.projection.noteConnection(false);
    expect(p.save(src('designer frozen'))).toBe(true);
    // Each failed attempt reports a drop; nothing of ours has gone anywhere.
    p.projection.noteConnection(false);
    p.projection.noteConnection(false);
    const theirEdit = p.teammate(src('teammate frozen'));
    p.projection.noteConnection(true);
    p.deliver(theirEdit);
    await p.settle();
    expect(p.conflicts.map((c) => c.reason)).toEqual(['offline-overlap']);
    expect(p.disk()).toBe(src('designer frozen'));
    expect(htmlFromDoc(p.ours)).toBe(src('teammate frozen'));
  });

  test('after a drop, the next edit is checked on a base that holds the edit in flight', async () => {
    const p = pair();
    expect(p.save(src('designer', 'black'))).toBe(true);
    p.projection.noteConnection(false); // did the hub take "designer"? unknown
    expect(p.save(src('designer', 'blue'))).toBe(true);
    const theirEdit = p.teammate(src('base', 'red'));
    p.projection.noteConnection(true);
    p.deliver(theirEdit);
    await p.settle();
    expect(p.conflicts.map((c) => c.reason)).toEqual(['offline-overlap']);
    expect(p.disk()).toBe(src('designer', 'blue'));
    // Their colour over the state our offline edit replaced — never the bare
    // base, which would pull the in-flight title out of the project.
    expect(htmlFromDoc(p.ours)).toBe(src('designer', 'red'));
  });
});

// V2-8.9 final review, L1 — a merge too large to diff says nothing about
// whether the two edits touch, so it must not claim "the same part".
describe('a merge past its budget (V2-8.9 L1)', () => {
  test('a large teammate edit elsewhere is left to the CRDT merge, with no overlap notice', async () => {
    // The teammate adds a long note above the component and another below it,
    // one step each: every step is a plain insert, but base -> theirs spans
    // our title with more change than the diff budget allows.
    const note = (c: string) => `/* ${c.repeat(3000)} */\n`;
    const p = pair();
    expect(p.save(src('designer'))).toBe(true);
    p.deliver(p.teammate(note('b') + src('base')));
    p.deliver(p.teammate(note('b') + src('base') + note('c')));
    await p.settle();
    expect(p.conflicts).toEqual([]);
    expect(htmlFromDoc(p.ours)).toBe(note('b') + src('designer') + note('c'));
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
