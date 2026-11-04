// F15 / v2-204 — a held conflict survives a restart of the studio that holds it.
//
// The trash race (#166): alice and bob change one canvas while the cell is away; the hub takes one
// save and refuses the other, and the refused Mac keeps its own version on disk with the
// `source-conflict-<slug>` notice and the project's version in sync-recovery/incoming. That held
// state lives in the running projection. After a restart (an app relaunch, an update, a tab that
// rested) the cold start judges the disk again. For a Mac with no recorded base — the canvas's
// creator, whose create never wrote one — the verdict is `hold`, and `hold` had one shortcut:
// "the project once accepted exactly these bytes, so the disk is an OLDER accepted state"
// (`wasAccepted`, every cloud cell wake). The hub answers that by content hash, across the whole
// project and every revision — and a refused candidate's bytes are very often bytes the project
// accepted somewhere (the same artboards removed from a twin canvas, a trash that a restore
// undid, a text set back). Then the candidate was overwritten with the project's version, the
// notice was gone, and nobody had chosen: the silent half of F15, measured in the race rig
// (scripts/dev/trash-sync-repro.mjs --restart-held, offline trash race, both directions, 2.0.3):
// 8 of 20 runs, every one whose held side was the canvas's creator.
//
// The record that a conflict is open is already on disk: the first refused draft of the episode,
// `sync-recovery/candidate.tsx.json`, `resolved: false` until a save the project takes (or Take
// theirs) resolves it. While it is open, the disk is never "an older accepted state".

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';

import { acceptedColdStart } from '../sync/accepted-cold-start.ts';
import { applyHtmlToDoc } from '../sync/codec.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import {
  type AcceptedLaneLink,
  createDocProjection,
  type LaneProposal,
  type ProposalOutcome,
} from '../sync/projection.ts';
import { readRecoveryBody, readRecoveryCandidate } from '../sync/source-recovery.ts';
import { laneHash } from '../sync/transaction-client.ts';

const REMOTE = { remote: true };
const enc = (s: string) => new TextEncoder().encode(s);
const board = (...ids: string[]) =>
  `export default () => (\n  <DesignCanvas>\n${ids
    .map(
      (id) => `    <DCArtboard id="${id}" width={180} height={254}><h1>${id}</h1></DCArtboard>\n`
    )
    .join('')}  </DesignCanvas>\n);\n`;
