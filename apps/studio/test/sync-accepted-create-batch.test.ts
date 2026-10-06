// A burst of new canvases is ONE proposal — F3 S14 on the cloud cell: a fresh
// link sent its 77 creates one by one on the serialized transaction queue and
// the first edit waited 44 s behind them.

import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAcceptedLink } from '../sync/accepted-link.ts';
import type { Operation, ProposalResult, TransactionClient } from '../sync/transaction-client.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Sent {
  label: string;
  operations: Operation[];
}

/** A client that records every proposal and answers with `decide`. */
function fakeClient(decide: (ops: Operation[]) => ProposalResult['status'] = () => 'accepted') {
  const sent: Sent[] = [];
  let n = 0;
  const client = {
    propose: async (a: { label: string; operations: Operation[] }) => {
      sent.push({ label: a.label, operations: a.operations });
      const status = decide(a.operations);
      return {
        protocol: 1,
        status,
        transactionId: `tx_${sent.length}`,
        ...(status === 'accepted' ? { actionId: `a_${sent.length}` } : { code: 'path-conflict' }),
      } as ProposalResult;
    },
    newTransactionId: () => `tx_new_${++n}`,
    bootstrap: async () => {
      throw new Error('not used');
    },
  } as unknown as TransactionClient;
  return { client, sent };
}

function link(client: TransactionClient) {
  const root = mkdtempSync(join(tmpdir(), 'maude-create-batch-'));
  dirs.push(root);
  return createAcceptedLink({
    hubUrl: 'http://hub.test',
    token: () => 't',
    designRoot: root,
    docNameFor: (slug) => slug,
    client,
    log: { log() {}, warn() {}, error() {} },
  });
}

const html = (t: string) => `export default () => <h1>${t}</h1>;\n`;

test('creates that arrive together travel as one proposal', async () => {
  const { client, sent } = fakeClient();
  const l = link(client);
  const answers = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      l.createDoc(`ui-c${i}`, `ui/c${i}.tsx`, { html: html(`c${i}`) })
    )
  );
  expect(sent).toHaveLength(1);
  expect(sent[0]?.label).toBe('Add 30 canvases');
  expect(sent[0]?.operations.map((o) => o.doc)).toEqual(
    Array.from({ length: 30 }, (_, i) => `ui-c${i}`)
  );
  expect(answers.every((a) => a.status === 'accepted')).toBe(true);
});

test('a single create is still its own "Create canvas" action', async () => {
  const { client, sent } = fakeClient();
  const l = link(client);
  expect((await l.createDoc('ui-one', 'ui/one.tsx', { html: html('one') })).status).toBe(
    'accepted'
  );
  expect(sent.map((s) => s.label)).toEqual(['Create canvas']);
});

test('a refused batch falls back to one proposal each — one bad canvas does not hold back the rest', async () => {
  // The project refuses any proposal that carries `ui-bad`.
  const { client, sent } = fakeClient((ops) =>
    ops.some((o) => o.doc === 'ui-bad') ? 'rejected' : 'accepted'
  );
  const l = link(client);
  const [good1, bad, good2] = await Promise.all([
    l.createDoc('ui-good1', 'ui/good1.tsx', { html: html('g1') }),
    l.createDoc('ui-bad', 'ui/bad.tsx', { html: html('bad') }),
    l.createDoc('ui-good2', 'ui/good2.tsx', { html: html('g2') }),
  ]);
  expect(good1?.status).toBe('accepted');
  expect(good2?.status).toBe('accepted');
  expect(bad?.status).toBe('rejected');
  expect(sent[0]?.operations).toHaveLength(3);
  expect(sent.slice(1).map((s) => s.operations.map((o) => o.doc))).toEqual([
    ['ui-good1'],
    ['ui-bad'],
    ['ui-good2'],
  ]);
});

test('an edit made during the window never overtakes the create of its canvas', async () => {
  const { client, sent } = fakeClient();
  const l = link(client);
  const created = l.createDoc('ui-new', 'ui/new.tsx', { html: html('v0') });
  // The watcher reports the canvas's first save before the window closes.
  const edited = l.laneLink('ui-new').propose({
    lane: 'html',
    content: html('v1'),
    baseContent: html('v0'),
    transactionId: 'tx_edit',
  });
  await Promise.all([created, edited]);
  expect(sent.map((s) => s.operations[0]?.op)).toEqual(['doc.create', 'lane.replace']);
});

test('an edit waiting on a refused batch goes after its canvas is created on its own', async () => {
  // The batch answer is held open so the edit arrives while it is in flight.
  const sent: string[] = [];
  let answerBatch: (r: ProposalResult) => void = () => {};
  const client = {
    propose: (a: { operations: Operation[] }) => {
      sent.push(a.operations.map((o) => `${o.op}:${o.doc}`).join(','));
      if (a.operations.length > 1)
        return new Promise<ProposalResult>((r) => {
          answerBatch = r;
        });
      return Promise.resolve({
        protocol: 1,
        status: 'accepted',
        transactionId: `tx_${sent.length}`,
        actionId: `a_${sent.length}`,
      } as ProposalResult);
    },
    newTransactionId: () => `tx_new_${sent.length}`,
    bootstrap: async () => {
      throw new Error('not used');
    },
  } as unknown as TransactionClient;
  const l = link(client);
  const created = Promise.all([
    l.createDoc('ui-a', 'ui/a.tsx', { html: html('a') }),
    l.createDoc('ui-b', 'ui/b.tsx', { html: html('b') }),
  ]);
  await new Promise((r) => setTimeout(r, 60));
  expect(sent).toEqual(['doc.create:ui-a,doc.create:ui-b']);
  const edited = l.laneLink('ui-b').propose({
    lane: 'html',
    content: html('b1'),
    baseContent: html('b'),
    transactionId: 'tx_edit',
  });
  await new Promise((r) => setTimeout(r, 10));
  expect(sent).toHaveLength(1);
  answerBatch({
    protocol: 1,
    status: 'rejected',
    transactionId: 'tx_b',
    code: 'path-conflict',
  } as ProposalResult);
  await Promise.all([created, edited]);
  expect(sent.slice(1)).toEqual(['doc.create:ui-a', 'doc.create:ui-b', 'lane.replace:ui-b']);
});
