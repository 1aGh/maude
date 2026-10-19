// S9.21b — a canvas trashed while open stops writes (decision v2-lead-trashed-while-open-stops-writes).
//
//   · the write stop (routes/trash.ts `createTrashWriteStop`): a canvas write naming a trashed canvas — or one of
//     its sidecars — is refused 409 `in-trash` on any write route, at once after `trash:changed`; per-user runtime
//     and exports are not; a canvas made again at the same place takes writes; no shared Trash = nothing stopped;
//   · the parked edits (sync/transaction-client.ts): a content change the kernel answers `dependency-missing` for
//     (its canvas went to the trash first) is kept with it in recovery — never deleted — and `requeueParked`
//     re-proposes it under a derived id once the canvas is restored.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { targetOf } from '../access/request.ts';
import { canvasStemOf, createTrashWriteStop } from '../routes/trash.ts';
import { createTransactionClient, type ProposalResult } from '../sync/transaction-client.ts';

// ------------------------------------------------------------------------------------ the write stop

type Listener = (...a: unknown[]) => void;
function bus() {
  const on = new Map<string, Listener[]>();
  const emitted: Array<[string, unknown]> = [];
  return {
    on: (e: string, fn: Listener) => on.set(e, [...(on.get(e) ?? []), fn]),
    emit: (e: string, p?: unknown) => {
      emitted.push([e, p]);
      for (const fn of on.get(e) ?? []) fn(p);
    },
    emitted,
  };
}

function runtime(state: { trashed: string[]; live?: string[]; down?: boolean }) {
  return {
    acceptedTrash: async () => {
      if (state.down) throw new Error('unreachable');
      return {
        canvases: state.trashed.map((p, i) => ({
          id: `canvas:e${i}`,
          entry: `e${i}`,
          doc: `d${i}`,
          path: p,
          rev: 1,
          actionId: 'a',
          actor: 'tereza',
          at: 1,
        })),
        artboards: [],
        live: {},
      };
    },
    acceptedLinkDocs: async () =>
      (state.live ?? []).map((p, i) => ({ entry: `l${i}`, path: p, retired: false })),
  };
}

