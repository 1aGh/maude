// Per-tenant R2 credential resolution for a cell — cache, single-flight, cooldown.
//
// WHAT THIS EXISTS TO STOP (2026-09-03). `MaudeCell.fetch()` resolved storage
// credentials on EVERY proxied request, not on every container start as its
// own comment claimed. A file-plane seed issues up to `MAX_FILES_PER_PASS`
// (200) PUTs per pass, so one pass drove up to 200 control-plane round trips
// and therefore up to 200 `POST /accounts/:id/r2/temp-access-credentials`
// calls against the Cloudflare API. The account rate limit tripped; the 429
// arrived as an opaque 502; the cell fail-closed and refused to start; the
// next request minted again. Measured: 30 container starts in 10 s, 314 PUTs
// across 44 unique paths, and an 8.8 GB project that moved ZERO files across
// two runs while sending 616 MB of retry traffic.
//
// Three controls, each closing a different half of that loop:
//
//   1. CACHE — a minted credential is good for its whole TTL, so a wake should
//      cost one mint, not one per request.
//   2. SINGLE-FLIGHT — concurrent requests to a cold cell must produce ONE
//      mint between them, not one each.
//   3. COOLDOWN — when the control plane says "come back", asking again
//      immediately is the thing making it worse. Inside the cooldown we do not
//      touch the control plane at all.
//
// WHAT THIS DELIBERATELY DOES NOT CHANGE: fail-closed. A cell that genuinely
// cannot obtain storage must still refuse to start (see the header comment on
// `fetchTenantS3Credentials` — a cold start without storage rehydrates nothing,
// comes up empty, and autosave then commits that emptiness over real work).
// This module changes how OFTEN we ask and what we can say about the answer.
// It never turns "no storage" into "run local-only".
//
// TENANT ISOLATION IS STRUCTURAL, AND CHECKED ANYWAY. The cache lives in the
// Durable Object's own storage, and the DO id is `idFromName(tenantId)` — one
// store per tenant by construction, so there is no shared map a mistake could
// cross. The `tenantId` equality assertions are redundant today and kept
// anyway: they cost nothing and turn a future routing mistake into a cache miss
// instead of one tenant booting with another's credential.
//
// EVERY per-tenant path carries the key, not just the ones that read storage.
// The first version keyed the cache and the cooldown but left the single-flight
// promise on a bare `let` — the fast path around the very check the slow path
// performs. `cell-do.mjs` does carry a live rebind branch (an
// `x-maude-internal-tenant` header that differs from the stored id re-binds the
// instance), which is precisely the scenario these assertions exist for, so a
// promise shared across two tenant ids would have handed tenant B tenant A's
// `secretAccessKey` with no check anywhere on the way. Caught by the security
// review of this change; the lesson is that "structural" is a reason to add the
// belt, not a reason to skip it on one path.

import { fetchTenantS3Credentials } from './cell-config.mjs';

/** Storage keys. Namespaced so nothing else in the DO's store collides. */
export const CREDS_KEY = 's3Creds';
export const COOLDOWN_KEY = 's3CredsCooldown';

/**
 * Treat credentials as stale this long before their stated expiry.
 *
 * Mirrors `REFRESH_MARGIN_MS` in `apps/cloud/r2-creds.mjs`. Deliberately a
 * local copy: `apps/cells` and `apps/cloud` are separate Workers with separate
 * bundles and no shared module, and a cross-app import would couple two deploy
 * units for one number. If it changes there, change it here — the tests below
 * pin the behaviour, not the value.
 */
export const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/** Floor and ceiling on a cooldown, whatever the control plane asked for. */
export const MIN_COOLDOWN_MS = 5_000;
export const MAX_COOLDOWN_MS = 5 * 60_000;

/**
 * Full jitter on the cooldown.
 *
 * A fleet of cells that all met the same rate limit would otherwise all come
 * back at the same instant and re-trip it — a thundering herd wearing a
 * backoff's clothes. Full jitter (a uniform draw over the whole window, not a
 * ± band around it) is the shape that actually spreads them.
 */
function jitter(ms, random) {
  const capped = Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, ms));
  return Math.max(MIN_COOLDOWN_MS, Math.round(capped * (0.5 + 0.5 * random())));
}

/**
 * Build a resolver bound to ONE cell's storage.
 *
 * Closure state (not module state) holds the in-flight map: a module-level map
 * would be shared by every DO instance in the isolate, which is exactly the
 * kind of cross-tenant coupling the DO boundary exists to prevent.
 *
 * @param {object} opts
 * @param {object} opts.env
 * @param {{get: (k: string) => Promise<any>, put: (k: string, v: any) => Promise<any>, delete: (k: string) => Promise<any>}} opts.storage
 * @param {() => number} [opts.now]
 * @param {() => number} [opts.random]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {typeof fetchTenantS3Credentials} [opts.mint]
 * @param {Pick<Console,'log'|'warn'|'error'>} [opts.log]
 */
