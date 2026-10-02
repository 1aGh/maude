// The three controls that stop a cell from minting itself into a rate limit.
//
// Each test names the shape it prevents, because the bug these exist for was
// invisible from inside the cell: every symptom (0 files moved, `on-hub`
// constant, bytes leaving) read as "slow upload" rather than "nothing is
// landing". See `cell-credentials.mjs` for the full incident.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { needsStartupState } from './cell-config.mjs';
import {
  COOLDOWN_KEY,
  CREDS_KEY,
  createCredentialResolver,
  MIN_COOLDOWN_MS,
  REFRESH_MARGIN_MS,
} from './cell-credentials.mjs';

/** A stand-in for DO storage: a Map with the three methods we use. */
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    async get(k) {
      return m.get(k);
    },
    async put(k, v) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
  };
}

const SILENT = { log() {}, warn() {}, error() {} };

function credentials(expiresAt) {
  return {
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    bucket: 'maude-cloud-assets',
    accessKeyId: 'tmp',
    secretAccessKey: 's',
    sessionToken: 't',
    expiresAt,
    prefix: 'tenants/alligators/',
  };
}

// ── 1. the cache ────────────────────────────────────────────────────────────

test('a cached credential inside its TTL costs ZERO mints', async () => {
  const t0 = 1_000_000;
  const storage = fakeStorage();
  let mints = 0;
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => t0,
    log: SILENT,
    mint: async () => {
      mints++;
      return { ok: true, credentials: credentials(t0 + 12 * 60 * 60_000) };
    },
  });

  const first = await r.resolve('alligators');
  assert.equal(first.ok, true);
  assert.equal(first.source, 'mint');
  assert.equal(mints, 1);

  // THE WHOLE POINT: 200 PUTs in one file-plane pass must not be 200 mints.
  for (let i = 0; i < 200; i++) {
    const again = await r.resolve('alligators');
    assert.equal(again.ok, true);
    assert.equal(again.source, 'cache');
  }
  assert.equal(mints, 1, '200 requests, one mint');
});

test('the refresh margin forces a re-mint before the credential actually dies', async () => {
  const t0 = 1_000_000;
  let clock = t0;
  const storage = fakeStorage();
  let mints = 0;
  const expiresAt = t0 + 60 * 60_000;
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => clock,
    log: SILENT,
    mint: async () => {
      mints++;
      return { ok: true, credentials: credentials(expiresAt) };
    },
  });

  await r.resolve('alligators');
  assert.equal(mints, 1);

  // Just INSIDE the margin — still served from cache.
  clock = expiresAt - REFRESH_MARGIN_MS - 1;
  assert.equal((await r.resolve('alligators')).source, 'cache');
  assert.equal(mints, 1);

  // At the margin — re-minted, while the credential is still technically live.
  clock = expiresAt - REFRESH_MARGIN_MS;
  assert.equal((await r.resolve('alligators')).source, 'mint');
  assert.equal(mints, 2);
});

test('a stored blob for a DIFFERENT tenant is ignored, never served', async () => {
  const t0 = 1_000_000;
  const storage = fakeStorage({
    [CREDS_KEY]: {
      tenantId: 'someone-else',
      credentials: credentials(t0 + 60 * 60_000),
      expiresAt: t0 + 60 * 60_000,
    },
  });
  let mints = 0;
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => t0,
    log: SILENT,
    mint: async () => {
      mints++;
      return { ok: true, credentials: credentials(t0 + 60 * 60_000) };
    },
  });
  const out = await r.resolve('alligators');
  assert.equal(out.source, 'mint', 'a foreign entry is a cache MISS, never a hit');
  assert.equal(mints, 1);
  assert.equal(storage.m.get(CREDS_KEY).tenantId, 'alligators');
});

test('the cache never outlives the credential it holds', async () => {
  const t0 = 1_000_000;
  const storage = fakeStorage();
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => t0,
    log: SILENT,
    mint: async () => ({ ok: true, credentials: credentials(t0 + 30 * 60_000) }),
  });
  await r.resolve('alligators');
  assert.equal(storage.m.get(CREDS_KEY).expiresAt, t0 + 30 * 60_000);
});

// ── 2. single-flight ────────────────────────────────────────────────────────

