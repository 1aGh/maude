// The cell as a Durable Object — Cloud Phase 15 Tasks 1/2.
//
// One project, one container, one DO. The DO is the lifecycle owner (start,
// idle-sleep, wake); the container is the tenant's Maude workspace, which is
// the SAME image as the self-hosted hub plus tenant scoping (DDR-195).
//
// THE RUNTIME HALF ONLY. Everything decidable without a container — the tenant
// grammar, the derived secrets, the env mapping, and (since Phase 24 B1) the
// per-tenant config fetch — lives in `cell-config.mjs`, because this file
// imports `@cloudflare/containers` and that does not resolve under plain Node.
// The split is what makes the mapping testable at all; it is re-exported here
// so every existing importer is unaffected.
//
// CONTAINMENT (DDR-193 §2) is an image property, asserted at CI time, at build
// time and at boot. Nothing here can re-enable rendering; the image has no
// renderer in it.

import { Container } from '@cloudflare/containers';

import {
  CANVAS_ORIGIN_HEADER,
  CELL_PORT,
  cellEnv,
  deriveSecret,
  fetchTenantConfig,
  isNavigation,
  isValidTenantId,
  needsStartupState,
  RESTART_PATH,
  secretsMatch,
  TENANT_HEADER,
  WAKE_HEADER,
  wakePolicy,
} from './cell-config.mjs';
import { createCredentialResolver } from './cell-credentials.mjs';
import {
  couldNotStartPage,
  htmlResponse,
  notFoundPage,
  REFRESH_SECONDS,
  startingPage,
  stripWait,
  WAIT_PARAM,
} from './pages.mjs';

/**
 * How long a start may take before a person is told it failed: the port wait
 * below (30 min — "how big may a project be", see the comment there).
 */
const START_DEADLINE_MS = 1_800_000;

export {
  CELL_PORT,
  cellEnv,
  deriveSecret,
  fetchTenantConfig,
  fetchTenantS3Credentials,
  isValidTenantId,
  RESTART_PATH,
  secretsMatch,
  TENANT_HEADER,
  tenantFromHostname,
} from './cell-config.mjs';

export class MaudeCell extends Container {
  defaultPort = CELL_PORT;

  /**
   * This cell's credential resolver — cache + single-flight + cooldown.
   *
   * Per-INSTANCE, like `envVars`, and for the same reason: a resolver shared
   * across instances would hold one tenant's credential where another tenant's
   * request could reach it. The DO boundary is what makes the cache safe, so
   * the cache must not outlive it. Built lazily because `this.env` is not
   * available at field-initialiser time.
   */
  #credentials = null;

  /**
   * Idle timeout. Long enough that stepping away does not cost a cold start
   * (which pays rehydrate-from-R2); short enough that an idle cell is not
   * billed compute for doing nothing.
   */
  sleepAfter = '20m';

  /**
   * Start with THIS tenant's environment, then proxy.
   *
   * Per-instance, not class-level: `envVars` on the class is identical for
   * every instance, which is exactly what must not happen when the variables
   * include an operator credential and a storage prefix.
   */
  /**
   * Stop the container so the next request starts it fresh.
   *
   * Environment is applied at START. Without this, changing a cell's
   * configuration — its seed repo, its storage credentials, its first user —
   * has no effect until the idle timeout happens to fire, which is a 20-minute
   * wait with no way to tell whether the change took. An operator needs to be
   * able to say "apply it now".
   */
  /**
   * RPC from this cell's own outbound route (`projectStoreOutbound`): forward
   * one store call to THIS tenant's ProjectStore. The tenant is the one this
   * cell was routed for — never anything the container says.
   */
  async projectStore(method, args) {
    const tenantId = this.tenantId ?? (await this.ctx.storage.get('tenantId'));
    if (!isValidTenantId(tenantId) || !this.env.PROJECT_STORE) {
      return {
        ok: false,
        error: {
          name: 'Error',
          code: 'store-unavailable',
          message: 'no project store for this cell',
        },
      };
    }
    const store = this.env.PROJECT_STORE.get(this.env.PROJECT_STORE.idFromName(tenantId));
    return store.projectStore(method, args);
  }

