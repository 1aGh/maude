// 2.1.1 S1 — a FIRST link to a server that already holds a canvas never drops this Mac's
// comments, board or layout for that canvas.
//
// Reproduced end to end (link a folder to a fixture hub that holds the same canvas): the source
// lane was held as a conflict (safe), but the side lanes took the server's value with nothing
// said — the comments and board this Mac had never reached the project, the layout/title was
// overwritten with no copy at all, and the three recovery copies shared ONE `local.json`, so the
// board's copy overwrote the comments' (the comments were then gone for good once the file was
// rewritten). The rule now:
//
//   • comments and board elements the project never accepted are this Mac's own work: they join
//     the project as the accepted value plus what only this disk has (ids keep them apart);
//   • whatever of this Mac's the project's value replaces (layout/title, an id both sides
//     changed) is kept in that lane's OWN recovery slot and reported as set aside;
//   • a value the project once accepted is an older accepted state: the project's wins, quietly,
//     as before.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';

import { acceptedColdStart, setAsideNotice, unionById } from '../sync/accepted-cold-start.ts';
import {
  applyAnnotationsToDoc,
  applyCommentsToDoc,
  applyHtmlToDoc,
  applyMetaToDoc,
} from '../sync/codec.ts';
import {
  type AcceptedLaneLink,
  createDocProjection,
  type LaneProposal,
  type ProposalOutcome,
} from '../sync/projection.ts';
import { readRecoveryBody } from '../sync/source-recovery.ts';
import { board, sticky } from './fixtures/annotations-v2/boards.ts';

