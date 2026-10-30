// S6.13 / V2-1.14 §7 `accepted-link-create-durable` — fix 5.12d: a canvas
// create is on disk BEFORE the 25 ms batching window, so a crash inside the
// window loses nothing, the replay sends it exactly once, and a prompt queued
// right behind it waits for it (O4 watermark).

import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { contentPending, contentWatermark } from '../outbox/content.ts';
import { closedGates } from '../outbox/policy.ts';
import { createAcceptedLink } from '../sync/accepted-link.ts';

const quiet = { log() {}, warn() {}, error() {} };
const FIXTURE = path.join(import.meta.dir, 'fixtures', 'create-window-crash.ts');
const HUB = 'https://hub.test';

const dirs: string[] = [];
const links: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const l of links.splice(0)) l.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function root(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'maude-create-durable-'));
  dirs.push(d);
  return d;
}

const outboxDir = (r: string) => path.join(r, '_state', 'outbox');
const outboxNames = (r: string) => {
  try {
    return readdirSync(outboxDir(r)).sort();
  } catch {
    return [];
  }
};

/**
 * A hub that dedupes like the kernel (`process`: the same transaction id with
 * the same bytes is a replay, with other bytes `transaction-id-reused`) and
 * keeps every canvas it created — the oracle is the hub, never the sender.
 */
function fakeHub() {
  const results = new Map<string, { hash: string; result: Record<string, unknown> }>();
  const docs = new Map<string, { path: string; html: string }>();
  const posts: Array<{ transactionId: string; operations: Array<Record<string, unknown>> }> = [];
  let online = true;
  let revision = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    if (!online) throw new TypeError('fetch failed');
    const route = new URL(String(url)).pathname.replace(/^\/api\/projects\/[^/]+\/v1\//, '');
    if (route === 'bootstrap')
      return Response.json({
        projectId: 'p1',
        mode: 'transactions',
        epoch: 1,
        revision,
        docs: [...docs].map(([doc, d]) => ({
          doc,
          entry: `n_${doc}`,
          generation: 1,
          path: d.path,
          retired: false,
          lanes: {},
        })),
        dirs: [],
      });
    if (route.startsWith('transactions/')) {
      const known = results.get(route.slice('transactions/'.length));
      return known ? Response.json(known.result) : Response.json({}, { status: 404 });
    }
    const bytes = String(init?.body);
    const p = JSON.parse(bytes);
    const prior = results.get(p.transactionId);
    if (prior) {
      if (prior.hash === bytes) return Response.json(prior.result);
      return Response.json({
        protocol: 1,
        status: 'rejected',
        code: 'transaction-id-reused',
        transactionId: p.transactionId,
      });
    }
    posts.push({ transactionId: p.transactionId, operations: p.action.operations });
    let result: Record<string, unknown>;
    const creates = p.action.operations.filter((o: { op: string }) => o.op === 'doc.create');
    const clash = creates.find(
      (o: { doc: string; path: string }) =>
        docs.has(o.doc) || [...docs.values()].some((d) => d.path === o.path)
    );
    if (clash)
      result = {
        protocol: 1,
        status: 'rejected',
        code: 'path-conflict',
        transactionId: p.transactionId,
      };
    else {
      for (const o of creates) docs.set(o.doc, { path: o.path, html: o.lanes?.html ?? '' });
      revision++;
      result = { protocol: 1, status: 'accepted', transactionId: p.transactionId, revision };
    }
    results.set(p.transactionId, { hash: bytes, result });
    return Response.json(result);
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    docs,
    posts,
    setOnline(v: boolean) {
      online = v;
    },
  };
}

function link(designRoot: string, fetchImpl: typeof fetch) {
  const l = createAcceptedLink({
    hubUrl: HUB,
    token: () => 't',
    designRoot,
    docNameFor: (slug) => slug,
    fetchImpl,
    retryMs: 2,
    log: quiet,
  });
  links.push(l);
  return l;
}

/** Kill a studio process inside the window (fixture), as the OS would. */
function crashInsideWindow(designRoot: string, canvases: string[]) {
  const r = spawnSync('bun', [FIXTURE, designRoot, HUB, ...canvases], { encoding: 'utf8' });
  expect(r.signal).toBe('SIGKILL');
}

const createdDocs = (posts: ReturnType<typeof fakeHub>['posts']) =>
  posts.flatMap((p) => p.operations.filter((o) => o.op === 'doc.create').map((o) => o.doc));

