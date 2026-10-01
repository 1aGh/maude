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

import { timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type ExportContext,
  type ExportOptions,
  type Format,
  getAdapter,
  isFormat,
} from '../studio/exporters/index.ts';
import { BROWSER_FREE_FORMATS, REMOTE_UNSUPPORTED_FORMATS } from '../studio/exporters/remote.ts';
import type { Target } from '../studio/exporters/scope.ts';
import { startTokenProxy } from './proxy.ts';

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
// Default 2, not 1 (security-review: a single slot lets one wedging comp hold
// the WHOLE fleet's render capacity until the cell aborts — up to a video
// job's timeout — a cross-tenant DoS). Two slots + the 503-when-full queue
// blunt it; genuine per-tenant fairness (sharding by job across N named
// instances — worker.mjs) is the follow-up lever, tracked in DDR-230.
const MAX_CONCURRENT = Math.max(1, Number(process.env.MAUDE_RENDER_MAX_CONCURRENT) || 2);
const MAX_QUEUED = Math.max(0, Number(process.env.MAUDE_RENDER_MAX_QUEUED) || 4);
// Flat render ceiling — generous enough for the frame-step video worst case
// (the cell's own jobTimeoutMs aborts the fetch first for anything smaller).
const RENDER_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.MAUDE_RENDER_TIMEOUT_MS) || 60 * 60 * 1000
);

