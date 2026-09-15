#!/usr/bin/env node
// Maude Hub — self-hostable Yjs sync backend.
//
// Phase 9 (v1.1). Hocuspocus over PartyKit — see
// .ai/archive/decisions/DDR-052-hocuspocus-over-partykit-for-hub.md.
// Admin auth architecture — see DDR-053-hub-admin-auth-architecture.md.
//
// Environment (consumed only when run as a CLI / main module):
//   PORT                    listen port (default 1234)
//   DATA_DIR                tokens.db + hub.db dir (default ./data)
//   HUB_SECRET              escape-hatch token; the token store is primary
//   HUB_INSECURE_HTTP       if '1', allow plaintext HTTP to a public host (testing)
//   HUB_PUBLIC_URL          base URL printed in admin / bootstrap logs
//   HUB_ADMIN_RATE_LIMIT    'off' disables the per-IP rate limiter (dev only)
//   HUB_CONN_RATE_LIMIT     valid-token WS auths per label per minute (default 600)
//   HUB_ASSET_WRITE_RATE_LIMIT  authenticated asset writes per label per minute (default 600)
//
// Auth: the SQLite token store (tokens.db, HMAC-SHA256 at rest — Task 6) is
// checked first; HUB_SECRET is a fallback for headless / scripted setups. With
// NEITHER configured the hub runs in permissive dev mode and warns on every
// connect. Connections are rate-limited to 100 auths/min per token; the hub
// refuses to boot over plaintext HTTP to a non-loopback host (TLS upstream).
//
// Admin: /admin serves a vanilla-JS single-page UI (src/admin/). /admin/api/*
// JSON routes mint tokens, rotate them, list peers, and report hub status.
// Bootstrap key (single-use, 24h TTL, no reissue post-consume per DDR-053)
// lets the first admin claim the hub without typing HUB_SECRET.
//
// Per DDR-053 hardening:
//   - Bearer-only admin auth (no ?secret= query).
//   - Atomic single-use bootstrap (POSIX rename-to-consume).
//   - Scope-bound tokens (default scope = label; documentName must match).
//   - Rotate kicks active WS sessions for the rotated label.
//   - CSP + X-Frame-Options + Referrer-Policy on /admin*.
//   - Per-IP rate limit (5/60s) on /admin/api/bootstrap + 401s.
//   - readJsonBody enforces Content-Type, body timeout, proto-pollution guard.
//   - All log lines that interpolate user data go through sanitizeForLog.

import { Buffer } from 'node:buffer';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { SQLite } from '@hocuspocus/extension-sqlite';
import { Server } from '@hocuspocus/server';
import { canvasSlugFromRel } from '../../studio/canvas-slug.ts';
import { ADMIN_CSS, ADMIN_HTML, ADMIN_JS, adminAssetsLoaded } from './admin-assets.mjs';
import {
  generateAdminSecret,
  readAdminSecret,
  rotateAdminSecret,
  verifyAdminAuth,
  writeAdminSecret,
} from './admin-auth.mjs';
import { createWriteBehind, hydrateAssets, hydrateFiles } from './asset-lane.mjs';
import {
  handleAssetProbeRoute,
  handleAssetRoute,
  handleCheckoutAssetRoute,
  parseAssetPath,
  parseCheckoutAssetPath,
} from './assets.mjs';
import {
  handleAuthRoutes,
  handleUserAdminRoutes,
  permissiveDevAuthDisabled,
} from './auth-routes.mjs';
import { scheduleBackups, targetFromConfig, targetFromEnv } from './backup.mjs';
import { maybeIssueOnBoot, verifyAndConsume } from './bootstrap.mjs';
import {
  BROWSER_SESSION_COOKIE,
  cookieValue,
  handleBrowserAuth,
  handleOidc,
} from './browser-auth.mjs';
import {
  checkBundleIdentity,
  formatIdentityFailure,
  identityForHealth,
  readStudioReleaseVersion,
} from './bundle-identity.mjs';
import { handleExportRoute, scheduleMirror, scheduleRevocationSweep } from './cell-ops.mjs';
import { clientIpFor, parseTrustedProxies } from './client-ip.mjs';
import { designRootFor } from './design-root.mjs';
import { groupCanvases } from './doc-namespace.mjs';
import { createDocumentEvents } from './document-events.mjs';
import {
  DOCUMENT_PATH_PREFIX,
  DOCUMENTS_PATH,
  handleDocumentItemRoute,
  handleDocumentsRoute,
} from './documents.mjs';
import {
  FILE_DOOR_PREFIX,
  FILE_LIMITS_PATH,
  handleFileDoor,
  handleFileLimits,
} from './file-door.mjs';
import {
  FILES_PATH,
  handleFilesRoute,
  handleProjectFileRoute,
  PROJECT_FILE_PREFIX,
} from './file-manifest.mjs';
import {
  createFilesPoke,
  dropCtlAwareness,
  isFilesCtlDoc,
  withoutCtlPersistence,
} from './files-ctl.mjs';
import { seedFirstUserOnBoot } from './first-user.mjs';
import { createGitRunner } from './git-runner.mjs';
import { HISTORY_FILE_PATH, HISTORY_PATH, handleHistoryRoutes } from './history.mjs';
import {
  createJournalTail,
  handleJournalRoutes,
  JOURNAL_PATH,
  JOURNAL_REPORT_PATH,
  openJournal,
  walkImport,
  walkIntervalFromEnv,
} from './journal.mjs';
import { LOOPBACK_HOSTS, sanitizeForLog } from './log-safety.mjs';
import { assertStrictIsSurvivable, oidcConfig } from './oidc-routes.mjs';
import { createAcceptedRevisions } from './project-transactions/hub-integration.mjs';
import { openRemoteProjectStore } from './project-transactions/store-remote.mjs';
import { openSqliteProjectStore } from './project-transactions/store-sqlite.mjs';
import { createRateStore } from './rate-store.mjs';
import { mintRenderToken, verifyRenderToken } from './render-token.mjs';
import { isReadOnlyRole, ROLES } from './role-matrix.mjs';
import { defaultS3Source } from './s3-creds.mjs';
import { seedRepo } from './seed-repo.mjs';
import { DEFAULT_HUB_NAME, readSettings, writeSettings } from './settings.mjs';
import { createStudioChild } from './studio-child.mjs';
import {
  doorVerdict,
  isCanvasHost,
  isHubOwned,
  PAUSED_MESSAGE,
  servicePage,
} from './studio-door.mjs';
import { createStudioProxy, sessionKeyFor } from './studio-proxy.mjs';
import { tenantStats } from './tenant-stats.mjs';
import {
  addToken,
  assertValidLabel,
  listTokenLabels,
  matchesScope,
  readTokens,
  recordTokenUse,
  removeToken,
  revokeTokensForOwner,
  rotateToken,
  verifyToken,
} from './tokens.mjs';
import { clearTombstone, listTombstones, recordTombstone } from './tombstones.mjs';
import { countLinkedOidc } from './users.mjs';
import { createWorkspaceAgent } from './workspace-agent.mjs';

const HUB_VERSION = readOwnVersion();

/**
 * What the workspace half did at boot, as facts a human can read.
 *
 * A CELL HAS NO CONSOLE — its stdout reaches nobody an operator can ask, and
 * `wrangler tail` shows the Worker, not the container. During Cloud Phase 15
 * the only way to answer "did the seed clone work?" was to watch a bucket for
 * ten minutes and infer from what appeared. That is a guess, not a diagnosis.
 *
 * Facts only: states and counts, never a URL (a seed URL carries a token) and
 * never a path. Safe on the unauthenticated /health, which is the point — when
 * you need this, authentication is usually the thing that is broken.
 */
