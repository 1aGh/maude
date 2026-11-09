// 2.1.1 T8 — a write to a canvas another run created joins the creator ONE hop: two runs that each
// hold a create lane for the same canvas (stage state restored from an older build) must not bounce
// the write between them forever.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createActionStage } from '../sync/action-stage.ts';
import { hashBytes } from '../sync/echo-guard.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 't8-stage-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const createLane = { slug: 'ui-x', doc: 'doc-x', lane: 'meta', base: '', mine: 'M', writes: 1 };

test('two restored runs both creating one canvas: a third run’s write lands in one of them', () => {
  mkdirSync(join(dir, '_state'), { recursive: true });
  writeFileSync(
    join(dir, '_state', 'ai-stage.json'),
    JSON.stringify({
      v: 2,
      runs: ['r_a', 'r_b'].map((runId) => ({
        runId,
        label: runId,
        state: 'held',
        since: 1,
        touched: {},
        lanes: [{ ...createLane, create: 'ui/x.tsx' }],
      })),
    })
  );
  const stage = createActionStage({
    designRoot: dir,
    propose: async () => ({ protocol: 1, status: 'accepted', transactionId: 'g' }),
    newTransactionId: () => 'tx_group',
    log: { log() {}, warn() {} },
    now: () => 1_000,
  });
  stage.restore();
  stage.begin('c', 'Third run', { runId: 'r_c' });
  stage.claim('r_c', 'ui-x', hashBytes('H1'));
  let pending: Promise<unknown> | undefined;
  expect(() => {
    pending = stage.capture('ui-x', 'doc-x', {
      lane: 'html',
      content: 'H1',
      baseContent: '',
      transactionId: 'tx1',
      stageable: true,
    });
  }).not.toThrow();
  expect(pending).toBeDefined();
  const holders = stage
    .runs()
    .filter((r) => r.runId === 'r_a' || r.runId === 'r_b')
    .map((r) => r.runId);
  expect(holders.sort()).toEqual(['r_a', 'r_b']);
});
