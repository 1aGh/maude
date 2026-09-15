// The projection under accepted revisions — DDR-241 §3, plan T13/T15.
//
// A fake link records every proposal and lets each test answer it; the hub's
// publication is simulated by writing the accepted value into the doc with a
// REMOTE origin, exactly as a provider would. The oracles: the proposals sent,
// the file on disk, and — the fence — that the projection itself never wrote
// the document.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';

import { decideSourceLane } from '../sync/accepted-cold-start.ts';
import { applyHtmlToDoc, readLaneFromDoc } from '../sync/codec.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import {
  type AcceptedLaneLink,
  createDocProjection,
  type LaneProposal,
  type ProposalOutcome,
} from '../sync/projection.ts';
import { laneHash } from '../sync/transaction-client.ts';

const REMOTE = { remote: true };
const enc = (s: string) => new TextEncoder().encode(s);
const src = (title: string, color = 'black') =>
  `export default () => <h1 title="${title}" color="${color}">x</h1>;\n`;

interface Sent {
  p: LaneProposal;
  answer: (o: ProposalOutcome) => void;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'accepted-projection-'));
  mkdirSync(join(dir, 'ui'), { recursive: true });
  mkdirSync(join(dir, '_comments'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function rig(initial = src('A')) {
  const paths = {
    html: join(dir, 'ui', 'home.tsx'),
    comments: join(dir, '_comments', 'ui-home.json'),
    annotations: join(dir, 'ui-home.annotations.svg'),
    css: join(dir, 'ui', 'home.css'),
    meta: join(dir, 'ui', 'home.meta.json'),
  };
  writeFileSync(paths.html, initial);
  const doc = new Y.Doc();
  // The accepted state arrives from the hub.
  doc.transact(() => applyHtmlToDoc(doc, initial, REMOTE), REMOTE);
  const sent: Sent[] = [];
  let on = true;
  let n = 0;
  const link: AcceptedLaneLink = {
    on: () => on,
    newTransactionId: () => `tx_${++n}`,
    propose: (p) => new Promise<ProposalOutcome>((answer) => sent.push({ p, answer })),
  };
  const conflicts: unknown[] = [];
  let recoveredCount = 0;
  const projection = createDocProjection({
    slug: 'ui-home',
    doc,
    paths,
    flushMs: 0,
    historyDir: join(dir, '_history', 'ui-home'),
    accepted: link,
    onConflict: (c) => conflicts.push(c),
    onRecovered: () => {
      recoveredCount += 1;
    },
  });
  // Count every doc write that did NOT come from the "hub".
  let localWrites = 0;
  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) localWrites += 1;
  });
  projection.start();
  projection.reconcile();
  const edit = (text: string) => {
    writeFileSync(paths.html, text);
    return projection.applyFromFs({ path: paths.html, bytes: enc(text), hash: hashBytes(text) });
  };
  /** The hub publishes an accepted value (as a provider would deliver it). */
  const publish = (html: string) => doc.transact(() => applyHtmlToDoc(doc, html, REMOTE), REMOTE);
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return {
    doc,
    paths,
    sent,
    projection,
    conflicts,
    edit,
    publish,
    settle,
    disk: () => readFileSync(paths.html, 'utf8'),
    localWrites: () => localWrites,
    recovered: () => recoveredCount,
    setOn: (v: boolean) => {
      on = v;
    },
  };
}

