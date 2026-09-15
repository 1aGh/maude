// What a cell IS, decided without a container — Cloud Phase 15, split out in
// Phase 24 (B1).
//
// SPLIT FROM cell-do.mjs SO IT CAN BE TESTED. `cell-do.mjs` imports
// `@cloudflare/containers`, which does not resolve under plain Node, so the
// most dangerous mapping on the platform — the one where a mistake means one
// tenant reading another's data — had no tests at all. It does now
// (cell-do.test.mjs), and the split is what makes that possible without a
// workerd harness. Same rule as the control plane's decision modules
// (DDR-196 §1): the reviewable part takes data and returns data.
//
// WHY PER-TENANT SECRETS ARE DERIVED, NOT SHARED. A cell needs an operator
// credential (HUB_SECRET) and it needs one that is ITS OWN: handing every cell
// the same value would make one leaked cell an operator credential for every
// other project on the platform. Deriving it — HMAC(master, tenant) — gives a
// distinct, unguessable value per tenant from a single stored secret, so
// rotating the master rotates every cell and no per-tenant secret store has to
// exist. The master itself never enters a container.

/** The port the cell image listens on. Matches its EXPOSE / PORT. */
export const CELL_PORT = 1234;

/**
 * The header the Worker uses to tell a DO which tenant it is.
 *
 * Safe ONLY because a Durable Object is unreachable from the internet — the
 * sole caller is our own Worker, which derives the value from the hostname it
 * was routed on. If a DO ever becomes directly addressable this stops being
 * trustworthy input, so it is named to make that obvious.
 */
export const TENANT_HEADER = 'x-maude-internal-tenant';

/** The operator route: `POST /_cell/restart`, authorized by the cell's own secret. */
export const RESTART_PATH = '/_cell/restart';

/** Same charset the cell entrypoint enforces — the id becomes an R2 prefix. */
const TENANT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidTenantId(raw) {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 63 && TENANT_ID.test(raw);
}

/**
 * Is desktop ↔ cloud live pairing on for this tenant?
 *
 * `CELL_LIVE_PAIRING` is a comma-separated tenant allowlist, or `*` for the
 * whole fleet. A list rather than a boolean because this feature changes the
 * CRDT layer, and the rollout it is written for is "one pilot project, watched,
 * then widen" — a boolean makes the pilot step impossible to express.
 *
 * `*` is spelled out so that widening the fleet is a visible, deliberate edit
 * and never something a stray truthy value can do by accident.
 */
export function livePairingEnabled(env, tenantId) {
  const raw = (env.CELL_LIVE_PAIRING ?? '').trim();
  if (!raw) return false;
  if (raw === '*') return true;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(tenantId).toLowerCase());
}

/**
 * Derive this tenant's operator credential from the platform master.
 *
 * Hex, 64 chars — the same shape `workspace-up` generates, so a cell cannot
 * tell (and must not care) whether the platform or a self-hoster provisioned it.
 */
