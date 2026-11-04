// v2-204 (F15 follow-up) — the canvas's creator has a saved base, so its offline edit after a
// restart is proposed, not held as a conflict.
//
// A peer that receives a canvas writes it to disk and records that body as the base it agreed on
// with the project (`sync-recovery/base.tsx`). The Mac that MADE the canvas never did: its create
// was accepted, `adoptBase` set the base in memory only, and when the publication arrived the
// projection had nothing to write (disk already held it), so no base was persisted. After a
// restart the cold start found no base for the creator, and any edit the creator made while the
// studio was down (offline, or before the publication came back) was judged against nothing:
// `hold` — a false conflict with the source-conflict notice, for an edit nobody else touched.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';

import { acceptedColdStart } from '../sync/accepted-cold-start.ts';
import { applyHtmlToDoc } from '../sync/codec.ts';
import {
  type AcceptedLaneLink,
  createDocProjection,
  type LaneProposal,
  type ProposalOutcome,
} from '../sync/projection.ts';
import { readRecoveryBody } from '../sync/source-recovery.ts';

const REMOTE = { remote: true };
const board = (...ids: string[]) =>
  `export default () => (\n  <DesignCanvas>\n${ids
    .map(
      (id) => `    <DCArtboard id="${id}" width={180} height={254}><h1>${id}</h1></DCArtboard>\n`
    )
    .join('')}  </DesignCanvas>\n);\n`;
const MADE = board('a', 'b', 'c', 'd');
const EDITED = MADE.replace('<h1>d</h1>', '<h1>d edited</h1>');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'v2-204-creator-base-'));
  mkdirSync(join(dir, 'ui'), { recursive: true });
  mkdirSync(join(dir, '_comments'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const paths = () => ({
  html: join(dir, 'ui', 'made.tsx'),
  comments: join(dir, '_comments', 'ui-made.json'),
  annotations: join(dir, 'ui', 'made.annotations.json'),
  meta: join(dir, 'ui', 'made.meta.json'),
});
const historyDir = () => join(dir, '_history', 'ui-made');
const publish = (doc: Y.Doc, html: string) =>
  doc.transact(() => applyHtmlToDoc(doc, html, REMOTE), REMOTE);
const settle = () => new Promise((r) => setTimeout(r, 20));
const disk = () => readFileSync(paths().html, 'utf8');

function studio(doc: Y.Doc) {
  const sent: Array<{ p: LaneProposal; answer: (o: ProposalOutcome) => void }> = [];
  let n = 0;
  const link: AcceptedLaneLink = {
    on: () => true,
    newTransactionId: () => `tx_${++n}`,
    propose: (p) => new Promise<ProposalOutcome>((answer) => sent.push({ p, answer })),
  };
  const conflicts: unknown[] = [];
  const projection = createDocProjection({
    slug: 'ui-made',
    doc,
    paths: paths(),
    flushMs: 0,
    historyDir: historyDir(),
    accepted: link,
    waitForReconcile: true,
    onConflict: (c) => conflicts.push(c),
  });
  projection.start();
  return { projection, sent, conflicts };
}

const coldStart = (
  s: ReturnType<typeof studio>,
  doc: Y.Doc,
  inProject: boolean,
  wasAccepted: (content: string) => Promise<boolean | null> = async () => false
) =>
  acceptedColdStart({
    slug: 'ui-made',
    doc,
    paths: paths(),
    rel: 'ui/made.tsx',
    inProject,
    projection: s.projection,
    historyDir: historyDir(),
    wasAccepted,
    createDoc: async () => ({ status: 'accepted' }),
    log: { log() {}, warn() {} },
  });

describe('v2-204 — the creator of a canvas has a base on record', () => {
  test('an accepted create saves the base; an offline edit after a restart is proposed, not held', async () => {
    // alice makes the canvas; the project takes it
    writeFileSync(paths().html, MADE);
    const doc = new Y.Doc();
    const a = studio(doc);
    const made = await coldStart(a, doc, false);
    expect(made.kind).toBe('created');
    publish(doc, MADE); // the publication comes back: nothing to write, disk already holds it
    a.projection.reconcile();
    await settle();
    expect(disk()).toBe(MADE);
    a.projection.stop();

    // the studio is down (or offline) while she edits one heading by hand
    writeFileSync(paths().html, EDITED);

    // restart: the project still holds what she made, and nobody else touched it
    const doc2 = new Y.Doc();
    publish(doc2, MADE);
    const b = studio(doc2);
    const joined = await coldStart(b, doc2, true);
    b.projection.reconcile();
    await settle();
    const html =
      joined.kind === 'reconciled' ? joined.verdicts.find((v) => v.lane === 'html') : null;
    expect(html?.decision).toBe('propose');
    expect(b.sent[0]?.p).toMatchObject({ lane: 'html', content: EDITED, baseContent: MADE });
    expect(b.conflicts).toHaveLength(0);
    expect(disk()).toBe(EDITED);
    b.projection.stop();
    // the base the create agreed on is on record (until the proposal's answer moves it on)
    expect(readRecoveryBody(historyDir(), paths().html, 'base')).toBe(MADE);
  });

  test('a base handed back for a HOLD is not persisted (it would turn the next restart into a propose)', async () => {
    writeFileSync(paths().html, MADE);
    const doc = new Y.Doc();
    const s = studio(doc);
    s.projection.adoptBase(EDITED);
    await settle();
    expect(readRecoveryBody(historyDir(), paths().html, 'base')).toBeNull();
    s.projection.stop();
  });
});
