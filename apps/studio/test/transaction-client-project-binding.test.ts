// V2-1.14 §5.12b / plan V2-2.8 B2 — outbox entries are bound to the project
// they were made for.
//
// Before: an entry written before the client knew the project was `unbound`
// and took the NEXT project id it learned — after a relink, a change made for
// one project (a `doc.delete` naming its canvas, say) was delivered to another.
// A bound entry left by a previous link was sent to whatever project the
// client was talking to now, under that project's URL.
//
// After: every entry records the link (hub) it was written under and, once
// known, its project id. An entry whose project or link is not the current one
// is never sent: it is answered `rejected` / `project-changed` and its bytes
// move to `_history/_outbox-recovery/` (G18: "…kept on this Mac").

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTransactionClient } from '../sync/transaction-client.ts';

const quiet = { log() {}, warn() {}, error() {} };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tx-bind-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const outboxRoot = () =>
  existsSync(join(dir, '_state', 'outbox'))
    ? readdirSync(join(dir, '_state', 'outbox')).filter((n) => n.endsWith('.json'))
    : [];
const recovery = () =>
  existsSync(join(dir, '_history', '_outbox-recovery'))
    ? readdirSync(join(dir, '_history', '_outbox-recovery')).sort()
    : [];

/** A hub serving project `projectId`; records every proposal it is sent. */
function hub(projectId: string) {
  const posts: Array<{ url: string; projectId: unknown; label: string }> = [];
  let down = false;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    if (down) throw new TypeError('fetch failed');
    const u = new URL(String(url));
    const route = u.pathname.replace(/^\/api\/projects\/[^/]+\/v1\//, '');
    const ok = (status: number, v: unknown) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (route === 'bootstrap')
      return ok(200, {
        projectId,
        mode: 'transactions',
        epoch: 1,
        revision: 0,
        docs: [],
        dirs: [],
      });
    if (route.startsWith('transactions/')) return ok(404, { code: 'absent' });
    const body = JSON.parse(String(init?.body)) as {
      transactionId: string;
      projectId: unknown;
      action: { label: string };
    };
    posts.push({ url: String(url), projectId: body.projectId, label: body.action.label });
    return ok(200, {
      protocol: 1,
      status: 'accepted',
      transactionId: body.transactionId,
      revision: 1,
    });
  }) as unknown as typeof fetch;
  return {
    posts,
    fetchImpl,
    setDown: (v: boolean) => {
      down = v;
    },
  };
}

const client = (hubUrl: string, h: ReturnType<typeof hub>) =>
  createTransactionClient({
    hubUrl,
    token: () => 't',
    designRoot: dir,
    fetchImpl: h.fetchImpl,
    retryMs: 2,
    log: quiet,
  });

describe('outbox entries are bound to their project (B2)', () => {
  test('a bound entry left for project A is never sent to project B — it is kept in recovery', async () => {
    const a = hub('p-alligators');
    const first = client('http://hub-a', a);
    await first.bootstrap();
    a.setDown(true);
    void first
      .propose({ label: 'delete Pricing', operations: [{ op: 'doc.delete', doc: 'ui-pricing' }] })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    first.stop();
    expect(outboxRoot()).toHaveLength(1);

    // Relinked: the same design root now talks to another project.
    const b = hub('p-other');
    const second = client('http://hub-b', b);
    const results = await second.drainOutbox();
    expect(results.map((r) => [r.status, r.code])).toEqual([['rejected', 'project-changed']]);
    expect(b.posts).toEqual([]); // zero requests to the new project's proposal door
    expect(outboxRoot()).toEqual([]);
    expect(recovery()).toHaveLength(1);
    expect(recovery()[0]).toMatch(/\.project-changed\.json$/);
    second.stop();
  });

  test('an unbound entry written under link A does not bind to link B', async () => {
    const a = hub('p-alligators');
    a.setDown(true);
    const first = client('http://hub-a', a);
    void first
      .propose({ label: 'offline create', operations: [{ op: 'dir.create', path: 'ui/New' }] })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    first.stop();

    const b = hub('p-other');
    const second = client('http://hub-b', b);
    const results = await second.drainOutbox();
    expect(results.map((r) => r.code)).toEqual(['project-changed']);
    expect(b.posts).toEqual([]);
    expect(recovery()).toHaveLength(1);
    second.stop();
  });

  test('an unbound entry written under the SAME link binds to that project and is sent', async () => {
    const a = hub('p-alligators');
    a.setDown(true);
    const first = client('http://hub-a', a);
    void first
      .propose({ label: 'offline create', operations: [{ op: 'dir.create', path: 'ui/New' }] })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    first.stop();

    a.setDown(false);
    const again = client('http://hub-a/', a); // a trailing slash is the same link
    const results = await again.drainOutbox();
    expect(results.map((r) => r.status)).toEqual(['accepted']);
    expect(a.posts.map((p) => p.projectId)).toEqual(['p-alligators']);
    expect(recovery()).toEqual([]);
    again.stop();
  });

  test('a bound entry for the same project is resent unchanged (no false positive)', async () => {
    const a = hub('p-alligators');
    const first = client('http://hub-a', a);
    await first.bootstrap();
    a.setDown(true);
    void first
      .propose({ label: 'edit', operations: [{ op: 'dir.create', path: 'ui/E' }] })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    first.stop();
    a.setDown(false);
    const again = client('http://hub-a', a);
    const results = await again.drainOutbox();
    expect(results.map((r) => r.status)).toEqual(['accepted']);
    again.stop();
  });

  test('a 1.x entry (no link, no projectId field) is judged by the project id in its bytes', async () => {
    mkdirSync(join(dir, '_state', 'outbox'), { recursive: true });
    const bytes = (pid: string | null, tx: string) =>
      JSON.stringify({
        protocol: 1,
        projectId: pid,
        epoch: 1,
        transactionId: tx,
        origin: { deviceId: 'studio', sessionId: 's', client: 'studio' },
        action: { kind: 'edit', label: tx, operations: [{ op: 'dir.create', path: `ui/${tx}` }] },
      });
    const legacy = (name: string, entry: object) =>
      writeFileSync(join(dir, '_state', 'outbox', name), JSON.stringify(entry));
    const action = (tx: string) => ({
      label: tx,
      operations: [{ op: 'dir.create', path: `ui/${tx}` }],
    });
    legacy('1-tx_same.json', {
      transactionId: 'tx_same',
      createdAt: 1,
      bytes: bytes('p-b', 'tx_same'),
      label: 'tx_same',
      action: action('tx_same'),
    });
    legacy('2-tx_other.json', {
      transactionId: 'tx_other',
      createdAt: 2,
      bytes: bytes('p-a', 'tx_other'),
      label: 'tx_other',
      action: action('tx_other'),
    });
    // unbound and from a build that did not record its link: it cannot be
    // proven to belong here, so it is kept, not sent (the disk still holds it).
    legacy('3-tx_unbound.json', {
      transactionId: 'tx_unbound',
      createdAt: 3,
      bytes: bytes(null, 'tx_unbound'),
      label: 'tx_unbound',
      action: action('tx_unbound'),
      unbound: true,
    });

    const b = hub('p-b');
    const c = client('http://hub-b', b);
    const results = await c.drainOutbox();
    expect(results.map((r) => r.code ?? r.status)).toEqual([
      'accepted',
      'project-changed',
      'project-changed',
    ]);
    expect(b.posts.map((p) => p.label)).toEqual(['tx_same']);
    expect(recovery()).toHaveLength(2);
    c.stop();
  });
});
