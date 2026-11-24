// The team server's activity log — kept, bounded, searchable.
//
// Until this file the admin's Activity was an in-memory ring of 200 events
// (`server.mjs pushActivity`): a restart, a deploy or a crash erased the answer
// to "who did that, and when". This is the same question on disk.
//
// SHAPE. One row per thing that happened: when, WHO did it (`actor`), to WHOM
// or WHAT (`target`), a plain sentence fragment (`detail`) and WHERE in the
// admin it belongs (`area`: People · Sign-in · Settings · Server). Same store
// pattern as `invites.mjs` / `users.mjs`: better-sqlite3, one cached handle per
// data dir, file mode 0600, schema stamped.
//
// WHAT NEVER GOES IN. No token value, no invite value, no admin key, no
// password, no OIDC code. Callers pass labels, ids and addresses only — and
// `scrub` is the second lock for the day one of them forgets: anything shaped
// like a credential this hub mints is replaced before the row is written.
//
// BOUNDED. Rows older than RETENTION_MS are dropped, and the table never holds
// more than MAX_ROWS — a sign-in flood must not be able to fill the disk the
// documents live on.

import { chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { sanitizeForLog } from './log-safety.mjs';
import { stampSchemaVersion } from './schema-version.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

/** Kept for 90 days. */
export const RETENTION_MS = 90 * 24 * 3600_000;
/** …and never more than this many rows, whatever their age. */
export const MAX_ROWS = 100_000;
/** One page of the list; the CSV download takes at most CSV_MAX. */
export const PAGE_MAX = 500;
export const CSV_MAX = 20_000;
/** Prune every this many writes (and once when the store opens). */
const PRUNE_EVERY = 500;

/** The four places an event belongs — the Activity tabs. */
export const AREAS = Object.freeze(['people', 'signin', 'settings', 'server']);

/**
 * Every kind this hub records, and where it belongs. A kind that is not here
 * is still stored (under `server`) — an unknown event is not a dropped one.
 */
export const KIND_AREA = Object.freeze({
  // sign-ins
  login: 'signin',
  logout: 'signin',
  'signin-browser': 'signin',
  'oidc-signin': 'signin',
  'oidc-pending': 'signin',
  'oidc-refused': 'signin',
  'oidc-domain-join': 'signin',
  'oidc-self-link': 'signin',
  'invite-redeem': 'signin',
  // people and access
  'invite-create': 'people',
  'invite-reissue': 'people',
  'invite-revoke': 'people',
  'role-change': 'people',
  'user-create': 'people',
  'user-disable': 'people',
  'user-enable': 'people',
  'user-delete': 'people',
  'user-password': 'people',
  'user-signout': 'people',
  'oidc-approve': 'people',
  'oidc-link': 'people',
  'oidc-unlink': 'people',
  'oidc-dismiss': 'people',
  // settings
  settings: 'settings',
  // server
  token: 'server',
  'token-rotate': 'server',
  'token-delete': 'server',
  'secret-rotate': 'server',
  backup: 'server',
  kick: 'server',
});

const dbCache = new Map();
const writes = new Map();

export function auditDbPath(dataDir) {
  return join(dataDir, 'audit.db');
}

function db(dataDir) {
  const cached = dbCache.get(dataDir);
  if (cached?.open) return cached;
  const path = auditDbPath(dataDir);
  const handle = new Database(path);
  handle.exec(
    `CREATE TABLE IF NOT EXISTS audit (
       id     INTEGER PRIMARY KEY AUTOINCREMENT,
       at     INTEGER NOT NULL,
       kind   TEXT NOT NULL,
       area   TEXT NOT NULL,
       actor  TEXT NOT NULL DEFAULT '',
       target TEXT NOT NULL DEFAULT '',
       detail TEXT NOT NULL DEFAULT ''
     )`
  );
  handle.exec('CREATE INDEX IF NOT EXISTS audit_at ON audit(at)');
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows / read-only fs */
  }
  stampSchemaVersion(handle);
  dbCache.set(dataDir, handle);
  prune(handle);
  return handle;
}

export function closeAudit(dataDir) {
  const handle = dbCache.get(dataDir);
  if (handle?.open) {
    try {
      handle.close();
    } catch {
      /* ignore */
    }
  }
  dbCache.delete(dataDir);
  writes.delete(dataDir);
}

function prune(handle, now = Date.now()) {
  handle.prepare('DELETE FROM audit WHERE at < ?').run(now - RETENTION_MS);
  const { n } = handle.prepare('SELECT COUNT(*) AS n FROM audit').get();
  if (n > MAX_ROWS) {
    handle
      .prepare('DELETE FROM audit WHERE id IN (SELECT id FROM audit ORDER BY id ASC LIMIT ?)')
      .run(n - MAX_ROWS);
  }
}

/**
 * Replace anything shaped like a credential. Invite values (`inv_…`), peer
 * tokens (`mau_…`), project tokens (`m2.…`) and any long hex or
 * base64url run (32+ hex, 43+ base64url: a 128- or 256-bit value) — a secret has
 * no business in a sentence.
 */