export async function deriveSecret(master, tenantId, purpose = 'hub-secret') {
  if (!master) throw new Error('CELL_SECRET_MASTER is not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(master),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`maude-cell:${purpose}:${tenantId}`)
  );
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time compare. A timing oracle on an operator credential is worth
 * closing even when the credential is derived rather than stored.
 */
export function secretsMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The tenant a request is for.
 *
 * From the HOSTNAME, never a header or a path: the hostname is routed by our
 * own DNS; the others are attacker-controlled. `<tenant>.cloud.maude.sh`.
 *
 * HOW THIS HOSTNAME EXISTS AT ALL. Not a wildcard route — Cloudflare accepts a
 * wildcard only at the START of a hostname pattern, and free Universal SSL
 * covers the apex plus ONE level, so `<tenant>.cloud.maude.sh` is neither
 * routable by `cell-*.maude.sh/*` nor on the certificate. Both were tried; the
 * TLS failure has no HTTP status to read, which is why it is written down.
 *
 * A Worker CUSTOM DOMAIN solves both at once: it provisions the DNS record and
 * an edge certificate for any hostname in the zone, at any depth. So a cell's
 * hostname is created per tenant at provision time (`maude cell up`) rather
 * than pre-declared, which is also what `cellResources()` already modelled —
 * `dns` and `worker-route` as per-cell resources, not global config.
 */
export function tenantFromHostname(hostname, zone) {
  const h = String(hostname ?? '').toLowerCase();
  const suffix = `.${String(zone ?? '').toLowerCase()}`;
  if (!zone || !h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  // THE GALLERY IS GONE (Cloud Phase 25 C5) — and deleting its ROUTES is not
  // the same as deleting its ADDRESS. `view-<project>` is a valid tenant-id
  // shape, so a leftover custom domain would resolve here and start a cell
  // literally named "view-alligators": a brand new empty project, at a URL
  // that used to be a real page, with autosave ready to commit over it. This
  // is not hypothetical — the hostname was still live in production after C5
  // shipped, because a Worker route and a Worker custom domain are different
  // objects and only one of them is in the repo.
  if (label.startsWith('view-')) return null;
  // Same reasoning, second reserved prefix: `canvas-<project>` is that project's
  // segregated canvas origin (Cloud Phase 27), and it is also a valid tenant-id
  // shape. Without this, `canvas-alligators.cloud.maude.sh` would start a cell
  // for a brand-new empty project called "canvas-alligators" — at the very
  // address alligators' own canvases load from.
  if (label.startsWith('canvas-')) return null;
  return isValidTenantId(label) ? label : null;
}

/** The single hostname label the canvas origin lives on, fleet-wide. */
const CANVAS_LABEL = 'canvas';

/**
 * How the Worker tells a cell that a request arrived on the CANVAS origin.
 *
 * Not the Host header: by the time a request has crossed the Durable Object and
 * the container proxy, `Host` is no longer the name the browser typed. Inferring
 * the origin from it made every canvas request fall through to the shell lane,
 * which answered "sign in to open this project" — to an iframe that has no
 * cookie and never will, because a cookie that could reach this origin is
 * exactly what DDR-054 exists to prevent.
 */
export const CANVAS_ORIGIN_HEADER = 'x-maude-canvas-origin';

/**
 * Is this a canvas-origin request, and if so which project is it for?
 *
 * Returns `null` when the hostname is not the canvas origin (so the caller
 * falls through to normal per-project hostname routing), or
 * `{ tenant, rest }` where `rest` is the path with the tenant segment removed.
 * A canvas-origin URL with no project segment yields `{ tenant: null }` — a
 * refusal, never a fall-through to a cell.
 */
export function canvasOriginTenant(url, zone) {
  if (!zone) return null;
  const host = String(url.hostname).toLowerCase();
  const z = String(zone).toLowerCase();

  // PER-PROJECT CANVAS ORIGIN — `canvas-<project>.<zone>` (Cloud Phase 27).
  //
  // The path form below put the project in the PATH, and that turned out to be
  // incompatible with how a canvas references its own assets: canvas code
  // contains absolute URLs (`/.design/system/<ds>/assets/…`, which is what every
  // design system emits), and an absolute URL resolves against the ORIGIN. On a
  // shared canvas host that silently drops the project — the browser asks for
  // `canvas.<zone>/.design/…` and the data plane reads `.design` as a project
  // name. Nothing in the shell can fix it: those URLs are inside the tenant's
  // own compiled module, not in anything we generate.
  //
  // A per-project hostname makes the origin root the project, so absolute URLs
  // mean exactly what they mean on a desktop. The cost the original design
  // avoided was one more custom domain per project; the thing it did not know
  // was that the cheaper option does not work. It is also a STRONGER boundary:
  // on the shared host, one tenant's executing canvas shared an origin with
  // every other tenant's.
  if (host.startsWith(`${CANVAS_LABEL}-`) && host.endsWith(`.${z}`)) {
    const tenant = host.slice(CANVAS_LABEL.length + 1, -(z.length + 1));
    // The path is NOT rewritten — there is nothing to strip.
    return isValidTenantId(tenant) ? { tenant, rest: url.pathname } : null;
  }

  // LEGACY shared canvas host, project in the path. Kept so a cell mid-rollout
  // (and any link already in a browser tab) keeps working; new sessions get the
  // per-project origin from `cellEnv`.
  if (host !== `${CANVAS_LABEL}.${z}`) return null;
  const [, first, ...rest] = url.pathname.split('/');
  if (!first) return { tenant: null, rest: '/' };
  return { tenant: first, rest: `/${rest.join('/')}` };
}

/** Nothing known about this tenant. The fail-closed default, and never a shared value. */
const NO_CONFIG = Object.freeze({ projectName: null, seedRepo: null, adminEmail: null });

/**
 * Ask the control plane who THIS tenant is (Cloud Phase 24 B1).
 *
 * WHY THIS FUNCTION EXISTS AT ALL. `cellEnv` used to read the project's name,
 * its seed repository and its first admin address out of the cells-Worker's
 * own environment — three values shared by every tenant on the platform. A
 * second customer's FIRST boot could therefore clone the first customer's
 * repository, because "the seed repo" was a global. This was the single most
 * dangerous finding of the 2026-07-31 readiness audit and it blocked customer
 * number two absolutely.
 *
 * The authorization IS the isolation: the secret a cell must present is
 * derived from the tenant id it asks about, so a cell can ask about itself and
 * about nothing else. Same gate as `/internal/mirror-config`.
 *
 * FAIL CLOSED, ALWAYS. An unreachable control plane yields the last answer we
 * cached for THIS tenant, and failing that, nothing. Falling back to a shared
 * value is precisely the bug, so there is no fallback.
 */
export async function fetchTenantConfig({ tenantId, env, storage = null, fetchImpl = fetch }) {
  if (!env.CELL_SECRET_MASTER) return { ...NO_CONFIG };
  const controlPlane = env.CONTROL_PLANE_URL ?? 'https://cloud.maude.sh';
  try {
    const secret = await deriveSecret(env.CELL_SECRET_MASTER, tenantId);
    const res = await fetchImpl(
      `${controlPlane}/internal/cell-config?tenant=${encodeURIComponent(tenantId)}`,
      { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const config = {
      projectName: body?.projectName ?? null,
      seedRepo: body?.seedRepo ?? null,
      adminEmail: body?.adminEmail ?? null,
    };
    // Cached against the NEXT cold start, which may happen during an outage —
    // and a cell that cannot learn its seed repo on first boot comes up empty
    // with nothing in the response saying why.
    // KEYED BY TENANT. `cell-do.mjs` contains a branch that rebinds a DO's
    // tenant id, and while `idFromName()` makes it unreachable today, an
    // unkeyed cache would hand the new tenant the OLD tenant's seedRepo during
    // a control-plane outage — B1's bug, re-entering through the fallback that
    // exists to be safe.
    if (storage) await storage.put(`config:${tenantId}`, config);
    return config;
  } catch (err) {
    console.error(`[cell] ${tenantId} could not read its config: ${err.message}`);
    if (storage) {
      const cached = await storage.get(`config:${tenantId}`);
      if (cached) return cached;
    }
    return { ...NO_CONFIG };
  }
}

/**
 * This tenant's OWN object-storage credentials (Cloud Phase 25 A-1).
 *
 * Minted by the control plane as R2 TEMPORARY credentials scoped to
 * `tenants/<id>/`, TTL-bounded. The bucket-wide key that used to ride in as a
 * fleet-wide Worker secret never enters a container again — in a cell that
 * BUILDS tenant-authored source (Phase 25 A1), a build-time file read must
 * reach at most this tenant's own objects, for a bounded time.
 *
 * FAIL CLOSED — but loudly, in the caller. `null` here means "no storage",
 * and a cell that boots without storage on a cold start comes up EMPTY, which
 * autosave would then commit over real work. So cell-do treats null as a
 * refusal to start (unless the legacy shared-key fallback is still configured
 * during the migration window), never as "run local-only".
 */
/**
 * Does this cell have to resolve start-up state (its config and its storage
 * credentials) for the request in hand?
 *
 * NO when the container is already running: both are applied at container
 * START — `startOptions.envVars` REPLACES the image's environment and nothing
 * re-reads them afterwards — so resolving them per request is pure cost. On
 * 2026-09-03 it was a catastrophic cost: `MaudeCell.fetch()` runs for every
 * proxied request, so a file-plane pass of up to 200 PUTs drove up to 200
 * Cloudflare `temp-access-credentials` mints, tripped the account rate limit,
 * and turned the fail-closed refusal into a restart loop (30 starts / 10 s).
 *
 * ONLY the literal `true` counts as running. Anything else — absent, unknown,
 * a truthy value from some future platform shape — falls to the safe side and
 * resolves, because starting a container that is already up is idempotent
 * while proxying to one that is down is not.
 *
 * Pure and exported so it is testable without the container runtime, exactly
 * like `cellEnv` (this module's whole reason for existing).
 */
export function needsStartupState(container) {
  return container?.running !== true;
}

export async function fetchTenantS3Credentials({ tenantId, env, fetchImpl = fetch }) {
  if (!env.CELL_SECRET_MASTER) {
    return {
      ok: false,
      retryable: false,
      status: null,
      retryAfterMs: null,
      detail: 'no CELL_SECRET_MASTER',
    };
  }
  const controlPlane = env.CONTROL_PLANE_URL ?? 'https://cloud.maude.sh';
  try {
    const secret = await deriveSecret(env.CELL_SECRET_MASTER, tenantId);
    const res = await fetchImpl(
      `${controlPlane}/internal/cell-r2-credentials?tenant=${encodeURIComponent(tenantId)}`,
      { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) {
      // READ THE BODY. This used to be `throw new Error(\`HTTP ${res.status}\`)`,
      // which discarded the one thing that said WHY — the control plane sends
      // `{error, retryable}`, and on 2026-09-03 the whole diagnosis had to be
      // reconstructed from `wrangler tail` on the other side of the hop because
      // this line kept only a number.
      const body = await readJsonSafely(res);
      const retryable =
        typeof body?.retryable === 'boolean'
          ? body.retryable
          : res.status === 429 || res.status >= 500;
      const detail = safeForLog(body?.error ?? `HTTP ${res.status}`).slice(0, MAX_DETAIL_CHARS);
      console.error(
        `[cell] ${tenantId} could not mint R2 credentials: HTTP ${res.status}${
          retryable ? ' (retryable)' : ''
        } — ${detail}`
      );
      return {
        ok: false,
        retryable,
        status: res.status,
        retryAfterMs: retryAfterMsFromHeader(res.headers?.get?.('retry-after')),
        detail,
      };
    }
    const body = await res.json();
    if (!body?.accessKeyId || !body?.secretAccessKey) {
      console.error(`[cell] ${tenantId} could not mint R2 credentials: malformed credentials`);
      return {
        ok: false,
        retryable: false,
        status: res.status,
        retryAfterMs: null,
        detail: 'malformed credentials',
      };
    }
    return { ok: true, credentials: body };
  } catch (err) {
    // A transport failure never reached the control plane — transient by
    // nature, so the caller should come back rather than read it as a broken
    // deployment.
    const detail = safeForLog(err?.message ?? err).slice(0, MAX_DETAIL_CHARS);
    console.error(`[cell] ${tenantId} could not mint R2 credentials: ${detail}`);
    return { ok: false, retryable: true, status: null, retryAfterMs: null, detail };
  }
}

/** How much of a control-plane error string reaches a log line. */
const MAX_DETAIL_CHARS = 200;

/** `Retry-After: <seconds>` → ms, or null. Clamped at 5 min so a confused
 *  upstream cannot park a cell indefinitely. */
function retryAfterMsFromHeader(header) {
  const secs = Number(String(header ?? '').trim());
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return Math.min(secs * 1000, 5 * 60_000);
}

/** How much of an error body we will read. The non-ok branch is exactly where
 *  an edge error page — not our Worker — produced the body, so it is bounded
 *  the same way `apps/studio/sync/retry-after.ts` bounds its own snippet read. */
const MAX_ERROR_BODY_BYTES = 8 * 1024;

/** Parse a bounded JSON body without letting a non-JSON error page throw. */
async function readJsonSafely(res) {
  try {
    const reader = res.body?.getReader?.();
    if (!reader) {
      const text = (await res.text()).slice(0, MAX_ERROR_BODY_BYTES);
      return JSON.parse(text);
    }
    const chunks = [];
    let total = 0;
    while (total < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    void reader.cancel().catch(() => {});
    const joined = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      joined.set(c, at);
      at += c.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(joined));
  } catch {
    return null;
  }
}

/** Strip control characters before a peer-supplied string reaches a log line —
 *  an ANSI/CR sequence in a terminal is output the writer did not intend. */
function safeForLog(raw) {
  return (
    String(raw ?? '')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Environment for one tenant's cell.
 *
 * PURE and exported, because this mapping is where a mistake means one tenant
 * reading another's data — and that must be reviewable without booting a
 * container (DDR-196 §1). Everything tenant-specific arrives in `config`,
 * resolved by `fetchTenantConfig`; nothing tenant-specific is read from `env`,
 * which is shared by the whole fleet.
 */
export async function cellEnv({ tenantId, env, hostname, config = NO_CONFIG, s3Creds = null }) {
  if (!isValidTenantId(tenantId)) throw new Error(`invalid tenant id: ${tenantId}`);
  return {
    // EVERYTHING THE CELL NEEDS, EXPLICITLY.
    //
    // `startOptions.envVars` REPLACES the image's ENV, it does not merge with
    // it. Relying on the Dockerfile's values cost a debugging cycle: the cell
    // booted, answered /health, and quietly had no MAUDE_REPO_DIR and no
    // workspace mode — so no checkout, no history, no seed, and nothing in the
    // response that said so. Anything the cell needs is listed here, even when
    // the image also sets it.
    NODE_ENV: 'production',
    DATA_DIR: '/data',
    MAUDE_REPO_DIR: '/repo',
    HUB_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_TENANT_ID: tenantId,
    PORT: String(CELL_PORT),
    // The cell terminates TLS at the edge, so it sees http:// and must be told
    // the https:// name it actually answers as.
    //
    // FROM CONFIGURATION, NOT FROM THE WAKING REQUEST (D4, same lesson as
    // MAUDE_PUBLIC_CANVAS_ORIGIN below). Env applies at container START, and
    // the request that happens to wake a cell is not always a member opening
    // the shell — a lone canvas tab retrying an asset (or an operator probe)
    // wakes it on `canvas-<tenant>.<zone>`, and a HUB_PUBLIC_URL derived from
    // that Host makes the studio's `frame-ancestors` name the CANVAS origin as
    // the legit embedder. Every shell iframe then reads "refused to connect"
    // until the next restart happens to be woken by the right hostname —
    // which is how the v30 roll shipped a working fleet that looked down.
    HUB_PUBLIC_URL: env.CELL_ZONE ? `https://${tenantId}.${env.CELL_ZONE}` : `https://${hostname}`,
    HUB_SECRET: await deriveSecret(env.CELL_SECRET_MASTER, tenantId),
    // Behind Cloudflare every request arrives from the edge. Without this the
    // per-client rate limiter buckets the entire internet as one client.
    HUB_TRUSTED_PROXIES: '0.0.0.0/0,::/0',
    // Where this cell's platform lives — powers the mirror clock (Phase 19).
    // Safe to pass again since Phase 23 B1: identity is keyed on its OWN
    // explicit switch below, never inferred from this URL (the 2026-07-30
    // regression: one env var was doubling as two switches).
    MAUDE_CONTROL_PLANE_URL: env.CONTROL_PLANE_URL ?? 'https://cloud.maude.sh',
    // HYBRID cloud identity (Phase 23 B1/B2): the cell accepts control-plane
    // project tokens IN ADDITION to its local user store, so the workspace
    // password keeps working while the dashboard/desktop lanes migrate.
    // Flip CELL_IDENTITY_MODE=strict (worker var) once the handoff lanes have
    // carried real sign-ins — a deliberate act, never inferred (B1's lesson).
    MAUDE_CLOUD_IDENTITY: env.CELL_IDENTITY_MODE === 'strict' ? 'strict' : '1',
    // Project tokens verify against their OWN derived key (B4) — never
    // HUB_SECRET, which is already the admin bearer and a peer token.
    MAUDE_PROJECT_TOKEN_KEY: await deriveSecret(env.CELL_SECRET_MASTER, tenantId, 'project-token'),
    // The return leg for the cell's own pages (B5). A NEW variable, so it can
    // never re-trip the identity switch.
    HUB_DASHBOARD_URL: env.DASHBOARD_URL ?? 'https://cloud.maude.sh',
    // WHERE THE CANVAS IFRAME LOADS FROM (Cloud Phase 27 / DDR-209).
    //
    // The cell now runs the real studio, and the studio's client builds every
    // canvas iframe URL from this value. It must be the address the MEMBER'S
    // BROWSER can reach — the fleet's shared canvas hostname with this tenant
    // in the path — never the loopback port the studio happens to have bound.
    // Deriving it from a request Host is what sent a member to an address that
    // was not their project, twice, in production (D4).
    //
    // The tenant segment is here because the BROWSER needs it: `worker.mjs`
    // routes `canvas.<zone>/<tenant>/…` and strips the segment before the cell
    // sees the path, so the cell itself must never strip it again.
    // Per-project, and with NO path — see `canvasOriginTenant` for why the
    // shared-host-with-a-path form could not work.
    ...(env.CELL_ZONE
      ? { MAUDE_PUBLIC_CANVAS_ORIGIN: `https://${CANVAS_LABEL}-${tenantId}.${env.CELL_ZONE}` }
      : {}),
    // feature-cloud-export-render-workers (DDR-230) — where browser-format
    // export jobs dispatch. The URL is a fleet var, the secret a Worker
    // secret; both reach the studio child through the hub's childEnv
    // projection. Absent (service not deployed yet), the studio's lane is
    // `none` and exports refuse with a remedy instead of a 404.
    ...(env.MAUDE_RENDER_URL ? { MAUDE_RENDER_URL: env.MAUDE_RENDER_URL } : {}),
    // A cell's own disk is disposable (replaced on every rollout), so it can
    // never hold accepted revisions: the hub is told so, and refuses the
    // accepted-revisions mode unless it has a durable store.
    MAUDE_DATA_EPHEMERAL: '1',
    // …which is the tenant's ProjectStore Durable Object, reached through the
    // container's outbound interception (DDR-241). Rolled out by fleet var so
    // a Worker without the route never points a container at it.
    ...(env.CELL_PROJECT_STORE === 'do'
      ? { MAUDE_PROJECT_STORE_URL: 'http://project-store.internal' }
      : {}),
    ...(env.MAUDE_RENDER_SECRET ? { MAUDE_RENDER_SECRET: env.MAUDE_RENDER_SECRET } : {}),
    // The customer-facing landing shows THIS, not a generic default. Absent,
    // the cell prettifies its own tenant slug — it never falls back to the
    // operator placeholder a customer should never meet, and (since B1) never
    // to another tenant's name.
    ...(config.projectName ? { MAUDE_PROJECT_NAME: config.projectName } : {}),
    // Object storage — PER-TENANT credentials (Cloud Phase 25 A-1).
    //
    // `s3Creds` are temporary credentials the control plane minted for THIS
    // tenant, scoped to `tenants/<id>/` and TTL-bounded. The legacy branch —
    // the fleet-wide MAUDE_R2_* Worker secrets — exists only for the
    // migration window and logs its own retirement; once the secrets are
    // deleted from the Worker it is dead code. The entrypoint still derives
    // the per-tenant key prefix from MAUDE_TENANT_ID either way (belt AND
    // braces: scoped credentials fail hard on a prefix bug that the
    // app-level prefix would have papered over).
    ...(s3Creds
      ? {
          MAUDE_S3_ENDPOINT: s3Creds.endpoint ?? env.MAUDE_R2_ENDPOINT ?? '',
          MAUDE_S3_BUCKET: s3Creds.bucket ?? env.MAUDE_R2_BUCKET ?? 'maude-cloud-assets',
          MAUDE_S3_ACCESS_KEY_ID: s3Creds.accessKeyId,
          MAUDE_S3_SECRET_ACCESS_KEY: s3Creds.secretAccessKey,
          ...(s3Creds.sessionToken ? { MAUDE_S3_SESSION_TOKEN: s3Creds.sessionToken } : {}),
          ...(s3Creds.expiresAt ? { MAUDE_S3_CREDS_EXPIRES_AT: String(s3Creds.expiresAt) } : {}),
          // The hub refreshes its own credentials before they expire, with
          // the SAME derived secret it already holds (HUB_SECRET authorizes
          // /internal/cell-r2-credentials — it is the same derivation).
          MAUDE_S3_CREDS_URL: `${env.CONTROL_PLANE_URL ?? 'https://cloud.maude.sh'}/internal/cell-r2-credentials?tenant=${encodeURIComponent(tenantId)}`,
        }
      : {
          MAUDE_S3_ENDPOINT: env.MAUDE_R2_ENDPOINT ?? '',
          MAUDE_S3_BUCKET: env.MAUDE_R2_BUCKET ?? 'maude-cloud-assets',
          MAUDE_S3_ACCESS_KEY_ID: env.MAUDE_R2_ACCESS_KEY_ID ?? '',
          MAUDE_S3_SECRET_ACCESS_KEY: env.MAUDE_R2_SECRET_ACCESS_KEY ?? '',
        }),
    // Outbound-ingress tunnel (Phase 25): with this set, the entrypoint runs
    // cloudflared alongside the hub and the cell dials OUT to the edge. Only
    // ever set for the tenant it belongs to — a token is one tunnel, and one
    // tunnel is one tenant's hostname.
    ...(env.MAUDE_TUNNEL_TOKEN && tenantId === env.MAUDE_TUNNEL_TENANT
      ? { MAUDE_TUNNEL_TOKEN: env.MAUDE_TUNNEL_TOKEN }
      : {}),
    // DESKTOP ↔ CLOUD LIVE PAIRING — the pilot switch.
    //
    // With this on, the cell's studio child joins its OWN hub's documents over
    // loopback, so a person in the desktop app and a person in a browser tab
    // share one Y.Doc: cursors and edits cross both ways. Off, the cell behaves
    // exactly as it did before — the two surfaces persist to the same disk and
    // never meet live.
    //
    // PER-TENANT, and default OFF, because this is a change to the CRDT layer:
    // it is rolled to one pilot project, watched, and only then widened. A
    // fleet-wide boolean would make "try it on one project" impossible, which
    // is the same reason the seed repo and the admin email stopped being
    // Worker globals in B1.
    ...(livePairingEnabled(env, tenantId) ? { MAUDE_CELL_PAIRING: '1' } : {}),
    MAUDE_S3_REGION: 'auto',
    // Checkpoint cadence. A cell's disk is ephemeral and the platform migrates
    // instances freely, so the gap between checkpoints IS the window of
    // possible loss. Ten minutes is the current trade against R2 write cost.
    MAUDE_BACKUP_INTERVAL_MS: String(10 * 60 * 1000),
    // The project this cell starts from, on FIRST boot only. The cell refuses
    // to seed over an existing checkout, so this is inert on every later wake.
    //
    // PER-TENANT SINCE B1. As a Worker global this was the platform's worst
    // latent bug: one seed repo for the whole fleet, applied to whichever
    // tenant booted first.
    ...(config.seedRepo ? { MAUDE_SEED_REPO: config.seedRepo } : {}),
    // The first person who can sign in — the project's OWNER, as the control
    // plane knows them, never a fleet-wide `PILOT_ADMIN_EMAIL`.
    //
    // The password is DERIVED, not stored: the platform already holds the
    // master, so a per-tenant secret store would add a place to leak from
    // without adding a secret the platform did not already know. It is an
    // INITIAL credential — the same status as the one `workspace-up` prints —
    // and the person is told to change it.
    // Retired under strict (Phase 23 B6): a cloud-identity cell takes every
    // sign-in from the control plane, so seeding a local password would
    // recreate the credential class strict exists to end.
    ...(config.adminEmail && env.CELL_IDENTITY_MODE !== 'strict'
      ? {
          MAUDE_ADMIN_EMAIL: config.adminEmail,
          MAUDE_ADMIN_PASSWORD: await deriveSecret(
            env.CELL_SECRET_MASTER,
            tenantId,
            'initial-admin-password'
          ),
        }
      : {}),
  };
}

/**
 * Rebuild a canvas-origin request for the cell: tenant prefix stripped from
 * the path, the canvas-origin marker asserted by THIS Worker and nobody else.
 *
 * THE SECOND ARGUMENT TO `new Request` IS THE ORIGINAL REQUEST, and that is
 * load-bearing. The previous shape — `new Request(url, { ...request, headers })`
 * — copies NOTHING from the request: `method`, `body` and the rest are
 * prototype getters, invisible to object spread, so every canvas-lane request
 * left here as a bodyless GET. The studio then answered writes from its GET
 * branches — 200, `image/svg+xml` — which the client read as "saved". That is
 * how annotation strokes, artboard layout and media edits crossed as cursors
 * and died as documents THROUGH the v0.55.0 hub fix: the method never
 * survived long enough to reach the door that fix repaired.
 *
 * Headers are adjusted AFTER construction: a freshly constructed Request has
 * mutable headers (fetch-spec guard "request"), and mutating them avoids a
 * second lossy init object.
 */
export function canvasInnerRequest(request, url, rest) {
  const inner = new Request(new URL(rest + url.search, url.origin).toString(), request);
  inner.headers.delete(CANVAS_ORIGIN_HEADER);
  inner.headers.set(CANVAS_ORIGIN_HEADER, '1');
  return inner;
}

/**
 * Strip the canvas-origin marker from an outside request on the tenant lane —
 * nothing beyond this Worker may assert which origin a request arrived on.
 * Same `new Request(request, …)` rule as above: the request rides as the
 * init source so method and body survive the rebuild.
 */
export function stripCanvasOriginMarker(request) {
  if (!request.headers.has(CANVAS_ORIGIN_HEADER)) return request;
  const inbound = new Request(request);
  inbound.headers.delete(CANVAS_ORIGIN_HEADER);
  return inbound;
}
