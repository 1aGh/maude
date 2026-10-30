// Plan T16 — AI and multi-file action boundaries (sync/action-stage.ts).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createActionStage } from '../sync/action-stage.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import type { LaneProposal } from '../sync/projection.ts';
import type { Operation, ProposalResult } from '../sync/transaction-client.ts';

const quiet = { log() {}, warn() {} };
let clock = 1_000;
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
  const sent: {
    label: string;
    kind: string;
    operations: Operation[];
    transactionId: string;
    origin?: Record<string, unknown>;
    fence?: unknown;
  }[] = [];
  let n = 0;
  const stage = createActionStage({
    designRoot: dir,
    propose: async (a) => {
      sent.push(a);
      return answer(a.operations);
    },
    newTransactionId: () => `tx_group_${++n}`,
    log: quiet,
    now: () => clock,
  });
  return { stage, sent };
}

/**
 * p8-a1-claims — every run is claim-only: the tool that writes `p.content` claims those bytes for the
 * open run(s) first (what the ACP tracker / the hook's edit/check / a verb does), then the watcher's
 * write is captured.
 */
function claimed(
  stage: ReturnType<typeof rig>['stage'],
  slug: string,
  doc: string,
  p: LaneProposal
) {
  for (const r of stage.runs())
    if (r.state === 'open') stage.claim(r.runId, slug, hashBytes(p.content));
  return stage.capture(slug, doc, p);
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
    // p8-a1-claims — nothing claimed: a write is the person's, even with this one run open
    expect(stage.captures('ui-a', true, 'A1')).toBe(false);
    expect(stage.captures('ui-a', false)).toBe(false); // the person's UI edit is theirs
    const a1 = claimed(stage, 'ui-a', 'doc-a', prop('html', 'A1', 'A0', 'tx1'));
    const a2 = claimed(stage, 'ui-a', 'doc-a', prop('html', 'A2', 'A1', 'tx2'));
    const b = claimed(stage, 'ui-b', 'doc-b', prop('html', 'B1', 'B0', 'tx3'));
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
    void claimed(stage, 'ui-a', 'doc-a', prop('html', 'half', 'A0', 'tx1'));
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
    const staged = claimed(stage, 'ui-a', 'doc-a', prop('html', 'half', 'A0', 'tx1'));
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

  test('two runs are two stages: each ends on its own (V2-1.5 U10 — one action today)', async () => {
    const { stage, sent } = rig();
    stage.begin('acp:c1', 'AI');
    stage.begin('edit:ui/a.tsx', 'AI 2');
    stage.claim('acp:c1', 'ui-a', hashBytes('x'));
    void stage.capture('ui-a', 'doc-a', prop('html', 'x', 'A0', 'tx1'));
    await stage.end('edit:ui/a.tsx', 'done');
    // the other run wrote nothing: nothing to publish for it, c1 is still open
    expect(sent).toHaveLength(0);
    expect(stage.state).toBe('open');
    await stage.end('acp:c1', 'failed');
    expect(stage.state).toBe('held');
  });

  test('a crash comes back HELD: the next session stages the cold start instead of publishing it', async () => {
    const first = rig();
    first.stage.begin('k', 'Claude: two files');
    void claimed(first.stage, 'ui-a', 'doc-a', prop('html', 'A1', 'A0', 'tx1'));
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
    const a = claimed(stage, 'ui-a', 'doc-a', prop('html', 'x', 'A0', 'tx1'));
    const b = claimed(stage, 'ui-b', 'doc-b', prop('html', 'y', 'B0', 'tx2'));
    await stage.end('k', 'done');
    expect(await a).toEqual({ status: 'rejected', code: 'base-conflict' });
    expect(await b).toEqual({ status: 'rejected', code: 'base-conflict', head: 'h1' });
  });
});

// V2-1.5 §5.5 — one stage per run, composed per run by a three-way merge.
// Fixture (§7): one canvas file, artboards P and S, both rendering a shared K.
const BASE = '<P>title</P><K>logo</K><S>story</S>';
const P1 = '<P>TITLE</P><K>logo</K><S>story</S>';

