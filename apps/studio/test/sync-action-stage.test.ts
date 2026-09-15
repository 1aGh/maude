// Plan T16 — AI and multi-file action boundaries (sync/action-stage.ts).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createActionStage } from '../sync/action-stage.ts';
import type { LaneProposal } from '../sync/projection.ts';
import type { Operation, ProposalResult } from '../sync/transaction-client.ts';

const quiet = { log() {}, warn() {} };
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ai-stage-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function rig(
  answer: (ops: Operation[]) => ProposalResult = () => ({
    protocol: 1,
    status: 'accepted',
    transactionId: 'g',
  })
) {
  const sent: { label: string; kind: string; operations: Operation[]; transactionId: string }[] =
    [];
  let n = 0;
  const stage = createActionStage({
    designRoot: dir,
    propose: async (a) => {
      sent.push(a);
      return answer(a.operations);
    },
    newTransactionId: () => `tx_group_${++n}`,
    log: quiet,
  });
  return { stage, sent };
}

const prop = (
  lane: LaneProposal['lane'],
  content: string,
  base: string,
  tx: string
): LaneProposal => ({
  lane,
  content,
  baseContent: base,
  transactionId: tx,
  stageable: true,
});

describe('AI action stage', () => {
  test('changes made while an action is open go out as ONE action when it ends well', async () => {
    const { stage, sent } = rig();
    stage.begin('acp:c1', 'Claude: tidy the header');
    expect(stage.captures('ui-a', true)).toBe(true);
    expect(stage.captures('ui-a', false)).toBe(false); // the person's UI edit is theirs
    const a1 = stage.capture('ui-a', 'doc-a', prop('html', 'A1', 'A0', 'tx1'));
    const a2 = stage.capture('ui-a', 'doc-a', prop('html', 'A2', 'A1', 'tx2'));
    const b = stage.capture('ui-b', 'doc-b', prop('html', 'B1', 'B0', 'tx3'));
    expect(sent).toHaveLength(0);
    expect(existsSync(join(dir, '_state', 'ai-stage.json'))).toBe(true);

    const r = await stage.end('acp:c1', 'done');
    expect(r?.status).toBe('accepted');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.label).toBe('Claude: tidy the header');
    expect(sent[0]?.kind).toBe('ai');
    // The FIRST base, the LAST content — one replace per lane.
    expect(sent[0]?.operations).toEqual([
      { op: 'lane.replace', doc: 'doc-a', lane: 'html', content: 'A2', baseContent: 'A0' },
      { op: 'lane.replace', doc: 'doc-b', lane: 'html', content: 'B1', baseContent: 'B0' },
    ]);
    expect((await a1).status).toBe('accepted');
    expect((await a2).status).toBe('accepted');
    expect((await b).status).toBe('accepted');
    expect(stage.state).toBeNull();
    expect(existsSync(join(dir, '_state', 'ai-stage.json'))).toBe(false);
    // A later proposal that named a staged one depends on the group instead.
    expect(stage.mapDeps(['tx2'])).toEqual(['tx_group_1']);
  });

  test('an action that fails publishes nothing and throws nothing away', async () => {
    const { stage, sent } = rig();
    stage.begin('edit:ui/a.tsx', 'Claude edited a');
    void stage.capture('ui-a', 'doc-a', prop('html', 'half', 'A0', 'tx1'));
    expect(await stage.end('edit:ui/a.tsx', 'failed')).toBeNull();
    expect(sent).toHaveLength(0);
    expect(stage.summary()).toMatchObject({ state: 'held', canvases: ['ui-a'] });
    // Publishing the held edit is the person's choice.
    const r = await stage.publish();
    expect(r?.status).toBe('accepted');
    expect(sent).toHaveLength(1);
  });

  test('discard answers every held change "discarded", and the dependents with it', async () => {
    const { stage, sent } = rig();
    stage.begin('k', 'AI');
    const staged = stage.capture('ui-a', 'doc-a', prop('html', 'half', 'A0', 'tx1'));
    await stage.end('k', 'failed');
    // The person edited on top of the unpublished bytes: it waits behind the stage.
    expect(stage.holdsDependency(['tx1'])).toBe(true);
    let dropped: unknown = null;
    stage.wait({ dependsOn: ['tx1'], send: () => {}, drop: (o) => (dropped = o) });
    expect(stage.discard()).toBe(1);
    expect(await staged).toEqual({ status: 'rejected', code: 'discarded' });
    expect(dropped).toEqual({ status: 'rejected', code: 'discarded' });
    expect(sent).toHaveLength(0);
    expect(stage.state).toBeNull();
  });

  test('two participants: the action publishes when the LAST ends, and holds if either failed', async () => {
    const { stage, sent } = rig();
    stage.begin('acp:c1', 'AI');
    stage.begin('edit:ui/a.tsx', 'AI 2');
    void stage.capture('ui-a', 'doc-a', prop('html', 'x', 'A0', 'tx1'));
    await stage.end('edit:ui/a.tsx', 'done');
    expect(sent).toHaveLength(0);
    await stage.end('acp:c1', 'failed');
    expect(stage.state).toBe('held');
  });

  test('a crash comes back HELD: the next session stages the cold start instead of publishing it', async () => {
    const first = rig();
    first.stage.begin('k', 'Claude: two files');
    void first.stage.capture('ui-a', 'doc-a', prop('html', 'A1', 'A0', 'tx1'));
    // ...process dies here.
    const second = rig();
    second.stage.restore();
    expect(second.stage.summary()).toMatchObject({
      state: 'held',
      label: 'Claude: two files',
      canvases: ['ui-a'],
    });
    expect(second.stage.captures('ui-a', true)).toBe(true); // its cold start difference
    expect(second.stage.captures('ui-z', true)).toBe(false); // another canvas proceeds normally
    const p = second.stage.capture('ui-a', 'doc-a', prop('html', 'A1', 'A1-guess', 'tx9'));
    await second.stage.publish();
    // The base survives the restart — not the cold start's guess.
    expect(second.sent[0]?.operations[0]).toMatchObject({ content: 'A1', baseContent: 'A0' });
    expect((await p).status).toBe('accepted');
  });

  test('a group rejection names the conflicting lane only', async () => {
    const { stage } = rig(() => ({
      protocol: 1,
      status: 'rejected',
      code: 'base-conflict',
      transactionId: 'g',
      doc: 'doc-b',
      lane: 'html',
      head: 'h1',
    }));
    stage.begin('k', 'AI');
    const a = stage.capture('ui-a', 'doc-a', prop('html', 'x', 'A0', 'tx1'));
    const b = stage.capture('ui-b', 'doc-b', prop('html', 'y', 'B0', 'tx2'));
    await stage.end('k', 'done');
    expect(await a).toEqual({ status: 'rejected', code: 'base-conflict' });
    expect(await b).toEqual({ status: 'rejected', code: 'base-conflict', head: 'h1' });
  });
});
