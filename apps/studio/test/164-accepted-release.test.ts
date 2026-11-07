// #164 B4 — a hub project's parked writes that a settle did NOT claim are released as OUTSIDE, and go out
// exactly as the lane edits they were: one `edit` proposal per write, in arrival order, each under its own
// transaction id, label and write id — the shape `laneLink` sends any other lane edit in (an annotations
// write carries `objects: 'hold'`, S9.24). Never the stage's generic per-canvas default (a `label` from the
// slug, the writes folded into one, no write id, no `objects`).
// Contract: apps/studio/client/v2/contracts/164-hash-diff-attribution.md §3.4, §5 (`sync/action-stage.ts`).

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAcceptedLink } from '../sync/accepted-link.ts';
import type { TransactionClient } from '../sync/transaction-client.ts';

const quiet = { log() {}, warn() {}, error() {} };
const dirs: string[] = [];
const links: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const l of links.splice(0)) l.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Sent = {
  kind: string;
  label: string;
  transactionId?: string;
  dependsOn?: string[];
  operations: Array<Record<string, unknown>>;
};

/** A link over a stub transaction client that records every proposal and accepts it. */
function rig() {
  const designRoot = mkdtempSync(path.join(tmpdir(), 'maude-164-release-'));
  dirs.push(designRoot);
  const sent: Sent[] = [];
  let n = 0;
  const client = {
    newTransactionId: () => `tx_new${++n}`,
    bootstrap: async () => ({ mode: 'transactions' }),
    propose: async (a: Sent) => {
      sent.push(a);
      return {
        protocol: 1,
        status: 'accepted',
        transactionId: a.transactionId ?? 'tx_x',
        actionId: `act_${sent.length}`,
      };
    },
    read: async () => ({}),
    reserve: () => ({ transactionId: 'tx_r', createdAt: 1 }),
    entryFile: () => path.join(designRoot, 'none'),
    stop() {},
  } as unknown as TransactionClient;
  const l = createAcceptedLink({
    hubUrl: 'https://hub.test',
    token: () => 't',
    designRoot,
    docNameFor: (s) => `doc:${s}`,
    client,
    log: quiet,
  });
  links.push(l);
  return { l, sent };
}

describe('#164 B4 — a hub project releases parked writes as the lane edits they were', () => {
  test('an unclaimed parked write goes out under its own transaction, label, write id and object hold', async () => {
    const { l, sent } = rig();
    l.stage.begin('acp:c1', 'python', {
      runId: 'r_py',
      shell: { call: 'b1', open: true, slugs: ['ui-a'] },
    });
    const lane = l.laneLink('ui-a');
    const first = lane.propose({
      lane: 'annotations',
      content: '{"v":2,"elements":[1]}',
      baseContent: '{"v":2,"elements":[]}',
      transactionId: 'tx_one',
      writeId: 'w_one',
      stageable: true,
    });
    const second = lane.propose({
      lane: 'html',
      content: 'after',
      baseContent: 'before',
      transactionId: 'tx_two',
      writeId: 'w_two',
      stageable: true,
    });
    expect(l.stage.parked()).toEqual([
      { slug: 'ui-a', lane: 'annotations' },
      { slug: 'ui-a', lane: 'html' },
    ]);
    expect(sent).toEqual([]); // parked: nothing out while the window is open
    l.stage.settleShellCall('r_py', 'b1'); // the settle claimed nothing: released as outside
    expect(await first).toMatchObject({ status: 'accepted' });
    expect(await second).toMatchObject({ status: 'accepted' });
    expect(l.stage.summaryOf('r_py')?.canvases ?? []).toEqual([]);
    expect(sent.map((s) => [s.kind, s.label, s.transactionId])).toEqual([
      ['edit', 'Edit annotations', 'tx_one'],
      ['edit', 'Edit canvas', 'tx_two'],
    ]);
    expect(sent[0].operations).toEqual([
      {
        op: 'lane.replace',
        doc: 'doc:ui-a',
        lane: 'annotations',
        content: '{"v":2,"elements":[1]}',
        baseContent: '{"v":2,"elements":[]}',
        writeId: 'w_one',
        objects: 'hold',
      },
    ]);
    expect(sent[1].operations).toEqual([
      {
        op: 'lane.replace',
        doc: 'doc:ui-a',
        lane: 'html',
        content: 'after',
        baseContent: 'before',
        writeId: 'w_two',
      },
    ]);
  });

  test('two parked writes of one lane go out in arrival order, each its own edit', async () => {
    const { l, sent } = rig();
    l.stage.begin('acp:c2', 'sed', {
      runId: 'r_sed',
      shell: { call: 'b2', open: true, slugs: ['ui-b'] },
    });
    const lane = l.laneLink('ui-b');
    const a = lane.propose({
      lane: 'html',
      content: 'one',
      baseContent: 'zero',
      transactionId: 'tx_a',
      stageable: true,
    });
    const b = lane.propose({
      lane: 'html',
      content: 'two',
      baseContent: 'one',
      transactionId: 'tx_b',
      dependsOn: ['tx_a'],
      stageable: true,
    });
    l.stage.releaseShellCall('r_sed', 'b2', 'no-settle');
    await Promise.all([a, b]);
    expect(sent.map((s) => [s.transactionId, s.operations[0].content, s.dependsOn])).toEqual([
      ['tx_a', 'one', undefined],
      ['tx_b', 'two', ['tx_a']],
    ]);
  });
});
