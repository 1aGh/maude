// The team-library grant credential — Maude v2 S10.18a-2 (option A, Michal 2026-10-20).
//
//   GET    /api/projects/:p/v1/ds-grants        → { grants: [...] }   the owner's list
//   POST   /api/projects/:p/v1/ds-grants        → 201 { grant, token } (the token, once)
//   DELETE /api/projects/:p/v1/ds-grants/:id    → 204                 revoke
//
// WHAT IT IS. A bearer token this hub mints for ONE design system of its project, so a
// NON-member (a linking project, S10.18b) can read that system's head and revisions at the
// ds-library door (`ds-library.mjs`) — and nothing else. It changes no account model and
// needs no control plane, so it works the same on a self-hosted hub and a cloud cell.
//
// WHO MINTS. The project owner: the row asks `invite` (the same capability that shares the
// project, `routes-v2/access.mjs`) and the handler re-asks it over the WHOLE project — a
// machine token scoped to part of the design root does not mint, and neither does a
// read-only one.
//
// STORAGE. `<dataDir>/ds-grants.db` keeps the SHA-256 of the token, never the token: the
// secret is 32 random bytes (256 bits), so a plain hash is enough (no HMAC key to keep —
// nobody can guess a preimage of that size). The token carries its row id, so verification
// is ONE lookup by id plus a constant-time compare of the hashes. Revocable; an optional
// expiry (1–365 days).
//
// ONE DOOR. The token is not a peer token: `tokens.mjs verifyToken` never sees it, so every
// other hub door (and the Yjs socket) treats it exactly as an unknown bearer. Only the
// ds-library door calls `verifyGrant` (test/ds-library-grant-doors.test.mjs sweeps them).
//
// DARK. Nothing here answers unless MAUDE_DS_LIBRARY_GRANTS=1: the routes are 404 and
// `verifyGrant` is null, so a non-member is refused exactly as before S10.18a-2. `/health`
// lists `ds-library-grants` only then. The flag is read per call (a cell's env).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { stampSchemaVersion } from './schema-version.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

/** The `/health` capability a v2 studio looks for before it accepts a grant link. */
export const DS_GRANTS_CAPABILITY = 'ds-library-grants';
/** The switch. Exactly `1`; Michal turns it on per cell after review. */
export const DS_GRANTS_ENV = 'MAUDE_DS_LIBRARY_GRANTS';

export function dsGrantsEnabled(env = process.env) {
  return env[DS_GRANTS_ENV] === '1';
}

/** `mdsg_<16 hex row id>_<64 hex secret>` — the id is not secret, the 256 bits are. */
export const DS_GRANT_TOKEN = /^mdsg_([0-9a-f]{16})_([0-9a-f]{64})$/;
const ID = /^g_[0-9a-f]{16}$/;

/** Live (unrevoked, unexpired) grants one hub keeps. A display surface, not a fleet. */
export const DS_GRANTS_MAX_LIVE = 200;
export const DS_GRANT_MAX_DAYS = 365;
const DAY_MS = 86_400_000;
const LABEL_MAX = 80;
const SYSTEM_NAME = /^[\w .-]{1,64}$/;

const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest();

const dbCache = new Map();

export function dsGrantsDbPath(dataDir) {
  return join(dataDir, 'ds-grants.db');
}

function db(dataDir) {
  const cached = dbCache.get(dataDir);
  if (cached?.open) return cached;
  const path = dsGrantsDbPath(dataDir);
  const handle = new Database(path);
  handle.exec(
    `CREATE TABLE IF NOT EXISTS ds_grants (
       id          TEXT PRIMARY KEY,
       hash        TEXT NOT NULL,
       system      TEXT NOT NULL,
       label       TEXT,
       created_at  INTEGER NOT NULL,
       created_by  TEXT,
       expires_at  INTEGER,
       revoked_at  INTEGER
     )`
  );
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows / read-only fs */
  }
  stampSchemaVersion(handle);
  dbCache.set(dataDir, handle);
  return handle;
}

export function closeDsGrants(dataDir) {
  const handle = dbCache.get(dataDir);
  if (handle?.open) {
    try {
      handle.close();
    } catch {
      /* ignore */
    }
  }
  dbCache.delete(dataDir);
}

const live = (row, t) => row.revoked_at === null && (row.expires_at === null || row.expires_at > t);

const publicGrant = (row) => ({
  id: row.id,
  system: row.system,
  label: row.label ?? null,
  createdAt: row.created_at,
  expiresAt: row.expires_at ?? null,
});

