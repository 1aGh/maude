// maude-render — the ONE place tenant TSX may be evaluated by vendor compute
// (DDR-230, amending DDR-209 A′1).
//
// WHAT THIS PROCESS IS: a Chromium and the studio's exporter spine, nothing
// else. It receives a fully-resolved export job (targets are pure data — the
// cell resolved scope against its own checkout), renders through the SAME
// adapters the desktop uses, and streams the artifact back. Per job it
// reaches the tenant's canvas exactly the way the member's browser does: the
// public canvas origin, authenticated by the member's own short-lived
// read-only render token.
//
// WHAT THIS PROCESS MUST NEVER HOLD (DDR-230 §1, boot-asserted below): a hub
// secret, a cell master secret, a provider key, a tenant store. There is
// nothing here worth escaping Chromium for — that property is the security
// argument, so it is enforced at boot, not remembered.
//
// SSRF POSTURE (fail-closed): a job names the canvas origin it wants this
// process to fetch from. Unconstrained, that is "please GET an arbitrary URL
// from inside our network" — so the origin must match MAUDE_RENDER_CANVAS_
// ORIGINS (comma-separated origin prefixes, e.g. `https://canvas.cloud.maude.sh`),
// and an empty allowlist refuses every job rather than allowing every job.

import {
  type ExportOptions,
  type Format,
  getAdapter,
  isFormat,
} from '../studio/exporters/index.ts';
import { BROWSER_FREE_FORMATS, REMOTE_UNSUPPORTED_FORMATS } from '../studio/exporters/remote.ts';
import type { Target } from '../studio/exporters/scope.ts';
import { createRenderService } from './service.ts';

// ── boot assert — DDR-230 §1: nothing here worth stealing ────────────────────
//
// A denylist of named secrets misses the real risk (security-review): a secret
// under an UNLISTED variable passes it. But a strict allowlist is an
// availability hazard here — this runs in a Cloudflare container whose platform
// injects variables we do not enumerate, and refusing to boot on one of those
// is the "green in CI, dead in prod" failure the codebase keeps re-learning.
//
// So: refuse on SHAPE, not on a fixed name list. Anything whose name looks like
// a credential (secret / token / key / password / credential / private) refuses
// the boot — EXCEPT this service's own ingress bearer, which is the one secret
// it legitimately holds. That catches a hub secret, a provider key or an
// operator token arriving under any name, without tripping on `PATH` or a
// platform's `CF_*` bookkeeping var.
const SECRET_SHAPED =
  /secret|token|(^|[^A-Za-z])key([^A-Za-z]|$)|password|passwd|credential|private/i;
const OWN_SECRET_ALLOWED = new Set(['MAUDE_RENDER_SECRET']);
{
  const leaked = Object.keys(process.env).filter(
    (k) => SECRET_SHAPED.test(k) && !OWN_SECRET_ALLOWED.has(k) && process.env[k]
  );
  if (leaked.length) {
    console.error(
      `maude-render REFUSING TO START — this process must hold no secret but its own ingress ` +
        `bearer (DDR-230 §1), and the environment carries credential-shaped variables: ` +
        `${leaked.join(', ')}. Remove them from the deployment.`
    );
    process.exit(1);
  }
}

// This worker is headless Linux, where @remotion/web-renderer's renderMediaOnWeb
// never resolves (measured on the fleet + CI: it wedges even a 12-frame muted
// comp, though WebCodecs itself works). Left on, it only burns its timeout and
// falls to frame-step anyway. Tell the video shim to skip it and frame-step
// directly — the path that WORKS here — so a real render gets the whole budget
// instead of losing minutes to a doomed whole-comp attempt. Cloud video is thus
// muted (audio rides renderMediaOnWeb); audio export stays a desktop capability.
// Set MAUDE_RENDER_SKIP_WHOLE_COMP=0 to force the old behavior.
if (process.env.MAUDE_RENDER_SKIP_WHOLE_COMP == null)
  process.env.MAUDE_RENDER_SKIP_WHOLE_COMP = '1';

const PORT = Number(process.env.PORT) || 8790;
const SECRET = process.env.MAUDE_RENDER_SECRET ?? '';
const ALLOWED_ORIGINS = (process.env.MAUDE_RENDER_CANVAS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

/** The studio's format sets decide what may render here (zip renders in-cell; canva is desktop-only). */
function rejectFormat(format: unknown): string | null {
  if (!isFormat(format)) return 'unknown format';
  if (BROWSER_FREE_FORMATS.has(format)) return 'this format renders in-cell, not here';
  if (REMOTE_UNSUPPORTED_FORMATS.has(format))
    return 'this format cannot be rendered by the render service';
  return null;
}

// Requests, the queue, status/cancel and the cloud render budget live in service.ts (#128 T3.7);
// this file owns the process. Env knobs: MAUDE_RENDER_MAX_CONCURRENT (default 2 — a single slot
// lets one wedging comp hold the whole fleet's render capacity), MAUDE_RENDER_MAX_QUEUED (4),
// MAUDE_RENDER_TIMEOUT_MS (flat 60 min ceiling — the cell's own jobTimeoutMs aborts first for
// anything smaller). Videos run one at a time with a queue of one (service.ts).
const service = createRenderService({
  secret: SECRET,
  allowedOrigins: ALLOWED_ORIGINS,
  rejectFormat,
  run: (format, targets, options, ctx, hooks) => {
    const adapter = getAdapter(format as Format);
    if (!adapter) throw new Error('unknown format');
    return adapter.run(targets as Target[], options as ExportOptions, ctx, hooks);
  },
  maxConcurrent: Number(process.env.MAUDE_RENDER_MAX_CONCURRENT) || 2,
  maxQueued: Number(process.env.MAUDE_RENDER_MAX_QUEUED) || 4,
  timeoutMs: Math.max(60_000, Number(process.env.MAUDE_RENDER_TIMEOUT_MS) || 60 * 60 * 1000),
  version: process.env.MAUDE_RENDER_VERSION ?? 'dev',
});

const server = Bun.serve({
  port: PORT,
  idleTimeout: 0, // long renders — the job timeout governs, not the socket
  fetch: (req) => service.fetch(req),
});

console.log(
  `[maude-render] listening on :${server.port} — ` +
    `${SECRET ? 'secret set' : 'NO SECRET (all jobs refused)'}, ` +
    `${ALLOWED_ORIGINS.length ? `origins: ${ALLOWED_ORIGINS.join(', ')}` : 'NO ORIGINS (all jobs refused)'}`
);

// SLEEP MUST BE ABLE TO HAPPEN. This process is PID 1 in its container, and
// Linux delivers no default action to PID 1: without a handler SIGTERM is
// IGNORED. The DO's idle stop is exactly a SIGTERM, so the render instance
// never slept — September 2026 ran it 24/7 at ~30 requests a day (~$23 of a
// ~$65 bill), while the platform logged "Activity expired" every few minutes.
// Nothing here is durable (no store, no tenant state — DDR-230 §1), so the
// right answer to a stop is to stop — after letting a render that is already
// running finish, for a short while. The idle stop never fires mid-job (the
// DO counts open requests), but a platform stop (rollout, host move) can.
const DRAIN_MS = 25_000;
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    const c = service.counts();
    console.log(`[maude-render] ${sig} — stopping (running=${c.running}, queued=${c.queued})`);
    server.stop(false); // no new connections; in-flight ones keep going
    const deadline = Date.now() + DRAIN_MS;
    while (Date.now() < deadline) {
      const now = service.counts();
      if (now.running + now.queued === 0) break;
      await Bun.sleep(250);
    }
    process.exit(0);
  });
}
