// V2-1.14 §7 `outbox-project-changed` — a relink: the old project's intents
// are dropped `project-changed` (G17) and its content entries go to recovery
// (G18, fix 5.12b); ZERO requests reach the new project, through either lane.

import { afterEach, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { createTransactionClient } from '../sync/transaction-client.ts';
import { type Harness, harness, invite, prompt } from './_outbox-harness.ts';

let h: Harness;
afterEach(() => h?.dispose());

const quiet = { log() {}, warn() {}, error() {} };

test('relink: old intents dropped, old content kept aside, nothing sent to the new project', async () => {
  h = harness();
  // Made for p1 while offline: one content change, one prompt, one invite.
  let down = true;
  const posts: string[] = [];
  const hubFor = (projectId: string) =>
    (async (url: string | URL, init?: RequestInit) => {
      if (down) throw new TypeError('fetch failed');
      const route = new URL(String(url)).pathname.replace(/^\/api\/projects\/[^/]+\/v1\//, '');
      if (route === 'bootstrap')
        return Response.json({
          projectId,
          mode: 'transactions',
          epoch: 1,
          revision: 0,
          docs: [],
          dirs: [],
        });
      if (route.startsWith('transactions/'))
        return Response.json({ code: 'absent' }, { status: 404 });
      posts.push(`${projectId}:${route}`);
      const b = JSON.parse(String(init?.body));
      return Response.json({
        protocol: 1,
        status: 'accepted',
        transactionId: b.transactionId,
        revision: 1,
      });
    }) as unknown as typeof fetch;

  down = false;
  const old = createTransactionClient({
    hubUrl: 'https://hub-one',
    token: () => 't',
    designRoot: h.root,
    fetchImpl: hubFor('p1'),
    retryMs: 2,
    log: quiet,
  });
  await old.bootstrap();
  down = true;
  void old
    .propose({ label: 'Delete Pricing', operations: [{ op: 'doc.delete', doc: 'ui-pricing' }] })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 20));
  old.stop();
  h.gates.online = false;
  const p = h.outbox.enqueue(prompt('c1', 'redo the pricing page'));
  const i = h.outbox.enqueue(invite('tereza@studio.cz'));
  expect(p.ok && i.ok).toBe(true);
  expect(p.ok && p.record.watermark).not.toBe(null); // it waits for the delete

  // Relinked to another project; back online.
  down = false;
  h.gates.online = true;
  h.facts = { ...h.facts, projectId: 'p2' };
  const fresh = createTransactionClient({
    hubUrl: 'https://hub-two',
    token: () => 't',
    designRoot: h.root,
    fetchImpl: hubFor('p2'),
    retryMs: 2,
    log: quiet,
  });
  const content = await fresh.drainOutbox();
  await h.outbox.drain.wake();

  expect(content.map((r) => r.code)).toEqual(['project-changed']);
  expect(h.outbox.store.list().map((r) => [r.kind, r.state, r.outcome?.code])).toEqual([
    ['ai.prompt', 'dropped', 'project-changed'],
    ['share.invite', 'dropped', 'project-changed'],
  ]);
  expect(posts).toEqual([]); // zero requests to the new project
  expect(h.sent).toEqual([]);
  const rec = path.join(h.root, '_history', '_outbox-recovery');
  expect(existsSync(rec) && readdirSync(rec)).toHaveLength(1);
  fresh.stop();
});
