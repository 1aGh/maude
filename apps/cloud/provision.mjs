// Making a project answer at its address — Cloud Phase 14, the effects half.
//
// A tenant "exists" when two things are true: `<id>.cloud.maude.sh` is a
// Worker custom domain routed at the data-plane Worker (the only mechanism
// that gives a third-level name both a route and a certificate — see
// apps/cells/wrangler.toml), and the cell behind it answers /health. This
// module owns both: creating the route, and asking the honest question.
//
// The Cloudflare token this uses (CF_PROVISION_TOKEN) can edit Workers
// domains on the account. It lives in the control plane next to the platform
// master secret and the GitHub App key — the control plane is already the
// blast radius (DDR-193); a cell never sees it.

import { deriveCellSecret } from './cell-token.mjs';

/** The ONE shared hostname the segregated canvas origin lives on (Phase 25 A4). */
export const CANVAS_HOST_LABEL = 'canvas';

/**
 * Ensure `canvas.cloud.maude.sh` routes to the cells Worker (Cloud Phase 25 A4).
 *
 * The canvas origin is where a tenant's own built module is EVALUATED, by the
 * viewer's browser, deliberately not sharing an origin with the editing shell
 * (DDR-054). One hostname for the whole fleet with the tenant in the path —
 * a per-tenant canvas domain would be a second custom domain to provision,
 * delete and reconcile for every project, for the same origin boundary.
 *
 * Called from the hourly sweep rather than from a deploy step, and idempotent,
 * so the address self-heals: an operator never has to remember it, and a
 * hostname deleted by accident comes back within the hour. `canvas` is not a
 * valid tenant id shape... except that it IS — so the reconcile that would
 * hand it to a project is what a name collision would look like, and the
 * signup path must never allocate it.
 */
export async function ensureCanvasDomain(env, { fetchImpl = fetch } = {}) {
  if (!env.CF_PROVISION_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_ZONE_ID) {
    return { ok: false, error: 'provisioning is not configured' };
  }
  const hostname = `${CANVAS_HOST_LABEL}.${env.CELL_ZONE ?? 'cloud.maude.sh'}`;
  try {
    const res = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/domains`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${env.CF_PROVISION_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          zone_id: env.CF_ZONE_ID,
          hostname,
          service: 'maude-cells',
          environment: 'production',
        }),
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
      return { ok: false, hostname, error: body?.errors?.[0]?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, hostname };
  } catch (err) {
    return { ok: false, hostname, error: err.message };
  }
}

/**
 * Ensure `<projectId>.cloud.maude.sh` routes to the cells Worker.
 * Idempotent: an already-attached hostname reports ok.
 */
/**
 * The project's own canvas origin — `canvas-<id>.<zone>` (Cloud Phase 27).
 *
 * A SECOND custom domain per project, which the original design explicitly
 * avoided. It was avoided for a reason that turned out to be wrong: the shared
 * `canvas.<zone>` host put the project in the PATH, and canvas code contains
 * ABSOLUTE asset URLs (`/.design/system/<ds>/assets/…` — what every design
 * system emits), which resolve against the origin and silently drop the
 * project. Nothing in the shell can fix that; those URLs are inside the
 * tenant's own compiled module.
 *
 * It is also a stronger boundary than the thing it replaces: on the shared
 * host, every tenant's executing canvas shared one origin.
 *
 * Idempotent, and called from the same hourly reconcile as the project's own
 * hostname, so the address self-heals the same way.
 */
export async function ensureProjectCanvasDomain(env, projectId, { fetchImpl = fetch } = {}) {
  if (!env.CF_PROVISION_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_ZONE_ID) {
    return { ok: false, error: 'provisioning is not configured' };
  }
  const hostname = `${CANVAS_HOST_LABEL}-${projectId}.${env.CELL_ZONE ?? 'cloud.maude.sh'}`;
  try {
    const res = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/domains`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${env.CF_PROVISION_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          zone_id: env.CF_ZONE_ID,
          hostname,
          service: 'maude-cells',
          environment: 'production',
        }),
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
      return { ok: false, hostname, error: body?.errors?.[0]?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, hostname };
  } catch (err) {
    return { ok: false, hostname, error: err.message };
  }
}

