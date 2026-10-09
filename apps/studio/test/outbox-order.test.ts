// V2-1.14 §5.5 O1–O6 — ordering.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

describe('outbox ordering', () => {
  test('O2: prompts are FIFO per chat; another chat is independent', async () => {
    h = harness();
    const a1 = put(h, prompt('chat-a', 'first'));
    const a2 = put(h, prompt('chat-a', 'second'));
    const b1 = put(h, prompt('chat-b', 'other chat'));
    h.answers['ai.prompt'] = [{ ok: false, status: 503 }]; // a1's first try fails, transiently
    await h.outbox.drain.wake();
    // a1 tried and backs off; a2 holds behind it; b1 went.
    expect(h.sent.map((s) => s.id)).toEqual([a1.id, b1.id]);
    expect(h.outbox.store.get(a2.id)?.state).toBe('queued');
    await h.clock.advance(1600); // the backoff (1.5 s ±20 %, rand 0.5)
    await settle();
    expect(h.sent.map((s) => s.id)).toEqual([a1.id, b1.id, a1.id, a2.id]);
    expect(h.outbox.store.get(a2.id)?.state).toBe('done');
  });

  test('O2: a prompt waiting for you (G6) holds the next prompt of that chat only', async () => {
    h = harness();
    const a1 = put(
      h,
      prompt('chat-a', 'for the footer', {
        target: {
          chatId: 'chat-a',
          canvas: 'ui-reel',
          artboards: ['post'],
          elements: [{ canvas: 'ui-reel', artboard: 'post', element: 'footer' }],
        },
      })
    );
    const a2 = put(h, prompt('chat-a', 'next'));
    const b1 = put(h, prompt('chat-b', 'elsewhere'));
    h.factsFor.set(a1.id, {
      missingElements: [{ element: 'footer', name: 'Footer', artboard: 'post' }],
      artboards: { post: { state: 'present', name: 'Post 1:1' } },
    });
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(a1.id)).toMatchObject({
      state: 'needs-you',
      outcome: { code: 'target-removed', row: 'G6' },
    });
    expect(h.sent.map((s) => s.id)).toEqual([b1.id]);
    expect(h.outbox.store.get(a2.id)?.state).toBe('queued');
  });

  test('O3: invites are independent; exports START in creation order', async () => {
    h = harness();
    h.gates.online = false;
    const e1 = put(h, cloudExport({ format: 'mp4', canvas: 'a' }));
    const i1 = put(h, invite('tereza@studio.cz'));
    const e2 = put(h, cloudExport({ format: 'png', canvas: 'b' }));
    const i2 = put(h, invite('jan@studio.cz'));
    await h.outbox.drain.wake();
    expect(h.sent).toEqual([]);
    h.gates.online = true;
    h.answers['share.invite'] = [{ ok: false, status: 502 }];
    await h.outbox.drain.wake();
    expect(h.sent.map((s) => s.id)).toEqual([e1.id, i1.id, e2.id, i2.id]);
    expect(h.outbox.store.get(i1.id)?.state).toBe('queued'); // backing off
    expect(h.outbox.store.get(i2.id)?.state).toBe('done'); // not blocked by it
  });

  test('O4: an intent waits for the content made before it (watermark), not for later content', async () => {
    h = harness();
    const r = put(h, prompt('c1', 'use the canvas I made offline', { watermark: 100 }));
    h.contentPending = [90, 150];
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(r.id)?.gates).toEqual(['after']);
    expect(h.sent).toEqual([]);
    h.contentPending = [150]; // the doc.create made before the ask is accepted; a later edit is not
    await h.outbox.drain.wake();
    expect(h.sent.map((s) => s.id)).toEqual([r.id]);
  });

  test('O4: enqueue takes the watermark from the content lane on disk', () => {
    h = harness();
    const dir = path.join(h.root, '_state', 'outbox');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '1760000000100-tx_aaaa.json'), '{}');
    writeFileSync(path.join(dir, '1760000000200-tx_bbbb.json'), '{}');
    h.gates.online = false;
    const r = h.outbox.enqueue(prompt('c1', 'after my offline canvas'));
    expect(r.ok && r.record.watermark).toBe(1760000000200);
    rmSync(dir, { recursive: true, force: true });
    const r2 = h.outbox.enqueue(prompt('c2', 'nothing pending'));
    expect(r2.ok && r2.record.watermark).toBe(null);
  });

  test('O5: content never waits on an intent', async () => {
    h = harness();
    h.gates.online = false;
    put(h, prompt('c1', 'queued forever'));
    await h.outbox.drain.wake();
    const tx = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: h.root,
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith('/bootstrap'))
          return Response.json({
            projectId: 'p1',
            mode: 'transactions',
            epoch: 1,
            revision: 0,
            docs: [],
            dirs: [],
          });
        const b = JSON.parse(String(init?.body));
        return Response.json({
          protocol: 1,
          status: 'accepted',
          transactionId: b.transactionId,
          revision: 1,
        });
      }) as unknown as typeof fetch,
      log: { log() {}, warn() {}, error() {} },
    });
    const res = await tx.propose({
      label: 'Edit',
      operations: [{ op: 'dir.create', path: 'ui/A' }],
    });
    expect(res.status).toBe('accepted');
    tx.stop();
  });
});