const ALL = board('a', 'b', 'c', 'd');
const MINE = board('d'); // alice moved a, b and c to the trash
const THEIRS = board('a', 'b', 'c'); // bob moved d, and his reached the project first

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'f15-restart-'));
  mkdirSync(join(dir, 'ui'), { recursive: true });
  mkdirSync(join(dir, '_comments'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const paths = () => ({
  html: join(dir, 'ui', 'race.tsx'),
  comments: join(dir, '_comments', 'ui-race.json'),
  annotations: join(dir, 'ui', 'race.annotations.json'),
  meta: join(dir, 'ui', 'race.meta.json'),
});
const historyDir = () => join(dir, '_history', 'ui-race');

function studio(doc: Y.Doc, { waitForReconcile = false } = {}) {
  const sent: Array<{ p: LaneProposal; answer: (o: ProposalOutcome) => void }> = [];
  let n = 0;
  const link: AcceptedLaneLink = {
    on: () => true,
    newTransactionId: () => `tx_${++n}`,
    propose: (p) => new Promise<ProposalOutcome>((answer) => sent.push({ p, answer })),
  };
  const conflicts: unknown[] = [];
  const projection = createDocProjection({
    slug: 'ui-race',
    doc,
    paths: paths(),
    flushMs: 0,
    historyDir: historyDir(),
    accepted: link,
    waitForReconcile,
    onConflict: (c) => conflicts.push(c),
  });
  projection.start();
  return { projection, sent, conflicts };
}
const publish = (doc: Y.Doc, html: string) =>
  doc.transact(() => applyHtmlToDoc(doc, html, REMOTE), REMOTE);
const settle = () => new Promise((r) => setTimeout(r, 20));
const disk = () => readFileSync(paths().html, 'utf8');

/** Alice made the canvas (so no base slot was ever written), trashed three artboards, was refused. */
async function aliceHeld() {
  writeFileSync(paths().html, ALL);
  const doc = new Y.Doc();
  const a = studio(doc);
  a.projection.reconcile();
  // what the create path does when the project takes this Mac's new canvas (accepted-cold-start)
  a.projection.adoptBase(ALL);
  publish(doc, ALL);
  await settle();
  expect(readRecoveryBody(historyDir(), paths().html, 'base')).toBeNull();
  // the trash: her file, proposed from the version she saw; bob's landed first
  writeFileSync(paths().html, MINE);
  a.projection.applyFromFs({ path: paths().html, bytes: enc(MINE), hash: hashBytes(MINE) });
  expect(a.sent[0]?.p).toMatchObject({ lane: 'html', content: MINE, baseContent: ALL });
  publish(doc, THEIRS);
  a.sent[0]?.answer({ status: 'rejected', code: 'base-conflict', head: laneHash(THEIRS) });
  await settle();
  expect(disk()).toBe(MINE);
  expect(a.conflicts).toHaveLength(1);
  expect(readRecoveryCandidate(historyDir(), paths().html)).toMatchObject({
    original: MINE,
    base: ALL,
    resolved: false,
  });
  a.projection.stop();
}

/** The studio starts again on the same disk; the project still holds bob's version. */
async function restart(wasAccepted: (content: string) => Promise<boolean | null>) {
  const doc = new Y.Doc();
  publish(doc, THEIRS);
  const b = studio(doc, { waitForReconcile: true });
  const joined = await acceptedColdStart({
    slug: 'ui-race',
    doc,
    paths: paths(),
    rel: 'ui/race.tsx',
    inProject: true,
    projection: b.projection,
    historyDir: historyDir(),
    wasAccepted,
    createDoc: async () => ({ status: 'rejected', code: 'in-project' }),
    log: { log() {}, warn() {} },
  });
  b.projection.reconcile();
  await settle();
  return { ...b, joined };
}

describe('F15 — a held conflict outlives a restart', () => {
  test('the project once accepted the refused bytes elsewhere: still held, never overwritten', async () => {
    await aliceHeld();
    // the hub has these bytes from some revision (a twin canvas, an earlier trash undone)
    const r = await restart(async (content) => content === MINE);
    const html =
      r.joined.kind === 'reconciled' ? r.joined.verdicts.find((v) => v.lane === 'html') : null;
    expect(html?.decision).toBe('hold');
    expect(disk()).toBe(MINE);
    expect(r.conflicts).toHaveLength(1);
    // the project's version is kept beside it for Compare
    const incoming = join(historyDir(), 'sync-recovery', 'incoming.tsx');
    expect(existsSync(incoming) && readFileSync(incoming, 'utf8')).toBe(THEIRS);
  });

  test('no record of an open conflict: the cell-wake rule still materializes an older accepted disk', async () => {
    // a checkout restored from a backup holds a value the project accepted at some revision
    writeFileSync(paths().html, ALL);
    const r = await restart(async (content) => content === ALL);
    const html =
      r.joined.kind === 'reconciled' ? r.joined.verdicts.find((v) => v.lane === 'html') : null;
    expect(html?.decision).toBe('materialize');
    expect(disk()).toBe(THEIRS);
    expect(r.conflicts).toHaveLength(0);
  });

  test('a resolved episode does not keep the next restart from materializing', async () => {
    await aliceHeld();
    // Take theirs: the project's version comes back to disk and the episode is resolved
    const doc = new Y.Doc();
    publish(doc, THEIRS);
    const s = studio(doc);
    s.projection.hold('html', THEIRS, MINE);
    expect(s.projection.takeAccepted()).toBe(true);
    await settle();
    expect(disk()).toBe(THEIRS);
    expect(readRecoveryCandidate(historyDir(), paths().html)?.resolved).toBe(true);
    s.projection.stop();
    // later the disk holds an older accepted body again (a backup restore), with no base slot to
    // judge it by (a checkout restored without its _history) — the cell-wake rule decides
    rmSync(join(historyDir(), 'sync-recovery', 'base.tsx'), { force: true });
    writeFileSync(paths().html, ALL);
    const r = await restart(async (content) => content === ALL);
    const html =
      r.joined.kind === 'reconciled' ? r.joined.verdicts.find((v) => v.lane === 'html') : null;
    expect(html?.decision).toBe('materialize');
    expect(disk()).toBe(THEIRS);
  });
});