export async function ensureCellDomain(env, projectId, { fetchImpl = fetch } = {}) {
  if (!env.CF_PROVISION_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_ZONE_ID) {
    return { ok: false, error: 'provisioning is not configured' };
  }
  const hostname = `${projectId}.${env.CELL_ZONE ?? 'cloud.maude.sh'}`;
  try {
    const res = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/domains`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${env.CF_PROVISION_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          zone_id: env.CF_ZONE_ID,
          hostname,
          service: 'maude-cells',
          environment: 'production',
        }),
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
      const detail = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
      console.error(`[provision] ${hostname}: ${detail}`);
      return { ok: false, error: detail };
    }
    return { ok: true, hostname };
  } catch (err) {
    console.error(`[provision] ${hostname}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Detach `<projectId>.cloud.maude.sh` — the delete flow's last step.
 * Best-effort and idempotent: an already-absent hostname reports ok.
 */
export async function removeCellDomain(env, projectId, { fetchImpl = fetch } = {}) {
  if (!env.CF_PROVISION_TOKEN || !env.CF_ACCOUNT_ID) return { ok: false, error: 'not configured' };
  const hostname = `${projectId}.${env.CELL_ZONE ?? 'cloud.maude.sh'}`;
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/domains`;
  const headers = { authorization: `Bearer ${env.CF_PROVISION_TOKEN}` };
  try {
    const listed = await fetchImpl(`${base}?hostname=${encodeURIComponent(hostname)}`, { headers });
    const body = await listed.json().catch(() => ({}));
    const found = (body?.result ?? []).find((d) => d.hostname === hostname);
    if (!found) return { ok: true, hostname, removed: false };
    const res = await fetchImpl(`${base}/${found.id}`, { method: 'DELETE', headers });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, hostname, removed: true };
  } catch (err) {
    console.error(`[provision] detach ${hostname}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Is the workspace actually up? One question, asked of the thing itself.
 *
 * Returns 'healthy' | 'pending'. Never 'failed' from a single probe: a cold
 * start looks exactly like an outage from here, and `decideCheckout` already
 * owns the only honest deadline (the timeout). A hard "failed" belongs to a
 * signal that cannot be a cold start, and no such signal exists at this layer.
 */
export async function probeCell(env, projectId, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  return (await probeCellBody(env, projectId, { fetchImpl, timeoutMs })).state;
}

/**
 * The same probe, keeping the ANSWER — Cloud Phase 26 Stage 3.
 *
 * `probeCell` threw the body away after reading `ok`, so the cell's own count
 * of what it holds had nowhere to go. This returns both, and `probeCell` stays
 * exactly what its callers expect. One fetch either way: the point of riding
 * the existing hourly probe is that no cell is asked twice.
 *
 * `body` is null whenever the cell did not answer, answered badly, or answered
 * with something unparseable — all three are "we do not know", which the
 * caller must not turn into a zero.
 */
export async function probeCellBody(
  env,
  projectId,
  { fetchImpl = fetch, timeoutMs = 8000, secret = null, maxBytes = 64 * 1024, wake = true } = {}
) {
  const hostname = `${projectId}.${env.CELL_ZONE ?? 'cloud.maude.sh'}`;
  try {
    const res = await fetchImpl(`https://${hostname}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      // THE CELL IS UNTRUSTED TO ITS PEERS (DDR-054), AND WE ARE ITS PEER.
      // `fetch` follows redirects by default, so a compromised cell answering
      // 302 would steer this call — made from the control plane, with the
      // control plane's network position — wherever it liked. Refusing to
      // follow costs nothing: a health probe has exactly one right answer and
      // it is not "look over there".
      redirect: 'manual',
      // The counts are privileged (they describe what a customer holds), so
      // the tenant's own derived secret goes with the ask. Without it the cell
      // answers the public posture and the sweep records nothing — the same
      // "unknown" an older image produces.
      //
      // `wake: false` (the hourly telemetry read) asks the cell NOT to start
      // for this. A sleeping cell answers `{state:'asleep'}` — no stats, which
      // the board renders as unknown — instead of re-hydrating a whole project
      // from R2 so we can count it. Waking callers (checkout, cold-start
      // measurement) leave it at the default.
      ...probeHeaders({ secret, wake }),
    });
    if (!res.ok) return { state: 'pending', body: null };
    // BOUNDED. `res.json()` will happily buffer whatever a cell sends, and a
    // cell is somebody else's process; a health probe that can be answered
    // with a gigabyte is a health probe that can take the sweep down.
    const text = await readBounded(res, maxBytes);
    if (text === null) return { state: 'pending', body: null };
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      return { state: 'pending', body: null };
    }
    const healthy = body?.ok === true || body?.status === 'ok';
    return { state: healthy ? 'healthy' : 'pending', body };
  } catch {
    return { state: 'pending', body: null };
  }
}

/** `{headers}` only when there is something to send — a bare probe stays bare. */
function probeHeaders({ secret, wake }) {
  const headers = {
    ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    ...(wake ? {} : { 'x-maude-wake': 'never' }),
  };
  return Object.keys(headers).length ? { headers } : {};
}

/** Read at most `maxBytes` of a response, or null when it exceeds that. */
async function readBounded(res, maxBytes) {
  const declared = Number(res.headers?.get?.('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const text = await res.text();
  return text.length > maxBytes ? null : text;
}

/**
 * Ask a cell to run its revocation sweep NOW (followup-multiplayer-hardening G5).
 *
 * The sweep reads `member_revocations` on a clock (10 min), so a removed
 * member's already-open session lived until the next tick (F3 S02 on the test
 * cell: 121 s). Right after the row is written the control plane knocks with
 * the tenant's derived secret; the cell then reads the list itself, so the
 * request names nobody. Best-effort: a sleeping or unreachable cell is ended
 * by its own sweep as before, and nothing here fails the removal.
 */
export async function nudgeCellRevocations(
  env,
  projectId,
  { fetchImpl = fetch, timeoutMs = 10_000 } = {}
) {
  if (!env.CELL_SECRET_MASTER) return { ok: false, reason: 'no cell secret' };
  try {
    const secret = await deriveCellSecret(env.CELL_SECRET_MASTER, projectId);
    const res = await fetchImpl(
      `https://${projectId}.${env.CELL_ZONE ?? 'cloud.maude.sh'}/internal/revocation-sweep`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
        // The cell is untrusted to its peers (DDR-054): never follow it elsewhere.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err) };
  }
}