const post = (url: string, body?: unknown) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new Request(`http://127.0.0.1${url}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(text ? { 'content-length': String(Buffer.byteLength(text)) } : {}),
    },
    body: text,
  });
};

function stopFor(state: Parameters<typeof runtime>[0], b = bus()) {
  const rt = runtime(state);
  const stop = createTrashWriteStop({
    control: () => rt,
    target: (req) => targetOf(req, '.design'),
    on: b.on,
    emit: b.emit,
  });
  return { stop, b };
}

describe('the write stop', () => {
  test('a write to a trashed canvas is refused on any canvas write route, sidecars included', async () => {
    const { stop } = stopFor({ trashed: ['ui/Combine-cisla.tsx'] });
    const edit = await stop.refusal(
      post('/_api/canvas-edit', { file: '.design/ui/Combine-cisla.tsx' }),
      'edit'
    );
    expect(edit?.status).toBe(409);
    expect(await edit?.json()).toMatchObject({ reason: 'in-trash', error: 'in-trash' });
    const meta = await stop.refusal(
      post('/_api/canvas-meta?file=.design/ui/Combine-cisla.meta.json'),
      'edit'
    );
    expect(meta?.status).toBe(409);
    const ann = await stop.refusal(
      post('/_api/annotations', { file: 'ui/Combine-cisla.annotations.json' }),
      'annotate'
    );
    expect(ann?.status).toBe(409);
    const comment = await stop.refusal(
      post('/_comments', { file: 'ui/Combine-cisla.tsx' }),
      'comment'
    );
    expect(comment?.status).toBe(409);
  });

  test('another canvas, per-user runtime and exports are not stopped', async () => {
    const { stop } = stopFor({ trashed: ['ui/Combine-cisla.tsx'] });
    expect(
      await stop.refusal(post('/_api/canvas-edit', { file: 'ui/Other.tsx' }), 'edit')
    ).toBeNull();
    expect(
      await stop.refusal(post('/_canvas-state', { file: 'ui/Combine-cisla.tsx' }), 'session')
    ).toBeNull();
    expect(
      await stop.refusal(post('/_api/export', { file: 'ui/Combine-cisla.tsx' }), 'export')
    ).toBeNull();
  });

  test('a canvas made again at the trashed one’s place takes writes', async () => {
    const { stop } = stopFor({ trashed: ['ui/A.tsx'], live: ['ui/A.tsx'] });
    expect(await stop.refusal(post('/_api/canvas-edit', { file: 'ui/A.tsx' }), 'edit')).toBeNull();
  });

  test('trash:changed stops the very next write, and says which canvases to the collab lanes', async () => {
    const state = { trashed: [] as string[] };
    const { stop, b } = stopFor(state);
    expect(await stop.refusal(post('/_api/canvas-edit', { file: 'ui/A.tsx' }), 'edit')).toBeNull();
    state.trashed = ['ui/A.tsx'];
    b.emit('trash:changed', { seq: 2 });
    const r = await stop.refusal(post('/_api/canvas-edit', { file: 'ui/A.tsx' }), 'edit');
    expect(r?.status).toBe(409);
    const last = b.emitted.filter(([e]) => e === 'trash:write-stop').at(-1);
    expect(last?.[1]).toEqual({ stems: ['ui/A'] });
    // restored: writes go again
    state.trashed = [];
    b.emit('trash:changed', { seq: 3 });
    expect(await stop.refusal(post('/_api/canvas-edit', { file: 'ui/A.tsx' }), 'edit')).toBeNull();
  });

  test('no shared Trash, or a hub that cannot answer at first, stops nothing and holds nothing up', async () => {
    const legacy = createTrashWriteStop({
      control: () => ({}),
      target: (req) => targetOf(req, '.design'),
    });
    expect(
      await legacy.refusal(post('/_api/canvas-edit', { file: 'ui/A.tsx' }), 'edit')
    ).toBeNull();
    const { stop } = stopFor({ trashed: ['ui/A.tsx'], down: true });
    const t0 = Date.now();
    expect(await stop.refusal(post('/_api/canvas-edit', { file: 'ui/A.tsx' }), 'edit')).toBeNull();
    expect(await stop.refusal(post('/_api/canvas-edit', { file: 'ui/A.tsx' }), 'edit')).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test('canvasStemOf folds a canvas and its sidecars together', () => {
    expect(canvasStemOf('ui/x.tsx')).toBe('ui/x');
    expect(canvasStemOf('ui/x.meta.json')).toBe('ui/x');
    expect(canvasStemOf('ui/x.annotations.json')).toBe('ui/x');
    expect(canvasStemOf('ui/x.annotations.svg')).toBe('ui/x');
  });
});

// ------------------------------------------------------------------------------------ parked edits

const quiet = { log() {}, warn() {}, error() {} };
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trash-stop-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const listing = (rel: string) =>
  existsSync(join(dir, rel)) ? readdirSync(join(dir, rel)).filter((n) => n.endsWith('.json')) : [];

/** A hub that answers `dependency-missing` for doc `d1` while `trashed`, and accepts everything else. */
function hub(state: { trashed: boolean }) {
  const posts: Array<{ tx: string; label: string }> = [];
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
      action: { label: string; operations: Array<{ doc?: string }> };
    };
    posts.push({ tx: body.transactionId, label: body.action.label });
    if (state.trashed && body.action.operations.some((o) => o.doc === 'd1'))
      return ok(200, {
        protocol: 1,
        status: 'rejected',
        code: 'dependency-missing',
        transactionId: body.transactionId,
      });
    return ok(200, {
      protocol: 1,
      status: 'accepted',
      transactionId: body.transactionId,
      revision: posts.length,
    });
  }) as unknown as typeof fetch;
  return { posts, fetchImpl };
}

const edit = (label: string, doc = 'd1') => ({
  label,
  operations: [
    { op: 'lane.replace', doc, lane: 'html', content: `<b>${label}</b>`, baseContent: '' },
  ],
});

describe('edits parked with a trashed canvas (V2-1.14 G1)', () => {
  test('dependency-missing keeps the bytes with the trashed canvas; Restore sends them again', async () => {
    const state = { trashed: true };
    const h = hub(state);
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
    try {
      await client.bootstrap();
      const r = await client.propose(edit('unsent'));
      expect(r).toMatchObject({ status: 'rejected', code: 'dependency-missing' });
      expect(listing('_state/outbox')).toEqual([]);
      const kept = listing('_history/_outbox-recovery');
      expect(kept).toHaveLength(1);
      expect(kept[0]).toMatch(/\.trashed\.json$/);

      // another canvas's parked edits are not touched by this canvas's restore
      expect(await client.requeueParked(['d9'])).toBe(0);

      state.trashed = false; // the canvas is restored
      const firstTx = h.posts[0]?.tx;
      expect(await client.requeueParked(['d1'])).toBe(1);
      expect(listing('_history/_outbox-recovery')).toEqual([]);
      for (let i = 0; i < 100 && results.length < 2; i++)
        await new Promise((r) => setTimeout(r, 10));
      expect(results.at(-1)?.status).toBe('accepted');
      expect(h.posts.map((p) => p.label)).toEqual(['unsent', 'unsent']);
      expect(h.posts[1]?.tx).not.toBe(firstTx); // a derived id, never the refused one again
      expect(listing('_state/outbox')).toEqual([]);
    } finally {
      client.stop();
    }
  });

  test('a refused delete for a missing dependency is not kept', async () => {
    const state = { trashed: true };
    const h = hub(state);
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: h.fetchImpl,
      retryMs: 2,
      log: quiet,
    });
    try {
      await client.bootstrap();
      await client.propose({ label: 'del', operations: [{ op: 'doc.delete', doc: 'd1' }] });
      expect(listing('_history/_outbox-recovery')).toEqual([]);
    } finally {
      client.stop();
    }
  });
});
