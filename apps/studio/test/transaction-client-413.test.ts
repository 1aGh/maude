// V2-1.14 §5.12a / plan V2-2.8 B1 — a 4xx answer that is NOT an answer about
// the change (no `status` field) is still FINAL.
//
// Before: `deliver` treated every body without `status: accepted|rejected` as
// "retry", so a 413 from a proxy or the hub's body cap was resent forever and,
// because the content lane is one ordered chain, every proposal behind it
// waited forever too (V2-1.14 §6 probe: 22 POSTs in 600 ms, both outbox files
// still present, the small comment behind it still pending).
//
// After: the entry is answered `rejected` with code `http-<status>`, its bytes
// move to `_history/_outbox-recovery/`, and the next proposal settles. 401 keeps
// its own rule (credential), and 408 / 425 / 429 stay transient.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTransactionClient, type ProposalResult } from '../sync/transaction-client.ts';

const quiet = { log() {}, warn() {}, error() {} };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tx-413-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const outboxRoot = () =>
  existsSync(join(dir, '_state', 'outbox'))
    ? readdirSync(join(dir, '_state', 'outbox')).filter((n) => n.endsWith('.json'))
    : [];
const recovery = () =>
  existsSync(join(dir, '_history', '_outbox-recovery'))
    ? readdirSync(join(dir, '_history', '_outbox-recovery'))
    : [];

/** A hub whose proposal door answers `answer(label, attempt)`; `null` = accept. */
function hub(answer: (label: string, attempt: number) => Response | null) {
  const posts: string[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const route = new URL(String(url)).pathname.replace(/^\/api\/projects\/[^/]+\/v1\//, '');
    const ok = (status: number, v: unknown) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (route === 'bootstrap')
      return ok(200, {
        projectId: 'p1',
        mode: 'transactions',
        epoch: 1,
        revision: 0,
        docs: [],
        dirs: [],
      });
    if (route.startsWith('transactions/')) return ok(404, { code: 'absent' });
    const body = JSON.parse(String(init?.body)) as {
      transactionId: string;
      action: { label: string };
    };
    posts.push(body.action.label);
    const r = answer(body.action.label, posts.filter((l) => l === body.action.label).length);
    return (
      r ??
      ok(200, {
        protocol: 1,
        status: 'accepted',
        transactionId: body.transactionId,
        revision: posts.length,
      })
    );
  }) as unknown as typeof fetch;
  return { posts, fetchImpl };
}

/** Settle within `ms`, or fail instead of hanging (the bug IS a hang). */
function within<T>(p: Promise<T>, ms = 1500): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`still unsettled after ${ms} ms`)), ms)
    ),
  ]);
}

describe('a 4xx without `status` is final (B1)', () => {
  test('a plain-text 413 is answered once, parked in recovery, and the chain moves on', async () => {
    const h = hub((label) =>
      label === 'big' ? new Response('Payload Too Large', { status: 413 }) : null
    );
    const results: ProposalResult[] = [];
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: h.fetchImpl,
      retryMs: 2,
      log: quiet,
      onResult: (r) => results.push(r),
    });
    await client.bootstrap();
    const big = client.propose({
      label: 'big',
      operations: [{ op: 'dir.create', path: 'ui/Big' }],
    });
    const small = client.propose({
      label: 'small',
      operations: [{ op: 'dir.create', path: 'ui/S' }],
    });
    try {
      const [b, s] = await within(Promise.all([big, small]));
      expect(b).toMatchObject({ status: 'rejected', code: 'http-413' });
      expect(s.status).toBe('accepted');
      expect(h.posts).toEqual(['big', 'small']); // one POST for the refused one, no retries
      expect(outboxRoot()).toEqual([]);
      const kept = recovery();
      expect(kept).toHaveLength(1);
      expect(kept[0]).toMatch(/^\d+-tx_[0-9a-f]{32}\.http-413\.json$/);
      const entry = JSON.parse(
        readFileSync(join(dir, '_history', '_outbox-recovery', kept[0] as string), 'utf8')
      );
      expect(JSON.parse(entry.bytes).action.label).toBe('big'); // the exact bytes are kept
      expect(results.map((r) => r.code ?? r.status)).toEqual(['http-413', 'accepted']);
    } finally {
      client.stop();
    }
  });

  test('a JSON 4xx body without `status` (a proxy error object) is final too', async () => {
    const h = hub((label) =>
      label === 'x'
        ? new Response(JSON.stringify({ error: 'request entity too large' }), {
            status: 413,
            headers: { 'content-type': 'application/json' },
          })
        : null
    );
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: h.fetchImpl,
      retryMs: 2,
      log: quiet,
    });
    try {
      const r = await within(
        client.propose({ label: 'x', operations: [{ op: 'dir.create', path: 'ui/X' }] })
      );
      expect(r).toMatchObject({ status: 'rejected', code: 'http-413' });
      expect(h.posts).toEqual(['x']);
    } finally {
      client.stop();
    }
  });

  test.each([408, 425, 429])('%d stays transient: retried, then delivered', async (code) => {
    const h = hub((label, attempt) =>
      label === 't' && attempt === 1 ? new Response('slow down', { status: code }) : null
    );
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: h.fetchImpl,
      retryMs: 2,
      log: quiet,
    });
    try {
      const r = await within(
        client.propose({ label: 't', operations: [{ op: 'dir.create', path: 'ui/T' }] })
      );
      expect(r.status).toBe('accepted');
      expect(h.posts).toEqual(['t', 't']);
      expect(recovery()).toEqual([]);
    } finally {
      client.stop();
    }
  });

  test('a 5xx without `status` stays transient', async () => {
    const h = hub((label, attempt) =>
      label === 'u' && attempt <= 2 ? new Response('bad gateway', { status: 502 }) : null
    );
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: h.fetchImpl,
      retryMs: 2,
      log: quiet,
    });
    try {
      const r = await within(
        client.propose({ label: 'u', operations: [{ op: 'dir.create', path: 'ui/U' }] })
      );
      expect(r.status).toBe('accepted');
      expect(h.posts).toEqual(['u', 'u', 'u']);
    } finally {
      client.stop();
    }
  });
});
