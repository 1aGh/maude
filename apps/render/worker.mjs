// maude-render data-plane Worker — DDR-230.
//
// One shared render service for the whole fleet, NOT one per tenant: the
// container holds no tenant state (DDR-230 §1 — no store, no secrets), a job
// is single-tenant by construction (its canvas grant reaches one project),
// and an idle per-tenant Chromium would multiply the fleet's standing cost
// for nothing. Tenancy isolation lives in the JOB (the token), not in the
// instance.
//
// AUTH IS IN THE CONTAINER, deliberately. The Worker forwards `/render` and
// `/_health` verbatim; server.ts checks the bearer with a timing-safe compare
// and refuses when unset. Doing it here too would mean the secret living in
// two runtimes — one more place to rotate, no additional door closed.
//
// SCALE NOTE: `idFromName('render-v1')` pins a single container instance —
// one Chromium, one render at a time (+ a short in-process queue). That is
// the pilot posture on purpose (the cells' wrangler.toml cost arithmetic
// applies here too). Sharding by job id across N named instances is the
// follow-up lever when render queueing shows up in /_health metrics.

import { Container } from '@cloudflare/containers';

import { renderIdleExpired } from './idle-policy.mjs';

const RENDER_PORT = 8790;

export class MaudeRender extends Container {
  defaultPort = RENDER_PORT;

  // Renders are bursty; an idle Chromium is pure cost. Shorter than a cell's
  // 20m because there is no rehydrate penalty on cold start — the container
  // holds nothing to rehydrate.
  sleepAfter = '10m';

  constructor(ctx, env) {
    super(ctx, env);
    // Per DDR-230 §1 this is the COMPLETE environment: the ingress bearer, the
    // canvas-origin allowlist, and the release stamp. A secret beyond these
    // must not appear — server.ts boot-asserts the known ones and refuses.
    //
    // ENV IS READ ONCE, HERE. A Durable Object caches its `env` at construction;
    // a MAUDE_RENDER_SECRET set (or rotated) AFTER this DO was first constructed
    // does NOT reach the container until the DO is reconstructed — which only a
    // byte-different Worker deploy (a new script version) forces, never a bare
    // `wrangler secret put` or a container rollout. The operator flow is
    // therefore: set the secret, then redeploy this Worker. The startup log
    // below records which half is missing so "configured:false" is diagnosable
    // from the tail rather than guessed at (the env-hash-drift class the fleet
    // runbook flags as an open follow-up).
    const hasSecret = Boolean(env.MAUDE_RENDER_SECRET);
    const hasOrigins = Boolean(env.MAUDE_RENDER_CANVAS_ORIGINS);
    console.log(
      `[maude-render DO] constructed — secret:${hasSecret ? 'set' : 'MISSING'} origins:${hasOrigins ? 'set' : 'MISSING'}`
    );
    this.envVars = {
      MAUDE_RENDER_SECRET: env.MAUDE_RENDER_SECRET ?? '',
      MAUDE_RENDER_CANVAS_ORIGINS: env.MAUDE_RENDER_CANVAS_ORIGINS ?? '',
      MAUDE_RENDER_VERSION: env.MAUDE_RENDER_VERSION ?? 'unstamped',
      PORT: String(RENDER_PORT),
    };
  }

  /** Last request start or finish — the clock `isActivityExpired` reads. */
  #lastActivityAt = Date.now();
  /** Requests this DO is serving right now: id → start time. */
  #open = new Map();
  #nextId = 0;

  async fetch(request) {
    const id = this.#nextId++;
    const started = Date.now();
    this.#open.set(id, started);
    this.#lastActivityAt = started;
    this.#ignoredStops = 0; // traffic cancels a pending stop
    try {
      return await this.containerFetch(request);
    } finally {
      this.#open.delete(id);
      this.#lastActivityAt = Date.now();
    }
  }

  /** Stop asks the container has ignored since it last served a request. */
  #ignoredStops = 0;

  /**
   * Stop on idle — and MAKE it stop.
   *
   * The library's stop is a SIGTERM, which a PID-1 process without a handler
   * ignores; that is how this instance stayed up for weeks while the log said
   * "Activity expired" every few minutes. server.ts now handles SIGTERM, but
   * the container holds no state worth a graceful exit (DDR-230 §1), so if it
   * is still running at the NEXT expiry (one `sleepAfter` later) it is killed.
   *
   * Counted, not timed: `Date.now()` inside a Durable Object only advances
   * across I/O, so a wall-clock grace measured in this loop never elapses.
   */
  async onActivityExpired() {
    if (!this.ctx.container?.running) {
      this.#ignoredStops = 0;
      return;
    }
    if (this.#ignoredStops >= 1) {
      console.log('[maude-render DO] still running after SIGTERM — destroying');
      this.#ignoredStops = 0;
      await this.destroy();
      return;
    }
    this.#ignoredStops++;
    await this.stop();
  }

  /**
   * OUR idle rule, not the library's (see idle-policy.mjs for the leak it
   * routes around). The library's alarm loop calls this; overriding it is the
   * one seam that does not fight that loop — never override `alarm()`.
   */
  isActivityExpired() {
    // The library's own timer still paces the loop: it is pushed out by every
    // real request AND after every expiry (renewActivityTimeout), so honouring
    // it spaces our stop/destroy asks one `sleepAfter` apart instead of
    // spinning the alarm. Only the leak-prone inflight half is replaced.
    if (this.sleepAfterMs > Date.now()) return false;
    const expired = renderIdleExpired({
      now: Date.now(),
      lastActivityAt: this.#lastActivityAt,
      openSince: this.#open.values(),
    });
    if (expired && this.inflightRequests > 0) {
      console.log(
        `[maude-render DO] idle with ${this.inflightRequests} library-inflight request(s) — treating as leaked, sleeping`
      );
    }
    return expired;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isHealth = url.pathname === '/_health' && request.method === 'GET';
    const isRender = url.pathname === '/render' && request.method === 'POST';
    if (!isHealth && !isRender) {
      // The same posture the cells take: an unrouted path looks like the
      // feature never existed.
      return new Response('not found', { status: 404 });
    }
    const id = env.MAUDE_RENDER.idFromName('render-v1');
    return env.MAUDE_RENDER.get(id).fetch(request);
  },
};