const bootReport = { seed: null, history: null, assets: null, assetsRestored: null };
const DOCUMENT_NAME_REGEX = /^[A-Za-z0-9._/-]{1,256}$/;
const PUBLIC_URL_REGEX = /^https?:\/\/[^\s;'"<>`]+$/;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
// DDR-102 rate-limit redesign. The original single 100/min-per-label bucket
// was an anti-brute-force control, but it throttled VALID tokens: under WS
// multiplexing the hub still authenticates once per DOCUMENT, so two peers
// booting an 83-canvas project burst ~166 valid auths and pinned the bucket
// forever (the 2026-06-11 permission-denied storm). Brute force is about
// INVALID attempts — so the buckets split:
//   - valid-token auths: per label, generous (default 600/min, env
//     HUB_CONN_RATE_LIMIT) — legitimate peers can't starve sync.
//   - invalid-token attempts: per IP, tight (100/min) — the brute-force
//     control the old bucket was meant to be.
export const CONN_RATE_LIMIT_MAX = 600;
export const INVALID_CONN_RATE_LIMIT_MAX = 100;
// The same split, one lane over: AUTHENTICATED asset writes (DDR-217 desktop
// push). The 2026-08-10 security review correctly demanded metering the valid
// PUT, but wired it to the 5/min per-IP admin bucket — so a first link of a
// real project (alligators: 182 assets, HEAD-first) 429'd after ~5 files and
// the persisted window meant rebooting did not help (RCA 2026-08-11). Per
// LABEL, generous: a peer must be able to finish its own sweep in one boot.
// Byte volume is bounded elsewhere (MAX_PUT_BYTES + PUT_SESSION_BUDGET in
// assets.mjs) — this bucket bounds REQUEST RATE, nothing else.
export const ASSET_WRITE_RATE_LIMIT_MAX = 600;
// Activity feed (admin console): bounded in-memory ring buffer. Ephemeral —
// lost on restart, NOT a persisted audit trail (DDR-097). Caps memory.
export const ACTIVITY_CAP = 200;

/**
 * @typedef {Object} HubConfig
 * @property {number} [port]
 * @property {string} [dataDir]
 * @property {string} [secret]
 * @property {string} [publicUrl]
 * @property {boolean} [insecureHttp]  allow plaintext HTTP to a public host (testing only)
 * @property {boolean} [verbose]
 * @property {boolean} [rateLimit]  default true; set false in tests/dev
 * @property {number} [connRateLimit]  valid-token auths per label per minute (default CONN_RATE_LIMIT_MAX; env HUB_CONN_RATE_LIMIT)
 * @property {number} [invalidConnRateLimit]  invalid-token attempts per IP per minute (default INVALID_CONN_RATE_LIMIT_MAX; tests only)
 * @property {number} [assetWriteRateLimit]  authenticated asset writes per label per minute (default ASSET_WRITE_RATE_LIMIT_MAX; env HUB_ASSET_WRITE_RATE_LIMIT)
 */

/**
 * DDR-102 — build an auth-rejection error whose REASON crosses the wire.
 * Hocuspocus' connection handler propagates `error.reason ?? 'permission-denied'`
 * to the peer's onAuthenticationFailed — a plain `new Error(message)` carries
 * no `.reason`, so peers used to see only the generic fallback (the incident's
 * RC4: the client hint pointed at scopes while the real cause was the rate
 * limit). Old peers ignore the richer reason — interop-safe.
 *
 * @param {string} reason
 * @returns {Error & { reason: string }}
 */
function authError(reason) {
  const err = /** @type {Error & { reason: string }} */ (new Error(reason));
  err.reason = reason;
  return err;
}

/**
 * Build (but don't yet start) a Hocuspocus instance against the given config.
 * Callers run `await instance.listen()` and `await instance.destroy()`.
 *
 * @param {HubConfig} [config]
 */
/** Methods that cannot change anything, so a read-only session may use them. */
const READ_ONLY_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The mutating paths a READ-ONLY session is still allowed (Cloud Phase 25 C1).
 *
 * Deliberately a short, explicit list rather than a pattern:
 *   /auth/logout  — ending your OWN session is not changing the project, and a
 *                   viewer who cannot sign out is a viewer stuck signed in.
 *   /api/export   — "look, comment and download" is what the role means; the
 *                   export is a READ of the project, POSTed only because it
 *                   takes work to build.
 * Comments join this list when they exist (Phase 25 C3).
 */
function readOnlyAllowedPath(path) {
  return (
    path === '/auth/logout' ||
    path === '/api/export' ||
    // Cloud Phase 25 B5 — comments. THE ONE WRITE A VIEWER HOLDS, promised in
    // those words on the People page and stated in the role matrix
    // (`src/role-matrix.mjs`: viewer.comment === true, viewer.annotate ===
    // false). It is exactly where a scope bug turns "may leave a note" into
    // "may edit the project", so it is ONE exact path, never a prefix — the
    // handler behind it touches `_comments/` and nothing else, and it offers
    // no delete.
    path === '/api/studio/comments' ||
    // Signing out of the browser door is ending your own session, same as
    // /auth/logout is for the desktop's.
    path === '/auth/browser/signout'
  );
}

export function createHub(config = {}) {
  const port = config.port ?? 1234;
  const dataDir = config.dataDir ?? resolve(process.cwd(), 'data');
  const secret = config.secret ?? '';
  const publicUrl = config.publicUrl ?? `http://localhost:${port}`;
  const verbose = config.verbose ?? true;
  const rateLimit = config.rateLimit ?? true;
  const insecureHttp = config.insecureHttp ?? false;
  // DDR-102 — valid-token auth ceiling (per label per minute).
  const connRateLimitMax = config.connRateLimit ?? CONN_RATE_LIMIT_MAX;
  const invalidConnRateLimitMax = config.invalidConnRateLimit ?? INVALID_CONN_RATE_LIMIT_MAX;
  // RCA 2026-08-11 — authenticated asset-write ceiling (per label per minute).
  const assetWriteRateLimitMax = config.assetWriteRateLimit ?? ASSET_WRITE_RATE_LIMIT_MAX;
  const startedAt = Date.now();

  // DDR-053 §5: refuse to boot if publicUrl can be weaponized into shell
  // injection on operators who copy-paste from the admin UI.
  if (!PUBLIC_URL_REGEX.test(publicUrl)) {
    throw new Error(
      `invalid publicUrl: ${JSON.stringify(publicUrl)} — must match ${PUBLIC_URL_REGEX}`
    );
  }

  // Task 6 (transport hardening): refuse to serve a PUBLIC hub over plaintext
  // HTTP. TLS terminates upstream (Fly auto-cert / Caddy ACME / Cloudflare /
  // Tailscale Funnel) so the hub itself sees http://, but HUB_PUBLIC_URL must
  // declare https:// for any non-loopback host. Loopback (local dev) is exempt;
  // HUB_INSECURE_HTTP=1 overrides for explicit non-TLS testing.
  if (!insecureHttp) {
    const u = new URL(publicUrl);
    if (u.protocol === 'http:' && !LOOPBACK_HOSTS.has(u.hostname)) {
      throw new Error(
        `refusing to serve a public hub over plaintext HTTP (publicUrl=${publicUrl}). Set HUB_PUBLIC_URL to an https:// URL (TLS terminates at your proxy), or set HUB_INSECURE_HTTP=1 for local-only testing.`
      );
    }
  }

  // ---- OIDC boot gate (Track C) --------------------------------------------
  //
  // Refuse to start on a broken or dangerous identity config, rather than
  // discovering it at the first sign-in. Two cases: an incomplete config (a
  // mode set with a missing issuer/secret/allowlist), and `strict` with nobody
  // linked — which locks the operator out of their own box with no way back but
  // editing env on the host.
  {
    const oidc = oidcConfig(process.env);
    if (oidc.enabled && oidc.errors.length) {
      throw new Error(`refusing to start: HUB_OIDC_MODE is set but ${oidc.errors[0]}`);
    }
    if (oidc.enabled) {
      assertStrictIsSurvivable(oidc, { linkedAccounts: countLinkedOidc(dataDir) });
    }
  }

  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const sqlitePath = join(dataDir, 'hub.db');

  /** @type {Map<string, { socketId: string, documentName: string, user: string, connectedAt: number, connection: any }>} */
  const peers = new Map();

  // Cloud Phase 2 Task 2 — trusted proxies. Empty by default, which keeps the
  // DDR-053 §6 stance ("X-Forwarded-For is not trusted") byte-for-byte intact
  // for anyone who does not opt in.
  const trustedProxies = parseTrustedProxies(process.env.HUB_TRUSTED_PROXIES);
  if (trustedProxies.length > 0 && verbose) {
    console.warn(
      `[hub] trusting X-Forwarded-For from ${trustedProxies.length} configured proxy range(s)`
    );
  }
  /** The address a rate-limit bucket is keyed by (see client-ip.mjs). */
  const clientIp = (request) => clientIpFor(request, trustedProxies);

  // Persistent sliding-window limiter. In-memory buckets reset on restart,
  // which made "crash the hub, keep guessing" a free counter reset.
  const rateStore = createRateStore(dataDir);

  // Cloud Phase 2 Task 3 — scheduled doc-store backups. No destination
  // configured ⇒ no backups, and that is a quiet no-op rather than a boot
  // failure: a laptop hub genuinely does not need one. Verify with
  // `maude hub restore-drill` — a backup nobody has restored is a hypothesis.
  // The bucket the asset proxy reads from. Same env set as backups — one
  // storage configuration per hub, not two.
  // A-1: in a platform cell the credentials are TEMPORARY and self-refresh
  // through the control plane; on a self-hosted hub the source is the same
  // static env config as ever. Everything below asks the source per
  // operation instead of pinning boot-time values.
  const s3Source = defaultS3Source();
  // Boot-time snapshot — answers "is a backup destination configured" and
  // provides the describe string. In BOTH credential modes the env carries a
  // valid initial config at boot (static keys, or the fresh mint the DO
  // injected), so this is safe to resolve once.
  const bootTarget = targetFromEnv();
  const backupTarget = bootTarget
    ? async () => targetFromConfig(process.env, await s3Source.config())
    : null;
  const backupIntervalMs = Number(process.env.MAUDE_BACKUP_INTERVAL_MS ?? 6 * 3600_000);
  // Phase 0 F5 — durability as STATE, not as a log line. A hub that refuses to
  // write because another workspace owns the keyspace is protecting its peer
  // and protecting nothing of its own; that has to be visible where an
  // operator looks, or we have swapped a loud data-loss for a silent
  // no-durability. Never `/health` (liveness, unauthenticated, and a restart
  // policy would cycle a hub that is up and serving).
  const durability = {
    configured: Boolean(bootTarget),
    target: bootTarget?.describe ?? null,
    prefix: process.env.MAUDE_BACKUP_PREFIX || null,
    state: bootTarget ? 'pending' : 'not-configured',
    lastGeneration: null,
    lastOkAt: null,
    conflictWith: null,
    message: null,
    at: null,
  };
  const stopBackups = scheduleBackups({
    dataDir,
    target: backupTarget,
    intervalMs: backupTarget ? backupIntervalMs : 0,
    onStatus: (s) => {
      durability.state = s.state;
      durability.at = s.at;
      durability.message = s.message ?? null;
      durability.conflictWith = s.conflictWith ?? null;
      if (s.state === 'ok') {
        durability.lastGeneration = s.generation;
        durability.lastOkAt = s.at;
      }
    },
    // Cloud Phase 15 — the checkout rides in the same generation as the
    // databases. A cell's disk is ephemeral, so a history that is not in the
    // backup is a history that lasts until the next migration.
    repoDir: process.env.MAUDE_REPO_DIR || null,
    run: process.env.MAUDE_REPO_DIR ? createGitRunner() : null,
    // The generation now carries `journal.db` up to this head, so the R2 tail
    // can start again from here (DDR-226 §3). Guarded on both sides: replay
    // skips rows at or below the restored head, so a missed rotation is a
    // longer tail, never a wrong journal.
    onGeneration: async () => {
      if (journal && journalTail) await journalTail.rotate(journal.head());
    },
  });
  if (backupTarget) {
    // Seconds below a minute: `every 0 min` (what a 15 s test interval printed)
    // reads as "never", which is the opposite of the truth.
    const every =
      backupIntervalMs < 60_000
        ? `${Math.round(backupIntervalMs / 1000)} s`
        : `${Math.round(backupIntervalMs / 60000)} min`;
    console.log(`[hub] backups → ${bootTarget.describe} every ${every}`);
  }

  /** Per-IP rate limit buckets (admin API): ip → { count, windowStart } */
  const rateBuckets = new Map();

  /** Per-token rate limit buckets (valid WS auth): label → { count, windowStart } */
  const connBuckets = new Map();

  /** Per-token rate limit buckets (authenticated asset writes): label → { count, windowStart } */
  const assetWriteBuckets = new Map();

  /** Per-token rate limit buckets (authenticated file-plane reads): label → { count, windowStart }.
   *  Its OWN map, deliberately: a fresh link pulls a whole design system in one
   *  pass (the RCA-2026-08-11 lesson), and that burst must not eat the asset
   *  WRITE budget of the same label. Same generous per-label ceiling. */
  const fileReadBuckets = new Map();

  /** Activity feed ring buffer (newest last). Bounded to ACTIVITY_CAP. */
  const activity = [];

  // Cloud Phase 16 — the headless workspace agent (server-owned git history).
  //
  // Workspace mode ONLY, and that restriction is the point. A laptop hub sits
  // beside a developer who has their own git and commits when they mean to; a
  // second committer writing into their working tree would be a hostile
  // surprise, not a feature. In a cell there is nobody at the keyboard, so an
  // uncommitted history is no history at all.
  const workspaceMode =
    process.env.HUB_WORKSPACE_MODE === '1' || process.env.MAUDE_WORKSPACE_MODE === '1';
  const repoDir = config.repoDir ?? process.env.MAUDE_REPO_DIR ?? '';
  /** @type {ReturnType<typeof createWorkspaceAgent>|null} */
  let workspace = null;

  // Cloud Phase 27 A1/A2 (DDR-209) — THE STUDIO IS A CHILD, THE HUB IS A DOOR.
  //
  // A cell runs the real `apps/studio` server on loopback and proxies to it, so
  // a member's browser loads the byte-identical client the desktop loads. A
  // self-hosted hub sits beside somebody's desktop and has no studio to
  // supervise, so this is workspace-mode-only — the same restriction, and the
  // same reason, as the autosave agent above.
  // Cloud Phase 27 B3 — built once the storage credentials resolve (below), and
  // read by the proxy's post-upload hook. Null until then, and null forever on
  // a hub with no object storage, which is every self-hosted one.
  let writeBehind = null;
  /** One line, not one per request, when render tokens cannot be minted. */
  let warnedNoCanvasToken = false;

  // ── The file journal (Sync v2 Increment 1, DDR-226 §2) ───────────────────
  //
  // Workspace-mode only: the journal describes a CHECKOUT's file plane, and a
  // self-hosted sync hub beside somebody's desktop has none. Absent ⇒ every
  // journal surface answers the empty case, which is exactly what an
  // un-upgraded hub looks like to a capability-gated client.
  //
  // DARK IN THIS INCREMENT. The table fills, the routes answer, the tail is
  // written — and no client consumes any of it yet. That is deliberate: the
  // durability half has to have soaked before anything depends on the seqs.
  const journalDesignRoot = workspaceMode && repoDir ? designRootFor() : null;
  const journal = journalDesignRoot ? openJournal(dataDir) : null;
  /** @type {ReturnType<typeof createJournalTail>|null} */
  let journalTail = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let walkImportTimer = null;

  /**
   * Every accepted write to the checkout, in ONE place.
   *
   * Two subscribers, and the ORDER matters only in that neither may fail the
   * other: the journal append is synchronous and local (it is what makes the
   * write knowable), the bucket mirror is fire-and-forget (the bytes are
   * already durable in the checkout). A write door calls this with a PATH; what
   * is at that path is read here, from disk.
   */
  const noteCheckoutWrite = (info) => {
    const rel = typeof info?.path === 'string' ? info.path : null;
    if (journal && journalDesignRoot && rel) {
      try {
        journal.recordWrite({ designRoot: journalDesignRoot, path: rel, source: 'peer-put' });
      } catch (err) {
        // A journal failure must never un-succeed a write that landed. It is
        // loud, and the walk-import reconciler is the backstop that makes it
        // recoverable rather than permanent.
        console.error(`[journal] append failed for ${sanitizeForLog(rel)}: ${err.message}`);
      }
    }
    // No mirror call here — the write-behind subscribes to `journal.onAppend`,
    // so the row this append just produced IS the mirror trigger (Sync v2
    // Increment 5: journal-driven, covering every file-plane class).
  };

  /**
   * A peer deleted a file — Increment 6. The mirror image of the write hook.
   *
   * The tombstone is a journal ROW, so peers receive "deleted at seq N" in the
   * same order they receive writes. Nothing is removed from object storage: a
   * CAS blob is content-addressed, so a delete leaves it unreferenced rather
   * than destroyed, and the generation backups keep their own copy regardless.
   */
  const noteCheckoutDelete = (info) => {
    const rel = typeof info?.path === 'string' ? info.path : null;
    if (!journal || !journalDesignRoot || !rel) return null;
    try {
      // F-7 (post-1.0 burn-down) — the append result flows BACK to the door.
      // This used to be fire-and-forget with the throw swallowed, while the
      // door answered `200 {deleted: true}` and reported `latestFor`'s seq —
      // after a failed append, the previous WRITE's seq. The door now refuses
      // the delete (and restores the quarantined copy) when this returns null.
      return (
        journal.recordWrite({
          designRoot: journalDesignRoot,
          path: rel,
          source: 'peer-put',
          deleted: true,
        }) ?? null
      );
    } catch (err) {
      console.error(`[journal] tombstone failed for ${sanitizeForLog(rel)}: ${err.message}`);
      return null;
    }
  };

  const studioEnabled = workspaceMode && process.env.MAUDE_STUDIO_CHILD !== '0';
  // DESKTOP ↔ CLOUD LIVE PAIRING (variant C2) — mint the child's credential.
  //
  // Off unless asked for: this is the pilot switch, so a fleet that has not been
  // rolled to it behaves exactly as before.
  const studioPairingToken = studioEnabled ? mintLoopbackSyncToken(dataDir) : null;
  // The child dials the hub it is already inside. `port` is this server's own
  // listener, so there is no configuration to get wrong and no address that
  // could ever leave the container. `undefined` when no token was minted, so
  // `createStudioChild` falls through to its own `env = process.env` default —
  // the LIVE object, not a snapshot copy — exactly as it did before pairing
  // existed. Only pairing's own two variables justify a copy at all.
  const studioEnv = studioPairingToken
    ? {
        ...process.env,
        MAUDE_LOOPBACK_SYNC_URL: `http://127.0.0.1:${port}`,
        MAUDE_LOOPBACK_SYNC_TOKEN: studioPairingToken,
      }
    : undefined;
  const studio = studioEnabled ? createStudioChild(studioEnv ? { env: studioEnv } : {}) : null;
  const studioProxy = studioEnabled
    ? createStudioProxy({
        upstream: () => studio.status(),
        canvasUpstream: () => canvasUpstreamStatus(studio),
        publicUrl: process.env.HUB_PUBLIC_URL ?? null,
        hash: (input) => createHash('sha256').update(input).digest('hex'),
        // B3 — a browser upload reaches object storage now, not at the next
        // boot. The browser-upload door is PROXIED — the bytes stream through
        // to the studio child, so the hub never learns which path landed and
        // cannot name one to the journal. The child reports its own writes
        // over `POST /api/journal/report` (a nudge; the hub still reads its
        // own disk), whose append the write-behind subscribes to; this hook is
        // only a flush nudge for rows that landed just before, and
        // walk-import stays the backstop. Payload-free, as before.
        onAssetWritten: () => {
          writeBehind?.note();
        },
        // NEVER LET THIS THROW INTO THE REQUEST LOOP.
        //
        // `mintRenderToken` refuses without a hub secret — correctly; a
        // capability nobody can verify is not a capability. But this is called
        // from the shell door on an ordinary signed-in page load, and an
        // unhandled throw there does not produce a 500: it takes the whole hub
        // process down. A hub started without HUB_SECRET therefore accepted a
        // sign-in and then died on the very first page the person opened.
        //
        // The canvas token is OPTIONAL by construction — `?? null` at the call
        // site, and the canvas origin simply stays unauthenticated without it.
        // So a mint that cannot happen degrades to "no token", loudly, once.
        mintCanvasToken: (session) => {
          try {
            return mintRenderToken({
              secret,
              project: process.env.MAUDE_TENANT_ID ?? 'local',
              subject: session.email,
              // The member's real role rides the capability so the canvas
              // origin's collab socket opens at it (annotations need an editor).
              // The HTTP canvas lane keeps the viewer floor regardless — see
              // render-token.mjs for why this widens nothing over HTTP.
              role: session.role,
            });
          } catch (err) {
            if (!warnedNoCanvasToken) {
              warnedNoCanvasToken = true;
              console.error(
                `[hub] cannot mint canvas render tokens (${err.message}). The studio will load, but canvas-origin surfaces that need a capability (live collab, annotations) stay unauthenticated. Set HUB_SECRET to enable them.`
              );
            }
            return null;
          }
        },
        // DDR-230 §c — the token the cell forwards to the maude-render service.
        // ALWAYS viewer role, whatever the member is: the worker only reads the
        // canvas, and a read-only capability is all a browser-bearing process
        // that evaluates tenant TSX may hold. Never the write-capable canvas
        // token above.
        mintRenderToken: (session) => {
          try {
            return mintRenderToken({
              secret,
              project: process.env.MAUDE_TENANT_ID ?? 'local',
              subject: session.email,
              role: 'viewer',
            });
          } catch {
            // Same failure mode as the canvas token — a hub without a secret
            // just can't mint one; the render lane then dispatches tokenless
            // and the canvas origin refuses it, which fails the export cleanly.
            return null;
          }
        },
      })
    : null;
  /** @type {ReturnType<typeof scheduleMirror>|null} */
  let mirror = null;
  /** @type {ReturnType<typeof scheduleRevocationSweep>|null} */
  let revocationSweep = null;

  // Accepted revisions (DDR-241). Assigned right after the Server exists;
  // the hooks below read it lazily, so `null` simply means "legacy".
  /** @type {ReturnType<typeof createAcceptedRevisions>|null} */
  let accepted = null;

  const server = new Server({
    port,

    // Hocuspocus installs its own SIGINT/SIGQUIT/SIGTERM handler that calls
    // `destroy()` and then `process.exit(0)` — racing ours. Since Cloud Phase
    // 16 that race is destructive: our handler flushes the pending commit
    // first, and Hocuspocus' exit fires in the middle of it. The observed
    // result was a workspace left staged-but-uncommitted on every shutdown —
    // `git add` had run, `git commit` never did — which silently loses the
    // last edits of every session the platform migrates, and migration is the
    // NORMAL path for a cell. Shutdown is ours; see `shutdown()` in runAsMain.
    stopOnSignals: false,

    // The control document (`maude.files`) carries no Y content and must never
    // reach the document store — an empty row there would show up in listings,
    // in the restore drill's document count, and in the operator's canvas
    // count. See files-ctl.mjs.
    extensions: [withoutCtlPersistence(new SQLite({ database: sqlitePath }))],

    async onAuthenticate({ token, documentName, request, connectionConfig }) {
      // DDR-053 §5: defend against log forging + future XSS regression by
      // rejecting documentNames with HTML / log metacharacters at source.
      // DDR-102: every rejection goes through authError() so the SPECIFIC
      // reason reaches the peer's onAuthenticationFailed (Hocuspocus sends
      // `error.reason ?? 'permission-denied'` — a bare Error message is lost).
      if (!DOCUMENT_NAME_REGEX.test(documentName ?? '')) {
        throw authError('invalid documentName');
      }
      const match = verifyToken(dataDir, token, secret);
      if (match) {
        // Sync v2 (DDR-226 §4) — the file-plane CONTROL channel.
        //
        // SCOPE-MAPPED rather than scope-checked: `maude.files` is not a
        // document any token is scoped to, so the ordinary check would refuse
        // every narrow credential and the poke would reach only wildcard
        // peers. Admitting it is safe precisely because of what it is — a
        // channel with no Y content, carrying `{t:'files', head}` and nothing
        // else. A peer learns that the journal moved; it learns WHAT moved
        // only by asking `GET /api/journal`, which IS scope-filtered.
        //
        // ADMITTED READ-ONLY, unconditionally. Hocuspocus enforces that for
        // SyncStep2 and Update, so no peer — patched, scripted or merely out
        // of date — can put Y CONTENT into the control document even though
        // the persistence layer would refuse to store it anyway.
        //
        // `readOnly` does NOT cover AWARENESS, which is applied and fanned out
        // to every connection on the document regardless. Since every valid
        // token of every scope is admitted here by design, that made the ctl
        // channel an authenticated cross-scope broadcast bus and a fan-out
        // amplifier — peers scoped to disjoint canvases could exchange
        // arbitrary payloads on it, quietly undoing the isolation the scope
        // check buys everywhere else. `beforeHandleAwareness` below drops
        // awareness on this document outright; presence has no meaning on a
        // channel whose entire vocabulary is one integer.
        //
        // Viewer (`match.readOnly`) tokens are admitted here too, deliberately:
        // knowing the journal moved tells you nothing you could not learn by
        // asking, and the ask is scope-filtered.
        if (isFilesCtlDoc(documentName)) {
          if (connectionConfig) connectionConfig.readOnly = true;
          return {
            user: {
              name: match.label,
              source: match.source,
              scope: match.scope ?? '*',
              readOnly: true,
              ctl: true,
            },
          };
        }
        // DDR-053 §3: scope binding gates Chain B (token leak → full hub).
        if (!matchesScope(match.scope, documentName)) {
          throw authError('token not authorized for this documentName');
        }
        // DDR-102 — valid-token ceiling: generous (default 600/min per label),
        // sized so multi-peer boot bursts of large projects (auth fires once
        // per DOCUMENT even on a multiplexed socket) never starve sync. The
        // anti-brute-force control moved to the invalid-attempt bucket below.
        if (rateLimit && !checkConnRateLimit(connBuckets, match.label, connRateLimitMax)) {
          if (verbose) {
            const bucket = connBuckets.get(match.label);
            console.warn(
              `[hub] rate limit exceeded for token label=${sanitizeForLog(match.label)} ` +
                `(valid bucket: ${bucket?.count ?? '?'}/${connRateLimitMax} per 60s)`
            );
          }
          throw authError('rate limit exceeded for this token — retry in up to 60s');
        }
        if (match.source === 'file') recordTokenUse(dataDir, match.label);
        // Cloud Phase 25 C1 — read-only is enforced by the PROTOCOL, not by
        // the UI. Hocuspocus drops this connection's SyncStep2 and Update
        // messages, so a viewer whose client is patched, scripted, or simply
        // out of date still cannot mutate the document. Hiding the buttons is
        // the last layer, never the only one.
        if (connectionConfig && match.readOnly) connectionConfig.readOnly = true;
        // DDR-241 §7 — in accepted-revisions mode every content connection is
        // read-only: changes arrive as proposals, only the kernel writes.
        if (connectionConfig && accepted?.acceptedMode()) connectionConfig.readOnly = true;
        return {
          user: {
            name: match.label,
            source: match.source,
            dev: !!match.dev,
            scope: match.scope ?? '*',
            readOnly: !!match.readOnly,
            // The address the token was minted for. Carried so the server-side
            // workspace agent can attribute a commit to the PERSON rather than
            // to their machine's token label — `git blame` on a design should
            // answer "who designed this" (Cloud Phase 16 / autocommit rule 2).
            ...(match.owner ? { email: match.owner } : {}),
          },
        };
      }
      // No tokens configured and no HUB_SECRET → permissive dev mode.
      //
      // Cloud Phase 2 — this path is off the moment the hub has ANY user, or
      // when the operator declares workspace mode. On a scratch hub it is a
      // convenience; on a hub with real accounts it would let an
      // unauthenticated stranger read and write every document, which is
      // strictly worse than refusing to start.
      const { tokens } = readTokens(dataDir);
      if (tokens.length === 0 && secret === '' && !permissiveDevAuthDisabled(dataDir)) {
        if (verbose) {
          console.warn(
            `[hub] no tokens configured; accepting any token for documentName=${sanitizeForLog(documentName)}`
          );
        }
        // DDR-241 §7 — accepted revisions: no client writes content, ever.
        if (connectionConfig && accepted?.acceptedMode()) connectionConfig.readOnly = true;
        return { user: { name: 'anon', anon: true } };
      }
      // DDR-102 — invalid-token attempts are the brute-force surface: tight
      // per-IP bucket (100/min). The old design never rate-limited these at
      // all (the label bucket only ever counted VALID tokens).
      // Resolve through the trusted-proxy chain so a hub behind Caddy buckets
      // attackers individually instead of collapsing them into the proxy's IP.
      const ip = clientIp(request);
      if (
        rateLimit &&
        !rateStore.check(`auth:${ip}`, invalidConnRateLimitMax, RATE_LIMIT_WINDOW_MS)
      ) {
        if (verbose) {
          console.warn(
            `[hub] invalid-token attempt rate limit exceeded for ip=${sanitizeForLog(ip)} ` +
              `(ceiling ${invalidConnRateLimitMax} per 60s, persisted across restarts)`
          );
        }
        // The reason must still SAY "invalid token". This bucket only fills
        // with invalid credentials, and the generic wording made a peer with
        // an expired token classify the refusal as transient and keep
        // retrying into the very bucket refusing it — masking the one cause
        // that needed a person (the alligators incident: 1840 rate-limit
        // lines hiding 138 invalid-token ones).
        throw authError('invalid token — rate limited, retry in up to 60s');
      }
      throw authError('invalid token');
    },

    async onRequest({ request, response }) {
      if (!request.url) return;
      const url = request.url;
      const method = request.method ?? 'GET';

      if (method === 'GET' && (url === '/health' || url.startsWith('/health?'))) {
        // /health is UNAUTHENTICATED and internet-reachable on a deploy (the
        // fly.toml + compose health check + `maude hub status` all hit it).
        // Omit `dataDir` (a server filesystem path) from the public payload —
        // it's a recon over-share. The authenticated /admin/api/status keeps
        // the full payload (operator already has admin access there).
        // Cloud Phase 26 Stage 3/4 — what this cell HOLDS and how hard its
        // canvases are to build, for the control plane's hourly reconcile.
        //
        // GATED, and that gate is the whole design. `/health` is
        // UNAUTHENTICATED and internet-reachable — every cell is a Worker
        // CUSTOM DOMAIN, so `<project>.cloud.maude.sh` is in Certificate
        // Transparency and the ids are not secret. Publishing a customer's
        // canvas count, asset bytes and live build counters there would be a
        // far larger over-share than the `dataDir` this same handler already
        // drops for being "a recon over-share" — and computing them would put
        // a recursive filesystem walk on an endpoint anyone can poll, on the
        // single loop that also serves collab sync.
        //
        // So the counts require the tenant's own derived secret — the one the
        // control plane already holds and already presents to `/internal/*`
        // (cell-ops.mjs uses HUB_SECRET as the bearer for exactly this
        // relationship). Public callers get the posture payload unchanged, and
        // pay nothing for it.
        const privileged = presentsCellSecret(request, secret);
        const health = buildStatusPayload({
          dataDir,
          secret,
          port,
          startedAt,
          peersCount: peers.size,
          exposeDataDir: false,
          studio,
          stats: privileged ? tenantStats({ designRoot: designRootFor() }) : null,
          render: privileged && studio ? await studio.renderStats() : null,
          // Sync v2 capability advertisement (DDR-226 §5/§10 — the compat
          // matrix is BINDING). A client never attaches the control channel or
          // relaxes its polling against a hub that does not say `ledger` here.
          // A protocol marker, not customer data, so it rides the public half.
          capabilities: journal ? ['ledger'] : [],
        });
        // 503, not 200-with-ok-false. A router reads the STATUS; a payload it
        // has to parse to learn the truth is a payload it will not parse.
        respondJson(response, health.ok ? 200 : 503, health);
        bailFromOnRequest();
      }
      if (!studioProxy && method === 'GET' && (url === '/' || url === '' || url.startsWith('/?'))) {
        // Cloud Phase 25 B8 — the cell's front door IS the project. Cloud Phase
        // 27 finishes the thought: it no longer REDIRECTS to a studio, it IS
        // one. `/` falls through to the proxy whenever a studio child exists,
        // and this landing is what a hub with no project to serve shows —
        // a self-hosted sync hub, or a cell whose checkout has not arrived.
        // Minimal landing — replaces Hocuspocus' default "Welcome to Hocuspocus!"
        // with a sensible signpost into the admin console. Self-hosted operator
        // surface, deliberately NOT a marketing page (DDR-097). Server-rendered
        // with the hub name; links the admin stylesheet (no inline styles — the
        // admin CSP `style-src 'self'` would drop them).
        respondAsset(response, renderLanding(readSettings(dataDir)), 'text/html; charset=utf-8', {
          hardenAdminOrigin: true,
        });
        bailFromOnRequest();
      }
      // Cloud Phase 2 — human sign-in. /auth/login is unauthenticated (and
      // rate-limited on the same bucket as /admin/api/bootstrap); /auth/logout
      // and /auth/session authenticate with the peer token they concern.
      // Match on the pathname, not the raw URL: an exact-equality check would
      // silently fall through on `/auth/login?next=…` and land the request in
      // the Hocuspocus catch-all.
      const authPath = url.split('?')[0];

      // ---- READ-ONLY SESSIONS (Cloud Phase 25 C1) -------------------------
      //
      // ONE gate, at the single HTTP entry point, rather than a branch inside
      // each of the sixteen mutating handlers — because a capability check
      // that has to be remembered sixteen times is a capability check that is
      // eventually forgotten once, and the once is the whole hole.
      //
      // A viewer may still do the things "viewer" means (Phase 25: look,
      // comment, download), so the exceptions are named explicitly and are
      // few. Everything else that changes state is refused with the same
      // sentence the People page promises.
      if (!READ_ONLY_SAFE_METHODS.has(method) && !readOnlyAllowedPath(authPath)) {
        const presented = (request.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
        const bearer = presented ? verifyToken(dataDir, presented, secret) : null;
        if (bearer?.readOnly) {
          respondJson(response, 403, {
            error: 'You can look at this project, comment and download it, but not change it.',
            reason: 'read-only',
          });
          bailFromOnRequest();
        }
      }

      // ---- THE BROWSER DOOR (Cloud Phase 25 B1–B4, A1/A3/A4) --------------
      //
      // A member who has installed nothing opens the project here. The session
      // is a COOKIE over the same peer token the desktop holds as a bearer:
      // one token store, one expiry, one read-only capability (C1) — a second
      // session type would be a second place for the role model to drift.
      if (
        authPath === '/auth/browser' ||
        authPath === '/auth/browser/signout' ||
        authPath === '/studio/signin'
      ) {
        const handled = await handleBrowserAuth({
          request,
          response,
          path: authPath,
          method,
          dataDir,
          secret,
          publicUrl,
          // OIDC AppSec pass — the self-hosted /studio/signin POST is a real
          // password check and must ride the same throttle /auth/login does.
          checkRateLimit: rateLimit
            ? (req) => checkRateLimit(rateBuckets, req, { store: rateStore, ip: clientIp(req) })
            : undefined,
          respondRateLimited: () => respondRateLimited(response),
        });
        if (handled) bailFromOnRequest();
      }
      // ---- THE OIDC DOOR (Track C) ---------------------------------------
      //
      // Same ending as the password door — a peer-token session cookie — with
      // the "who are you?" answered by the operator's identity provider. The
      // decision (linked ⇒ in, everyone else ⇒ pending) lives in
      // `resolveSubject`; this is only the HTTP.
      if (authPath === '/auth/oidc/start' || authPath === '/auth/oidc/callback') {
        const handled = await handleOidc({
          request,
          response,
          path: authPath,
          method,
          dataDir,
          secret,
          publicUrl,
          // OIDC AppSec pass — the callback drives outbound egress + a verify;
          // throttle it on the same bucket as the password doors.
          checkRateLimit: rateLimit
            ? (req) => checkRateLimit(rateBuckets, req, { store: rateStore, ip: clientIp(req) })
            : undefined,
          respondRateLimited: () => respondRateLimited(response),
        });
        if (handled) bailFromOnRequest();
      }
      // ---- THE CANVAS ORIGIN (DDR-054) ------------------------------------
      //
      // A different hostname, no cookie, and that is the point: a cookie scoped
      // widely enough to cover it would be readable by the untrusted canvas
      // origin. The capability lives in the URL and the lane is read-only.
      if (studioProxy && isCanvasHost(request)) {
        const handled = await studioProxy.handleCanvas({
          request,
          response,
          pathname: authPath,
          method,
          // NO PREFIX — the data plane already stripped it.
          //
          // `apps/cells/worker.mjs` routes `canvas.<zone>/<tenant>/…` and
          // rewrites the request WITHOUT the tenant segment, precisely so that
          // "a cell serving a self-hoster and a cell serving a Cloud tenant
          // handle byte-identical requests". Stripping it a second time here
          // would 404 the shell, the module, the runtime and every asset — the
          // grey boxes, again, from the opposite direction. The prefix belongs
          // to the URL the CLIENT builds (MAUDE_PUBLIC_CANVAS_ORIGIN), not to
          // the path this process parses.
          pathPrefix: '',
          verifyToken: (token) =>
            verifyRenderToken({ secret, token, project: process.env.MAUDE_TENANT_ID ?? null }),
        });
        if (handled) bailFromOnRequest();
      }

      // Cloud Phase 3 — authenticated asset proxy. Peer-token gated, GET/HEAD
      // proxy plus the DDR-217 desktop asset PUSH (PUT, workspace-mode only),
      // and reachable ONLY for validated keys. Never a presigned URL: the
      // canvas CSP is `img-src 'self'` and a presigned URL would be a bearer
      // credential living inside tenant-authored content.
      // Sync v2 Increment 5 — ONE door. The legacy write routes
      // (`PUT /assets/<key>`, `PUT /_asset-file/<rel>`) delegate to the file
      // door, so admission, CAS, quota, the owner gate and the journal have a
      // single home; the URLs stay answerable for the legacy client window
      // (≥2 releases, Open decision 4). A legacy client sends no
      // `x-maude-expect-hash`, which the door reads as "no precondition" —
      // exactly the semantics the old routes had. A path neither parser
      // accepts falls through to the legacy handlers' own refusals.
      //
      // CONTAINMENT AUTHORITY, post-consolidation. The pre-door `/assets/`
      // writer carried its OWN `isContainedReal(assetsRoot, …)` gate confining
      // a write to the `assets/` subtree. That is deliberately gone: `/assets/`
      // is now a thin alias for the one door, and the door's classifier +
      // symlink-resolved `resolveCheckoutFileWrite` is the sole containment
      // authority for every write URL. A committed `assets/link -> ../system`
      // therefore lands `system/x.css` as `companion-text` — but that is a
      // first-class file-plane class already reachable via `/_asset-file/`, so
      // there is NO net-new reach here, and the code-module owner gate is
      // unchanged. Re-adding an `assets/`-only guard would reintroduce exactly
      // the per-URL divergence this consolidation removed (attacker review
      // finding 3, 2026-08-18 — accepted as documented, not a fix).
      if (
        method === 'PUT' &&
        (authPath.startsWith('/assets/') || authPath.startsWith('/_asset-file/')) &&
        // Same canvas-origin exclusion the canonical file-door route carries
        // (DDR-088 — a privileged write belongs to NEITHER canvas allowlist).
        // The peer token already gates this, but the alias must mirror the
        // door's guard so a canvas realm can never reach the write door under
        // any URL (defender parity finding L-1, 2026-08-18).
        !(studioProxy && isCanvasHost(request))
      ) {
        const key = authPath.startsWith('/assets/') ? parseAssetPath(authPath) : null;
        const rel = key !== null ? `assets/${key}` : parseCheckoutAssetPath(authPath);
        if (rel !== null) {
          const handled = await handleFileDoor({
            request,
            response,
            pathname: `/api/file/${rel.split('/').map(encodeURIComponent).join('/')}`,
            method,
            dataDir,
            secret,
            designRoot: journalDesignRoot,
            journal,
            onWritten: noteCheckoutWrite,
            onDeleted: noteCheckoutDelete,
            checkRateLimit: rateLimit
              ? (req) => checkRateLimit(rateBuckets, req, { store: rateStore, ip: clientIp(req) })
              : undefined,
            checkWriteRateLimit: rateLimit
              ? (label) => checkConnRateLimit(assetWriteBuckets, label, assetWriteRateLimitMax)
              : undefined,
          });
          if (handled) bailFromOnRequest();
        }
      }
      if (authPath.startsWith('/assets/')) {
        const handled = await handleAssetRoute({
          request,
          response,
          pathname: authPath,
          method,
          dataDir,
          secret,
          s3: await s3Source.config(),
          // DDR-217 — where a pushed asset lands (the checkout the studio
          // child serves). Null on a hub with no checkout → PUT keeps its 405.
          designRoot:
            workspaceMode && repoDir
              ? join(repoDir, process.env.MAUDE_DESIGN_ROOT ?? '.design')
              : null,
          // Mirror a pushed asset to the bucket now — the same fire-and-forget
          // hook a browser upload uses (B3); the checkout stays the backstop.
          // Arg-carrying since Sync v2: the same hook appends the journal row.
          onWritten: noteCheckoutWrite,
          checkRateLimit: rateLimit
            ? (req) => checkRateLimit(rateBuckets, req, { store: rateStore, ip: clientIp(req) })
            : undefined,
          // The authenticated write lane gets its OWN, generous per-label
          // bucket — see ASSET_WRITE_RATE_LIMIT_MAX.
          checkWriteRateLimit: rateLimit
            ? (label) => checkConnRateLimit(assetWriteBuckets, label, assetWriteRateLimitMax)
            : undefined,
        });
        if (handled) bailFromOnRequest();
      }
      // DDR-217 addendum (2026-08-11) — the CHECKOUT half of the desktop asset
      // push. Brand/DS assets under `system/<ds>/assets/…` are referenced by
      // their full designRoot path and served from the checkout by the studio
      // child, NOT the bucket `/assets/` proxy — so they land on the checkout
      // at their real relative path (which the bucket-keyed route can't
      // address). Same peer-token + rate-limit + workspace gate; top-level
      // `assets/…` writes here mirror to the bucket via onWritten (2026-08-15
      // RCA — this door used to skip the B3 hook). See handleCheckoutAssetRoute.
      if (authPath.startsWith('/_asset-file/')) {
        const handled = await handleCheckoutAssetRoute({
          request,
          response,
          pathname: authPath,
          method,
          dataDir,
          secret,
          designRoot:
            workspaceMode && repoDir
              ? join(repoDir, process.env.MAUDE_DESIGN_ROOT ?? '.design')
              : null,
          // 2026-08-15 RCA — this was the ONE write surface without the B3
          // mirror hook; a top-level `assets/…` file pushed here stayed
          // checkout-only until the next boot.
          onWritten: noteCheckoutWrite,
          checkRateLimit: rateLimit
            ? (req) => checkRateLimit(rateBuckets, req, { store: rateStore, ip: clientIp(req) })
            : undefined,
          checkWriteRateLimit: rateLimit
            ? (label) => checkConnRateLimit(assetWriteBuckets, label, assetWriteRateLimitMax)
            : undefined,
        });
        if (handled) bailFromOnRequest();
      }
      // The batch presence probe (RCA 2026-08-11 part 2). A HEAD does not reach
      // a cell as a HEAD — it arrives as GET — so the sweep's per-file
      // skip-probe could never say "already there" for DS assets, and pulled
      // whole objects out of R2 for the bucket ones. This asks about the whole
      // set in ONE request, with the method that survives. Same gates as the
      // writes it replaces. See handleAssetProbeRoute.
      if (authPath === '/_asset-probe') {
        const handled = await handleAssetProbeRoute({
          request,
          response,
          pathname: authPath,
          method,
          dataDir,
          secret,
          s3: await s3Source.config(),
          designRoot:
            workspaceMode && repoDir
              ? join(repoDir, process.env.MAUDE_DESIGN_ROOT ?? '.design')
              : null,
          checkRateLimit: rateLimit
            ? (req) => checkRateLimit(rateBuckets, req, { store: rateStore, ip: clientIp(req) })
            : undefined,
          checkWriteRateLimit: rateLimit
            ? (label) => checkConnRateLimit(assetWriteBuckets, label, assetWriteRateLimitMax)
            : undefined,
        });
        if (handled) bailFromOnRequest();
      }
      // A syncing peer asking what the PROJECT contains — see documents.mjs for
      // why Yjs cannot answer this and why a peer must not need the admin
      // secret to ask. Scope-bound to exactly the documents this token could
      // already open over the wire.
      if (authPath === DOCUMENTS_PATH) {
        const handled = handleDocumentsRoute({
          path: authPath,
          method,
          bearer: (request.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim() || null,
          verify: (token) => verifyToken(dataDir, token, secret),
          matchesScope,
          listDocuments: () => listCanvases(sqlitePath, peers),
          listTombstones: () => listTombstones(dataDir),
          respondJson: (status, payload) => respondAdminJson(response, status, payload),
        });
        if (handled) bailFromOnRequest();
      }
      // The absence half — a peer stating that a canvas is gone, so the other
      // side stops treating "the hub has it" as authority to write the file
      // back. See tombstones.mjs.
      if (
        authPath.startsWith(DOCUMENT_PATH_PREFIX) &&
        accepted?.acceptedMode() &&
        method !== 'GET'
      ) {
        // Fenced (DDR-241 §7): deletion and revival are accepted actions now.
        respondAdminJson(response, 409, {
          error: 'This project saves through accepted revisions — delete through a proposal.',
          code: 'accepted-mode',
        });
        bailFromOnRequest();
      }
      if (authPath.startsWith(DOCUMENT_PATH_PREFIX)) {
        const handled = handleDocumentItemRoute({
          path: authPath,
          method,
          bearer: (request.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim() || null,
          verify: (token) => verifyToken(dataDir, token, secret),
          matchesScope,
          deleteDocument: (name) => {
            deleteDocument({ name, server, sqlitePath, dataDir });
            documentEvents.changed();
          },
          reviveDocument: (name) => {
            try {
              clearTombstone(dataDir, name);
              documentEvents.changed();
            } catch {
              /* an unwritable store degrades to today's behaviour */
            }
          },
          respondJson: (status, payload) => respondAdminJson(response, status, payload),
        });
        if (handled) bailFromOnRequest();
      }
      // The file plane's manifest (feature-sync-file-plane) — what plane-B
      // files this project offers, classified by the shared positive
      // classifier. Scope-bound to the same peer token the sync uses, like
      // the documents listing above; canvas-owned files are absent at the
      // SOURCE so the CRDT lanes can never be shadowed by a second transport.
      if (authPath === FILES_PATH) {
        const handled = handleFilesRoute({
          path: authPath,
          method,
          bearer: (request.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim() || null,
          verify: (token) => verifyToken(dataDir, token, secret),
          matchesScope,
          designRoot:
            workspaceMode && repoDir
              ? join(repoDir, process.env.MAUDE_DESIGN_ROOT ?? '.design')
              : null,
          respondJson: (status, payload) => respondAdminJson(response, status, payload),
        });
        if (handled) bailFromOnRequest();
      }
      // The SINGLE file write door (Sync v2, DDR-226 §5). Unlike the two older
      // asset doors it carries a compare-and-swap precondition and an
      // owner-role gate on code modules, and it answers with the journal seq —
      // the receipt that moves a file to `on-hub` in the doručenka.
      //
      // Main origin only, like every other privileged route: the canvas origin
      // is untrusted content and has no business writing project files
      // (DDR-088 — a privileged route belongs to NEITHER allowlist).
      // WHAT THIS DOOR WILL ACCEPT, as data. A client that has to guess the
      // ceiling guesses wrong: the push side used the 512 MB PULL cap while
      // this door refuses anything over 95 MB, so oversized files retried
      // forever against a wall neither side named (2026-09-03).
      if (authPath === FILE_LIMITS_PATH && !(studioProxy && isCanvasHost(request))) {
        if (
          handleFileLimits({
            request,
            response,
            pathname: authPath,
            method,
            dataDir,
            secret,
            // METERED like every sibling route. The handler verifies a token
            // when one is offered — HMAC-SHA256 plus a SQLite lookup — and
            // answers observably differently for a valid one, so an
            // unauthenticated caller must not be able to drive that path at
            // will. Every neighbouring route threads this; the first version of
            // this one did not (found in the security review of this change).
            checkRateLimit: rateLimit
              ? (req) => checkRateLimit(rateBuckets, req, { store: rateStore, ip: clientIp(req) })
              : undefined,
          })
        ) {
          bailFromOnRequest();
          return;
        }
      }
      if (authPath.startsWith(FILE_DOOR_PREFIX) && !(studioProxy && isCanvasHost(request))) {
        const handled = await handleFileDoor({
          request,
          response,
          pathname: authPath,
          method,
          dataDir,
          secret,
          designRoot: journalDesignRoot,
          journal,
          onWritten: noteCheckoutWrite,
          onDeleted: noteCheckoutDelete,
          checkRateLimit: rateLimit
            ? (req) => checkRateLimit(rateBuckets, req, { store: rateStore, ip: clientIp(req) })
            : undefined,
          checkWriteRateLimit: rateLimit
            ? (label) => checkConnRateLimit(assetWriteBuckets, label, assetWriteRateLimitMax)
            : undefined,
        });
        if (handled) bailFromOnRequest();
      }
      // Accepted revisions (DDR-241): proposals, bootstrap, replay, history.
      // In NEITHER canvas allowlist — the canvas origin never proposes.
      if (authPath.startsWith('/api/projects/') && !(studioProxy && isCanvasHost(request))) {
        const handled = await accepted.handleRoutes({
          path: authPath,
          method,
          query: Object.fromEntries(new URL(url, 'http://x').searchParams),
          request,
          auth: (req) => {
            const presented = (req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
            const m = presented ? verifyToken(dataDir, presented, secret) : null;
            if (m) {
              return {
                actor: m.owner || m.label,
                readOnly: !!m.readOnly,
                scope: m.scope ?? '*',
                admin:
                  !m.readOnly &&
                  (m.role === 'owner' || m.role === 'admin' || (!m.role && !m.owner)),
              };
            }
            if (presentsCellSecret(req, secret))
              return { actor: 'operator', readOnly: false, admin: true };
            const { tokens } = readTokens(dataDir);
            if (tokens.length === 0 && secret === '' && !permissiveDevAuthDisabled(dataDir)) {
              return { actor: 'anon', readOnly: false, admin: true };
            }
            return null;
          },
          respondJson: (status, payload) => respondAdminJson(response, status, payload),
        });
        if (handled) bailFromOnRequest();
      }
      // The journal (Sync v2 Increment 1, DDR-226 §5). `GET /api/journal` is
      // the cursor read — the manifest becomes its `since=0` case — and
      // `POST /api/journal/report` is the studio child's loopback nudge.
      //
      // In NEITHER canvas allowlist (DDR-088): the canvas origin is untrusted
      // content and has no business reading a project's write history, let
      // alone asking the hub to stat paths.
      if (
        (authPath === JOURNAL_PATH || authPath === JOURNAL_REPORT_PATH) &&
        // Never from the canvas origin, structurally — not merely because that
        // origin holds a render capability rather than a peer token. DDR-088's
        // rule is that a privileged route is reachable from NEITHER allowlist,
        // and "it would 401 anyway" is the kind of reasoning that stops being
        // true one refactor later.
        !(studioProxy && isCanvasHost(request))
      ) {
        let journalBody = null;
        if (authPath === JOURNAL_REPORT_PATH && method === 'POST') {
          try {
            journalBody = await readJsonBody(request);
          } catch {
            journalBody = null;
          }
        }
        const handled = handleJournalRoutes({
          path: authPath,
          method,
          query: Object.fromEntries(new URL(url, 'http://x').searchParams),
          bearer: (request.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim() || null,
          verify: (token) => verifyToken(dataDir, token, secret),
          matchesScope,
          designRoot: journalDesignRoot,
          journal,
          body: journalBody,
          // The nudge is for the process sharing this disk. `clientIp` already
          // resolves the trusted-proxy chain, so a forwarded request from the
          // internet cannot claim to be loopback here.
          isLoopback: LOOPBACK_HOSTS.has(clientIp(request)),
          // The same per-label bucket the file-plane READS use — a cursor poll
          // is the same shape of traffic, and `GET /api/files` having no rate
          // limit at all is a named below-floor finding this route does not
          // repeat.
          checkRateLimit: rateLimit
            ? (label) => checkConnRateLimit(fileReadBuckets, label, assetWriteRateLimitMax)
            : undefined,
          respondJson: (status, payload) => respondAdminJson(response, status, payload),
        });
        if (handled) bailFromOnRequest();
      }
      // The cell's own git history, readable by the linked desktop
      // (feature-cloud-managed-git-posture). In cloud-managed posture the cell
      // is the sole committer, so this is the ONLY history that describes the
      // project — the desktop's local repo has none, which is what made its
      // History tab say "No saved versions yet" under a "Cloud is saving" note.
      //
      // In NEITHER canvas allowlist (DDR-088): the canvas origin is untrusted
      // content and has no business reading a project's commit history, let
      // alone asking the cell to hand back a file at an arbitrary object name.
      if (
        (authPath === HISTORY_PATH || authPath === HISTORY_FILE_PATH) &&
        !(studioProxy && isCanvasHost(request))
      ) {
        const handled = await handleHistoryRoutes({
          path: authPath,
          method,
          query: Object.fromEntries(new URL(url, 'http://x').searchParams),
          bearer: (request.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim() || null,
          verify: (token) => verifyToken(dataDir, token, secret),
          matchesScope,
          repoDir: workspaceMode ? repoDir : null,
          designRoot: journalDesignRoot,
          // A capture ceiling above the blob cap, so a legitimate canvas body
          // is never SILENTLY truncated into a plausible-looking wrong file.
          // The route still checks `cat-file -s` before reading anything.
          run: workspaceMode && repoDir ? createGitRunner({ maxCapture: 4 * 1024 * 1024 }) : null,
          projectName: process.env.MAUDE_PROJECT_NAME ?? null,
          // The same per-label bucket the file-plane READS use — a History poll
          // is the same shape of traffic.
          checkRateLimit: rateLimit
            ? (label) => checkConnRateLimit(fileReadBuckets, label, assetWriteRateLimitMax)
            : undefined,
          respondJson: (status, payload) => respondAdminJson(response, status, payload),
          response,
        });
        if (handled) bailFromOnRequest();
      }
      // The file plane's read half — one manifest entry's bytes. A NEW route,
      // deliberately NOT a widening of `/_asset-file/` (its GET-is-presence-
      // only posture is a recorded review decision). Read-only by
      // construction; every post-auth refusal is 404 — no oracle.
      if (authPath.startsWith(PROJECT_FILE_PREFIX)) {
        const handled = await handleProjectFileRoute({
          request,
          response,
          pathname: authPath,
          method,
          dataDir,
          secret,
          matchesScope,
          designRoot:
            workspaceMode && repoDir
              ? join(repoDir, process.env.MAUDE_DESIGN_ROOT ?? '.design')
              : null,
          checkRateLimit: rateLimit
            ? (req) => checkRateLimit(rateBuckets, req, { store: rateStore, ip: clientIp(req) })
            : undefined,
          // The GENEROUS per-label bucket, its own map — a fresh link pulls a
          // whole design system in one pass and must not starve (or be
          // starved by) the asset write budget.
          checkReadRateLimit: rateLimit
            ? (label) => checkConnRateLimit(fileReadBuckets, label, assetWriteRateLimitMax)
            : undefined,
        });
        if (handled) bailFromOnRequest();
      }
      // Cloud Phase 20 — the take-your-work-home export, started by the owner
      // (or the dashboard on the owner's behalf) with a project access token.
      if (authPath === '/api/export') {
        const handled = await handleExportRoute({
          request,
          path: authPath,
          method,
          repoDir: workspaceMode ? repoDir : null,
          run: workspaceMode && repoDir ? createGitRunner() : null,
          respondJson: (status, payload) => respondAdminJson(response, status, payload),
        });
        if (handled) bailFromOnRequest();
      }
      if (
        authPath === '/auth/login' ||
        authPath === '/auth/logout' ||
        authPath === '/auth/session' ||
        // Cloud Phase 6 — magic-link invites. `/join/<token>` only LOOKS
        // (a link preview must not burn an invite); `/join` POST redeems.
        authPath === '/join' ||
        authPath.startsWith('/join/')
      ) {
        // NEVER LET THIS THROW INTO THE REQUEST LOOP (same rule as
        // `mintCanvasToken` above): a non-null throw out of `onRequest` is not
        // a 500, it is the hub process exiting — and these are the UNAUTHENTICATED
        // human doors, the ones a mangled link or a hostile body reaches first.
        // A handler bug answers 500 to one request; it does not drop every
        // collab socket (security review 2026-08-21, F1).
        let handled = false;
        try {
          handled = await handleAuthRoutes({
            request,
            response,
            path: authPath,
            method,
            dataDir,
            secret,
            publicUrl,
            checkRateLimit: rateLimit
              ? (req) => checkRateLimit(rateBuckets, req, { store: rateStore, ip: clientIp(req) })
              : undefined,
            respondRateLimited: () => respondRateLimited(response),
            respondJson: (status, payload) => respondAdminJson(response, status, payload),
            readJsonBody,
            kickLabel: (label) => kickSessionsForLabel(peers, label),
            pushActivity: (evt) => pushActivity(activity, evt),
          });
        } catch (err) {
          console.error(`[hub] auth route ${authPath} failed: ${err?.message ?? err}`);
          if (!response.headersSent) respondAdminJson(response, 500, { error: 'internal error' });
          else response.end();
          handled = true;
        }
        if (handled) bailFromOnRequest();
      }

      if (url === '/admin' || url.startsWith('/admin?')) {
        respondAsset(response, ADMIN_HTML, 'text/html; charset=utf-8', { hardenAdminOrigin: true });
        bailFromOnRequest();
      }
      if (url === '/admin/') {
        // RELATIVE redirect (not '/admin') so it survives a path-stripping
        // reverse proxy: the browser is at <prefix>/admin/ and resolves
        // '../admin' against it → <prefix>/admin, preserving the mount prefix.
        // An absolute '/admin' would drop the prefix and 404 on the proxy.
        response.writeHead(301, { Location: '../admin' });
        response.end();
        bailFromOnRequest();
      }
      if (url === '/admin/style.css' || url.startsWith('/admin/style.css?')) {
        respondAsset(response, ADMIN_CSS, 'text/css; charset=utf-8', { hardenAdminOrigin: true });
        bailFromOnRequest();
      }
      if (url === '/admin/app.js' || url.startsWith('/admin/app.js?')) {
        respondAsset(response, ADMIN_JS, 'application/javascript; charset=utf-8', {
          hardenAdminOrigin: true,
        });
        bailFromOnRequest();
      }
      if (url.startsWith('/admin/api/')) {
        await handleAdminApi({
          request,
          response,
          dataDir,
          secret,
          port,
          startedAt,
          peers,
          publicUrl,
          rateBuckets,
          rateStore,
          clientIp,
          rateLimit,
          activity,
          sqlitePath,
          insecureHttp,
          durability,
        });
        bailFromOnRequest();
      }
      // ---- THE STUDIO (Cloud Phase 27 A2 / DDR-209) -----------------------
      //
      // Everything the hub does not own itself belongs to the real studio. The
      // direction is deliberate: the studio's route table grows every phase and
      // the hub's does not, so an allowlist of HUB paths keeps new studio
      // features working in the cloud without anyone remembering this file.
      if (studioProxy && !isHubOwned(authPath)) {
        const verdict = doorVerdict({
          request,
          pathname: authPath,
          session: browserSession(dataDir, secret, request),
        });
        if (verdict?.kind === 'paused') {
          respondAsset(
            response,
            servicePage('Paused', PAUSED_MESSAGE),
            'text/html; charset=utf-8',
            {
              hardenAdminOrigin: true,
            }
          );
          bailFromOnRequest();
        }
        if (verdict?.kind === 'no-project') {
          respondJson(response, 503, { error: 'this workspace has no design project yet' });
          bailFromOnRequest();
        }
        if (verdict?.kind === 'sign-in') {
          // An HTML navigation gets a redirect it can follow; an API call gets
          // a 401 it can read. Sending a fetch() to the control plane's sign-in
          // page produces a CORS error in the console and nothing on screen.
          if ((request.headers?.accept ?? '').includes('text/html')) {
            response.writeHead(302, { location: verdict.to, 'cache-control': 'no-store' });
            response.end();
          } else {
            respondJson(response, 401, { error: 'sign in to open this project' });
          }
          bailFromOnRequest();
        }
        const handled = await studioProxy.handle({
          request,
          response,
          pathname: authPath,
          method,
          session: browserSession(dataDir, secret, request),
        });
        if (handled) bailFromOnRequest();
      }

      // Fall through — Hocuspocus' default handler responds to unknown routes.
    },

    async onConnect({ documentName, socketId, context }) {
      // Pre-init peers entry without the `connection` reference — that field
      // isn't on the onConnect payload in @hocuspocus/server 4.x; we patch it
      // in via the `connected` hook below. Keeping the entry available here
      // so /admin/api/peers shows pending connections during auth.
      const user = context?.user?.name ?? 'anon';
      peers.set(socketId, {
        socketId,
        documentName,
        user,
        scope: null,
        connectedAt: Date.now(),
        connection: null,
      });
      if (verbose) {
        console.log(
          `[hub] connect documentName=${sanitizeForLog(documentName)} user=${sanitizeForLog(user)}`
        );
      }
    },
    // Note: the join activity event is emitted from the `connected` hook below,
    // not here — onConnect fires BEFORE onAuthenticate, so context.user is still
    // 'anon'. By `connected` the real label is known (same reason peers.user is
    // patched there for kickSessionsForLabel — DDR-053 §4).
    async connected({ socketId, connection, context }) {
      // Per @hocuspocus/server 4.x types: `connection` is delivered on the
      // `connected` hook (post-auth, post-document-load), NOT onConnect.
      // The context.user is ALSO only populated here — onConnect fires BEFORE
      // onAuthenticate, so the Map entry recorded `user: 'anon'` there.
      // Patch BOTH fields so kickSessionsForLabel matches correctly (DDR-053 §4).
      const entry = peers.get(socketId);
      if (!entry) return;
      entry.connection = connection;
      const realUser = context?.user?.name;
      if (realUser) entry.user = realUser;
      if (context?.user?.scope) entry.scope = context.user.scope;
      pushActivity(activity, {
        type: 'join',
        user: entry.user,
        doc: entry.documentName,
      });
    },
    async onDisconnect({ documentName, socketId, context }) {
      const user = context?.user?.name ?? 'anon';
      peers.delete(socketId);
      pushActivity(activity, { type: 'leave', user, doc: documentName });
      if (verbose) {
        console.log(
          `[hub] disconnect documentName=${sanitizeForLog(documentName)} user=${sanitizeForLog(user)}`
        );
      }
    },
    async onLoadDocument({ documentName }) {
      if (verbose) console.log(`[hub] load documentName=${sanitizeForLog(documentName)}`);
    },

    /**
     * The control document carries no presence — DDR-226 §4.
     *
     * `connectionConfig.readOnly` gates Y content and not awareness, and every
     * valid token of every scope is admitted to `maude.files` by design. That
     * combination made it an authenticated cross-scope broadcast bus: a peer
     * could publish arbitrary state, for as many synthetic clientIDs as it
     * liked, to every other peer on the hub. Emptying the state map here is
     * what the re-encode downstream sees, so nothing is stored and nothing
     * fans out. Every other document keeps presence untouched.
     */
    async beforeHandleAwareness({ document, states }) {
      dropCtlAwareness({ document, states });
    },

    // DDR-241 §7 / T7 — a permission cached on a connection is not a boundary.
    // Re-assert read-only on EVERY message in accepted-revisions mode, so an
    // already-open socket (or one whose flag was loosened) cannot write either.
    async beforeHandleMessage(payload) {
      accepted?.fence(payload);
    },

    // Cloud Phase 16 Task 1 — server-owned history.
    //
    // `afterStoreDocument`, not `onChange`: by the time this fires the SQLite
    // extension has already persisted, and Hocuspocus has applied its own
    // debounce. Committing on every change event would produce one commit per
    // keystroke; committing before the store would let a crash leave a commit
    // describing a state the hub does not have.
    //
    // Wrapped so a projection failure can never propagate into the store hook
    // — an exception here aborts storage for every OTHER document too.
    // `lastContext`, NOT `context` — the store payload names it that (it is the
    // context of the connection whose change triggered the store, which is
    // exactly the person to attribute the commit to). Reading `context` here
    // silently yields undefined, and the only symptom is every server commit
    // authored by "Unknown editor" — a lie that git blame repeats forever.
    async afterStoreDocument({ documentName, document, lastContext }) {
      documentEvents.stored({ documentName, document });
      if (!workspace) return;
      try {
        await workspace.onDocumentStored({ documentName, document, user: lastContext?.user });
      } catch (err) {
        console.error(`[hub] workspace projection failed: ${err.message}`);
      }
    },
  });

  // Sync v2 Increment 2 — the poke. Built here because it needs the running
  // instance's document map; subscribed to the journal in
  // `startJournalReconciler`, so a hub with no checkout never emits one.
  //
  // `server` is a `Server` — the HTTP/WS host — and its documents live one
  // level down on `.hocuspocus`. `createFilesPoke` resolves either shape and
  // says so loudly if it can find neither; passing the wrong one used to be a
  // silent no-op, because "no document" is also what an unattached project
  // legitimately looks like. See `documentMap` in files-ctl.mjs.
  const filesPoke = createFilesPoke({ instance: server });
  const documentsPoke = createFilesPoke({ instance: server, documentsOnly: true, coalesceMs: 50 });
  const documentEvents = createDocumentEvents({ poke: documentsPoke });

  // ---- accepted revisions (DDR-241) ---------------------------------------
  // The store's durable home (DDR-241 §2): a cell's Durable Object through
  // the container's outbound route, or this hub's own data volume.
  const projectStore = process.env.MAUDE_PROJECT_STORE_URL
    ? openRemoteProjectStore({ url: process.env.MAUDE_PROJECT_STORE_URL })
    : openSqliteProjectStore(dataDir);
  // A disposable data directory (a cloud container) cannot back an
  // acknowledgement — the mode switch refuses rather than promise saves it
  // could lose on the next rollout (T11: no weakened "saved" semantics).
  const storeDurable = projectStore.kind === 'remote' || process.env.MAUDE_DATA_EPHEMERAL !== '1';
  let canvasGroupsCache = { at: 0, groups: null };
  const acceptedCanvasGroups = () => {
    if (Date.now() - canvasGroupsCache.at < 5000) return canvasGroupsCache.groups;
    let groups = null;
    try {
      const root = designRootFor();
      const cfg = root ? JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) : null;
      if (Array.isArray(cfg?.canvasGroups)) {
        groups = cfg.canvasGroups
          .map((g) => (typeof g === 'string' ? g : g?.path))
          .filter((g) => typeof g === 'string' && g.length > 0);
      }
    } catch {
      groups = null;
    }
    canvasGroupsCache = { at: Date.now(), groups };
    return groups;
  };
  /** slug → design-root-relative `.tsx` path, from the checkout (workspace mode). */
  const checkoutCanvasPaths = () => {
    const root = designRootFor();
    const out = new Map();
    if (!root) return out;
    const walk = (abs, rel, depth) => {
      if (depth > 16) return;
      let entries;
      try {
        entries = readdirSync(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'node_modules') continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(abs, e.name), childRel, depth + 1);
        else if (e.isFile() && e.name.endsWith('.tsx')) {
          const slug = canvasSlugFromRel(childRel, process.env.MAUDE_DESIGN_ROOT ?? '.design');
          if (slug && !out.has(slug)) out.set(slug, childRel);
        }
      }
    };
    walk(root, '', 1);
    return out;
  };
  /** Folders under the declared canvas groups (runtime `_*` and dot-dirs excluded). */
  const checkoutFolders = () => {
    const root = designRootFor();
    const groups = acceptedCanvasGroups() ?? [];
    if (!root || groups.length === 0) return [];
    const out = [];
    const walk = (abs, rel, depth) => {
      if (depth > 16) return;
      let entries;
      try {
        entries = readdirSync(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
        if (e.name === 'node_modules') continue;
        const childRel = `${rel}/${e.name}`;
        out.push(childRel);
        walk(join(abs, e.name), childRel, depth + 1);
      }
    };
    for (const g of groups) walk(join(root, ...g.split('/')), g, 1);
    return out;
  };
  accepted = createAcceptedRevisions({
    server,
    store: projectStore,
    projectId: process.env.MAUDE_TENANT_ID || 'local',
    canvasGroups: acceptedCanvasGroups,
    designRel: '.design',
    deleteDocument: (name) => {
      deleteDocument({ name, server, sqlitePath, dataDir });
    },
    reviveDocument: (name) => {
      try {
        clearTombstone(dataDir, name);
      } catch {
        /* the revived document is recreated either way */
      }
    },
    onAccepted: () => documentEvents.changed(),
    // Baseline import (T30): the storage listing, the project's deletions,
    // and — in workspace mode — the checkout as the path/folder authority.
    listDocuments: () => listCanvases(sqlitePath, peers),
    tombstoned: () => new Set(listTombstones(dataDir).map((t) => t.name)),
    checkoutPath: (slug) => checkoutCanvasPaths().get(slug) ?? null,
    checkoutBody: (rel) => {
      const root = designRootFor();
      if (!root) return null;
      try {
        return readFileSync(join(root, ...rel.split('/')), 'utf8');
      } catch {
        return null;
      }
    },
    checkoutDirs: () => checkoutFolders(),
    storeDurable,
  });
  // The persistent mode decides the fence before any peer can connect (the
  // SQLite read resolves long before the caller's `listen()`); the reconcile
  // then makes every accepted document match its store head.
  const acceptedReady = accepted
    .refresh()
    .then(() => accepted.reconcile())
    .catch((err) => console.error(`[transactions] startup reconcile failed: ${err.message}`));

  return {
    server,
    sqlitePath,
    port,
    secret,
    dataDir,
    publicUrl,
    startedAt,
    version: HUB_VERSION,
    peers,
    activity,
    backupTarget,
    s3Source,
    workspaceMode,
    repoDir,
    /** The supervised studio child. Null outside workspace mode. */
    studio,
    /** The live agent, once started. Null outside workspace mode. */
    get workspace() {
      return workspace;
    },

    /**
     * Take over WebSocket upgrades for the studio's live surfaces.
     *
     * The studio's panels are WebSockets — the inspector feed and the
     * per-canvas collab rooms — so a proxy that only speaks HTTP delivers a
     * studio whose Layers panel never updates and whose presence cursors never
     * appear. That is precisely the class of "it looks like the desktop but
     * behaves worse" this phase exists to end.
     *
     * Hocuspocus installs its own `upgrade` listener and treats the path as a
     * document name, so both cannot simply co-exist: an unclaimed `/_ws` would
     * become a Yjs document called `_ws`. We take the listeners off, put ours in
     * front, and delegate everything that is not the studio's back to them —
     * rather than `prependListener`, which would leave Hocuspocus running on the
     * same socket after we had already spliced it.
     */
    attachStudioUpgrades() {
      if (!studioProxy) return;
      const httpServer = server.httpServer;
      if (!httpServer) return;
      const existing = httpServer.listeners('upgrade');
      httpServer.removeAllListeners('upgrade');
      httpServer.on('upgrade', (request, socket, head) => {
        // The CANVAS origin's live sockets — collab rooms + HMR — first, and by
        // capability, not by session: the canvas origin is cookieless by design
        // (DDR-054), so `browserSession` can never say yes there, and routing
        // these through the session gate is exactly the 401 that kept cloud
        // collaboration dead (RCA issue-cloud-live-collaboration-dead). Checked
        // before the `/_ws` prefix test because the HMR socket's path IS `/_ws`.
        if (isCanvasHost(request)) {
          studioProxy.handleCanvasUpgrade({
            request,
            socket,
            head,
            // NO PREFIX — the data plane already stripped it (same contract as
            // the HTTP canvas lane above).
            pathPrefix: '',
            verifyToken: (token) =>
              verifyRenderToken({ secret, token, project: process.env.MAUDE_TENANT_ID ?? null }),
          });
          return;
        }
        const path = (request.url ?? '').split('?')[0];
        if (!path.startsWith('/_ws')) {
          for (const listener of existing) listener.call(httpServer, request, socket, head);
          return;
        }
        studioProxy.handleUpgrade({
          request,
          socket,
          head,
          session: browserSession(dataDir, secret, request),
        });
      });
    },
    /**
     * Boot the server-side history agent. Separate from createHub() because it
     * clones, shells out to git and touches a disk — none of which a test that
     * only wants a Hocuspocus instance should pay for.
     *
     * Reports rather than throws: a cell that cannot keep history must still
     * serve the tenant's work.
     */
    async startWorkspaceAgent(deps = {}) {
      if (!workspaceMode) return { state: 'skipped', reason: 'not a workspace hub' };
      if (!repoDir) return { state: 'skipped', reason: 'MAUDE_REPO_DIR is not set' };
      const make = deps.createWorkspaceAgent ?? createWorkspaceAgent;
      const seed = deps.seedRepo ?? seedRepo;
      const runner = deps.run ?? createGitRunner();

      const seeded = await seed(repoDir, runner, {
        url: process.env.MAUDE_SEED_REPO ?? '',
        branch: process.env.MAUDE_SEED_BRANCH ?? '',
      });
      // Recorded, not only logged — see bootReport. The reason is kept because
      // "the clone failed" without it sends the next person back to guessing.
      bootReport.seed = { state: seeded.state, reason: seeded.reason ?? null };
      if (seeded.state === 'failed') {
        // Loud, but not fatal. A cell that refuses to start on a bad seed URL
        // is a cell the operator cannot reach to fix the seed URL.
        console.error(`[hub] seed repo failed: ${seeded.reason}`);
      } else if (seeded.state === 'cloned') {
        console.log(`[hub] seeded workspace from ${seeded.url}`);
      }

      const agent = make({
        repoDir,
        designRel: process.env.MAUDE_DESIGN_ROOT ?? '.design',
        // Under accepted revisions a paired studio child is THE projector of
        // this checkout (T14); the agent then only commits.
        writesCheckout: () => !(studioPairingToken && accepted?.acceptedMode()),
        ...deps.options,
      });
      const started = await agent.start();
      bootReport.history = { state: started.state, reason: started.reason ?? null };
      if (started.state !== 'failed') workspace = agent;

      // Cloud Phase 19 — the mirror clock. Enabled only when this cell knows
      // its control plane; a self-hosted hub never ticks. The schedule asks
      // "is a mirror configured" each tick, so connecting one needs no restart.
      if (!mirror) {
        mirror = scheduleMirror({ repoDir, run: runner });
        if (mirror.enabled) console.log('[mirror] schedule armed');
      }
      // Phase 23 B2 — removals reach LIVE sessions. Same enablement rule as
      // the mirror clock: only a cell that knows its control plane ticks.
      if (!revocationSweep) {
        revocationSweep = scheduleRevocationSweep({
          dataDir,
          revokeForOwner: revokeTokensForOwner,
          kickLabel: (label) => kickSessionsForLabel(peers, label),
        });
        if (revocationSweep.enabled) console.log('[revocation] sweep armed');
      }
      return { ...started, seed: seeded.state };
    },
    /** Record the asset sweep's result for /health (see bootReport). */
    recordAssetSweep(summary) {
      bootReport.assets = summary;
    },
    /**
     * Record the bucket → checkout restore for /health.
     *
     * Kept SEPARATE from `assets` rather than folded into it: the two lanes
     * fail for different reasons and the operator question is different. A
     * non-zero `restored` is the visible symptom of an ephemeral checkout, and
     * it is the number that says how close this cell came to serving a project
     * full of grey boxes.
     */
    recordAssetHydrate(summary) {
      bootReport.assetsRestored = summary;
    },
    /**
     * Hand the boot sequence's sweeper to the proxy's post-upload hook (B3).
     *
     * It is built in `runAsMain()`, where the storage credentials resolve, and
     * consumed by a closure created here in `createHub()` — two different
     * function scopes, so this crosses the boundary explicitly. The first
     * attempt assigned straight across it, which in an ES module is not a
     * closure write but a `ReferenceError` on every cell boot with storage
     * configured. Caught by the linter, not by a test, and worth the sentence.
     */
    setWriteBehind(wb) {
      writeBehind = wb;
    },
    /** The file journal, or null on a hub with no checkout. Tests read it. */
    journal,
    /**
     * Arm the journal's durability + reconciliation, AFTER the port is bound.
     *
     * POST-BIND is not a detail. The first walk of a rehydrated checkout
     * re-hashes every file — the restore reset every mtime, so the sha cache
     * misses across the board — and `portReadyTimeoutMS` is already 30 minutes
     * because rehydrate runs before the hub binds. Putting a full hash pass in
     * front of the listener would make availability a function of project size
     * all over again. So the cell SERVES STALE UNTIL REPAIRED: the manifest
     * answers from whatever the journal already knows, and the walk corrects it
     * moments later.
     *
     * Two things start here:
     *   1. the R2 tail write-behind, subscribed to every append;
     *   2. the walk-import reconciler — once now, then on a slow belt.
     */
    async startJournalReconciler({ target, intervalMs = walkIntervalFromEnv() } = {}) {
      if (!journal || !journalDesignRoot) return { state: 'off', reason: 'no checkout' };
      journalTail = createJournalTail({ journal, target });
      // ONE append, two subscribers — durability and delivery. Neither may
      // fail the other, and neither may fail the write that already landed.
      journal.onAppend(() => {
        journalTail?.schedule();
        // Increment 2: tell every attached peer the journal moved. A cell's
        // own studio child is one of those peers, which is what closes the
        // container watcher gap — structurally, and for the WHOLE fleet rather
        // than for the one pilot tenant.
        filesPoke.schedule(journal.head());
      });

      // The reconciler is the TRUTH and the hooks are the optimization: a
      // git-level restore, a write site nobody hooked, or a class flip all
      // land here rather than being lost.
      const first = walkImport({ journal, designRoot: journalDesignRoot });
      if (first.appended > 0) await journalTail.flush();
      walkImportTimer = setInterval(() => {
        try {
          walkImport({ journal, designRoot: journalDesignRoot });
        } catch (err) {
          console.error(`[journal] walk-import pass failed: ${err.message}`);
        }
      }, intervalMs);
      walkImportTimer.unref?.();
      console.log(
        `[journal] armed — head ${journal.head()}, epoch ${journal.epoch().slice(0, 8)}, ` +
          `walk-import every ${intervalMs < 60_000 ? `${Math.round(intervalMs / 1000)} s` : `${Math.round(intervalMs / 60_000)} min`}${target ? ' + R2 tail' : ' (no object storage — no tail)'}`
      );
      return { state: 'on', head: journal.head(), imported: first.appended };
    },
    /** Land the tail inside the debounce window. The SIGTERM path needs this. */
    async stopJournal() {
      if (walkImportTimer !== null) {
        clearInterval(walkImportTimer);
        walkImportTimer = null;
      }
      filesPoke.stop();
      documentsPoke.stop();
      await journalTail?.stop();
      journalTail = null;
    },
    /** The poke emitter — tests assert its coalescing; /health counts frames. */
    filesPoke,
    /** Accepted revisions (DDR-241): kernel, fence, routes. */
    accepted,
    acceptedReady,
    projectStore,
    /** Flush the pending commit and detach. The SIGTERM path depends on this. */
    async stopWorkspaceAgent() {
      if (!workspace) return;
      const agent = workspace;
      workspace = null;
      const outcome = await agent.stop();
      if (outcome?.ok) console.log(`[workspace] flushed ${outcome.sha.slice(0, 8)} on shutdown`);
      else if (outcome && !outcome.ok) {
        console.error(`[workspace] shutdown flush did NOT commit: ${outcome.reason}`);
      }
    },
    /** Stop the backup schedule + close the rate store. Tests call this; the
     *  process exiting does the same thing in production. */
    stopBackgroundWork() {
      stopBackups();
      mirror?.stop();
      rateStore.close();
      if (walkImportTimer !== null) {
        clearInterval(walkImportTimer);
        walkImportTimer = null;
      }
    },
  };
}

// ----------------------------------------------------------------- /admin API

async function handleAdminApi(ctx) {
  const { request, response, dataDir, secret, peers, publicUrl, rateBuckets, rateLimit } = ctx;
  const { rateStore, clientIp } = ctx;
  const rateOpts = { store: rateStore, ip: clientIp?.(request) };
  const { activity, sqlitePath } = ctx;
  const url = new URL(request.url, 'http://x');
  const path = url.pathname.slice('/admin/api'.length); // '/status', '/tokens', …
  const method = request.method ?? 'GET';

  // /identity is unauthenticated — surfaces the hub's public URL + a stable
  // fingerprint so a claim-link victim can verify they're claiming the
  // expected hub (DDR-053 §7).
  if (method === 'GET' && path === '/identity') {
    respondAdminJson(response, 200, {
      publicUrl,
      version: HUB_VERSION,
      hostFingerprint: createHash('sha256').update(publicUrl).digest('hex').slice(0, 16),
    });
    return;
  }

  // /bootstrap is the only state-changing unauthenticated admin route — the
  // bootstrap key in the JSON body validates instead.
  if (method === 'POST' && path === '/bootstrap') {
    if (rateLimit && !checkRateLimit(rateBuckets, request, rateOpts)) {
      respondRateLimited(response);
      return;
    }
    return handleBootstrap({ request, response, dataDir });
  }

  if (!verifyAdminAuth(request, { hubSecret: secret, dataDir })) {
    // Consume budget on 401s — burst of wrong-auth → 429 (limits brute force).
    if (rateLimit && !checkRateLimit(rateBuckets, request, rateOpts)) {
      respondRateLimited(response);
      return;
    }
    respondAdminJson(response, 401, { error: 'unauthorized' });
    return;
  }

  // ---- everything below is ADMIN-BEARER-AUTHENTICATED ----

  // Cloud Phase 2 — user administration. Reached only past the Bearer gate
  // above; there is deliberately no path from a user password to this surface.
  if (
    path === '/users' ||
    path.startsWith('/users/') ||
    path === '/invites' ||
    path.startsWith('/invites/') ||
    // OIDC linking (Track C) — the admin control-plane for the pending queue.
    // Without this the /oidc/* routes 404, linking is unreachable, every
    // OIDC user stays pending forever, countLinkedOidc stays 0, and strict can
    // never boot. The whole feature authenticates people it can never admit.
    path === '/oidc/pending' ||
    path === '/oidc/link' ||
    path === '/oidc/approve' ||
    path === '/oidc/pending/dismiss'
  ) {
    const handled = await handleUserAdminRoutes({
      request,
      response,
      path,
      method,
      dataDir,
      publicUrl,
      respondJson: (status, payload) => respondAdminJson(response, status, payload),
      readJsonBody,
      kickLabel: (label) => kickSessionsForLabel(peers, label),
      pushActivity: (evt) => pushActivity(activity, evt),
    });
    if (handled) return;
    respondAdminJson(response, 404, { error: 'not found' });
    return;
  }

  if (method === 'GET' && path === '/status') {
    respondAdminJson(response, 200, {
      ...buildStatusPayload({
        dataDir,
        secret,
        port: ctx.port,
        startedAt: ctx.startedAt,
        peersCount: peers.size,
      }),
      // Phase 0 F5. The console's Overview reads this: an identity conflict
      // means backups are DISABLED for this hub, which is the one thing an
      // operator must not learn from a log six hours later.
      durability: ctx.durability ?? null,
    });
    return;
  }
  if (method === 'GET' && path === '/tokens') {
    respondAdminJson(response, 200, { tokens: listTokenLabels(dataDir) });
    return;
  }
  if (method === 'GET' && path === '/peers') {
    respondAdminJson(response, 200, {
      peers: Array.from(peers.values()).map((p) => ({
        socketId: p.socketId,
        documentName: p.documentName,
        user: p.user,
        scope: p.scope ?? null,
        connectedAt: p.connectedAt,
      })),
    });
    return;
  }
  // Kick a single live peer by socketId (per-connection disconnect). Distinct
  // from rotate (which kicks every session for a token label). DDR-053 §4.
  if (method === 'POST' && path === '/peers/kick') {
    try {
      const body = await readJsonBody(request);
      const socketId = String(body?.socketId ?? '');
      const peer = peers.get(socketId);
      if (!peer) {
        respondAdminJson(response, 404, { error: 'no such peer' });
        return;
      }
      try {
        peer.connection?.close?.();
      } catch {
        /* best-effort */
      }
      peers.delete(socketId);
      pushActivity(activity, {
        type: 'warn',
        user: peer.user,
        doc: `kicked from ${peer.documentName}`,
      });
      respondAdminJson(response, 200, { ok: true });
    } catch (err) {
      respondAdminJson(response, 400, { error: err.message });
    }
    return;
  }
  // Canvases browser — read the Hocuspocus SQLite `documents` table read-only.
  // `canvases` stays a flat list (unchanged wire shape for existing admin
  // clients); `groups` adds the DDR-192 §5 workspace/branch grouping. Legacy
  // flat slugs are not hidden — they collect in one `legacy: true` group, so a
  // hub mid-rollout shows both kinds at once instead of appearing to lose docs.
  if (method === 'GET' && path === '/canvases') {
    const canvases = listCanvases(sqlitePath, peers);
    respondAdminJson(response, 200, { canvases, groups: groupCanvases(canvases) });
    return;
  }
  // Activity feed — newest-first slice of the in-memory ring buffer.
  if (method === 'GET' && path === '/activity') {
    respondAdminJson(response, 200, { activity: (activity ?? []).slice().reverse() });
    return;
  }
  // Settings — GET reads identity + persisted name/description; POST persists
  // the editable bits (name/description) atomically.
  if (method === 'GET' && path === '/settings') {
    const stored = readSettings(dataDir);
    const { tokens } = readTokens(dataDir);
    respondAdminJson(response, 200, {
      name: stored.name,
      description: stored.description,
      publicUrl,
      transport: ctx.insecureHttp ? 'plaintext HTTP (dev)' : 'TLS upstream',
      dataDir,
      authMode: tokens.length > 0 ? 'tokens' : secret ? 'env-secret' : 'dev',
      // WHICH IDENTITY MODE THIS CELL IS ACTUALLY IN.
      //
      // `authMode` above describes the token STORE and says nothing about
      // whether local passwords are still a door. The 2026-07-30 validate
      // found every retirement gated on `strict` while the whole fleet ran
      // hybrid — the code was shipped, the behaviour was not, and there was
      // no way to see that from outside. A mode nobody is in is not shipped,
      // so the mode is now a fact you can read.
      identity: identityPosture(),
      version: HUB_VERSION,
    });
    return;
  }
  if (method === 'POST' && path === '/settings') {
    try {
      const body = await readJsonBody(request);
      const saved = writeSettings(dataDir, { name: body?.name, description: body?.description });
      respondAdminJson(response, 200, { ok: true, ...saved });
    } catch (err) {
      respondAdminJson(response, 400, { error: err.message });
    }
    return;
  }
  // Danger zone — rotate the admin secret (signs every device out). High blast
  // radius: the new value is NOT returned (operator re-claims via bootstrap /
  // HUB_SECRET). DDR-097.
  if (method === 'POST' && path === '/admin-secret/rotate') {
    try {
      // Body is unused, but route it through readJsonBody for the same
      // Content-Type + proto-pollution guard the other POST routes get
      // (defense-in-depth consistency — DDR-053 §5).
      await readJsonBody(request);
    } catch (err) {
      respondAdminJson(response, 400, { error: err.message });
      return;
    }
    rotateAdminSecret(dataDir);
    pushActivity(activity, { type: 'warn', user: 'admin', doc: 'admin secret rotated' });
    respondAdminJson(response, 200, { ok: true, reauth: true });
    return;
  }
  if (method === 'POST' && path === '/token') {
    try {
      const body = await readJsonBody(request);
      const label = String(body?.label ?? '').trim();
      assertValidLabel(label);
      // scope optional; default = label (DDR-053 §3). '*' = wildcard opt-in.
      const scope = body?.scope === undefined ? undefined : String(body.scope).trim();
      const record = addToken(dataDir, { label, scope });
      pushActivity(activity, {
        type: 'token',
        user: label,
        doc: `invite issued · scope ${record.scope ?? '*'}`,
      });
      respondAdminJson(response, 201, formatInviteResponse(record, publicUrl));
    } catch (err) {
      respondAdminJson(response, 400, { error: err.message });
    }
    return;
  }
  if (method === 'POST' && path === '/token/rotate') {
    try {
      const body = await readJsonBody(request);
      const label = String(body?.label ?? '').trim();
      assertValidLabel(label);
      const record = rotateToken(dataDir, label);
      // DDR-053 §4: kick existing WS sessions for the rotated label so dwell
      // time on a compromised token is bounded by rotate latency, not by the
      // attacker's choice to never disconnect.
      const disconnected = kickSessionsForLabel(peers, label);
      pushActivity(activity, {
        type: 'warn',
        user: label,
        doc: `token rotated — ${disconnected} session${disconnected === 1 ? '' : 's'} kicked`,
      });
      respondAdminJson(response, 200, { ...formatInviteResponse(record, publicUrl), disconnected });
    } catch (err) {
      const status = err.message.startsWith('no token') ? 404 : 400;
      respondAdminJson(response, status, { error: err.message });
    }
    return;
  }
  if (method === 'POST' && path === '/token/delete') {
    try {
      const body = await readJsonBody(request);
      const label = String(body?.label ?? '').trim();
      assertValidLabel(label);
      removeToken(dataDir, label);
      // Kick live sessions that authenticated with the deleted token (DDR-053 §4).
      const disconnected = kickSessionsForLabel(peers, label);
      pushActivity(activity, {
        type: 'warn',
        user: label,
        doc: `token deleted — ${disconnected} session${disconnected === 1 ? '' : 's'} kicked`,
      });
      respondAdminJson(response, 200, { ok: true, disconnected });
    } catch (err) {
      const status = err.message.startsWith('no token') ? 404 : 400;
      respondAdminJson(response, status, { error: err.message });
    }
    return;
  }

  respondAdminJson(response, 404, { error: 'not found' });
}

async function handleBootstrap({ request, response, dataDir }) {
  try {
    const body = await readJsonBody(request);
    const key = String(body?.key ?? '').trim();
    if (!key) {
      respondAdminJson(response, 400, { error: 'key required' });
      return;
    }
    if (!verifyAndConsume(dataDir, key)) {
      respondAdminJson(response, 401, { error: 'invalid or expired bootstrap key' });
      return;
    }
    let adminSecret = readAdminSecret(dataDir);
    if (!adminSecret) {
      adminSecret = generateAdminSecret();
      writeAdminSecret(dataDir, adminSecret);
    }
    respondAdminJson(response, 200, { secret: adminSecret });
  } catch (err) {
    respondAdminJson(response, 400, { error: err.message });
  }
}

/** Escape HTML metacharacters for safe interpolation into server-rendered HTML. */
function escapeHtmlAttr(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/**
 * Minimal landing page served at `/`. Links the admin stylesheet + reuses its
 * classes (no inline styles — the CSP `style-src 'self'` drops those). The
 * sparkle uses presentation attributes (fill=), which the CSP allows.
 */
/**
 * Prettify a tenant slug for display: `brno-alligators` → `Brno Alligators`.
 * Only ever a FALLBACK — a real name always wins.
 */
/**
 * The cell's identity posture, as a fact rather than a claim.
 *
 * `mode`      off | hybrid | strict — what the door actually accepts.
 * `localDoor` whether a password on THIS cell can still sign somebody in.
 * `seeded`    whether an initial admin password was planted at provision.
 *
 * Read by a fleet sweep, so "is anybody actually in strict yet" stops being
 * a question you answer by reading deployment scripts.
 */
function identityPosture() {
  const raw = process.env.MAUDE_CLOUD_IDENTITY ?? '';
  const mode = raw === 'strict' ? 'strict' : raw === '1' ? 'hybrid' : 'off';
  return {
    mode,
    localDoor: mode !== 'strict',
    seeded: Boolean(process.env.MAUDE_ADMIN_EMAIL),
  };
}

function nameFromSlug(slug) {
  return String(slug)
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function renderLanding(
  settings,
  {
    dashboardUrl = process.env.HUB_DASHBOARD_URL,
    tenantId = process.env.MAUDE_TENANT_ID,
    projectName = process.env.MAUDE_PROJECT_NAME,
  } = {}
) {
  // Precedence, most-specific first. The bug this replaces was a defaulting
  // one, not a rendering one: the caller passed `readSettings().name`, which
  // ALREADY substitutes "Studio Hub" when no settings file exists — and a
  // truthy default meant the tenant could never win. A customer opening their
  // own project was greeted by a generic placeholder. `settings` now arrives
  // whole so this function, which is the one that knows about tenants, gets
  // to decide.
  const operatorNamed = settings?.name && settings.name !== DEFAULT_HUB_NAME ? settings.name : null;
  const display =
    operatorNamed ?? projectName ?? (tenantId ? nameFromSlug(tenantId) : null) ?? DEFAULT_HUB_NAME;
  const name = escapeHtmlAttr(display);
  // Two audiences, one page (Phase 23 B5). A PLATFORM cell speaks to the
  // customer: their project's name, the way back to their dashboard, and the
  // operator console demoted to a footnote — "self-hosted sync · Yjs +
  // Hocuspocus" is infrastructure vocabulary a paying customer was promised
  // never to see. A self-hosted hub (no dashboard URL) keeps the operator
  // landing unchanged.
  const isPlatform = Boolean(dashboardUrl && tenantId);
  const sub = isPlatform ? 'your Maude Cloud project' : 'self-hosted sync · Yjs + Hocuspocus';
  const cta = isPlatform
    ? `<a class="btn btn--primary btn--lg" href="${escapeHtmlAttr(dashboardUrl)}">Open your dashboard →</a>
    <p class="landing-footnote"><a class="landing-footnote-link" href="admin">operator console</a></p>`
    : `<a class="btn btn--primary btn--lg" href="admin">Open admin console →</a>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${name}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHBhdGggZD0iTTcgMEgyNUE3IDcgMCAwIDEgMzIgN1YzMkg3QTcgNyAwIDAgMSAwIDI1VjdBNyA3IDAgMCAxIDcgMFoiIGZpbGw9IiM2ZDVlZjUiLz48cGF0aCBkPSJNMTYgNWwyLjggOC4yTDI3IDE2bC04LjIgMi44TDE2IDI3bC0yLjgtOC4yTDUgMTZsOC4yLTIuOHoiIGZpbGw9IiNmZmYiLz48L3N2Zz4=">
  <link rel="stylesheet" href="admin/style.css">
</head>
<body>
<div class="maude landing dotted">
  <div class="landing-card">
    <span class="mark mark--lg" aria-hidden="true"><svg class="mark-ic" viewBox="0 0 32 32" fill="currentColor"><path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z"/></svg></span>
    <h1>${name}</h1>
    <p class="landing-sub">${sub}</p>
    <p class="landing-status"><span class="presence-dot presence-dot--online" aria-hidden="true"></span> online</p>
    ${cta}
  </div>
</div>
</body>
</html>`;
}

function formatInviteResponse(record, publicUrl) {
  return {
    label: record.label,
    token: record.value,
    scope: record.scope ?? '*',
    createdAt: record.createdAt,
    command: `maude design link ${publicUrl} --token=${record.value}`,
  };
}

/**
 * What the workspace half of this hub actually did at boot.
 *
 * A CELL HAS NO CONSOLE. Its stdout goes nowhere an operator can reach —
 * `wrangler tail` shows the Worker's logs, not the container's — so during
 * Cloud Phase 15 the only way to answer "did the seed clone work?" was to
 * infer it from whether objects appeared in a bucket ten minutes later. That
 * is not a diagnosis, it is a guess.
 *
 * Deliberately FACTS, not internals: counts and states, no paths, no URLs, no
 * credentials. Safe on the unauthenticated /health, which is the whole point —
 * the moment you need it, authenticating is the thing that is broken.
 */
/** Past this, a lock is not an operation in flight — it is a corpse. */
export const STALE_GIT_LOCK_MS = 60_000;

/**
 * Is a git operation in flight, stuck, or absent — as a fact, not a guess.
 *
 * `mtime` rather than `ctime` because git touches the lock as it works, so a
 * long-but-live operation keeps looking live; and the age is reported next to
 * the verdict so a reader can disagree with the threshold.
 */
export function gitLockState(repoDir, { now = Date.now, stat = statSync } = {}) {
  try {
    const st = stat(join(repoDir, '.git', 'index.lock'));
    const ageMs = Math.max(0, Math.round(now() - st.mtimeMs));
    return { present: true, ageMs, stale: ageMs > STALE_GIT_LOCK_MS };
  } catch {
    return { present: false };
  }
}

function workspaceStatus() {
  const repoDir = process.env.MAUDE_REPO_DIR;
  if (!repoDir) return null;
  const designRoot = join(repoDir, process.env.MAUDE_DESIGN_ROOT ?? '.design');
  const out = {
    checkout: existsSync(join(repoDir, '.git')) ? 'present' : 'absent',
    seedConfigured: Boolean(process.env.MAUDE_SEED_REPO),
    storageConfigured: Boolean(process.env.MAUDE_S3_BUCKET),
    // What each stage of the boot actually DID. `seedConfigured` says a seed
    // was asked for; `seed` says whether it happened, and why not when it did
    // not. Distinguishing those two is the whole point — a cell whose seed was
    // configured and silently skipped looks identical to one that worked.
    ...(bootReport.seed ? { seed: bootReport.seed } : {}),
    ...(bootReport.history ? { history: bootReport.history } : {}),
    ...(bootReport.assets ? { assets: bootReport.assets } : {}),
    // Present only when this boot actually had to refill the checkout from the
    // bucket — i.e. when the instance came up with assets missing. Absent is
    // the healthy steady state; a non-zero `restored` is the operator's signal
    // that the checkout is being lost across migrations and how badly.
    ...(bootReport.assetsRestored ? { assetsRestored: bootReport.assetsRestored } : {}),
    // D5 — A STUCK GIT LOCK IS INVISIBLE UNTIL THE HISTORY IS ALREADY GONE.
    // `index.lock` is how git says "an operation is in flight"; left behind by
    // a killed process it means every subsequent commit fails, so the cell
    // keeps serving, the customer keeps working, and nothing is being SAVED.
    // The tell is age: a lock a second old is a commit happening, a lock ten
    // minutes old is a commit that never will.
    //
    // Reported, and deliberately NOT part of `ok`. Failing health here would
    // take the cell out of rotation and make an unreachable project out of one
    // whose history is merely stuck — worse for the tenant on every axis. This
    // is for whoever is looking, and for the alert that should page rather than
    // reroute.
    gitLock: gitLockState(repoDir),
  };
  try {
    const walk = (dir, depth = 0) => {
      if (depth > 3) return 0;
      let n = 0;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('_') || e.name === '.git') continue;
        if (e.isDirectory()) n += walk(join(dir, e.name), depth + 1);
        else if (e.name.endsWith('.tsx')) n += 1;
      }
      return n;
    };
    out.canvases = walk(designRoot);
  } catch {
    out.canvases = 0;
  }
  return out;
}

/** The token label the loopback pairing credential is stored under. */
export const LOOPBACK_SYNC_TOKEN_LABEL = 'cell-loopback-sync';

/**
 * Mint the credential the studio child uses to sync to THIS hub over loopback —
 * desktop ↔ cloud live pairing (variant C2).
 *
 * Returns null (pairing simply does not engage) unless `MAUDE_CELL_PAIRING` is
 * set. That is the pilot switch: it is a cell-config variable, so a fleet that
 * has not been rolled to pairing behaves exactly as it did before, and rolling
 * back is deleting a variable rather than shipping code.
 *
 * WHY A STORE TOKEN AND NOT `HUB_SECRET`. The child's environment is deliberately
 * minimal (see `childEnv`) precisely so that a process which handles tenant-shaped
 * requests does not hold the hub's admin bearer. `HUB_SECRET` unlocks `/internal/*`,
 * the admin API and every document; this unlocks documents only. Handing over the
 * admin secret to buy a Yjs connection would trade away the reason the minimal
 * environment exists.
 *
 * WHY SCOPE `*`. Document scopes bind a token to one project (DDR-053 §3), and a
 * cell hub holds exactly one tenant's project — the container boundary already
 * IS the scope. Narrowing further would mean guessing the wire namespace
 * (`ws/<workspace-id>/<branch>/…`, which depends on the tenant's own config and
 * their current branch) and silently failing to sync whenever the guess was
 * wrong, which is the failure this whole feature is fixing.
 *
 * Minted fresh on every boot: `addToken` is `INSERT OR REPLACE` by label, so the
 * previous value is invalidated rather than accumulated, and the raw value exists
 * only long enough to be handed to the child we are about to spawn.
 */
export function mintLoopbackSyncToken(dataDir, env = process.env) {
  if (!/^(1|true|on|yes)$/i.test(env.MAUDE_CELL_PAIRING ?? '')) return null;
  try {
    const record = addToken(dataDir, {
      label: LOOPBACK_SYNC_TOKEN_LABEL,
      scope: '*',
      // No `owner`. An owner address is what `afterStoreDocument` attributes a
      // commit to, and inventing one here would sign the tenant's git history
      // with a machine identity dressed up as a person.
    });
    console.log('[hub] live pairing ON — minted the studio child a loopback sync credential.');
    return record.value;
  } catch (err) {
    // A cell that cannot mint still serves; it just does not pair. Failing the
    // boot over a collaboration feature would trade a degraded cell for a dead one.
    console.error(`[hub] could not mint the loopback sync token — pairing off: ${err.message}`);
    return null;
  }
}

/**
 * Does this caller hold the cell's own secret?
 *
 * Constant-time, and false whenever no secret is configured — a self-hosted
 * hub with no HUB_SECRET must not accidentally treat every caller as the
 * control plane. The same value `cell-ops.mjs` presents OUTBOUND to
 * `/internal/*`, used inbound here.
 */
function presentsCellSecret(request, secret) {
  if (!secret) return false;
  const offered = String(request?.headers?.authorization ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (offered.length === 0 || offered.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(offered), Buffer.from(secret));
  } catch {
    return false;
  }
}

function buildStatusPayload({
  dataDir,
  secret,
  port,
  startedAt,
  peersCount,
  exposeDataDir = true,
  studio = null,
  stats = null,
  render = null,
  capabilities = null,
}) {
  const { tokens } = readTokens(dataDir);
  const workspace = workspaceStatus();
  // Cloud Phase 27 A1/D5 — A CONTAINER THAT ANSWERS 200 WHILE HALF-DEAD IS
  // WORSE THAN ONE THAT IS DOWN. The hub process being fine says nothing about
  // the studio the customer actually opens, so `ok` is the AND of both. The
  // router then stops sending here, which is the entire point of a health probe
  // and exactly what the last outage's monitor failed to do.
  const studioStatus = studio ? studio.status() : null;
  // D5 — DEEP, CONTENT-ADDRESSED HEALTH. "Something answered 200" is what the
  // last outage's monitor checked, and the rollback that followed went to a tag
  // whose contents CI had overwritten. So health names the BYTES: is the client
  // this cell would serve the client this image was built with.
  const identity = studioStatus ? identityForHealth(studioIdentityPaths()) : null;
  return {
    ok: studioStatus ? studioStatus.ok && identity?.ok !== false : true,
    version: HUB_VERSION,
    // WHICH RELEASE THIS IMAGE IS, beside the hash that says which BYTES it is.
    // They are not redundant — see the header of bundle-identity.mjs. The hash
    // catches "same tag, different bytes"; only the version catches "the layer
    // underneath was built from the previous release", which is how a cell
    // image tagged v0.57.0 shipped a v0.56.0 hub with every workflow green.
    //
    // Read from the studio manifest the client is served from, falling back to
    // the hub's own — one release line, two layers, and a disagreement between
    // them is itself the signal.
    releaseVersion: releaseVersion(),
    uptimeMs: Date.now() - startedAt,
    port,
    // `dataDir` is a server filesystem path — only included for authenticated
    // callers (/admin/api/status). The unauthenticated /health omits it.
    ...(exposeDataDir ? { dataDir } : {}),
    tokenCount: tokens.length,
    authMode: tokens.length > 0 ? 'tokens' : secret ? 'env-secret' : 'dev',
    identity: identityPosture(),
    // What protocol features this hub HAS. Omitted (not empty-arrayed) when the
    // caller did not compute it, so "this hub predates capabilities" stays
    // distinguishable from "this hub has none" — the same
    // omitted-when-unknown rule the stats block follows.
    ...(capabilities ? { capabilities } : {}),
    peersCount: peersCount ?? 0,
    // OMITTED when unknown, never zeroed. A cell on an older image, or one
    // whose studio is not up, must stay distinguishable from a project with no
    // canvases in it — the operator board renders `—` for the first and `0`
    // for the second (Cloud Phase 26).
    ...(stats || render ? { stats: { ...(stats ?? {}), ...(render ? { render } : {}) } } : {}),
    ...(workspace ? { workspace } : {}),
    ...(studioStatus
      ? {
          studio: {
            ok: studioStatus.ok,
            state: studioStatus.state,
            port: studioStatus.port,
            restarts: studioStatus.restarts,
            // The exit code is what an operator reads first, and omitting it
            // turns "why did it die" into a log hunt.
            lastExit: studioStatus.lastExit,
          },
          ...(identity ? { client: identity } : {}),
        }
      : {}),
  };
}

/**
 * Where the client artifacts and the image's record of them live.
 *
 * `MAUDE_STUDIO_SRC` is what the image sets when it stages the studio;
 * `MAUDE_IMAGE_MANIFEST_DIR` is where it wrote the seal. Both default to
 * layouts a dev checkout has, so this is inspectable locally.
 */
/**
 * The release line this image was cut from.
 *
 * `/health` is DELIBERATELY UNAUTHENTICATED — it is what an operator reads when
 * auth is the thing that is broken. A release version is not a secret (the git
 * tag is public, the npm package is public), so it belongs here. Nothing else
 * was added while in there.
 */
function releaseVersion() {
  return readStudioReleaseVersion(studioIdentityPaths().studioRoot) ?? HUB_VERSION;
}

function studioIdentityPaths(env = process.env) {
  const studioRoot = env.MAUDE_STUDIO_SRC ?? resolve(process.cwd(), '..', 'studio');
  return { studioRoot, manifestDir: env.MAUDE_IMAGE_MANIFEST_DIR ?? '/app' };
}

// --------------------------------------------------------- the browser session

/**
 * Who is asking, and what they may do — Cloud Phase 27 A3.
 *
 * The session is a COOKIE over the same peer token the desktop holds as a
 * bearer: one token store, one expiry, one read-only capability, because a
 * second session type would be a second place for the role model to drift.
 *
 * The ROLE is derived here and travels with every proxied request. That is the
 * change Phase 27 makes: the studio's own gate reads a per-PROCESS file, which
 * is one role per hub URL — correct for a desktop with one user, wrong for one
 * cell serving an owner and a viewer at the same time.
 *
 * Returns `null` for anything it cannot positively verify. Every branch here
 * fails closed on purpose (A4): the local gate this replaces returns `false`
 * (i.e. writable) from its own `catch`, which is correct for a local tool and is
 * the whole ballgame on the internet.
 */
function browserSession(dataDir, secret, request) {
  const cookieToken = cookieValue(request, BROWSER_SESSION_COOKIE);
  if (!cookieToken) return null;
  let match;
  try {
    match = verifyToken(dataDir, cookieToken, secret);
  } catch {
    return null;
  }
  if (!match?.owner) return null;
  // TWO ROLE VOCABULARIES MEET HERE, AND THEY ARE NOT THE SAME ONE.
  //
  // A token can carry an ACCOUNT role (`admin`) while this function must
  // produce a PROJECT role (`owner` / `member` / `viewer`, the role matrix's).
  // The translation happens at the DOOR (`browser-auth.mjs`), which is the only
  // place that knows which vocabulary it was handed; what is stored on the
  // token is therefore already a project role, and anything else is not one.
  //
  // A SESSION WITHOUT A STORED ROLE IS STALE, NOT A GUESS TO BE MADE.
  //
  // The role column shipped after these cookies did, so an older session has
  // only the one-bit `read_only` projection — and if that bit was computed by
  // the buggy translation it says `viewer` for a project's owner, permanently:
  // the capability was frozen at mint, the cookie lives 12 hours, `/data` is a
  // volume that survives every deploy, and the studio offers no way out. That
  // is exactly what happened, and re-deriving `member` from `read_only = 0`
  // would ALSO have been a guess — a quieter one, in the escalating direction.
  //
  // So an unrecognised role on a browser session is treated as no session at
  // all. The person is sent back through the door they came in by and gets a
  // correctly-minted one. Refusing costs a sign-in; guessing costs either the
  // owner's own project or somebody else's write access.
  const role = ROLES.includes(match.role) ? match.role : null;
  if (!role) return null;
  return {
    email: match.owner,
    role,
    readOnly: isReadOnlyRole(role),
    sessionKey: sessionKeyFor(process.env.MAUDE_TENANT_ID ?? 'local', match.owner, (input) =>
      createHash('sha256').update(input).digest('hex')
    ),
  };
}

/**
 * The studio's SEGREGATED canvas listener, which binds an OS-assigned port and
 * publishes it in `_server.json`. Read per call rather than cached: the child
 * restarts, and a cached port after a restart is a proxy pointing at nothing.
 */
function canvasUpstreamStatus(studio) {
  const status = studio?.status();
  if (!status?.ok) return { ok: false, port: null };
  const designRoot = designRootFor();
  if (!designRoot) return { ok: false, port: null };
  try {
    const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
    return info?.canvasPort ? { ok: true, port: info.canvasPort } : { ok: false, port: null };
  } catch {
    return { ok: false, port: null };
  }
}

// ------------------------------------------------------------ session kicker

/**
 * Force-close every connection whose context.user.name matches `label`.
 * Returns the count of closed sessions.
 */
function kickSessionsForLabel(peers, label) {
  let count = 0;
  for (const [socketId, peer] of peers.entries()) {
    if (peer.user !== label) continue;
    try {
      peer.connection?.close?.();
    } catch {
      /* best-effort */
    }
    peers.delete(socketId);
    count++;
  }
  return count;
}

// --------------------------------------------------------- activity feed

/**
 * Append an event to the bounded ring buffer (DDR-097). Fields are run through
 * the log sanitizer + clamped so a hostile documentName / label can't inflate
 * the buffer or smuggle control chars into the console feed. NEVER pass a token
 * VALUE here — only labels / doc names / human-readable summaries.
 */
function pushActivity(activity, { type, user, doc }) {
  if (!Array.isArray(activity)) return;
  activity.push({
    type: String(type),
    user: sanitizeForLog(user).slice(0, 120),
    doc: sanitizeForLog(doc).slice(0, 200),
    at: Date.now(),
  });
  while (activity.length > ACTIVITY_CAP) activity.shift();
}

// --------------------------------------------------------- canvases browser

const sqliteRequire = createRequire(import.meta.url);
/** Lazily resolve better-sqlite3 (a runtime-external native binding). */
let BetterSqlite3 = null;
function loadSqlite() {
  if (BetterSqlite3 === null) {
    try {
      BetterSqlite3 = sqliteRequire('better-sqlite3');
    } catch {
      BetterSqlite3 = false;
    }
  }
  return BetterSqlite3 || null;
}

/** Build the peer-count-per-document map from the live peers Map. */
function peerCountsByDoc(peers) {
  const counts = new Map();
  for (const p of peers.values()) {
    counts.set(p.documentName, (counts.get(p.documentName) ?? 0) + 1);
  }
  return counts;
}

function docsFromPeers(peerCounts) {
  return Array.from(peerCounts.entries()).map(([name, count]) => ({
    name,
    bytes: 0,
    peers: count,
  }));
}

/**
 * Read the Hocuspocus SQLite `documents` table READ-ONLY and join the live peer
 * count per document. The extension schema is:
 *   CREATE TABLE "documents" ("name" varchar, "data" blob, UNIQUE(name))
 * There are NO timestamp columns — size is `length(data)`; activity is the
 * joined live peer count (DDR-097). Defensive: never mutates, never 500s — a
 * missing table (no syncs yet) / lock / schema drift falls back to the
 * peer-derived view.
 */
function listCanvases(sqlitePath, peers) {
  const peerCounts = peerCountsByDoc(peers);
  if (!sqlitePath || !existsSync(sqlitePath)) return docsFromPeers(peerCounts);
  const Database = loadSqlite();
  if (!Database) return docsFromPeers(peerCounts);

  let db;
  try {
    db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    const rows = db.prepare('SELECT name, length(data) AS bytes FROM "documents"').all();
    // Union persisted docs (with size) with currently-active peer docs that
    // may not be persisted yet (size 0 until the extension stores them). This
    // keeps a live-but-unsaved canvas visible. Keyed by name; sorted by name.
    const byName = new Map();
    for (const r of rows) {
      const name = String(r.name);
      // Enforce the documentName charset at the READ boundary too — onAuthenticate
      // gates live WS auth, but rows could predate that guard (upgrade) or arrive
      // via another write path. Don't surface a name that isn't regex-clean into
      // the admin DOM (defense-in-depth alongside client escaping).
      if (!DOCUMENT_NAME_REGEX.test(name)) continue;
      byName.set(name, {
        name,
        bytes: typeof r.bytes === 'number' ? r.bytes : 0,
        peers: peerCounts.get(name) ?? 0,
      });
    }
    for (const [name, count] of peerCounts) {
      if (!byName.has(name)) byName.set(name, { name, bytes: 0, peers: count });
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return docsFromPeers(peerCounts);
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Delete one document: tombstone it, drop the live copy, drop the persisted row.
 *
 * ORDER IS LOAD-BEARING. The tombstone is written FIRST, because it is the only
 * step that survives a crash halfway through. A hub that recorded the tombstone
 * and then died leaves a row in `documents` that peers already know to ignore
 * and re-delete; a hub that dropped the row first and then died has forgotten
 * the deletion entirely, and the next peer to connect uploads the canvas again
 * from its own disk. One of those converges and one resurrects.
 *
 * CLOSE THE LIVE DOCUMENT BEFORE DELETING THE ROW. A connected peer holds the
 * canvas in memory, and the Hocuspocus store hook writes it back on the next
 * update or on unload — so deleting the row underneath a live document just
 * re-creates it moments later. `closeConnections` drops the peers and
 * `unloadDocument` releases the in-memory copy; both are best-effort, since a
 * document nobody has open is the normal case and must not error.
 *
 * Every step is independently guarded: this route's promise to the caller is
 * "the tombstone is recorded", which is what actually stops the resurrection.
 * A locked SQLite file costs a stale row, not a failed delete.
 */
function deleteDocument({ name, server, sqlitePath, dataDir }) {
  try {
    recordTombstone(dataDir, name);
  } catch {
    /* a store we cannot write is reported by the absent tombstone, not a 500 */
  }
  try {
    server?.closeConnections?.(name);
  } catch {
    /* nobody connected */
  }
  try {
    server?.unloadDocument?.(server?.documents?.get?.(name));
  } catch {
    /* not loaded */
  }
  deleteDocumentRow(sqlitePath, name);
}

/**
 * Remove one row from the Hocuspocus `documents` table.
 *
 * The read path (`listCanvases`) opens this file read-only and documents the
 * schema; this is the one place that writes to it. Defensive in the same shape:
 * a missing file / absent native binding / lock never throws, because the
 * tombstone is what the caller was promised.
 */
function deleteDocumentRow(sqlitePath, name) {
  if (!sqlitePath || !existsSync(sqlitePath)) return;
  const Database = loadSqlite();
  if (!Database) return;
  let db;
  try {
    db = new Database(sqlitePath, { fileMustExist: true });
    db.prepare('DELETE FROM "documents" WHERE name = ?').run(name);
  } catch {
    /* stale row is recoverable; a thrown delete is not */
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

// ----------------------------------------------------------- rate limiter

/**
 * Per-IP token bucket. Returns true when the request is within budget.
 * Per DDR-053 §6 — in-memory only (single-process hub), 5 req / 60s.
 *
 * X-Forwarded-For intentionally not trusted in v1.1 — operators behind a
 * proper reverse proxy get accurate buckets in Task 6 when trustProxy lands.
 */
function checkRateLimit(buckets, request, { store = null, ip: resolvedIp } = {}) {
  const ip = resolvedIp ?? request.socket?.remoteAddress ?? '0.0.0.0';
  // When a persistent store is wired, it IS the limiter — the in-memory bucket
  // below stays only as the fallback path (and for the pure-unit tests that
  // call this without a store).
  if (store) return store.check(`http:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  const now = Date.now();
  // Opportunistic eviction (~1% of calls) so a long-running hub doesn't
  // accumulate entries for one-shot IPs (botnet / IPv6 rotation). Cheap.
  if (Math.random() < 0.01) {
    for (const [key, b] of buckets) {
      if (now - b.windowStart >= RATE_LIMIT_WINDOW_MS) buckets.delete(key);
    }
  }
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

/**
 * Connection-auth rate limit (Task 6, redesigned in DDR-102). Returns true
 * when the key is within budget (`max` auths per 60s window). Keyed by token
 * LABEL for valid auths (default ceiling CONN_RATE_LIMIT_MAX, generous) and
 * by IP for invalid attempts (INVALID_CONN_RATE_LIMIT_MAX, tight).
 * Exported for unit testing — the production caller is onAuthenticate.
 */
export function checkConnRateLimit(buckets, key, max = CONN_RATE_LIMIT_MAX) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

function respondRateLimited(response) {
  const body = JSON.stringify({ error: 'rate limit exceeded' });
  response.writeHead(429, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Retry-After': '60',
    'Content-Length': Buffer.byteLength(body),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(body);
}

/** Sugar — admin-API JSON responses always opt into the hardened header set. */
function respondAdminJson(response, status, payload) {
  return respondJson(response, status, payload, { hardenAdminOrigin: true });
}

// ------------------------------------------------------------- HTTP helpers

const ADMIN_HARDENED_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function respondJson(response, status, payload, { hardenAdminOrigin = false } = {}) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  };
  if (hardenAdminOrigin) {
    for (const [k, v] of Object.entries(ADMIN_HARDENED_HEADERS)) {
      // Don't let the bundle clobber Content-Type / Cache-Control on a JSON
      // response (it currently shares Cache-Control with us — both 'no-store').
      if (k !== 'Content-Type' && k !== 'Cache-Control') headers[k] = v;
    }
  }
  response.writeHead(status, headers);
  response.end(body);
}

function respondAsset(response, body, contentType, { hardenAdminOrigin = false } = {}) {
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...(hardenAdminOrigin ? ADMIN_HARDENED_HEADERS : {}),
  };
  // Avoid duplicate Content-Type from spread above
  headers['Content-Type'] = contentType;
  response.writeHead(200, headers);
  response.end(body);
}

/**
 * Read + parse a JSON body. Per DDR-053 §5:
 *   - Enforces Content-Type: application/json (rejects text/plain etc.).
 *   - 64 KB max payload.
 *   - 15 s request timeout (defeats slow-POST DoS).
 *   - Rejects bodies containing __proto__ / constructor / prototype keys
 *     (proto-pollution defense-in-depth).
 */
async function readJsonBody(request, { maxBytes = 64 * 1024, timeoutMs = 15_000 } = {}) {
  const contentType = (request.headers?.['content-type'] ?? '').toString().toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new Error('Content-Type must be application/json');
  }
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let total = 0;
    const onTimeout = () => {
      try {
        request.destroy();
      } catch {
        /* ignore */
      }
      reject(new Error('request body timeout'));
    };
    try {
      request.setTimeout?.(timeoutMs, onTimeout);
    } catch {
      /* best-effort */
    }
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        request.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (total === 0) return resolveBody({});
      const raw = Buffer.concat(chunks).toString('utf8');
      if (/"\s*(?:__proto__|constructor|prototype)\s*"\s*:/.test(raw)) {
        reject(new Error('reserved property name in body'));
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`invalid JSON body: ${err.message}`));
      }
    });
    request.on('error', reject);
  });
}

/** Strip CR/LF/control chars and clamp length. Use for any user-controlled
 * value that lands in console.log lines (defends against log forging). */
/**
 * Short-circuit Hocuspocus' default `200 Welcome to Hocuspocus!` writer.
 * Its requestHandler swallows falsy throws (`if (error) throw error;`) — this
 * is the framework's documented bail-from-onRequest contract.
 */
function bailFromOnRequest() {
  // eslint-disable-next-line no-throw-literal
  throw null;
}

// ------------------------------------------------------------------- main

/** Run the hub as a CLI process. */
async function runAsMain() {
  const port = Number.parseInt(process.env.PORT ?? '1234', 10);
  const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), 'data');
  const secret = process.env.HUB_SECRET ?? '';
  const insecureHttp = process.env.HUB_INSECURE_HTTP === '1';
  const publicUrl =
    process.env.HUB_PUBLIC_URL ?? `http${insecureHttp ? '' : 's'}://localhost:${port}`;
  const rateLimit = process.env.HUB_ADMIN_RATE_LIMIT !== 'off';
  // DDR-102 — valid-token auth ceiling override (per label per minute).
  const connRateLimitEnv = Number.parseInt(process.env.HUB_CONN_RATE_LIMIT ?? '', 10);
  const connRateLimit = Number.isFinite(connRateLimitEnv) ? connRateLimitEnv : undefined;
  // RCA 2026-08-11 — authenticated asset-write ceiling override (per label).
  const assetWriteRateLimitEnv = Number.parseInt(process.env.HUB_ASSET_WRITE_RATE_LIMIT ?? '', 10);
  const assetWriteRateLimit = Number.isFinite(assetWriteRateLimitEnv)
    ? assetWriteRateLimitEnv
    : undefined;

  let built;
  try {
    built = createHub({
      port,
      dataDir,
      secret,
      publicUrl,
      rateLimit,
      insecureHttp,
      connRateLimit,
      assetWriteRateLimit,
    });
  } catch (err) {
    console.error('[hub] config error:', err.message);
    process.exit(1);
  }
  const { server, sqlitePath, workspaceMode, repoDir, s3Source, studio } = built;

  try {
    await server.listen();
  } catch (err) {
    console.error('[hub] failed to listen:', err);
    process.exit(1);
  }

  const scheme = insecureHttp ? 'http' : 'ws';
  console.log(`[hub] Maude Hub v${HUB_VERSION} listening on ${scheme}://0.0.0.0:${port}`);
  console.log(`[hub] data dir: ${dataDir}`);
  console.log(`[hub] SQLite at ${sqlitePath}`);
  console.log(`[hub] admin UI: ${publicUrl}/admin`);
  if (!adminAssetsLoaded()) {
    console.warn(
      '[hub] admin assets missing — /admin will serve empty page. Run `bun run build` in apps/hub.'
    );
  }

  // Cloud Phase 27 A1 — the studio child, and the upgrade splice that makes its
  // live panels work. Started BEFORE the workspace agent so the two are racing
  // for the same working tree for as short a time as possible (D2's residue —
  // see the plan's preserved dissent).
  if (studio) {
    // E1 — THE BYTE-IDENTITY GATE, before anything is served.
    //
    // Sealed only when the image says it sealed something; a dev checkout has no
    // manifest and is deliberately allowed through, because a guard that makes
    // the cloud path untestable locally is a guard that gets disabled.
    const identity = checkBundleIdentity({
      ...studioIdentityPaths(),
      required: process.env.MAUDE_IMAGE_SEALED === '1',
    });
    if (!identity.ok) {
      console.error(`\n${formatIdentityFailure(identity)}\n`);
      process.exit(1);
    }
    built.attachStudioUpgrades();
    studio.start();
    console.log(`[hub] studio child supervised on 127.0.0.1:${studio.port}`);
  }

  seedFirstUserOnBoot(dataDir);

  // Sync v2 Increment 1 — the journal's durability and its reconciler, armed
  // once the port is bound (see startJournalReconciler for why the order is
  // load-bearing). Fire-and-forget: a hub whose journal cannot arm still
  // serves, and says so.
  built
    .startJournalReconciler({ target: targetFromEnv() })
    .catch((err) => console.error(`[journal] could not arm: ${err.message}`));

  // Cloud Phase 16 — server-owned history + the server-side asset lane.
  // Both are workspace-mode-only and both report rather than throw.
  if (workspaceMode) {
    const started = await built.startWorkspaceAgent();
    if (started.state === 'failed') {
      console.warn(
        `[hub] server-side history is OFF (${started.reason}). Edits will sync and persist, ` +
          'but this workspace will keep no git history and cannot mirror to GitHub.'
      );
    }
    if (s3Source.configured && repoDir) {
      // Flush at boot: the journal's unstamped `mirrored_at_ms` rows are the
      // write-behind's whole work queue, so a crash or teardown between an
      // append and its mirror costs nothing — this pass settles the backlog.
      const designRoot = join(repoDir, process.env.MAUDE_DESIGN_ROOT ?? '.design');
      s3Source
        .config()
        .then(async (s3) => {
          // HYDRATE FIRST, THEN MIRROR — the order is the whole point.
          //
          // A cell's checkout is ephemeral and `rehydrate.mjs` restores it from
          // the newest BACKUP GENERATION, so every asset that reached the bucket
          // after that generation is simply gone from disk on the next wake. The
          // sweep below only ever went checkout → bucket, so it had nothing to
          // say about that: it would find the file absent, upload nothing, and
          // report success while the studio served 404s for it. Measured at
          // 53–58 of ~95 assets missing immediately after a rollout, three times
          // in one afternoon, with a ~388 MB re-upload from a laptop as the only
          // repair anyone had.
          //
          // Hydrating first also makes the sweep that follows cheap and correct:
          // the gaps are filled, so it HEADs them, finds them present, and skips
          // — instead of racing a restore it cannot see.
          const restored = await hydrateAssets({
            designRoot,
            s3,
            // Sync v2 — a bucket→checkout refill IS an arrival, and peers have
            // to be able to see it. `hydrate` rather than `peer-put`: the row's
            // source is forensics, and "this came back from the bucket after a
            // wake" is a different fact from "a desktop pushed it".
            onWritten: ({ path: rel }) => {
              // `built.journal`, not a bare `journal`: the latter is a const
              // inside `createHub` and this callback runs in `runAsMain`, so
              // every call threw a ReferenceError. `hydrateAssets` catches per
              // asset, so the only symptom was a log line each — and a hydrate
              // source that appended nothing. A woken cell refilled dozens of
              // assets and told no peer about any of them until the next
              // walk-import, which is the exact gap this lane was added to close.
              if (built.journal) {
                built.journal.recordWrite({ designRoot, path: rel, source: 'hydrate' });
              }
            },
          });
          // The same restore for every OTHER file-plane class — the `files/`
          // prefix the write-behind fills. Durability without a way back is a
          // receipt, not a backup (F-6/B2).
          const restoredFiles = await hydrateFiles({
            designRoot,
            s3,
            onWritten: ({ path: rel }) => {
              if (built.journal) {
                built.journal.recordWrite({ designRoot, path: rel, source: 'hydrate' });
              }
            },
          });
          if (
            restored.restored.length ||
            restored.failed.length ||
            restoredFiles.restored.length ||
            restoredFiles.failed.length
          ) {
            built.recordAssetHydrate({
              restored: restored.restored.length + restoredFiles.restored.length,
              present: restored.present + restoredFiles.present,
              failed: restored.failed.length + restoredFiles.failed.length,
            });
          }
          // The journal-driven write-behind (Sync v2 Increment 5). Every
          // accepted file-plane write already lands a journal row — through
          // the door, the studio child's report, walk-import or a hydrate —
          // so subscribing to the append IS subscribing to every write
          // surface at once, with no per-door hook to forget.
          const wb = createWriteBehind({ designRoot, s3, journal: built.journal });
          built.setWriteBehind(wb);
          built.journal?.onAppend(() => wb.note());
          return wb.flush();
        })
        .then((r) => {
          built.recordAssetSweep({
            uploaded: r.mirrored ?? 0,
            failed: r.failed ?? 0,
          });
        })
        .catch((err) => {
          built.recordAssetSweep({ error: err.message.slice(0, 120) });
          console.error(`[hub] asset write-behind failed: ${err.message}`);
        });
    }
  }

  const bootstrap = maybeIssueOnBoot(dataDir, { secret });
  if (bootstrap) {
    console.log('');
    console.log(
      '[hub] First-run setup link (single-use, expires in 24h, NO regeneration after consumption):'
    );
    console.log(`      ${publicUrl}/admin?key=${bootstrap.key}`);
    console.log('');
  } else {
    // Tell the operator why no link was printed when one might be expected.
    const { tokens } = readTokens(dataDir);
    if (tokens.length === 0 && secret === '') {
      console.warn(
        '[hub] Hub unclaimed window closed (prior bootstrap consumed or expired). Restart with HUB_SECRET=<value> to set admin.'
      );
    }
  }

  const { tokens } = readTokens(dataDir);
  if (tokens.length === 0 && secret === '') {
    console.warn(
      '[hub] no tokens configured — running in permissive dev mode. Do NOT expose to the internet.'
    );
  } else if (tokens.length > 0) {
    console.log(`[hub] token store contains ${tokens.length} token(s).`);
  } else {
    console.log('[hub] HUB_SECRET is set — accepting that single token.');
  }

  const shutdown = (signal) => {
    console.log(`[hub] ${signal} received, shutting down`);
    // Flush the pending commit FIRST. A cell is migrated mid-session as the
    // normal path, and destroying the server before the queue drains would
    // silently drop the last few seconds of every moved session.
    built
      .stopWorkspaceAgent()
      .catch((err) => console.error('[hub] workspace flush error:', err))
      // Land the journal tail BEFORE anything else tears down. A cell is
      // migrated mid-session as the NORMAL path, and a tail stuck inside its
      // debounce window is exactly the rewind the tail exists to prevent.
      .then(() => built.stopJournal())
      .catch((err) => console.error('[hub] journal tail flush error:', err))
      // The studio owns `_server.json` and a couple of pending writes; stopping
      // it politely is what keeps the next boot from reading stale state as a
      // live instance.
      .then(() => studio?.stop())
      .catch((err) => console.error('[hub] studio stop error:', err))
      .then(() => server.destroy())
      .catch((err) => {
        console.error('[hub] shutdown error:', err);
      })
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function readOwnVersion() {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Auto-start only when invoked directly (`node src/server.mjs` or the bundled
// dist/hub.bundle.mjs). Tests import { createHub } and drive the lifecycle
// themselves.
const invokedAsMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedAsMain) {
  await runAsMain();
}
