// The studio's durable transaction client — DDR-241 §3, plan T13.
//
// A fake hub over `fetchImpl` that records every request, so the oracles are
// the wire (what was sent, how often, in which order) and the outbox on disk —
// not the client's own return value.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTransactionClient, TransactionError } from '../sync/transaction-client.ts';

interface Sent {
  method: string;
  route: string;
  body: Record<string, unknown> | null;
}

function fakeHub(opts: { epoch?: number } = {}) {
  const sent: Sent[] = [];
  const results = new Map<string, Record<string, unknown>>();
  let epoch = opts.epoch ?? 1;
  let down = false;
  let dropAnswers = 0;
  let decide: (body: Record<string, unknown>) => Record<string, unknown> = (b) => ({
    protocol: 1,
    status: 'accepted',
    transactionId: b.transactionId,
    revision: sent.length,
  });
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const route = u.pathname.replace(/^\/api\/projects\/[^/]+\/v1\//, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    sent.push({ method: init?.method ?? 'GET', route, body });
    if (down) throw new TypeError('fetch failed');
    const json = (status: number, v: unknown) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (route === 'bootstrap') {
      return json(200, {
        projectId: 'p1',
        mode: 'transactions',
        epoch,
        revision: 0,
        docs: [],
        dirs: [],
      });
    }
    if (route.startsWith('transactions/')) {
      const r = results.get(route.slice('transactions/'.length));
      return r ? json(200, r) : json(404, { code: 'absent' });
    }
    if (route === 'proposals' && body) {
      if (body.epoch !== epoch) {
        const r = {
          protocol: 1,
          status: 'rejected',
          code: 'epoch-stale',
          transactionId: body.transactionId,
        };
        return json(409, r);
      }
      const r = decide(body);
      results.set(String(body.transactionId), r);
      if (dropAnswers > 0) {
        dropAnswers -= 1;
        throw new TypeError('connection reset after commit');
      }
      return json(r.status === 'accepted' ? 200 : 409, r);
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return {
    sent,
    fetchImpl,
    setDown: (v: boolean) => {
      down = v;
    },
    dropNextAnswers: (n: number) => {
      dropAnswers = n;
    },
    bumpEpoch: () => {
      epoch += 1;
    },
    decideWith: (fn: typeof decide) => {
      decide = fn;
    },
    proposals: () => sent.filter((s) => s.route === 'proposals'),
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tx-client-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const outboxFiles = () => {
  const d = join(dir, '_state', 'outbox');
  return existsSync(d) ? readdirSync(d).filter((n) => n.endsWith('.json')) : [];
};

describe('transaction client', () => {
  test('writes the exact proposal bytes to the outbox BEFORE sending, and clears it on a final answer', async () => {
    const hub = fakeHub();
    let seenOnDisk: string[] = [];
    const wrapped = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/proposals')) {
        seenOnDisk = outboxFiles().map((n) =>
          readFileSync(join(dir, '_state', 'outbox', n), 'utf8')
        );
      }
      return hub.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: wrapped,
    });
    const r = await client.propose({
      label: 'Edit',
      operations: [{ op: 'lane.replace', doc: 'd', lane: 'html', content: 'x' }],
    });
    expect(r.status).toBe('accepted');
    expect(seenOnDisk).toHaveLength(1);
    const entry = JSON.parse(seenOnDisk[0] as string) as { bytes: string };
    expect(JSON.parse(entry.bytes)).toEqual(hub.proposals()[0]?.body as Record<string, unknown>);
    expect(outboxFiles()).toHaveLength(0);
  });

  test('a lost answer is resolved by asking for the result — the action is never sent as a second transaction', async () => {
    const hub = fakeHub();
    hub.dropNextAnswers(1);
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: hub.fetchImpl,
      retryMs: 5,
      log: { log() {}, warn() {}, error() {} },
    });
    const r = await client.propose({
      label: 'Edit',
      operations: [{ op: 'lane.replace', doc: 'd', lane: 'html', content: 'x' }],
    });
    expect(r.status).toBe('accepted');
    const ids = new Set(hub.proposals().map((p) => p.body?.transactionId));
    expect(ids.size).toBe(1);
    expect(hub.proposals()).toHaveLength(1); // the GET answered; no resend was needed
    expect(hub.sent.some((s) => s.route.startsWith('transactions/'))).toBe(true);
  });

  test('an unreachable hub keeps EVERY proposal durable — queued ones too; a new process resends the same bytes in order', async () => {
    const hub = fakeHub();
    const quiet = { log() {}, warn() {}, error() {} };
    const a = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: hub.fetchImpl,
      retryMs: 5,
      log: quiet,
    });
    await a.bootstrap();
    hub.setDown(true);
    void a
      .propose({ label: 'first', operations: [{ op: 'dir.create', path: 'ui/A' }] })
      .catch(() => {});
    void a
      .propose({ label: 'second', operations: [{ op: 'dir.create', path: 'ui/B' }] })
      .catch(() => {});
    // Durable the moment propose() returns — before any send was attempted.
    expect(outboxFiles()).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 50));
    a.stop(); // the process dies with both unanswered
    const onDisk = outboxFiles().map(
      (n) => JSON.parse(readFileSync(join(dir, '_state', 'outbox', n), 'utf8')).bytes as string
    );
    expect(onDisk.map((b) => (JSON.parse(b).action as { label: string }).label)).toEqual([
      'first',
      'second',
    ]);

    hub.setDown(false);
    const before = hub.proposals().length;
    const b = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: hub.fetchImpl,
      retryMs: 5,
      log: quiet,
    });
    const results = await b.drainOutbox();
    expect(results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    const delivered = hub.proposals().slice(before);
    expect(delivered.map((p) => JSON.stringify(p.body))).toEqual(
      onDisk.map((x) => JSON.stringify(JSON.parse(x)))
    );
    expect(outboxFiles()).toHaveLength(0);
  });

  test('a proposal made before the project is known is bound once, then sent', async () => {
    const hub = fakeHub();
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: hub.fetchImpl,
    });
    const r = await client.propose({
      label: 'early',
      operations: [{ op: 'dir.create', path: 'ui/A' }],
    });
    expect(r.status).toBe('accepted');
    expect(hub.proposals()[0]?.body?.projectId).toBe('p1');
  });

  test('a failed local write is reported, never treated as saved', async () => {
    const hub = fakeHub();
    // The outbox path is a FILE, so the directory cannot be created.
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, '_state'), { recursive: true });
    writeFileSync(join(dir, '_state', 'outbox'), 'not a dir');
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: hub.fetchImpl,
    });
    const err = await client
      .propose({ label: 'x', operations: [{ op: 'dir.create', path: 'ui/A' }] })
      .catch((e) => e);
    expect((err as TransactionError).code).toBe('local-persistence');
    expect(hub.proposals()).toHaveLength(0);
  });

  test('an epoch-stale rebase carries its dependents: dependsOn is rewritten to the new id', async () => {
    const hub = fakeHub({ epoch: 1 });
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: hub.fetchImpl,
    });
    await client.bootstrap();
    hub.bumpEpoch();
    const u1 = client.newTransactionId();
    const p1 = client.propose({
      label: 'U1',
      transactionId: u1,
      operations: [{ op: 'dir.create', path: 'ui/A' }],
    });
    const p2 = client.propose({
      label: 'U2',
      dependsOn: [u1],
      operations: [{ op: 'dir.create', path: 'ui/B' }],
    });
    await Promise.all([p1, p2]);
    const accepted = hub.proposals().filter((p) => p.body?.epoch === 2);
    expect(accepted).toHaveLength(2);
    const [r1, r2] = accepted;
    expect(r1?.body?.transactionId).not.toBe(u1);
    expect(r2?.body?.dependsOn).toEqual([r1?.body?.transactionId]);
  });

  test('epoch-stale is re-proposed ONCE under the new epoch with a fresh transaction id', async () => {
    const hub = fakeHub({ epoch: 1 });
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: hub.fetchImpl,
    });
    await client.bootstrap();
    hub.bumpEpoch();
    const r = await client.propose({
      label: 'Edit',
      operations: [{ op: 'dir.create', path: 'ui/A' }],
    });
    expect(r.status).toBe('accepted');
    const [first, second] = hub.proposals();
    expect(first?.body?.epoch).toBe(1);
    expect(second?.body?.epoch).toBe(2);
    expect(first?.body?.transactionId).not.toBe(second?.body?.transactionId);
    expect(client.epoch).toBe(2);
  });

  test('a caller-chosen id and dependsOn travel in the proposal', async () => {
    const hub = fakeHub();
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: hub.fetchImpl,
    });
    const u1 = client.newTransactionId();
    const u2 = client.newTransactionId();
    await client.propose({
      label: 'U1',
      transactionId: u1,
      operations: [{ op: 'dir.create', path: 'ui/A' }],
    });
    await client.propose({
      label: 'U2',
      transactionId: u2,
      dependsOn: [u1],
      operations: [{ op: 'dir.create', path: 'ui/B' }],
    });
    const [p1, p2] = hub.proposals();
    expect(p1?.body?.transactionId).toBe(u1);
    expect(p1?.body?.dependsOn).toBeUndefined();
    expect(p2?.body?.transactionId).toBe(u2);
    expect(p2?.body?.dependsOn).toEqual([u1]);
  });

  test('proposals are delivered strictly in creation order', async () => {
    const hub = fakeHub();
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: hub.fetchImpl,
    });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        client.propose({ label: `e${i}`, operations: [{ op: 'dir.create', path: `ui/D${i}` }] })
      )
    );
    const order = hub
      .proposals()
      .map((p) => (p.body?.action as { label: string } | undefined)?.label);
    expect(order).toEqual(Array.from({ length: 20 }, (_, i) => `e${i}`));
  });

  test('a hub without the route answers legacy, not failure', async () => {
    const fetchImpl = (async () =>
      new Response('not found', { status: 404 })) as unknown as typeof fetch;
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl,
    });
    const err = await client.bootstrap().catch((e) => e);
    expect(err).toBeInstanceOf(TransactionError);
    expect((err as TransactionError).code).toBe('absent');
  });
});