test('concurrent callers on a cold cell produce exactly ONE mint', async () => {
  const t0 = 1_000_000;
  const storage = fakeStorage();
  let mints = 0;
  let release;
  const gate = new Promise((res) => {
    release = res;
  });
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => t0,
    log: SILENT,
    mint: async () => {
      mints++;
      await gate;
      return { ok: true, credentials: credentials(t0 + 60 * 60_000) };
    },
  });

  const all = Promise.all(Array.from({ length: 25 }, () => r.resolve('alligators')));
  release();
  const results = await all;
  assert.equal(mints, 1, '25 concurrent wakes, one mint');
  assert.ok(results.every((x) => x.ok === true));
});

// ── 3. the cooldown ─────────────────────────────────────────────────────────

test('a retryable refusal opens a cooldown, and the cooldown asks NOBODY', async () => {
  let clock = 1_000_000;
  const storage = fakeStorage();
  let mints = 0;
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => clock,
    random: () => 1, // full jitter window, deterministic for the test
    log: SILENT,
    mint: async () => {
      mints++;
      return {
        ok: false,
        retryable: true,
        status: 429,
        retryAfterMs: 30_000,
        detail: 'mint refused: rate limited',
      };
    },
  });

  const first = await r.resolve('alligators');
  assert.equal(first.ok, false);
  assert.equal(first.retryable, true);
  assert.equal(first.source, 'mint');
  assert.equal(mints, 1);

  // THE LOOP-BREAKER. This is the branch whose absence produced 30 container
  // starts in 10 seconds.
  for (let i = 0; i < 50; i++) {
    const again = await r.resolve('alligators');
    assert.equal(again.ok, false);
    assert.equal(again.source, 'cooldown');
  }
  assert.equal(mints, 1, '50 requests during a cooldown, still one mint');

  // Past the window, exactly one more attempt is allowed.
  clock = storage.m.get(COOLDOWN_KEY).until;
  await r.resolve('alligators');
  assert.equal(mints, 2);
});

test('a NON-retryable refusal writes no cooldown — it is a fault, not a wall', async () => {
  const t0 = 1_000_000;
  const storage = fakeStorage();
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => t0,
    log: SILENT,
    mint: async () => ({
      ok: false,
      retryable: false,
      status: 503,
      retryAfterMs: null,
      detail: 'R2 credential minting is not configured',
    }),
  });
  const out = await r.resolve('alligators');
  assert.equal(out.ok, false);
  assert.equal(out.retryable, false);
  assert.equal(storage.m.has(COOLDOWN_KEY), false, 'nothing to wait for');
  assert.equal(storage.m.has(CREDS_KEY), false, 'a failure is never cached as a success');
});

test('a success clears a standing cooldown', async () => {
  const t0 = 1_000_000;
  const storage = fakeStorage({ [COOLDOWN_KEY]: { until: t0 - 1, detail: 'old' } });
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => t0,
    log: SILENT,
    mint: async () => ({ ok: true, credentials: credentials(t0 + 60 * 60_000) }),
  });
  await r.resolve('alligators');
  assert.equal(storage.m.has(COOLDOWN_KEY), false);
});

test('the cooldown is floored and jittered, never zero', async () => {
  const t0 = 1_000_000;
  const storage = fakeStorage();
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => t0,
    random: () => 0, // the smallest draw full jitter can produce
    log: SILENT,
    mint: async () => ({ ok: false, retryable: true, retryAfterMs: 1, detail: 'x' }),
  });
  await r.resolve('alligators');
  const until = storage.m.get(COOLDOWN_KEY).until;
  assert.ok(until - t0 >= MIN_COOLDOWN_MS, 'a cooldown that is instantly over is not a cooldown');
});

test('storage that throws degrades to today behaviour instead of failing the cell', async () => {
  const t0 = 1_000_000;
  const hostile = {
    async get() {
      throw new Error('storage unavailable');
    },
    async put() {
      throw new Error('storage unavailable');
    },
    async delete() {
      throw new Error('storage unavailable');
    },
  };
  let mints = 0;
  const r = createCredentialResolver({
    env: {},
    storage: hostile,
    now: () => t0,
    log: SILENT,
    mint: async () => {
      mints++;
      return { ok: true, credentials: credentials(t0 + 60 * 60_000) };
    },
  });
  const out = await r.resolve('alligators');
  assert.equal(out.ok, true, 'no cache is slower, not broken');
  assert.equal(mints, 1);
});

