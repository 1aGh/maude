// The hub's client for a store it does not hold (a cell's ProjectStore
// Durable Object). Reads are retried after a transport blip; writes never are —
// a commit whose answer was lost is resolved by asking for its transaction's
// result, not by committing twice (store-remote.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StoreConflict } from '../src/project-transactions/store-core.mjs';
import { openRemoteProjectStore } from '../src/project-transactions/store-remote.mjs';

const ok = (value) => new Response(JSON.stringify({ ok: true, value }), { status: 200 });

function flaky(failures) {
  const calls = [];
  const fetchImpl = async (url) => {
    const method = String(url).split('/').at(-1);
    calls.push(method);
    if (failures[method] > 0) {
      failures[method] -= 1;
      throw new TypeError('fetch failed');
    }
    return ok({ method });
  };
  return { calls, fetchImpl };
}

test('a read that meets a transport blip is asked again', async () => {
  const { calls, fetchImpl } = flaky({ state: 1, blob: 2 });
  const store = openRemoteProjectStore({ url: 'http://store.test/t/p', fetchImpl });
  assert.deepEqual(await store.state(), { method: 'state' });
  assert.deepEqual(await store.blob('h'), { method: 'blob' });
  assert.deepEqual(calls, ['state', 'state', 'blob', 'blob', 'blob']);
});

test('a read gives up after its retries, with the transport error', async () => {
  const { calls, fetchImpl } = flaky({ manifest: 5 });
  const store = openRemoteProjectStore({ url: 'http://store.test/t/p', fetchImpl });
  await assert.rejects(store.manifest(), /fetch failed/);
  assert.equal(calls.length, 3, 'one call and two retries');
});

test('a write is never retried at the transport', async () => {
  const { calls, fetchImpl } = flaky({ commit: 1, setMode: 1 });
  const store = openRemoteProjectStore({ url: 'http://store.test/t/p', fetchImpl });
  await assert.rejects(store.commit({}), /fetch failed/);
  await assert.rejects(store.setMode({ mode: 'transactions' }), /fetch failed/);
  assert.deepEqual(calls, ['commit', 'setMode']);
});

test("the store's own refusal is an answer, not a blip — never retried", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return new Response(
      JSON.stringify({ ok: false, error: { name: 'StoreConflict', code: 'epoch-stale' } }),
      { status: 200 }
    );
  };
  const store = openRemoteProjectStore({ url: 'http://store.test/t/p', fetchImpl });
  await assert.rejects(store.state(), (err) => err instanceof StoreConflict);
  assert.equal(n, 1);
});