/**
 * The grant store of one hub.
 *
 * @param {{ dataDir: string, projectId: string, enabled?: () => boolean, now?: () => number }} deps
 */
export function createDsGrantStore({
  dataDir,
  projectId,
  enabled = () => dsGrantsEnabled(),
  now = () => Date.now(),
}) {
  const handle = () => db(dataDir);

  function liveRows() {
    const t = now();
    return handle()
      .prepare('SELECT * FROM ds_grants WHERE revoked_at IS NULL ORDER BY created_at, id')
      .all()
      .filter((r) => live(r, t));
  }

  return {
    enabled: () => enabled() === true,

    /** @returns {{ ok: true, grant: object, token: string } | { ok: false, reason: string }} */
    mint({ system, label = null, expiresInDays = null, by = null }) {
      if (liveRows().length >= DS_GRANTS_MAX_LIVE) return { ok: false, reason: 'too-many' };
      const hex = randomBytes(8).toString('hex');
      const token = `mdsg_${hex}_${randomBytes(32).toString('hex')}`;
      const t = now();
      const row = {
        id: `g_${hex}`,
        hash: sha256(token).toString('hex'),
        system,
        label,
        created_at: t,
        created_by: by,
        expires_at: expiresInDays === null ? null : t + expiresInDays * DAY_MS,
        revoked_at: null,
      };
      handle()
        .prepare(
          `INSERT INTO ds_grants (id, hash, system, label, created_at, created_by, expires_at, revoked_at)
           VALUES (@id, @hash, @system, @label, @created_at, @created_by, @expires_at, @revoked_at)`
        )
        .run(row);
      return { ok: true, grant: publicGrant(row), token };
    },

    list() {
      return liveRows().map(publicGrant);
    },

    /** True when a live grant was revoked now. */
    revoke(id) {
      if (typeof id !== 'string' || !ID.test(id)) return false;
      const row = handle().prepare('SELECT * FROM ds_grants WHERE id = ?').get(id);
      if (!row || !live(row, now())) return false;
      handle().prepare('UPDATE ds_grants SET revoked_at = ? WHERE id = ?').run(now(), id);
      return true;
    },

    /**
     * The ds-library door's seam (`ds-library.mjs reader`): a live grant's ONE system and
     * who fetches (`grant:<id>`, so "used by N projects" counts grants), or null. Never
     * throws; null while the flag is off.
     */
    verifyGrant(token) {
      if (enabled() !== true || typeof token !== 'string') return null;
      const m = DS_GRANT_TOKEN.exec(token);
      if (!m) return null;
      let row;
      try {
        row = handle().prepare('SELECT * FROM ds_grants WHERE id = ?').get(`g_${m[1]}`);
      } catch {
        return null;
      }
      if (!row || typeof row.hash !== 'string' || row.hash.length !== 64) return null;
      const stored = Buffer.from(row.hash, 'hex');
      const given = sha256(token);
      if (stored.length !== given.length || !timingSafeEqual(stored, given)) return null;
      if (!live(row, now()) || !SYSTEM_NAME.test(row.system)) return null;
      return { system: row.system, fetcher: `grant:${row.id}`, project: projectId };
    },
  };
}

// ------------------------------------------------------------------ routes

const PROJECT = '[A-Za-z0-9._-]{1,128}';
/** Everything under a project's `/v1/ds-grants` — one row. */
export const DS_GRANTS_ROUTE = new RegExp(`^/api/projects/(${PROJECT})/v1/ds-grants(?:/.*)?$`);
const LIST_PATH = new RegExp(`^/api/projects/(${PROJECT})/v1/ds-grants$`);
const ONE_PATH = new RegExp(`^/api/projects/(${PROJECT})/v1/ds-grants/(g_[0-9a-f]{16})$`);

const NOT_FOUND = Object.freeze({ error: 'not found', code: 'not-found' });
const BODY_LIMIT = 8 * 1024;

const refusal = (status, code, error) => ({ status, body: { error, code } });

function readJson(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        finish(null);
        request.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (chunks.length === 0) return finish({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        finish(v && typeof v === 'object' && !Array.isArray(v) ? v : null);
      } catch {
        finish(null);
      }
    });
    request.on('error', () => finish(null));
  });
}

/**
 * The project owner, strictly: an `invite` holder over the WHOLE project on a writable
 * session — or a credential `acceptedAuth` itself calls the owner (the operator's secret,
 * the cell secret, a cloud owner's control-plane token).
 */