describe('projection in accepted-revisions mode', () => {
  test('a file edit is PROPOSED with the value it was derived from — the document is never written', async () => {
    const r = rig(src('A'));
    expect(r.edit(src('B'))).toBe(true);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]?.p).toMatchObject({ lane: 'html', content: src('B'), baseContent: src('A') });
    expect(r.sent[0]?.p.dependsOn).toBeUndefined();
    expect(readLaneFromDoc(r.doc, 'html')).toBe(src('A'));
    r.publish(src('B'));
    r.sent[0]?.answer({ status: 'accepted' });
    await r.settle();
    expect(r.disk()).toBe(src('B'));
    expect(r.localWrites()).toBe(0);
  });

  test('an edit on top of an unanswered one is based on it AND depends on it (U1 → U2)', async () => {
    const r = rig(src('A'));
    r.edit(src('B'));
    r.edit(src('C'));
    expect(r.sent).toHaveLength(2);
    expect(r.sent[1]?.p.baseContent).toBe(src('B'));
    expect(r.sent[1]?.p.dependsOn).toEqual([r.sent[0]?.p.transactionId as string]);
  });

  test('while a proposal is in flight the projection does not write the old accepted value over the candidate', async () => {
    const r = rig(src('A'));
    r.edit(src('B'));
    // A peer's unrelated revision arrives before our answer.
    r.publish(src('A', 'red'));
    await r.settle();
    expect(r.disk()).toBe(src('B'));
    // The hub merges ours onto it and publishes the result.
    r.publish(src('B', 'red'));
    r.sent[0]?.answer({ status: 'accepted' });
    await r.settle();
    expect(r.disk()).toBe(src('B', 'red'));
  });

  test('a rejected edit is kept on disk, reported, and the next save is based on the version that won', async () => {
    const r = rig(src('A'));
    r.edit(src('Mine'));
    r.publish(src('Theirs'));
    r.sent[0]?.answer({ status: 'rejected', code: 'base-conflict', head: laneHash(src('Theirs')) });
    await r.settle();
    expect(r.disk()).toBe(src('Mine'));
    expect(r.conflicts).toHaveLength(1);
    const incoming = join(dir, '_history', 'ui-home', 'sync-recovery', 'incoming.tsx');
    expect(existsSync(incoming) && readFileSync(incoming, 'utf8')).toBe(src('Theirs'));
    // A further peer change still does not overwrite the held candidate.
    r.publish(src('Theirs', 'blue'));
    await r.settle();
    expect(r.disk()).toBe(src('Mine'));
    // The resolution.
    r.edit(src('Both'));
    const last = r.sent.at(-1)?.p;
    expect(last?.baseContent).toBe(src('Theirs'));
    r.publish(src('Both', 'blue'));
    r.sent.at(-1)?.answer({ status: 'accepted' });
    await r.settle();
    expect(r.disk()).toBe(src('Both', 'blue'));
    expect(r.recovered()).toBeGreaterThan(0);
    expect(r.localWrites()).toBe(0);
  });

  test('a rejection that outruns the winning publication waits for it before reporting', async () => {
    const r = rig(src('A'));
    r.edit(src('Mine'));
    r.sent[0]?.answer({ status: 'rejected', code: 'base-conflict', head: laneHash(src('Theirs')) });
    await new Promise((res) => setTimeout(res, 30));
    r.publish(src('Theirs'));
    await r.settle();
    const incoming = join(dir, '_history', 'ui-home', 'sync-recovery', 'incoming.tsx');
    expect(readFileSync(incoming, 'utf8')).toBe(src('Theirs'));
  });

  test('a watcher redelivery of a value already proposed is not a second proposal', () => {
    const r = rig(src('A'));
    r.edit(src('B'));
    r.projection.applyFromFs({
      path: r.paths.html,
      bytes: enc(src('B')),
      hash: hashBytes(src('B')),
    });
    expect(r.sent).toHaveLength(1);
  });

  test('an invalid source is never proposed', () => {
    const r = rig(src('A'));
    r.edit('export default () => <h1>');
    expect(r.sent).toHaveLength(0);
    expect(r.conflicts).toHaveLength(1);
  });

  test('an API lane write (comments) is proposed with the base it was made from; its file write is not re-proposed', () => {
    const r = rig(src('A'));
    const list = JSON.stringify([{ id: 'c1', text: 'hi' }]);
    const p = r.projection.proposeLane('comments', list, { baseContent: '' });
    expect(p).not.toBeNull();
    expect(r.sent[0]?.p).toMatchObject({ lane: 'comments', content: list, baseContent: '' });
    // The API then writes the same list to disk (pretty-printed) — the watcher
    // must recognise it as the value already in flight.
    const pretty = JSON.stringify(JSON.parse(list), null, 2);
    writeFileSync(r.paths.comments, pretty);
    r.projection.applyFromFs({
      path: r.paths.comments,
      bytes: enc(pretty),
      hash: hashBytes(pretty),
    });
    expect(r.sent).toHaveLength(1);
  });

  test('file events before the cold start decided are proposed once it has', () => {
    const paths = {
      html: join(dir, 'ui', 'late.tsx'),
      comments: join(dir, '_comments', 'ui-late.json'),
      annotations: join(dir, 'ui-late.annotations.svg'),
    };
    writeFileSync(paths.html, src('A'));
    const doc = new Y.Doc();
    doc.transact(() => applyHtmlToDoc(doc, src('A'), REMOTE), REMOTE);
    const sent: LaneProposal[] = [];
    const projection = createDocProjection({
      slug: 'ui-late',
      doc,
      paths,
      flushMs: 0,
      waitForReconcile: true,
      accepted: {
        on: () => true,
        newTransactionId: () => 'tx_1',
        propose: (p) => {
          sent.push(p);
          return new Promise(() => {});
        },
      },
    });
    projection.start();
    writeFileSync(paths.html, src('early edit'));
    projection.applyFromFs({ path: paths.html, bytes: enc(src('early edit')), hash: 'h' });
    expect(sent).toHaveLength(0);
    projection.reconcile();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.content).toBe(src('early edit'));
  });

  test('hold() keeps both sides and blocks the writer until a save resolves it', async () => {
    const r = rig(src('A'));
    writeFileSync(r.paths.html, src('local, unknown base'));
    r.projection.hold('html', src('A'), src('local, unknown base'));
    expect(r.conflicts).toHaveLength(1);
    r.publish(src('A', 'red'));
    await r.settle();
    expect(r.disk()).toBe(src('local, unknown base'));
    r.edit(src('resolved'));
    expect(r.sent.at(-1)?.p.baseContent).toBe(src('A'));
  });

  test('outside accepted mode the legacy import path is untouched', () => {
    const r = rig(src('A'));
    r.setOn(false);
    r.edit(src('B'));
    expect(r.sent).toHaveLength(0);
    expect(readLaneFromDoc(r.doc, 'html')).toBe(src('B'));
  });
});

