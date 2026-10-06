// The hub's client for a store it does not hold — DDR-241 §2, plan T10.
//
// In a cloud cell the accepted-revision store lives in the cell's Durable
// Object (`apps/cells/project-store.mjs`), reached through the container
// runtime's outbound interception at `http://project-store.internal/`. This
// client exposes the SAME async API as `openSqliteProjectStore`, so the kernel
// and the hub integration cannot tell the two homes apart.
//
// A transport failure is thrown as a plain error, which the kernel reports as
// `retryable` — the proposal stays in the designer's outbox and is resent. It
// is never retried HERE: a commit whose answer was lost must be resolved by the
// client asking for its transaction's result, not by committing it twice.

import { StoreConflict } from './store-core.mjs';

const METHODS = [
  'state',
  'setMode',
  'markImported',
  'heads',
  'blob',
  'result',
  'recordResult',
  'commit',
  'revisions',
  'history',
  'action',
  'manifest',
  'docByPath',
  'laneAt',
  'effectsAfter',
  'liveDocByEntry',
];

export function openRemoteProjectStore({
  url,
  fetchImpl = fetch,
  timeoutMs = 20_000,
  token = null,
  readRetries = 2,
}) {
  const base = String(url).replace(/\/+$/, '');
  const call = async (method, args) => {
    const res = await fetchImpl(`${base}/v1/${method}`, {
      method: 'POST',
      // A cell reaches its store through outbound interception (no credential
      // needed). A store served over the network — the T32 verification
      // Worker — is addressed with a bearer.
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ args }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`project store answered ${res.status}`);
    const answer = await res.json();
    if (answer?.ok) return answer.value;
    const e = answer?.error ?? {};
    if (e.name === 'StoreConflict') throw new StoreConflict(e.code);
    throw new Error(`project store: ${e.message ?? 'failed'}`);
  };
  // READS ARE RETRIED; WRITES NEVER ARE. A read that met a transport blip (a
  // cell's store call cut mid-flight — "fetch failed" on the F3 fixture, a
  // platform disconnect on the cloud) is asked again: nothing changes by
  // asking twice. A write stays single-shot, for the reason at the top.
  const READS = new Set([
    'state',
    'heads',
    'blob',
    'result',
    'revisions',
    'history',
    'action',
    'manifest',
    'docByPath',
    'laneAt',
    'effectsAfter',
    'liveDocByEntry',
  ]);
  const read = async (method, args) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call(method, args);
      } catch (err) {
        if (err instanceof StoreConflict || attempt >= readRetries) throw err;
        await new Promise((r) => setTimeout(r, 200 * 4 ** attempt));
      }
    }
  };
  const store = { kind: 'remote', file: base, close: () => {} };
  for (const m of METHODS)
    store[m] = READS.has(m) ? (...args) => read(m, args) : (...args) => call(m, args);
  return store;
}