export function createCredentialResolver({
  env,
  storage,
  now = Date.now,
  random = Math.random,
  fetchImpl = undefined,
  mint = fetchTenantS3Credentials,
  log = console,
} = {}) {
  /**
   * In-flight mints, KEYED BY TENANT.
   *
   * A bare `let inflight` was the faster path around this module's own
   * defence-in-depth: `readCache` re-checks `stored.tenantId === tenantId`
   * precisely so a future routing mistake becomes a cache miss rather than one
   * tenant booting with another's credential — but a shared promise never
   * reads the cache at all, so the check could not run. The DO does carry a
   * live rebind branch (`cell-do.mjs`: a `x-maude-internal-tenant` header that
   * differs from stored re-binds the instance), which is the exact scenario
   * the equality check exists for. Keyed, both paths hold.
   */
  const inflight = new Map();

  /**
   * Resolve this tenant's storage credentials.
   *
   * @returns {Promise<
   *   | { ok: true, credentials: object, source: 'cache' | 'mint' }
   *   | { ok: false, retryable: boolean, retryAfterMs: number | null, status?: number | null, detail: string, source: 'cooldown' | 'mint' }
   * >}
   */
  async function resolve(tenantId) {
    const cached = await readCache(tenantId);
    if (cached) return { ok: true, credentials: cached, source: 'cache' };

    const cooling = await readCooldown(tenantId);
    if (cooling && now() < cooling.until) {
      // THE LOOP-BREAKER. Not one request to the control plane in this branch.
      const waitMs = cooling.until - now();
      log.warn?.(
        `[cell] ${tenantId} storage credentials on cooldown for ${Math.ceil(waitMs / 1000)}s — not asking`
      );
      return {
        ok: false,
        retryable: true,
        retryAfterMs: waitMs,
        detail: cooling.detail ?? 'waiting out an upstream refusal',
        source: 'cooldown',
      };
    }

    const running = inflight.get(tenantId);
    if (running) return await running;
    const mintOnce = (async () => {
      try {
        const minted = await mint({ tenantId, env, ...(fetchImpl ? { fetchImpl } : {}) });
        if (minted.ok) {
          await writeCache(tenantId, minted.credentials);
          await clearCooldown();
          // ONE LINE PER ACTUAL MINT. Its absence is what made this a
          // two-session diagnosis: `wrangler tail` showed the failures but
          // nothing showed the RATE of successful asks, so "we mint once per
          // start" could not be distinguished from "we mint once per request"
          // without reading the source. Never the credential, never the URL —
          // the same posture `seed-repo.mjs` takes with a seed URL.
          const ttlS = Math.max(
            0,
            Math.round((Number(minted.credentials?.expiresAt) - now()) / 1000) || 0
          );
          log.log?.(`[cell] ${tenantId} minted storage credentials (ttl ${ttlS}s)`);
          return { ok: true, credentials: minted.credentials, source: 'mint' };
        }
        // NEVER CACHE A FAILURE AS A SUCCESS. A refusal only ever writes a
        // cooldown, and only when coming back could actually help.
        if (minted.retryable) {
          const until = now() + jitter(minted.retryAfterMs ?? MAX_COOLDOWN_MS, random);
          await writeCooldown({ tenantId, until, detail: minted.detail });
        }
        // A NON-RETRYABLE REFUSAL INVALIDATES. The control plane refusing on
        // the merits (unknown tenant, purged, minting unconfigured) is exactly
        // when a previously-cached credential must stop being reusable — the
        // cache would otherwise outlive the authority that issued it.
        if (!minted.retryable) await invalidate();
        return {
          ok: false,
          retryable: minted.retryable === true,
          retryAfterMs: minted.retryAfterMs ?? null,
          // The control plane's own status — 404 is "no such project", which
          // the cell must treat as "do not start", never as a reason to reach
          // for a fallback key.
          status: minted.status ?? null,
          detail: minted.detail ?? 'credential mint refused',
          source: 'mint',
        };
      } finally {
        inflight.delete(tenantId);
      }
    })();
    inflight.set(tenantId, mintOnce);
    return await mintOnce;
  }

  /** Drop the cached credential — the operator's "apply it now" path. */
  async function invalidate() {
    try {
      await storage.delete(CREDS_KEY);
    } catch {
      /* a cache we cannot clear is a cache that expires on its own */
    }
  }

  async function readCache(tenantId) {
    let stored;
    try {
      stored = await storage.get(CREDS_KEY);
    } catch {
      return null;
    }
    if (!stored || typeof stored !== 'object') return null;
    // Redundant by construction (see the header) and kept deliberately.
    if (stored.tenantId !== tenantId) return null;
    const creds = stored.credentials;
    if (!creds?.accessKeyId || !creds?.secretAccessKey) return null;
    const expiresAt = Number(stored.expiresAt);
    if (!Number.isFinite(expiresAt)) return null;
    // NEVER serve past expiry, margin included. A credential that dies inside
    // a container start is worse than one that was never handed over: the cell
    // comes up, believes it has storage, and fails on the first read.
    if (now() >= expiresAt - REFRESH_MARGIN_MS) return null;
    return creds;
  }

  async function writeCache(tenantId, credentials) {
    // The credential's OWN stated expiry bounds the cache. Nothing here may
    // extend it — a cache entry outliving the credential it holds is the
    // failure this whole margin exists to avoid.
    const expiresAt = Number(credentials?.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    try {
      await storage.put(CREDS_KEY, { tenantId, credentials, expiresAt });
    } catch (err) {
      // A cache we cannot write is a slow cell, not a broken one.
      log.warn?.(`[cell] ${tenantId} could not cache storage credentials: ${err?.message ?? err}`);
    }
  }

  async function readCooldown(tenantId) {
    try {
      const stored = await storage.get(COOLDOWN_KEY);
      if (!stored || !Number.isFinite(Number(stored.until))) return null;
      // Same tenant check as the credential cache, for the same reason: under a
      // rebind, one tenant's cooldown would otherwise refuse another's start.
      if (stored.tenantId !== undefined && stored.tenantId !== tenantId) return null;
      return { until: Number(stored.until), detail: stored.detail };
    } catch {
      return null;
    }
  }

  async function writeCooldown(entry) {
    try {
      await storage.put(COOLDOWN_KEY, entry);
    } catch {
      /* an unpersisted cooldown still holds for this isolate's lifetime */
    }
  }

  async function clearCooldown() {
    try {
      await storage.delete(COOLDOWN_KEY);
    } catch {
      /* it expires on its own */
    }
  }

  return { resolve, invalidate };
}