test('a crash inside the 25 ms create window loses nothing; the replay sends it exactly once', async () => {
  const r = root();
  crashInsideWindow(r, ['ui-poster:ui/Poster.tsx', 'ui-logo:ui/Logo.tsx']);
  // Something of the creates is on disk although the process never flushed.
  expect(outboxNames(r).length).toBeGreaterThan(0);

  const hub = fakeHub();
  const l = link(r, hub.fetchImpl);
  await l.refresh();
  await l.client.drainOutbox();
  // One proposal for the burst (the window's batching survives the crash).
  expect(hub.posts.length).toBe(1);
  expect(createdDocs(hub.posts).sort()).toEqual(['ui-logo', 'ui-poster']);
  expect(hub.docs.get('ui-poster')?.html).toBe('export default () => <h1>ui-poster</h1>;\n');
  // A v1 peer reads a plain doc.create: no new key on the wire.
  for (const o of hub.posts[0]?.operations ?? [])
    expect(Object.keys(o).sort()).toEqual(['doc', 'lanes', 'op', 'path']);

  // A second boot replays nothing.
  expect(outboxNames(r)).toEqual([]);
  const again = link(r, hub.fetchImpl);
  await again.refresh();
  await again.client.drainOutbox();
  expect(hub.posts.length).toBe(1);
});

test('a crash after the window sealed but before its note was cleared is still one create', async () => {
  const r = root();
  const hub = fakeHub();
  hub.setOnline(false);
  const first = link(r, hub.fetchImpl);
  void first.createDoc('ui-a', 'ui/A.tsx', { html: 'export default () => <b>a</b>;\n' }, 0);
  // The window's note, as a crash between "sealed" and "note removed" leaves it.
  const note = outboxNames(r).find((n) => !n.endsWith('.json'));
  expect(note).toBeDefined();
  const kept = path.join(r, `note-${note}`);
  copyFileSync(path.join(outboxDir(r), note as string), kept);
  await new Promise((res) => setTimeout(res, 60));
  first.stop();
  expect(outboxNames(r).filter((n) => n.endsWith('.json')).length).toBe(1);
  copyFileSync(kept, path.join(outboxDir(r), note as string));

  hub.setOnline(true);
  const second = link(r, hub.fetchImpl);
  // Recovering twice is the same as once.
  const third = link(r, hub.fetchImpl);
  expect(outboxNames(r).length).toBe(1);
  await second.refresh();
  await second.client.drainOutbox();
  await third.refresh();
  await third.client.drainOutbox();
  expect(createdDocs(hub.posts)).toEqual(['ui-a']);
  expect(outboxNames(r)).toEqual([]);
});

test('a torn last line keeps every create that was acknowledged before it', async () => {
  const r = root();
  crashInsideWindow(r, ['ui-one:ui/One.tsx']);
  const note = outboxNames(r).find((n) => !n.endsWith('.json')) as string;
  expect(note).toBeDefined();
  writeFileSync(
    path.join(outboxDir(r), note),
    `${readFileSync(path.join(outboxDir(r), note), 'utf8')}{"op":"doc.cre`
  );
  const hub = fakeHub();
  const l = link(r, hub.fetchImpl);
  await l.refresh();
  await l.client.drainOutbox();
  expect(createdDocs(hub.posts)).toEqual(['ui-one']);
});

test('a prompt queued inside the window waits for the create (watermark covers it)', async () => {
  const r = root();
  const hub = fakeHub();
  hub.setOnline(false);
  const l = link(r, hub.fetchImpl);
  void l.createDoc('ui-new', 'ui/Untitled canvas.tsx', { html: 'export default () => null;\n' }, 0);
  // The moment ⌘N returned: the prompt that rides along is enqueued now.
  const wm = contentWatermark(r);
  expect(wm).not.toBeNull();
  const gates = (pending: number[]) =>
    closedGates(
      { kind: 'ai.prompt', project: { id: 'p1', hub: HUB }, watermark: wm },
      {
        online: true,
        hubReachable: true,
        signedIn: true,
        aiConnected: true,
        aiReady: true,
        allowanceResetsAt: null,
      },
      pending,
      Date.now()
    );
  expect(gates(contentPending(r))).toContain('after');
  // Sealed into the content lane: still covered by the same watermark.
  await new Promise((res) => setTimeout(res, 60));
  expect(outboxNames(r).filter((n) => n.endsWith('.json')).length).toBe(1);
  expect(gates(contentPending(r))).toContain('after');
  // Delivered: the gate opens and the prompt may go.
  hub.setOnline(true);
  await l.refresh();
  await new Promise((res) => setTimeout(res, 200));
  expect(createdDocs(hub.posts)).toEqual(['ui-new']);
  expect(gates(contentPending(r))).not.toContain('after');
});

test('a name taken by a peer while this Mac was offline is refused, never written over', async () => {
  const r = root();
  crashInsideWindow(r, ['ui-poster:ui/Poster.tsx']);
  const hub = fakeHub();
  hub.docs.set('ui-poster', { path: 'ui/Poster.tsx', html: 'the peer’s poster' });
  const l = link(r, hub.fetchImpl);
  await l.refresh();
  const results = await l.client.drainOutbox();
  expect(results.map((x) => x.code)).toEqual(['path-conflict']);
  expect(hub.docs.get('ui-poster')?.html).toBe('the peer’s poster');
  expect(existsSync(outboxDir(r)) ? outboxNames(r) : []).toEqual([]);
});