describe('per-run stages', () => {
  test('U10: two of your chats on P and S of one file land as TWO actions, each with only its own delta', async () => {
    const { stage, sent } = rig();
    stage.begin('c1-run', 'Restyle the post', { runId: 'r_c1', chatId: 'c1' });
    stage.begin('c2-run', 'Shorten the story', { runId: 'r_c2', chatId: 'c2' });
    stage.claim('r_c1', 'ui-a', hashBytes(P1));
    const w1 = stage.capture('ui-a', 'doc-a', prop('html', P1, BASE, 'tx1'));
    const both = '<P>TITLE</P><K>logo</K><S>tale</S>';
    stage.claim('r_c2', 'ui-a', hashBytes(both));
    const w2 = stage.capture('ui-a', 'doc-a', prop('html', both, P1, 'tx2'));
    clock = 5_000;
    await stage.end('r_c2', 'done');
    expect(sent).toHaveLength(1);
    // c2's action carries c2's change only, against the accepted base
    expect(sent[0]?.operations).toEqual([
      {
        op: 'lane.replace',
        doc: 'doc-a',
        lane: 'html',
        content: '<P>title</P><K>logo</K><S>tale</S>',
        baseContent: BASE,
      },
    ]);
    expect(sent[0]?.origin).toEqual({ runId: 'r_c2', chatId: 'c2', madeAt: 5_000 });
    expect((await w2).status).toBe('accepted');
    clock = 6_000;
    await stage.end('r_c1', 'done');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.operations[0]).toMatchObject({ content: P1, baseContent: BASE });
    expect(sent[1]?.origin).toMatchObject({ runId: 'r_c1', madeAt: 6_000 });
    expect((await w1).status).toBe('accepted');
    expect(stage.state).toBeNull();
  });

  test('U11: two runs changing the same characters (shared K) — the second write is refused run-overlap', async () => {
    const { stage, sent } = rig();
    stage.begin('a', 'c1', { runId: 'r_c1' });
    stage.begin('b', 'c2', { runId: 'r_c2' });
    const k1 = '<P>title</P><K>LOGO</K><S>story</S>';
    stage.claim('r_c1', 'ui-a', hashBytes(k1));
    void stage.capture('ui-a', 'doc-a', prop('html', k1, BASE, 'tx1'));
    const k2 = '<P>title</P><K>LOGO!</K><S>story</S>';
    stage.claim('r_c2', 'ui-a', hashBytes(k2));
    expect(stage.overlapWith('r_c2', 'ui-a', 'html', k1, k2)).toBe('r_c1');
    const refused = await stage.capture('ui-a', 'doc-a', prop('html', k2, k1, 'tx2'));
    expect(refused).toMatchObject({ status: 'rejected', code: 'run-overlap' });
    // c1 is unaffected: it publishes exactly its own change
    await stage.end('r_c1', 'done');
    expect(sent[0]?.operations[0]).toMatchObject({ content: k1, baseContent: BASE });
  });

  test('U12: Stop publishes what the run finished as ONE partial version (" — stopped")', async () => {
    const { stage, sent } = rig();
    stage.begin('k', 'Restyle the footer', { runId: 'r_1', chatId: 'c1' });
    void claimed(stage, 'ui-a', 'doc-a', prop('html', P1, BASE, 'tx1'));
    const fence = { runId: 'r_1', leases: [{ entry: 'e1', artboard: 'P', token: 3 }] };
    const r = await stage.end('r_1', 'stopped', { fence });
    expect(r?.status).toBe('accepted');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.label).toBe('Restyle the footer — stopped');
    expect(sent[0]?.origin).toMatchObject({ runId: 'r_1', partial: true });
    expect(sent[0]?.fence).toEqual(fence);
  });

  test('U13: an error holds; Keep publishes that run only, Undo discards it', async () => {
    const { stage, sent } = rig();
    stage.begin('a', 'c1', { runId: 'r_c1' });
    stage.begin('b', 'c2', { runId: 'r_c2' });
    stage.claim('r_c1', 'ui-a', hashBytes('A1'));
    const a = stage.capture('ui-a', 'doc-a', prop('html', 'A1', 'A0', 'tx1'));
    stage.claim('r_c2', 'ui-b', hashBytes('B1'));
    const b = stage.capture('ui-b', 'doc-b', prop('html', 'B1', 'B0', 'tx2'));
    await stage.end('r_c1', 'failed');
    await stage.end('r_c2', 'failed');
    expect(sent).toHaveLength(0);
    expect(stage.runs().map((r) => [r.runId, r.state])).toEqual([
      ['r_c1', 'held'],
      ['r_c2', 'held'],
    ]);
    await stage.publish('r_c2');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.operations[0]).toMatchObject({ doc: 'doc-b', content: 'B1' });
    expect((await b).status).toBe('accepted');
    expect(stage.discard('r_c1')).toBe(1);
    expect(await a).toEqual({ status: 'rejected', code: 'discarded' });
    expect(stage.state).toBeNull();
  });

  test('a lease-fenced publish holds the run instead of losing it', async () => {
    const { stage } = rig(() => ({
      protocol: 1,
      status: 'rejected',
      code: 'lease-fenced',
      transactionId: 'g',
    }));
    stage.begin('k', 'AI', { runId: 'r_1' });
    void claimed(stage, 'ui-a', 'doc-a', prop('html', 'A1', 'A0', 'tx1'));
    const r = await stage.end('r_1', 'done', {
      fence: { runId: 'r_1', leases: [{ entry: 'e', artboard: 'P', token: 1 }] },
    });
    expect(r?.code).toBe('lease-fenced');
    expect(stage.runs()[0]).toMatchObject({ runId: 'r_1', state: 'held' });
  });

  test('a write no open run claims is not staged when several runs are open', () => {
    const { stage } = rig();
    stage.begin('a', 'c1', { runId: 'r_c1' });
    // p8-a1-claims — being the one open run is not a claim: an unclaimed write is the person's
    expect(stage.captures('ui-a', true, 'whatever')).toBe(false);
    stage.begin('b', 'c2', { runId: 'r_c2' });
    expect(stage.captures('ui-a', true, 'whatever')).toBe(false); // ambiguous: a person's / outside
    stage.claim('r_c2', 'ui-a', hashBytes('mine'));
    expect(stage.captures('ui-a', true, 'mine')).toBe(true);
  });

  test('U14: a crash brings EVERY open run back held, each with its own base and bytes (v2 file)', async () => {
    const first = rig();
    first.stage.begin('a', 'c1', { runId: 'r_c1', chatId: 'c1' });
    first.stage.begin('b', 'c2', { runId: 'r_c2' });
    first.stage.claim('r_c1', 'ui-a', hashBytes('A1'));
    void claimed(first.stage, 'ui-a', 'doc-a', prop('html', 'A1', 'A0', 'tx1'));
    first.stage.claim('r_c2', 'ui-b', hashBytes('B1'));
    void first.stage.capture('ui-b', 'doc-b', prop('html', 'B1', 'B0', 'tx2'));
    const file = JSON.parse(readFileSync(join(dir, '_state', 'ai-stage.json'), 'utf8'));
    expect(file.v).toBe(2);
    expect(file.runs).toHaveLength(2);
    // ...process dies here.
    const second = rig();
    second.stage.restore();
    expect(second.stage.runs().map((r) => [r.runId, r.state, r.chatId ?? null])).toEqual([
      ['r_c1', 'held', 'c1'],
      ['r_c2', 'held', null],
    ]);
    expect(second.sent).toHaveLength(0);
    await second.stage.publish('r_c2');
    expect(second.sent[0]?.operations[0]).toMatchObject({ content: 'B1', baseContent: 'B0' });
    expect(second.sent[0]?.origin).toMatchObject({ runId: 'r_c2' });
  });

  test('a v1 ai-stage.json is read as ONE held run', () => {
    mkdirSync(join(dir, '_state'), { recursive: true });
    writeFileSync(
      join(dir, '_state', 'ai-stage.json'),
      JSON.stringify({
        v: 1,
        state: 'open',
        label: 'Claude: old',
        since: 7,
        lanes: [{ slug: 'ui-a', doc: 'doc-a', lane: 'html', baseContent: 'A0' }],
        restored: [],
      })
    );
    const { stage } = rig();
    stage.restore();
    expect(stage.runs()).toHaveLength(1);
    expect(stage.runs()[0]).toMatchObject({ state: 'held', label: 'Claude: old', since: 7 });
    expect(stage.summary()).toMatchObject({ state: 'held', canvases: ['ui-a'] });
  });

  test('attribution fills the run touched set', () => {
    const { stage } = rig();
    stage.begin('k', 'AI', { runId: 'r_1' });
    stage.touch('r_1', 'ui/a.tsx', ['P']);
    stage.touch('r_1', 'ui/a.tsx', ['S', 'P']);
    expect(stage.runs()[0]?.touched).toEqual({ 'ui/a.tsx': ['P', 'S'] });
  });

  // S2.20c (V2-1.5 §5.4) — ⌘Z on your edit while your run is open proposes its inverse as another
  // waiting edit behind the same run.
  const edit = (tx: string, extra: Record<string, unknown> = {}) => ({
    transactionId: tx,
    slug: 'ui-a',
    lane: 'html' as const,
    label: 'Edit canvas',
    madeAt: 1_500,
    content: 'A2',
    baseContent: 'A1',
    ...extra,
  });

  test('S2.20c: a waiting edit is listed (no bytes); the inverse queued on it waits behind the SAME run and goes out after it', async () => {
    const { stage, sent } = rig();
    stage.begin('k', 'AI', { runId: 'r_1' });
    void claimed(stage, 'ui-a', 'doc-a', prop('html', 'A1', 'A0', 'tx_run'));
    const order: string[] = [];
    stage.wait({
      dependsOn: ['tx_run'],
      send: () => order.push('edit'),
      drop: () => order.push('edit dropped'),
      edit: edit('tx_p'),
    });
    // The inverse depends on the waiting edit only — no run staged THAT transaction.
    expect(stage.holdsDependency(['tx_p'])).toBe(true);
    stage.wait({
      dependsOn: ['tx_p'],
      send: () => order.push('inverse'),
      drop: () => order.push('inverse dropped'),
      edit: edit('tx_i', {
        label: 'Undo',
        madeAt: 1_600,
        content: 'A1',
        baseContent: 'A2',
        undoes: 'tx_p',
      }),
    });
    expect(stage.waiting('ui-a')).toEqual([
      { transactionId: 'tx_p', slug: 'ui-a', lane: 'html', label: 'Edit canvas', madeAt: 1_500 },
      {
        transactionId: 'tx_i',
        slug: 'ui-a',
        lane: 'html',
        label: 'Undo',
        madeAt: 1_600,
        undoes: 'tx_p',
      },
    ]);
    expect(stage.waiting('ui-b')).toEqual([]);
    expect(stage.waitingEdit('tx_p')).toMatchObject({ content: 'A2', baseContent: 'A1' });
    expect(order).toEqual([]); // nothing overtakes the run
    await stage.end('k', 'done');
    expect(sent).toHaveLength(1);
    expect(order).toEqual(['edit', 'inverse']); // the run, then the edit, then its inverse
    expect(stage.waiting()).toEqual([]);
    expect(stage.waitingEdit('tx_p')).toBeNull();
  });

  test('S2.20c: discarding the run drops the waiting edit AND the inverse queued on it', async () => {
    const { stage } = rig();
    stage.begin('k', 'AI');
    void claimed(stage, 'ui-a', 'doc-a', prop('html', 'A1', 'A0', 'tx_run'));
    await stage.end('k', 'failed');
    const out: string[] = [];
    stage.wait({
      dependsOn: ['tx_run'],
      send: () => out.push('edit sent'),
      drop: () => out.push('edit dropped'),
      edit: edit('tx_p'),
    });
    stage.wait({
      dependsOn: ['tx_p'],
      send: () => out.push('inverse sent'),
      drop: () => out.push('inverse dropped'),
      edit: edit('tx_i', { undoes: 'tx_p' }),
    });
    stage.discard();
    expect(out).toEqual(['edit dropped', 'inverse dropped']);
  });
});

