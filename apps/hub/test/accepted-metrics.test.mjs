// Plan T29 — the coordinator's operator counters stay bounded and never carry
// what a proposal said: counts by outcome and rejection code, and the durable
// acknowledgment latency (submit → committed answer), nothing else.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createAcceptedMetrics } from '../src/project-transactions/hub-integration.mjs';

describe('accepted-revisions metrics', () => {
  test('outcomes, replays and latency percentiles are counted', () => {
    const m = createAcceptedMetrics();
    for (let i = 1; i <= 100; i++) m.record({ status: 'accepted' }, i);
    m.record({ status: 'accepted', replay: true }, 5);
    m.record({ status: 'rejected', code: 'base-conflict' }, 2);
    const s = m.snapshot();
    assert.equal(s.proposals.accepted, 100);
    assert.equal(s.proposals.replayed, 1);
    assert.deepEqual(s.proposals.rejected, { 'base-conflict': 1 });
    assert.equal(s.ackMs.n, 101);
    assert.ok(s.ackMs.p50 >= 45 && s.ackMs.p50 <= 55, `p50 ${s.ackMs.p50}`);
    assert.ok(s.ackMs.p99 >= 95, `p99 ${s.ackMs.p99}`);
    assert.equal(typeof s.lastProposalAt, 'number');
  });

  test('the latency window and the rejection codes are both bounded', () => {
    const m = createAcceptedMetrics({ window: 16, maxCodes: 4 });
    for (let i = 0; i < 1000; i++) m.record({ status: 'accepted' }, i);
    for (let i = 0; i < 50; i++) m.record({ status: 'rejected', code: `code-${i}` }, 1);
    const s = m.snapshot();
    assert.equal(s.ackMs.n, 16);
    // Four distinct codes, then everything else folds into one bucket.
    assert.equal(Object.keys(s.proposals.rejected).length, 5);
    assert.equal(s.proposals.rejected.other, 46);
  });

  test('nothing a proposal carried reaches the snapshot', () => {
    const m = createAcceptedMetrics();
    const secret = 'sk-live-FAKE-SECRET-0000';
    m.record(
      {
        status: 'rejected',
        code: 'source-invalid',
        message: `bad token ${secret}`,
        path: 'ui/Private Launch Plan.tsx',
        actor: 'ceo@example.test',
      },
      3
    );
    m.record({ status: 'accepted', actionId: secret, doc: 'ui-private' }, 4);
    const text = JSON.stringify(m.snapshot());
    for (const leak of [secret, 'Private Launch Plan', 'ceo@example.test', 'ui-private']) {
      assert.equal(text.includes(leak), false, `snapshot leaked ${leak}`);
    }
    // A code is a label, not a sentence: long input is cut.
    m.record({ status: 'rejected', code: 'x'.repeat(500) }, 1);
    assert.ok(Object.keys(m.snapshot().proposals.rejected).every((k) => k.length <= 40));
  });
});