function isOwner(who) {
  if (!who) return false;
  if (who.owner === true) return true;
  return (
    !!who.access &&
    !who.readOnly &&
    !who.access.canvasOnly &&
    (who.scope ?? '*') === '*' &&
    who.access.can('invite', null)
  );
}

/**
 * @param {object} deps
 * @param {ReturnType<typeof createDsGrantStore>} deps.store
 * @param {string} deps.projectId
 * @param {() => Array<{ name: string, path: string }>} deps.systems  the project's design systems
 * @param {(request: object) => object | null} deps.auth  the hub's `acceptedAuth`
 */
export function createDsGrantRoutes({ store, projectId, systems, auth }) {
  const hasSystem = (name) =>
    (Array.isArray(systems()) ? systems() : []).some((s) => s && s.name === name);

  async function handle(ctx) {
    const { path, method } = ctx;
    if (!DS_GRANTS_ROUTE.test(path)) return false;
    const answer = ({ status, body }) => {
      if (status === 204) {
        ctx.response.writeHead(204, { 'Cache-Control': 'no-store' });
        ctx.response.end();
      } else {
        ctx.respondJson(status, body);
      }
      return true;
    };
    // Dark: as if the route never existed — to the owner too.
    if (!store.enabled()) return answer({ status: 404, body: { ...NOT_FOUND } });
    const who = auth(ctx.request);
    if (!who) return answer(refusal(401, 'unauthenticated', 'sign in to this project first'));
    if (!isOwner(who)) {
      return answer(refusal(403, 'not-allowed', 'Ask the owner to change this.'));
    }
    const list = LIST_PATH.exec(path);
    const one = list ? null : ONE_PATH.exec(path);
    const m = list ?? one;
    if (!m || (m[1] !== projectId && m[1] !== 'current')) {
      return answer({ status: 404, body: { ...NOT_FOUND } });
    }

    if (one) {
      if (method !== 'DELETE') return answer(refusal(405, 'method', 'method not allowed'));
      return store.revoke(one[2])
        ? answer({ status: 204 })
        : answer({ status: 404, body: { ...NOT_FOUND } });
    }
    if (method === 'GET' || method === 'HEAD') {
      return answer({ status: 200, body: { grants: store.list() } });
    }
    if (method !== 'POST') return answer(refusal(405, 'method', 'method not allowed'));

    const body = await readJson(ctx.request);
    if (body === null) return answer(refusal(400, 'body', 'That is not a JSON object.'));
    const { system } = body;
    if (typeof system !== 'string' || system === '') {
      return answer(refusal(422, 'system', 'Name the design system to share.'));
    }
    // A system this project does not have answers like a missing one.
    if (!SYSTEM_NAME.test(system) || !hasSystem(system)) {
      return answer({ status: 404, body: { ...NOT_FOUND } });
    }
    let label = null;
    if (body.label !== undefined && body.label !== null) {
      label = typeof body.label === 'string' ? body.label.trim() : '';
      // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
      if (!label || label.length > LABEL_MAX || /[\u0000-\u001f\u007f]/.test(label)) {
        return answer(refusal(422, 'label', `A label is 1–${LABEL_MAX} characters.`));
      }
    }
    let days = null;
    if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
      days = body.expiresInDays;
      if (!Number.isInteger(days) || days < 1 || days > DS_GRANT_MAX_DAYS) {
        return answer(refusal(422, 'expiry', `An expiry is 1–${DS_GRANT_MAX_DAYS} days.`));
      }
    }
    const made = store.mint({ system, label, expiresInDays: days, by: who.actor ?? null });
    if (!made.ok) {
      return answer(refusal(409, 'too-many', 'Revoke a library link before making another.'));
    }
    return answer({ status: 201, body: { grant: made.grant, token: made.token } });
  }

  return { handle };
}

/** The row handler: the runtime comes in through `ctx.deps.dsGrants` (server.mjs). */
async function dsGrantsHandler(ctx) {
  const routes = ctx.deps?.dsGrants;
  if (!routes || typeof routes.handle !== 'function') return false;
  return routes.handle(ctx);
}

/**
 * The row (one table, S9 Q12): `invite` on both halves, as the access API's owner rows —
 * so a viewer, a Can view session and a member are refused at the gate, and a canvas-only
 * session never reaches the handler (project scope, no canvasDoor).
 */
export const DS_GRANT_ROWS = Object.freeze([
  {
    pattern: DS_GRANTS_ROUTE,
    cap: Object.freeze({ safe: 'invite', unsafe: 'invite' }),
    scope: 'project',
    handler: dsGrantsHandler,
  },
]);