describe('cold start decision (source lanes)', () => {
  test('agreed / materialize / propose / hold', () => {
    expect(decideSourceLane({ local: 'x', accepted: 'x', knownBase: null })).toEqual({
      decision: 'agreed',
    });
    expect(decideSourceLane({ local: null, accepted: 'x', knownBase: null })).toEqual({
      decision: 'materialize',
    });
    // Local is the old agreed state: the project moved on.
    expect(decideSourceLane({ local: 'old', accepted: 'new', knownBase: 'old' })).toEqual({
      decision: 'materialize',
    });
    // A local edit on top of what the project still holds.
    expect(decideSourceLane({ local: 'edit', accepted: 'base', knownBase: 'base' })).toEqual({
      decision: 'propose',
      base: 'base',
    });
    // Both moved — the hub merges from the base (or rejects and holds).
    expect(decideSourceLane({ local: 'mine', accepted: 'theirs', knownBase: 'base' })).toEqual({
      decision: 'propose',
      base: 'base',
    });
    // Nothing proves the base: keep both.
    expect(decideSourceLane({ local: 'mine', accepted: 'theirs', knownBase: null })).toEqual({
      decision: 'hold',
      base: 'theirs',
    });
    // The project never had the lane: nothing of anybody's can be lost.
    expect(decideSourceLane({ local: 'mine', accepted: '', knownBase: null })).toEqual({
      decision: 'propose',
      base: '',
    });
    // The journal hash stands in for lost bytes.
    expect(
      decideSourceLane({
        local: 'edit',
        accepted: 'base',
        knownBase: null,
        baseHash: hashBytes('base'),
      })
    ).toEqual({ decision: 'propose', base: 'base' });
    expect(
      decideSourceLane({
        local: 'old',
        accepted: 'new',
        knownBase: null,
        baseHash: hashBytes('old'),
      })
    ).toEqual({ decision: 'materialize' });
  });
});
