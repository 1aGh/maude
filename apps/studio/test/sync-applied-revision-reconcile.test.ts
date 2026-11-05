// fix/205-s515 — a revision that reaches the replica BEFORE the cold start reconciles is still
// reported applied.
//
// The creator of a new canvas proposes `doc.create` over HTTP and the hub publishes the accepted
// document over the WebSocket. When the publication wins that race (a slow answer — seen on CI as
// a 300–400 ms create), the projection is not `ready` yet: its flush returns early and the stamp
// is first seen by `reconcile()`, which materialised the disk but never said "applied". Nothing
// else changes on that document, so `status().appliedRevision` stayed one revision behind the
// head — the Version history panel did not refresh (`refreshKey`), and S5.15's two-Mac test timed
// out on "you to apply rN" (fix/205-release CI, shard 1, 2 of 4 runs).

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';

import { applyHtmlToDoc } from '../sync/codec.ts';
import { createDocProjection, type ProposalOutcome } from '../sync/projection.ts';

const REMOTE = { remote: true };
const src = (title: string) => `export default () => <h1 title="${title}">x</h1>;\n`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'applied-revision-reconcile-'));
  mkdirSync(join(dir, 'ui'), { recursive: true });
  mkdirSync(join(dir, '_comments'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function rig(body: string) {
  const paths = {
    html: join(dir, 'ui', 'new.tsx'),
    comments: join(dir, '_comments', 'ui-new.json'),
    annotations: join(dir, 'ui-new.annotations.svg'),
  };
  writeFileSync(paths.html, body);
  const doc = new Y.Doc();
  const applied: number[] = [];
  const projection = createDocProjection({
    slug: 'ui-new',
    doc,
    paths,
    flushMs: 0,
    waitForReconcile: true,
    accepted: {
      on: () => true,
      newTransactionId: () => 'tx_1',
      propose: () => new Promise<ProposalOutcome>(() => {}),
    },
    onRevisionApplied: (rev) => applied.push(rev),
  });
  /** The hub publishes the accepted document, stamped with its revision. */
  const publish = (html: string, revision: number) =>
    doc.transact(() => {
      applyHtmlToDoc(doc, html, REMOTE);
      doc.getMap('syncMeta').set('acceptedRevision', revision);
    }, REMOTE);
  return { doc, paths, projection, publish, applied };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

test('the publication beats the create answer: reconcile reports the revision applied', async () => {
  const body = src('new canvas');
  const r = rig(body);
  r.projection.start();
  // The WebSocket publication lands while `doc.create` is still unanswered (not ready yet).
  r.publish(body, 13);
  await tick();
  expect(r.applied).toEqual([]); // nothing is on record before the cold start decided
  // The create answer: the cold start adopts the base, then the runtime reconciles.
  r.projection.adoptBase(body, { remember: true });
  r.projection.reconcile();
  await tick();
  expect(readFileSync(r.paths.html, 'utf8')).toBe(body);
  expect(r.applied.at(-1)).toBe(13);
});

test('the answer first, the publication after: still applied once (the ordinary path)', async () => {
  const body = src('new canvas');
  const r = rig(body);
  r.projection.start();
  r.projection.adoptBase(body, { remember: true });
  r.projection.reconcile();
  r.publish(body, 14);
  await tick();
  expect(r.applied.at(-1)).toBe(14);
});