function authorized(req: Request): boolean {
  if (!SECRET) return false; // unset secret = closed service, never an open one
  const header = req.headers.get('authorization') ?? '';
  const got = Buffer.from(header);
  const want = Buffer.from(`Bearer ${SECRET}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * SSRF gate — PARSE FIRST, then match the parsed scheme+host (security-review
 * attacker HIGH). The prior version matched the raw string, which `new URL()`
 * then reinterpreted: `https://canvas-x@169.254.169.254#.cloud.maude.sh` has
 * userinfo `canvas-x`, host `169.254.169.254` and fragment `.cloud.maude.sh` —
 * it passed a raw prefix/suffix test yet resolves to the metadata IP. Matching
 * the PARSED `protocol://host` (no userinfo, no path, no query, no fragment)
 * makes the check see exactly what `fetch` will connect to. The allowlist entry
 * is compared against `<scheme>://<host>`; its single `*` may only stand in for
 * a run of hostname characters (`[a-z0-9-]`), never a dot or any delimiter.
 */
function originAllowed(origin: string): boolean {
  let scheme: string;
  let host: string;
  try {
    const u = new URL(origin);
    // Reject anything with credentials embedded — a legitimate canvas origin
    // never carries them, and they are the userinfo half of the bypass.
    if (u.username || u.password) return false;
    scheme = u.protocol.replace(/:$/, '');
    host = u.host.toLowerCase(); // host = hostname[:port]
  } catch {
    return false;
  }
  if (scheme !== 'https' && scheme !== 'http') return false;
  const canonical = `${scheme}://${host}`;
  return ALLOWED_ORIGINS.some((allowed) => {
    const a = allowed.toLowerCase().replace(/\/+$/, '');
    const star = a.indexOf('*');
    if (star === -1) return canonical === a;
    const prefix = a.slice(0, star);
    const suffix = a.slice(star + 1);
    if (!canonical.startsWith(prefix) || !canonical.endsWith(suffix)) return false;
    const filled = canonical.slice(prefix.length, canonical.length - suffix.length);
    // The `*` stands for ONE hostname label run only — letters, digits, hyphen.
    // No dot (crossing a domain boundary), no `@`, `:`, `/` (there is none in a
    // canonical scheme://host anyway, but assert it).
    return filled.length > 0 && /^[a-z0-9-]+$/.test(filled);
  });
}

interface RenderBody {
  format: Format;
  targets: Target[];
  options: ExportOptions;
  canvas: { origin: string; token?: string; tokensCssRel?: string; componentsCssRel?: string };
}

/**
 * Why a job was refused, or `null` when it is renderable.
 *
 * NAMED, not boolean (DDR-231 Phase 2 T4). Every rejection used to collapse
 * into one opaque `invalid render job`, and a live cloud PDF/HTML failure was
 * therefore un-diagnosable from the artifact the member saw — pinning it took
 * a local reproduction of the whole lane. The cell now refuses an incoherent
 * (format, scope) pair before dispatch, so anything arriving here is already a
 * bug in a caller; this reason is how the NEXT one names itself in one line.
 *
 * Says which field and why, never what the value was: the body is attacker-
 * influenced and the response crosses back to the cell.
 */
function rejectReason(b: unknown): string | null {
  if (!b || typeof b !== 'object') return 'body must be a JSON object';
  const body = b as Record<string, unknown>;
  if (!isFormat(body.format)) return 'unknown format';
  // zip renders in-cell; canva is desktop-only — neither belongs here.
  if (BROWSER_FREE_FORMATS.has(body.format)) return 'this format renders in-cell, not here';
  if (REMOTE_UNSUPPORTED_FORMATS.has(body.format))
    return 'this format cannot be rendered by the render service';
  if (!Array.isArray(body.targets)) return 'targets must be an array';
  if (body.targets.length === 0)
    return 'no targets resolved — the cell found nothing to render for this scope';
  // file-tree targets carry repo paths this process cannot (and must not) read.
  if (!body.targets.every((t) => (t as Target)?.kind === 'element'))
    return 'targets must all be element targets — a file-tree scope (project-raw) cannot render here';
  const canvas = body.canvas as Record<string, unknown> | undefined;
  if (!canvas || typeof canvas.origin !== 'string' || !canvas.origin)
    return 'canvas.origin is required';
  return null;
}

function validBody(b: unknown): b is RenderBody {
  return rejectReason(b) === null;
}

// ── tiny single-lane queue — one Chromium at a time per instance ─────────────
let running = 0;
let queued = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<(() => void) | null> {
  if (running >= MAX_CONCURRENT) {
    if (queued >= MAX_QUEUED) return null;
    queued += 1;
    await new Promise<void>((resolve) => waiters.push(resolve));
    queued -= 1;
  }
  running += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    running -= 1;
    waiters.shift()?.();
  };
}

async function handleRender(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response('unauthorized', { status: 401 });
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }
  const reason = rejectReason(parsed);
  if (reason || !validBody(parsed))
    return new Response(`invalid render job: ${reason ?? 'unknown'}`, { status: 400 });
  const body = parsed;
  if (!originAllowed(body.canvas.origin)) {
    return new Response(
      'canvas origin not in MAUDE_RENDER_CANVAS_ORIGINS — this service only renders from configured origins',
      { status: 403 }
    );
  }

  console.error(
    `[maude-render] job received: format=${body.format} targets=${body.targets?.length ?? 0}`
  );
  const release = await acquireSlot();
  if (!release)
    return new Response('render service busy', { status: 503, headers: { 'retry-after': '10' } });

  const proxy = startTokenProxy(body.canvas);
  // Throwaway roots: the adapters only need a place for their tmp captures —
  // this process holds no tenant checkout (DDR-230 §1) and never will.
  const scratch = await mkdtemp(path.join(tmpdir(), 'maude-render-'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    const ctx: ExportContext = {
      designRoot: scratch,
      repoRoot: scratch,
      serverOrigin: proxy.origin,
      tokensCssRel: body.canvas.tokensCssRel,
      componentsCssRel: body.canvas.componentsCssRel,
    };
    const adapter = getAdapter(body.format);
    if (!adapter) return new Response('unknown format', { status: 400 });
    const res = await adapter.run(body.targets, body.options ?? {}, ctx, {
      signal: controller.signal,
    });
    return new Response(res.body as unknown as BodyInit, {
      headers: {
        'content-type': res.contentType,
        'x-maude-filename': res.filename,
        // base64 — the degradation reason is free text (renderer errors carry
        // em-dashes, quotes, any Unicode), and a raw JSON value in an HTTP
        // header is Latin-1-only: a `—` in the reason threw "invalid header
        // value" and 500'd an otherwise-SUCCESSFUL (degraded) render. The cell
        // decodes it in remote.ts.
        ...(res.degraded
          ? {
              'x-maude-degraded': Buffer.from(JSON.stringify(res.degraded), 'utf8').toString(
                'base64'
              ),
            }
          : {}),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = controller.signal.aborted ? 504 : 500;
    // Attach the proxy's per-request log so a stuck canvas load is diagnosable
    // from the export dialog (the container's own logs are unreachable here).
    const trail = proxy.log();
    return new Response(`render failed: ${msg}${trail ? `\n\n[canvas proxy] ${trail}` : ''}`, {
      status,
    });
  } finally {
    clearTimeout(timer);
    proxy.stop();
    release();
    void rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 0, // long renders — the job timeout governs, not the socket
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/_health') {
      // Version + posture, no tenant data ever. `configured` says whether this
      // instance can accept work at all — the fleet check reads it.
      return Response.json({
        ok: true,
        app: 'maude-render',
        version: process.env.MAUDE_RENDER_VERSION ?? 'dev',
        configured: Boolean(SECRET) && ALLOWED_ORIGINS.length > 0,
        running,
        queued,
      });
    }
    if (url.pathname === '/render' && req.method === 'POST') return handleRender(req);
    return new Response('not found', { status: 404 });
  },
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
    console.log(`[maude-render] ${sig} — stopping (running=${running}, queued=${queued})`);
    server.stop(false); // no new connections; in-flight ones keep going
    const deadline = Date.now() + DRAIN_MS;
    while (running + queued > 0 && Date.now() < deadline) await Bun.sleep(250);
    process.exit(0);
  });
}