const REMOTE = { remote: true };
const SLUG = 'ui-same';
const SRC = `import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas><h1>same</h1></DesignCanvas>;\n`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 's1-side-lanes-'));
  mkdirSync(join(dir, 'ui'), { recursive: true });
  mkdirSync(join(dir, '_comments'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const paths = () => ({
  html: join(dir, 'ui', 'same.tsx'),
  css: join(dir, 'ui', 'same.css'),
  comments: join(dir, '_comments', `${SLUG}.json`),
  annotations: join(dir, `${SLUG}.annotations.json`),
  meta: join(dir, 'ui', 'same.meta.json'),
});
const historyDir = () => join(dir, '_history', SLUG);
const settle = () => new Promise((r) => setTimeout(r, 30));

const SERVER_COMMENTS = [{ id: 'c-server', text: 'server comment' }];
const MY_COMMENTS = [{ id: 'c-mine', text: 'my comment' }];
const SERVER_BOARD = board(sticky('s1', 'server note'));
const MY_BOARD = board(sticky('m1', 'my note', { x: 300, index: 'a1' }));

async function firstLink(o: {
  wasAccepted: (content: string) => Promise<boolean | null>;
  myBoard?: string;
}) {
  const p = paths();
  writeFileSync(p.html, SRC);
  writeFileSync(p.meta, `${JSON.stringify({ title: 'My title' }, null, 2)}\n`);
  writeFileSync(p.comments, JSON.stringify(MY_COMMENTS));
  writeFileSync(p.annotations, o.myBoard ?? MY_BOARD);
  const doc = new Y.Doc();
  doc.transact(() => {
    applyHtmlToDoc(doc, SRC, REMOTE);
    applyMetaToDoc(doc, JSON.stringify({ title: 'Server title' }), REMOTE);
    applyCommentsToDoc(doc, SERVER_COMMENTS, REMOTE);
    applyAnnotationsToDoc(doc, SERVER_BOARD, REMOTE);
  }, REMOTE);
  const sent: LaneProposal[] = [];
  let n = 0;
  const link: AcceptedLaneLink = {
    on: () => true,
    newTransactionId: () => `tx_${++n}`,
    propose: (prop) => {
      sent.push(prop);
      return new Promise<ProposalOutcome>(() => {});
    },
  };
  const projection = createDocProjection({
    slug: SLUG,
    doc,
    paths: p,
    flushMs: 0,
    historyDir: historyDir(),
    accepted: link,
    waitForReconcile: true,
  });
  projection.start();
  const r = await acceptedColdStart({
    slug: SLUG,
    doc,
    paths: p,
    rel: 'ui/same.tsx',
    inProject: true,
    projection,
    historyDir: historyDir(),
    wasAccepted: o.wasAccepted,
    createDoc: async () => ({ status: 'accepted' }),
    log: { log() {}, warn() {} },
  });
  projection.reconcile();
  await settle();
  projection.stop();
  return { r, sent };
}

const verdict = (r: Awaited<ReturnType<typeof acceptedColdStart>>, lane: string) =>
  r.kind === 'reconciled' ? r.verdicts.find((v) => v.lane === lane) : undefined;
const sentLane = (sent: LaneProposal[], lane: string) => sent.find((s) => s.lane === lane);

describe('S1 — a first link keeps this Mac’s comments, board and layout', () => {
  test('comments and board elements the project never had join it, next to the server’s', async () => {
    const { r, sent } = await firstLink({ wasAccepted: async () => false });

    expect(verdict(r, 'comments')?.decision).toBe('propose');
    const comments = JSON.parse(sentLane(sent, 'comments')?.content ?? '[]') as { id: string }[];
    expect(comments.map((c) => c.id).sort()).toEqual(['c-mine', 'c-server']);

    expect(verdict(r, 'annotations')?.decision).toBe('propose');
    const boardSent = sentLane(sent, 'annotations')?.content ?? '';
    expect(boardSent).toContain('"id":"m1"');
    expect(boardSent).toContain('"id":"s1"');
    // proposed on top of the project's value, so the hub merges, never replaces
    expect(sentLane(sent, 'annotations')?.baseContent).toContain('"id":"s1"');
  });

  test('the layout/title the project’s replaces is kept in its own slot and reported', async () => {
    const { r } = await firstLink({ wasAccepted: async () => false });
    expect(verdict(r, 'meta')?.decision).toBe('materialize');
    expect(readRecoveryBody(historyDir(), paths().meta, 'local')).toContain('My title');
    expect(r.kind === 'reconciled' ? r.setAside : undefined).toEqual(['meta']);
  });

  test('each side lane keeps its own recovery copy — the board’s never overwrites the comments’', async () => {
    // unknown answer (an older server): nothing is proposed, everything replaced is kept and reported
    const { r } = await firstLink({ wasAccepted: async () => null });
    expect(readRecoveryBody(historyDir(), paths().comments, 'local')).toBe(
      JSON.stringify(MY_COMMENTS)
    );
    expect(readRecoveryBody(historyDir(), paths().annotations, 'local')).toBe(MY_BOARD);
    expect(readRecoveryBody(historyDir(), paths().meta, 'local')).toContain('My title');
    expect(r.kind === 'reconciled' ? [...(r.setAside ?? [])].sort() : []).toEqual([
      'annotations',
      'comments',
      'meta',
    ]);
  });

  test('a board element both sides changed keeps the project’s, and this Mac’s is set aside', async () => {
    const mine = board(
      sticky('s1', 'my edit of the server note'),
      sticky('m1', 'my note', { x: 300, index: 'a1' })
    );
    const { r, sent } = await firstLink({ wasAccepted: async () => false, myBoard: mine });
    const boardSent = sentLane(sent, 'annotations')?.content ?? '';
    expect(boardSent).toContain('server note');
    expect(boardSent).not.toContain('my edit of the server note');
    expect(boardSent).toContain('"id":"m1"');
    expect(readRecoveryBody(historyDir(), paths().annotations, 'local')).toBe(mine);
    expect(r.kind === 'reconciled' ? r.setAside : undefined).toContain('annotations');
  });

  test('an older accepted state (the project once had these values) still takes the project’s, quietly', async () => {
    const { r, sent } = await firstLink({ wasAccepted: async () => true });
    expect(verdict(r, 'comments')?.decision).toBe('materialize');
    expect(verdict(r, 'annotations')?.decision).toBe('materialize');
    expect(sentLane(sent, 'comments')).toBeUndefined();
    expect(sentLane(sent, 'annotations')).toBeUndefined();
    expect(r.kind === 'reconciled' ? r.setAside : undefined).toBeUndefined();
  });
});

describe('unionById', () => {
  test('nothing new on this side → null; a new id → appended after the project’s', () => {
    expect(
      unionById('comments', JSON.stringify(SERVER_COMMENTS), JSON.stringify(SERVER_COMMENTS))
    ).toBeNull();
    const u = unionById('comments', JSON.stringify(MY_COMMENTS), JSON.stringify(SERVER_COMMENTS));
    expect(u?.complete).toBe(true);
    expect((JSON.parse(u?.value ?? '[]') as { id: string }[]).map((c) => c.id)).toEqual([
      'c-server',
      'c-mine',
    ]);
    expect(unionById('annotations', MY_BOARD, '')?.value).toContain('"id":"m1"');
  });
});

describe('setAsideNotice', () => {
  test('names the canvas, what of this Mac’s was replaced, and where the copy is', () => {
    expect(setAsideNotice('ui/Pricing.tsx', 'ui-pricing', ['meta', 'comments'])).toBe(
      'Pricing: the project’s layout and comments replaced this Mac’s. This Mac’s copy is kept in _history/ui-pricing/sync-recovery/.'
    );
  });
});