test('invalidate drops the cache so the next resolve re-mints', async () => {
  const t0 = 1_000_000;
  const storage = fakeStorage();
  let mints = 0;
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => t0,
    log: SILENT,
    mint: async () => {
      mints++;
      return { ok: true, credentials: credentials(t0 + 60 * 60_000) };
    },
  });
  await r.resolve('alligators');
  assert.equal((await r.resolve('alligators')).source, 'cache');
  await r.invalidate();
  assert.equal((await r.resolve('alligators')).source, 'mint');
  assert.equal(mints, 2);
});

// ── the running-container short-circuit ─────────────────────────────────────
//
// The predicate, not the class. `cell-do.mjs` imports `@cloudflare/containers`,
// which does not resolve under plain Node — that is the whole reason the
// decidable half lives in `cell-config.mjs` (see its header). An earlier
// version of this file tried to exercise `MaudeCell.fetch()` behind a
// `.catch(() => null)` import guard; it passed by SKIPPING, which is worse
// than no test. So the decision is a pure function and this is where it is
// pinned; the wiring in `fetch()` is covered by Task 31 wrangler-tail
// verification, and that gap is stated rather than papered over.

test('needsStartupState: a running container needs neither config nor credentials', () => {
  assert.equal(needsStartupState({ running: true }), false);
  assert.equal(needsStartupState({ running: false }), true);
  assert.equal(needsStartupState({}), true, 'unknown ⇒ resolve, never assume running');
  assert.equal(needsStartupState(null), true);
  assert.equal(needsStartupState(undefined), true);
  // Only the literal `true` counts. A truthy-but-not-true value (a stub, a
  // stale shape from a platform change) must fall to the safe side: start.
  assert.equal(needsStartupState({ running: 'yes' }), true);
});

// ── tenant keying (security review of this change) ──────────────────────────
//
// The first version keyed the CACHE and the COOLDOWN by tenant but left the
// single-flight promise on a bare `let`. That is the fast path around the very
// check the slow path performs: a shared promise never reads the cache, so the
// `stored.tenantId === tenantId` assertion could not run. `cell-do.mjs` carries
// a live rebind branch (a differing `x-maude-internal-tenant` header re-binds
// the instance), which is exactly the scenario those assertions exist for.

test('a concurrent mint for a DIFFERENT tenant is never served another tenant credential', async () => {
  const t0 = 1_000_000;
  const storage = fakeStorage();
  const seen = [];
  let release;
  const gate = new Promise((res) => {
    release = res;
  });
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => t0,
    log: SILENT,
    mint: async ({ tenantId }) => {
      seen.push(tenantId);
      await gate;
      return {
        ok: true,
        credentials: { ...credentials(t0 + 60 * 60_000), accessKeyId: `key-${tenantId}` },
      };
    },
  });

  const a = r.resolve('alligators');
  const b = r.resolve('someone-else');
  release();
  const [ra, rb] = await Promise.all([a, b]);

  // TWO mints, because they are two tenants — coalescing here would be the bug.
  assert.deepEqual(seen.sort(), ['alligators', 'someone-else']);
  assert.equal(ra.credentials.accessKeyId, 'key-alligators');
  assert.equal(rb.credentials.accessKeyId, 'key-someone-else');
});

test("one tenant's cooldown does not refuse another tenant's start", async () => {
  const t0 = 1_000_000;
  const storage = fakeStorage({
    [COOLDOWN_KEY]: { tenantId: 'someone-else', until: t0 + 60_000, detail: 'theirs' },
  });
  let mints = 0;
  const r = createCredentialResolver({
    env: {},
    storage,
    now: () => t0,
    log: SILENT,
    mint: async () => {
      mints++;
      return { ok: true, credentials: credentials(t0 + 60 * 60_000) };
    },
  });
  const out = await r.resolve('alligators');
  assert.equal(out.ok, true, 'a foreign cooldown is not ours to wait out');
  assert.equal(mints, 1);
});

test('an unknown tenant is reported as such, so the cell can refuse to start it', async () => {
  // The cell's legacy fallback key used to start a container for any tenant the
  // control plane refused — including scanner-chosen names (2026-10-02). The
  // 404 has to survive the resolver for the cell to tell "no such project"
  // apart from "storage is having a moment".
  const r = createCredentialResolver({
    env: {},
    storage: fakeStorage(),
    log: SILENT,
    mint: async () => ({ ok: false, retryable: false, status: 404, detail: 'HTTP 404' }),
  });
  const out = await r.resolve('feed');
  assert.equal(out.ok, false);
  assert.equal(out.retryable, false);
  assert.equal(out.status, 404);
});
