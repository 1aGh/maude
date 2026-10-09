// V2-1.14 §5.3 / §7 — the intent store: tmp + rename, boot reload in every
// state, an orphan `.tmp` ignored, `sending` replayed with the SAME id, caps,
// and the location 1.x never reads.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { INTENTS_REL, LIMITS, newIntentId, QUEUE_FULL_WORDS } from '../outbox/index.ts';
import { createTransactionClient } from '../sync/transaction-client.ts';
import {
  cloudExport,
  type Harness,
  harness,
  invite,
  prompt,
  put,
  settle,
} from './_outbox-harness.ts';

let h: Harness;
afterEach(() => h?.dispose());

const files = () => {
  const d = path.join(h.root, INTENTS_REL);
  return existsSync(d) ? readdirSync(d).sort() : [];
};

describe('outbox store', () => {
  test('a record is on disk (tmp + rename, no .tmp left) the moment enqueue returns', () => {
    h = harness();
    const r = put(h, prompt('c1', 'Make three reel covers'));
    expect(files()).toEqual([`${r.createdAt}-${r.id}.json`]);
    const disk = JSON.parse(
      readFileSync(path.join(h.root, INTENTS_REL, files()[0] as string), 'utf8')
    );
    expect(disk).toMatchObject({
      format: 'maude.outbox',
      v: 1,
      id: r.id,
      state: 'queued',
      lane: 'ai:c1',
    });
  });

  test('ids are `i_` + 20 [a-z0-9], crypto random', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newIntentId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^i_[a-z0-9]{20}$/);
  });

  test('reload after a crash keeps every state; an orphan .tmp and a bad file are ignored', () => {
    h = harness();
    const q = put(h, prompt('c1', 'one'));
    const s = put(h, prompt('c2', 'two'));
    const n = put(h, prompt('c3', 'three'));
    const d = put(h, invite('tereza@studio.cz'));
    const x = put(h, cloudExport({ format: 'mp4' }));
    h.outbox.store.update(s.id, { state: 'sending', attempts: 1 });
    h.outbox.store.settle(n.id, 'needs-you', { code: 'target-removed', row: 'G6' });
    h.outbox.store.settle(d.id, 'done', { code: 'sent', ref: 'inv_1' });
    h.outbox.store.settle(x.id, 'dropped', { code: 'cancelled' });
    // a crash mid-write leaves a .tmp whose rename never happened
    const dir = path.join(h.root, INTENTS_REL);
    writeFileSync(path.join(dir, `${q.createdAt}-${q.id}.json.tmp`), '{"half":');
    writeFileSync(path.join(dir, '1-i_aaaaaaaaaaaaaaaaaaaa.json'), '{"format":"nope"}');

    const fresh = h.reopen();
    const byId = Object.fromEntries(fresh.store.list().map((r) => [r.id, r.state]));
    expect(byId).toEqual({
      [q.id]: 'queued',
      [s.id]: 'sending',
      [n.id]: 'needs-you',
      [d.id]: 'done',
      [x.id]: 'dropped',
    });
    expect(fresh.store.invalidFiles()).toEqual(['1-i_aaaaaaaaaaaaaaaaaaaa.json']);
  });

  test('a record left `sending` by a crash is replayed with the SAME id', async () => {
    h = harness();
    const r = put(h, prompt('c1', 'go'));
    h.outbox.store.update(r.id, { state: 'sending', attempts: 1 });
    const fresh = h.reopen();
    await fresh.drain.wake();
    expect(h.sent.map((s) => s.id)).toEqual([r.id]);
    expect(fresh.store.get(r.id)).toMatchObject({
      state: 'done',
      attempts: 2,
      outcome: { code: 'sent' },
    });
  });

  test('past 500 waiting records a new one is refused with the words', () => {
    h = harness();
    for (let i = 0; i < LIMITS.queued; i++) put(h, prompt(`c${i}`, `p${i}`));
    const r = h.outbox.store.enqueue(prompt('c-last', 'one more'));
    expect(r).toEqual({ ok: false, code: 'queue-full', words: QUEUE_FULL_WORDS });
  });

  test('finished records are pruned 7 days after their outcome; the total cap prunes oldest done first', async () => {
    h = harness();
    const old = put(h, invite('a@x.cz'));
    h.outbox.store.settle(old.id, 'done', { code: 'sent' });
    const kept = put(h, prompt('c1', 'waiting'));
    await h.clock.advance(LIMITS.keepFinishedMs + 1);
    expect(h.outbox.store.prune()).toBe(1);
    expect(h.outbox.store.list().map((r) => r.id)).toEqual([kept.id]);
  });

  test('an invalid payload is refused, nothing written', () => {
    h = harness();
    const bad = prompt('c1', 'x');
    (bad.payload as { text: unknown }).text = 'x'.repeat(LIMITS.promptBytes + 1);
    const r = h.outbox.store.enqueue(bad);
    expect(r.ok).toBe(false);
    expect(files()).toEqual([]);
  });

  test('the location is downgrade-safe: the 1.x proposal drain ignores intents/', async () => {
    h = harness();
    put(h, prompt('c1', 'never a proposal'));
    let posts = 0;
    const tx = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: h.root,
      fetchImpl: (async () => {
        posts++;
        return Response.json({
          projectId: 'p1',
          mode: 'transactions',
          epoch: 1,
          revision: 0,
          docs: [],
          dirs: [],
        });
      }) as unknown as typeof fetch,
      log: { log() {}, warn() {}, error() {} },
    });
    const drained = await tx.drainOutbox();
    expect(drained).toEqual([]);
    expect(posts).toBe(0);
    expect(files()).toHaveLength(1);
    tx.stop();
    await settle();
  });
});