// p8-a1-claims — every run is claim-only. A call that cannot claim (S7 interpreter, a terminal-lane verb) opens
// a window for the canvases its command NAMES: an unclaimed write to one of THOSE joins the run while it is open
// (plus a short settle); a person's save to any other canvas, or after the settle, stays theirs.
describe('a call that cannot claim: a named-file window (A1)', () => {
  test('takes unclaimed writes to its named canvases only while open, then only claimed ones', () => {
    const { stage } = rig();
    clock = 50_000;
    const shell = (open: boolean) => ({ call: 'b1', open, slugs: ['ui-a'] });
    stage.begin('acp:c9', 'cut', { runId: 'r_sh', shell: shell(true) });
    expect(stage.captures('ui-a', true, 'call bytes')).toBe(true); // the call's own write
    expect(stage.captures('ui-b', true, 'person bytes')).toBe(false); // another canvas: the person's
    stage.begin('acp:c9', 'cut', { runId: 'r_sh', shell: shell(false) });
    expect(stage.captures('ui-a', true, 'late call bytes')).toBe(true); // within the settle
    clock += 5_000;
    expect(stage.captures('ui-a', true, 'person bytes')).toBe(false); // the person's VS Code save
    expect(stage.captures('ui-new', true, 'x')).toBe(false);
    stage.claim('r_sh', 'ui-a', hashBytes('claimed bytes'));
    expect(stage.captures('ui-a', true, 'claimed bytes')).toBe(true); // a tool claimed it
  });

  test('a call that waits on a permission card is suspended; a denied one never opens', () => {
    const { stage } = rig();
    clock = 90_000;
    const shell = (open: boolean) => ({ call: 'b2', open, slugs: ['ui-b'] });
    stage.begin('acp:c8', 'export', { runId: 'r_card', shell: shell(true) });
    stage.begin('acp:c8', 'export', { runId: 'r_card', shell: shell(false) });
    clock += 5_000;
    expect(stage.captures('ui-b', true, 'person while the card waits')).toBe(false);
  });

  test('a later begin with no window (an edit tool) never brings a fallback back', () => {
    const { stage } = rig();
    clock = 120_000;
    const shell = (open: boolean) => ({ call: 'b3', open, slugs: ['ui-c'] });
    stage.begin('acp:c7', 'mixed', { runId: 'r_mix', shell: shell(true) });
    stage.begin('acp:c7', 'mixed', { runId: 'r_mix', shell: shell(false) });
    clock += 5_000;
    stage.begin('acp:c7', 'mixed', { runId: 'r_mix' });
    expect(stage.captures('ui-c', true, 'a person after the edit tool')).toBe(false);
    stage.claim('r_mix', 'ui-c', hashBytes('edit tool bytes'));
    expect(stage.captures('ui-c', true, 'edit tool bytes')).toBe(true);
  });
});