export function scrub(value, max = 200) {
  return sanitizeForLog(value)
    .replace(/\binv_[0-9a-f]{8,}\b/gi, '[invite]')
    .replace(/\bmau_(?:dev_)?[0-9a-f]{8,}/gi, '[token]')
    .replace(/\bm2\.[A-Za-z0-9._-]{16,}/g, '[token]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{43,}\b/g, '[redacted]')
    .slice(0, max);
}

/**
 * Record one event. Never throws: an activity log that can take a sign-in or a
 * role change down with it is worse than a gap in the log.
 *
 * @param {string} dataDir
 * @param {{ kind: string, actor?: string, target?: string, detail?: string, area?: string, at?: number }} event
 */
export function recordAudit(
  dataDir,
  { kind, actor = '', target = '', detail = '', area, at } = {}
) {
  try {
    const k = scrub(kind, 40) || 'event';
    const handle = db(dataDir);
    handle
      .prepare(
        'INSERT INTO audit (at, kind, area, actor, target, detail) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        Number.isFinite(at) ? at : Date.now(),
        k,
        AREAS.includes(area) ? area : (KIND_AREA[k] ?? 'server'),
        scrub(actor, 160),
        scrub(target, 200),
        scrub(detail, 300)
      );
    const n = (writes.get(dataDir) ?? 0) + 1;
    writes.set(dataDir, n);
    if (n % PRUNE_EVERY === 0) prune(handle);
    return true;
  } catch (err) {
    console.warn(`[hub] activity log write failed: ${sanitizeForLog(err?.message)}`);
    return false;
  }
}

function rowOf(r) {
  return {
    id: r.id,
    at: r.at,
    kind: r.kind,
    area: r.area,
    actor: r.actor,
    target: r.target,
    detail: r.detail,
  };
}

const likeOf = (s) =>
  `%${String(s)
    .toLowerCase()
    .replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Newest first.
 *
 * @param {object} [q]
 * @param {string} [q.kind]   an area (`people` · `signin` · `settings` · `server`) or one exact kind
 * @param {string} [q.who]    exact actor OR target (an address), case-insensitive
 * @param {string} [q.q]      free text over actor, target and detail
 * @param {number} [q.before] only rows with an id below this one (paging)
 * @param {number} [q.limit]
 */
export function listAudit(dataDir, { kind, who, q, before, limit, max = PAGE_MAX } = {}) {
  const where = [];
  const args = [];
  if (kind) {
    if (AREAS.includes(kind)) where.push('area = ?');
    else where.push('kind = ?');
    args.push(String(kind).slice(0, 40));
  }
  if (who) {
    where.push('(lower(actor) = ? OR lower(target) = ?)');
    const w = String(who).trim().toLowerCase().slice(0, 254);
    args.push(w, w);
  }
  if (q) {
    where.push(
      "(lower(actor) LIKE ? ESCAPE '\\' OR lower(target) LIKE ? ESCAPE '\\' OR lower(detail) LIKE ? ESCAPE '\\')"
    );
    const like = likeOf(String(q).slice(0, 120));
    args.push(like, like, like);
  }
  const b = Number(before);
  if (Number.isInteger(b) && b > 0) {
    where.push('id < ?');
    args.push(b);
  }
  const n = Math.max(1, Math.min(Number.isFinite(Number(limit)) ? Number(limit) : 100, max));
  try {
    return db(dataDir)
      .prepare(
        `SELECT * FROM audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`
      )
      .all(...args, Math.floor(n))
      .map(rowOf);
  } catch {
    return [];
  }
}

/** How many events since `since` (optionally in one area). */
export function countAuditSince(dataDir, since, { area } = {}) {
  try {
    const handle = db(dataDir);
    return area
      ? handle
          .prepare('SELECT COUNT(*) AS n FROM audit WHERE at >= ? AND area = ?')
          .get(since, area).n
      : handle.prepare('SELECT COUNT(*) AS n FROM audit WHERE at >= ?').get(since).n;
  } catch {
    return 0;
  }
}

/**
 * The kinds that mean "this person got IN". Asking to join and being turned
 * away are sign-in EVENTS but not presence: counting them would let anyone who
 * can reach the sign-in page make an account look recently used.
 */
export const SIGNED_IN_KINDS = Object.freeze([
  'login',
  'signin-browser',
  'oidc-signin',
  'oidc-domain-join',
  'oidc-self-link',
  'invite-redeem',
]);

/** When each address last signed in successfully — for "Last here". */
export function lastSignIns(dataDir) {
  const out = new Map();
  try {
    const rows = db(dataDir)
      .prepare(
        `SELECT lower(actor) AS who, MAX(at) AS at FROM audit
          WHERE actor != '' AND kind IN (${SIGNED_IN_KINDS.map(() => '?').join(', ')})
          GROUP BY lower(actor)`
      )
      .all(...SIGNED_IN_KINDS);
    for (const r of rows) out.set(r.who, r.at);
  } catch {
    /* an unreadable log is an empty one */
  }
  return out;
}

/** One CSV cell. A leading = + - @ is neutralised (spreadsheet formula injection). */
function cell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function auditCsv(rows) {
  const lines = ['when,who,what,about,detail,where'];
  for (const r of rows) {
    lines.push(
      [new Date(r.at).toISOString(), r.actor, r.kind, r.target, r.detail, r.area]
        .map(cell)
        .join(',')
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