  async restart() {
    // DROP THE CACHED CREDENTIAL TOO, not just the container.
    //
    // Before the credential cache existed, every start re-asked
    // `/internal/cell-r2-credentials`, so the control plane's
    // purged/unknown-tenant gate ran on every start. With a cache and without
    // this line, a rotated or revoked credential would keep being handed to the
    // container across arbitrarily many restarts for the rest of its ~12 h TTL,
    // with no control-plane round trip in between — a revocation-latency
    // regression introduced by the cache, found in its security review.
    //
    // `restart()` is also the operator's documented "apply it now" path, and a
    // path that reapplies everything EXCEPT the credential is a trap.
    await this.#credentials?.invalidate();
    if (this.ctx.container?.running) await this.ctx.container.destroy();
    return { restarted: true };
  }

  async fetch(request) {
    const fromHeader = request.headers.get(TENANT_HEADER);
    // Remembered, so a wake triggered by anything other than a routed request
    // still knows who it is.
    const tenantId = fromHeader ?? (await this.ctx.storage.get('tenantId'));
    if (!isValidTenantId(tenantId)) {
      if (isNavigation(request)) {
        return htmlResponse(couldNotStartPage({ url: new URL(request.url) }), 500);
      }
      return new Response('this cell has no tenant', { status: 500 });
    }
    if (fromHeader && fromHeader !== (await this.ctx.storage.get('tenantId'))) {
      await this.ctx.storage.put('tenantId', fromHeader);
    }
    this.tenantId = tenantId;

    const hostname = new URL(request.url).hostname;

    // A PROBE THAT MUST NOT WAKE (WAKE_HEADER). Decided before ANY of the
    // start-path work below — config fetch, credential mint, activity renewal
    // — because each of those is a cost or a timer the probe exists to avoid.
    const running = this.ctx.container?.running;
    const policy = wakePolicy({
      headers: request.headers,
      running,
      // Only worked out when it could matter: a no-wake ask to a cold cell.
      authorized:
        running !== true &&
        request.headers.get(WAKE_HEADER) === 'never' &&
        secretsMatch(
          (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim(),
          await deriveSecret(this.env.CELL_SECRET_MASTER, tenantId)
        ),
    });
    if (policy === 'asleep-reply') {
      return Response.json({ state: 'asleep' }, { headers: { 'cache-control': 'no-store' } });
    }
    if (request.headers.has(WAKE_HEADER)) {
      // The hub never needs to see it.
      request = new Request(request);
      request.headers.delete(WAKE_HEADER);
    }

    // A PERSON'S BROWSER GETS A PAGE, NOT A HANG (feature-cloud-cost-and-
    // cold-start-ux B2). Everything else — scripts, sockets, desktop sync,
    // probes — falls through to the blocking path below, byte-for-byte as
    // before. The page is shown only where this request would have started
    // the cell anyway, so it reveals nothing a request could not already learn.
    if (isNavigation(request)) {
      const url = new URL(request.url);
      const canvas = request.headers.get(CANVAS_ORIGIN_HEADER) === '1';
      if (!(await this.#readyForNavigation(tenantId))) {
        if (this.#unknownTenant) return htmlResponse(notFoundPage({ canvas }), 404);
        const failed = this.#takeStartFailure();
        if (failed) {
          return htmlResponse(couldNotStartPage({ url, reason: failed, canvas }), 503);
        }
        const starting = this.#ensureStarted(tenantId, hostname);
        // The refreshes keep this object busy, but the start must not depend on
        // a person keeping the tab open.
        this.ctx.waitUntil?.(starting);
        return htmlResponse(startingPage({ url, canvas }), 503, { retryAfter: REFRESH_SECONDS });
      }
      if (url.searchParams.has(WAIT_PARAM)) request = new Request(stripWait(url), request);
    }

    // A RUNNING CONTAINER NEEDS NEITHER ITS CONFIG NOR FRESH CREDENTIALS.
    //
    // Both are applied at container START — `startOptions.envVars` REPLACES
    // the image's environment, and nothing re-reads them afterwards. Resolving
    // them per request was therefore pure cost, and on 2026-09-03 it was a
    // catastrophic one: `fetch()` runs for every proxied request, so a
    // file-plane pass of up to 200 PUTs drove up to 200 control-plane round
    // trips and 200 Cloudflare `temp-access-credentials` mints. The account
    // rate limit tripped, the 429 arrived as an opaque 502, the cell
    // fail-closed, and the next request minted again — 30 starts in 10 s,
    // while an 8.8 GB project moved zero files across two runs.
    //
    // The comment on the credential call below has always said "minted fresh
    // on every container start". This is the line that makes that true.
    //
    // `running` is the platform's own truth, the same accessor `restart()`
    // uses. A container that dies between this check and the proxy costs ONE
    // failed request — the catch falls through to the cold path, and the next
    // request sees `running === false` and starts properly.
    if (!needsStartupState(this.ctx.container)) {
      try {
        this.renewActivityTimeout?.();
        if (!this.#tunnelMode(tenantId)) return await this.containerFetch(request);
        return await this.#proxyThroughTunnel(request);
      } catch (err) {
        console.warn(
          `[cell] ${tenantId} running-container proxy failed, falling back to a start: ${err?.message ?? err}`
        );
      }
    }

    // THE BLOCKING PATH — every non-navigation caller, unchanged in behaviour.
    // It goes through the SAME single-flight start a navigation kicks, so a
    // page refresh and a desktop PUT arriving together cause one start, one
    // config fetch and one credential resolve (the 2026-09-03 storm guard).
    const started = await this.#ensureStarted(tenantId, hostname);
    if (started.refuse) return started.refuse;
    if (this.#tunnelMode(tenantId)) {
      this.renewActivityTimeout?.();
      return await this.#proxyThroughTunnel(request);
    }
    return this.containerFetch(request);
  }

  /** The start in flight, if any — ONE per object, shared by every caller. */
  #starting = null;
  /** When the current (or last) start began — the navigation deadline's clock. */
  #startedAt = null;
  /** Why the last start failed, for the next navigation to show once. */
  #startFailure = null;
  /** The control plane said this tenant does not exist — never start it. */
  #unknownTenant = false;

  /** A failed start, shown once — the person's "Try again" starts afresh. */
  #takeStartFailure() {
    if (this.#starting || !this.#startFailure) return null;
    const reason = this.#startFailure;
    this.#startFailure = null;
    return reason;
  }

  /**
   * Is the project ready to be shown to a person? Never starts anything.
   *
   * Non-tunnel: the platform says the container runs AND the library marked
   * its port healthy. Tunnel: one quick look through the tunnel — the same
   * readiness test `#proxyThroughTunnel` polls, asked once per page refresh
   * instead of in a two-minute blocking loop.
   */
  async #readyForNavigation(tenantId) {
    if (this.ctx.container?.running !== true) return false;
    if (!this.#tunnelMode(tenantId)) {
      const state = await this.getState?.();
      return state?.status === 'healthy';
    }
    if (this.#starting) return false;
    const probe = await fetch(`https://${this.env.MAUDE_TUNNEL_HOST}/health`, {
      cf: { cacheTtl: 0 },
      signal: AbortSignal.timeout(2_000),
    }).catch(() => null);
    const up = Boolean(probe && ![530, 502, 523, 521].includes(probe.status));
    if (!up && this.#startedAt && Date.now() - this.#startedAt > START_DEADLINE_MS) {
      this.#startFailure ??= 'The project’s server didn’t come up in time.';
    }
    return up;
  }

  /**
   * Start this cell, once, however many callers ask. Resolves `{}` when the
   * container is up (tunnel: started; otherwise: port healthy), or
   * `{ refuse }` with the response today's blocking callers return.
   */
  #ensureStarted(tenantId, hostname) {
    if (this.#starting) return this.#starting;
    this.#startedAt = Date.now();
    this.#startFailure = null;
    this.#starting = this.#start(tenantId, hostname)
      .catch((err) => {
        console.error(`[cell] ${tenantId} start failed: ${err?.message ?? err}`);
        this.#startFailure = 'The project’s server didn’t manage to start this time.';
        return {
          refuse: new Response(
            'This project could not be started. The operator has been given the reason.\n',
            { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }
          ),
        };
      })
      .finally(() => {
        this.#starting = null;
      });
    return this.#starting;
  }

  async #start(tenantId, hostname) {
    // ALREADY RUNNING (a navigation found it up but not yet healthy): nothing
    // to configure — env applies only at START — so just wait for the port.
    if (this.ctx.container?.running === true && !this.#tunnelMode(tenantId)) {
      await this.startAndWaitForPorts({
        cancellationOptions: { portReadyTimeoutMS: START_DEADLINE_MS },
      });
      return {};
    }

    // Who this tenant is, asked of the control plane rather than read from a
    // fleet-wide variable (B1). Resolved per start; the DO's own storage is
    // the offline fallback, never another tenant's value.
    const config = await fetchTenantConfig({
      tenantId,
      env: this.env,
      storage: this.ctx.storage,
    });
    // OUTBOUND INGRESS (Cloud Phase 25, 2026-08-03). When this tenant has a
    // named Cloudflare Tunnel, the request path avoids the DO→container port
    // link entirely: we START the container (the half of the machinery that
    // kept working through the outage) and then reach the hub over the tunnel
    // the container itself dialled out. The DO stays in the path on purpose —
    // it is what wakes the cell on demand and what lets sleepAfter idle it.
    if (
      this.env.MAUDE_TUNNEL_TOKEN &&
      this.env.MAUDE_TUNNEL_HOST &&
      tenantId === this.env.MAUDE_TUNNEL_TENANT
    ) {
      // `config` is the one resolved above — this branch used to re-fetch it,
      // doubling a control-plane call on every tunnel-mode cold start.
      const storage = await this.#resolveStorageCredentials(tenantId);
      if (storage.refuse) return this.#refused(storage);
      try {
        // Idempotent when already running; never waits for the port.
        await this.start({
          envVars: await cellEnv({
            tenantId,
            env: this.env,
            hostname,
            config,
            s3Creds: storage.s3Creds,
          }),
        });
      } catch (err) {
        console.error(`[cell] ${tenantId} tunnel-mode start: ${err?.message ?? err}`);
      }
      return {};
    }

    // This tenant's OWN storage credentials (Phase 25 A-1) — minted fresh on
    // every container START (see the running-container short-circuit above),
    // so a wake always carries a full TTL. FAIL CLOSED: a cell that cannot get
    // credentials AND has no legacy shared key must not start, because a cold
    // start without storage rehydrates nothing and comes up as an empty
    // project — indistinguishable from a deleted one.
    const storage = await this.#resolveStorageCredentials(tenantId);
    if (storage.refuse) return this.#refused(storage);
    const s3Creds = storage.s3Creds;
    await this.startAndWaitForPorts({
      startOptions: {
        envVars: await cellEnv({ tenantId, env: this.env, hostname, config, s3Creds }),
      },
      // A cold start pays a rehydrate from R2 — and a FIRST start also pays a
      // full clone of the tenant's project — before anything listens. The
      // default turns that normal path into a 500; 120 s was still not enough
      // for a ~280 MB seed on a quarter of a vCPU.
      // 30 MINUTES, and the number is evidence rather than taste.
      //
      // The entrypoint rehydrates the whole working set from R2 BEFORE the hub
      // binds its port, so this deadline is really "how big may a project be".
      // At 1.1 GiB on a half vCPU, alligators does not finish inside 600 s —
      // and the failure mode is vicious: the deadline fires, the DO starts
      // over on an empty disk, and every retry re-downloads from zero. The
      // project had been fine for weeks only because its disk stayed warm; the
      // first instance migration turned a working project into a permanent
      // restart loop, with the platform reporting the container as `running`
      // throughout (2026-08-03 incident).
      //
      // THE REAL FIX IS TO BIND FIRST AND RESTORE BEHIND a "restoring" page,
      // so availability stops being a function of project size. Until that
      // exists this number must stay ahead of the largest tenant.
      cancellationOptions: { portReadyTimeoutMS: START_DEADLINE_MS },
    });
    return {};
  }

  /** A credential refusal: today's response for API callers, a sentence for people. */
  #refused(storage) {
    if (storage.unknown) {
      this.#startFailure = null;
      this.#unknownTenant = true;
      return { refuse: storage.refuse };
    }
    // A retryable wall (cooldown, rate limit) is "still starting" to a person;
    // only the fail-closed refusal is a failure worth a page of its own.
    if (storage.refuse.status === 503 && !storage.refuse.headers.has('retry-after')) {
      this.#startFailure =
        'We couldn’t reach your project’s storage, so we didn’t start it — starting empty could look like lost work.';
    }
    return { refuse: storage.refuse };
  }

  /** Is this tenant reached through the outbound Cloudflare Tunnel? */
  #tunnelMode(tenantId) {
    return Boolean(
      this.env.MAUDE_TUNNEL_TOKEN &&
        this.env.MAUDE_TUNNEL_HOST &&
        tenantId === this.env.MAUDE_TUNNEL_TENANT
    );
  }

  /**
   * This tenant's storage credentials, through the cache/single-flight/cooldown
   * resolver — or the response that refuses to start.
   *
   * FAIL CLOSED IS UNCHANGED. What is new is that a refusal can now say which
   * kind it is: a retryable wall answers 503 + `Retry-After` and reads as "this
   * workspace is busy starting", while a genuine absence of storage keeps the
   * original wording. Before this split, both were the same opaque refusal and
   * the caller's only strategy was to try again immediately — which is what
   * turned an account rate limit into a restart loop.
   */
  async #resolveStorageCredentials(tenantId) {
    if (!this.#credentials) {
      this.#credentials = createCredentialResolver({
        env: this.env,
        storage: this.ctx.storage,
      });
    }
    const resolved = await this.#credentials.resolve(tenantId);
    if (resolved.ok) return { s3Creds: resolved.credentials };
    // NOT A PROJECT. The control plane has no such tenant (or it was purged).
    // Scanners walking `canvas.<zone>/<anything>` used to land here — `feed`,
    // `blog`, `web` — and the legacy fallback below then started a real
    // container for them, carrying the BUCKET-WIDE key. An unknown tenant is
    // never started, whatever fallback exists (2026-10-02).
    if (resolved.status === 404) {
      return {
        refuse: new Response('this is not a Maude project\n', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
        unknown: true,
      };
    }
    // NO FALLBACK KEY. A fleet-wide MAUDE_R2_* Worker secret used to stand in
    // here; it is never put into a container again (2026-10-02), whether or
    // not the secret still exists on the Worker.
    if (resolved.retryable) {
      const secs = Math.max(1, Math.ceil((resolved.retryAfterMs ?? 60_000) / 1000));
      return {
        refuse: new Response(
          'This project is starting up and its workspace is busy. Refresh in a moment.\n',
          { status: 503, headers: { 'retry-after': String(secs) } }
        ),
      };
    }
    return {
      refuse: new Response(
        'this cell could not obtain storage credentials — refusing to start empty\n',
        { status: 503 }
      ),
    };
  }

  /**
   * Proxy one request over the tenant's outbound tunnel, waiting for the
   * tunnel (not the port) to be ready first.
   */
  async #proxyThroughTunnel(request) {
    const target = new URL(request.url);
    target.protocol = 'https:';
    target.host = this.env.MAUDE_TUNNEL_HOST;

    // WAIT FOR THE TUNNEL, not for the port.
    //
    // A woken cell needs a few seconds to boot AND for cloudflared to
    // re-register with the edge; a request proxied in that window gets
    // Cloudflare's own 530 (origin unreachable) — which reads to a customer
    // exactly like the outage this seam was built to escape. This is the
    // readiness wait that `startAndWaitForPorts` used to do, moved onto the
    // path that actually works: poll the tunnel until the hub answers.
    //
    // GET /health is the probe because it is the one route that is cheap,
    // unauthenticated and meaningful. 530/502/523 mean "tunnel not ready
    // yet"; anything else means the cell is answering and the real request
    // can go through.
    const deadline = Date.now() + 120_000;
    for (;;) {
      const probe = await fetch(`https://${this.env.MAUDE_TUNNEL_HOST}/health`, {
        method: 'GET',
        cf: { cacheTtl: 0 },
      }).catch(() => null);
      if (probe && ![530, 502, 523, 521].includes(probe.status)) break;
      if (Date.now() > deadline) {
        return new Response(
          'This project is starting up and did not answer in time. Refresh in a moment.\n',
          { status: 503, headers: { 'retry-after': '10' } }
        );
      }
      await scheduler.wait(1_000);
    }
    return fetch(new Request(target, request));
  }

  onStart() {
    console.log(`[cell] ${this.tenantId ?? '?'} started`);
  }

  onStop() {
    // Not an error path. The hub flushes SQLite and the pending autosave
    // commit on SIGTERM (Cloud Phase 16), so a sleep is lossless by design.
    console.log(`[cell] ${this.tenantId ?? '?'} stopped`);
  }

  onError(error) {
    console.error(`[cell] ${this.tenantId ?? '?'} error: ${error}`);
  }
}

/** Route one request to its tenant's cell. */
export async function routeToCell(request, env, tenantId) {
  const id = env.MAUDE_CELL.idFromName(tenantId);
  const stub = env.MAUDE_CELL.get(id);

  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === RESTART_PATH) {
    // Authorized by THIS cell's derived secret — the platform can compute it,
    // nobody else can, and it is different for every tenant. A shared operator
    // key here would make one leak a restart button for every project.
    const offered = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    const expected = await deriveSecret(env.CELL_SECRET_MASTER, tenantId);
    if (!secretsMatch(offered, expected)) {
      return new Response('unauthorized\n', { status: 401 });
    }
    return Response.json(await stub.restart());
  }

  const forwarded = new Request(request);
  forwarded.headers.set(TENANT_HEADER, tenantId);
  return stub.fetch(forwarded);
}
