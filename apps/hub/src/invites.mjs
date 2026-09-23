// Magic-link invites — Cloud Phase 6 Task 1.
//
// The persona this exists for is the invited teammate who has never used git
// (DDR-193 §5). The whole path is: they get a link, they click it, they are
// editing. No account form, no token to paste, no repository, no GitHub.
//
// SHAPE. An invite is a single-use, expiring credential that can be exchanged —
// exactly once — for a real user account plus a session. It is NOT a login. The
// distinction matters: a link that logs you in is a link that logs in whoever
// forwarded it, forever.
//
// STORAGE. Only the HASH is stored, on the same HMAC spine as peer tokens
// (tokens.mjs), for the same reason: someone who reads the database must not
// be able to redeem an outstanding invite. Redemption presents the raw value.
//
// THE TOKEN MUST NOT LEAK.
//   • Redemption is a POST — a token in a URL a browser then navigates from
//     ends up in Referer headers and in every proxy log along the way.
//   • Nothing here logs the raw value, ever. `sanitizeForLog` is not enough:
//     the value simply never reaches a log statement.
//   • Responses are `no-store`, so it does not sit in a browser cache.
//
// The `/join/<token>` GET only LOOKS — a browser gets the welcome page
// (`join-page.mjs`: one form, redeemed by POST into a studio session cookie);
// an API caller gets JSON. It never redeems, so a crawler, a link preview
// bot, or a corporate scanner that follows the link cannot burn the invite —
// which is otherwise a very ordinary way for an invite to arrive already used.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { stampSchemaVersion } from './schema-version.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const INVITE_PREFIX = 'inv_';
const DEFAULT_TTL_HOURS = 24 * 7;
const MAX_TTL_HOURS = 24 * 30;

const dbCache = new Map();

export function invitesDbPath(dataDir) {
  return join(dataDir, 'invites.db');
}

function db(dataDir) {
  const cached = dbCache.get(dataDir);
  if (cached?.open) return cached;
  const path = invitesDbPath(dataDir);
  const handle = new Database(path);
  handle.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  handle.exec(
    `CREATE TABLE IF NOT EXISTS invites (
       id          TEXT PRIMARY KEY,
       hash        TEXT NOT NULL UNIQUE,
       email       TEXT,
       role        TEXT NOT NULL DEFAULT 'member',
       created_at  INTEGER NOT NULL,
       expires_at  INTEGER NOT NULL,
       redeemed_at INTEGER,
       redeemed_by TEXT,
       revoked_at  INTEGER,
       created_by  TEXT
     )`
  );
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows / read-only fs */
  }
  // A2 — record the shape while we know it (see schema-version.mjs).
  stampSchemaVersion(handle);
  dbCache.set(dataDir, handle);
  return handle;
}

export function closeInvites(dataDir) {
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

function hmacKey(handle) {
  const row = handle.prepare('SELECT v FROM meta WHERE k = ?').get('invite_key');
  if (row?.v) return row.v;
  const key = randomBytes(32).toString('hex');
  handle.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run('invite_key', key);
  return key;
}

function hashInvite(handle, value) {
  return createHmac('sha256', hmacKey(handle)).update(String(value), 'utf8').digest('hex');
}

export function inviteTtlMs(hours) {
  const raw = Number(hours);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_HOURS * 3600_000;
  return Math.min(raw, MAX_TTL_HOURS) * 3600_000;
}

/**
 * Mint an invite. The raw value is returned ONCE and never stored.
 *
 * `email` is optional and is a HINT, not a restriction — binding an invite to
 * an address sounds safer but means the person who forwards it to the right
 * colleague has broken it, and that is the most common thing that happens to
 * an invite in a small team.
 */
export function createInvite(dataDir, { email, role = 'member', ttlHours, createdBy } = {}) {
  // An invite becomes an ACCOUNT, and a hub's accounts are 'admin' | 'member'.
  // Anything else used to be stored as 'member' while the response echoed the
  // requested role — so "invite a viewer" silently minted a writer. Refuse it:
  // an unknown role must never be an escalation (read-only access on a hub is
  // a read-only token, not an invite).
  if (role !== 'admin' && role !== 'member')
    throw new Error("role must be one of: admin, member — a self-hosted hub has no view-only accounts");
  const handle = db(dataDir);
  const value = INVITE_PREFIX + randomBytes(24).toString('hex');
  const id = randomBytes(8).toString('hex');
  const now = Date.now();
  const expiresAt = now + inviteTtlMs(ttlHours);
  handle
    .prepare(
      `INSERT INTO invites (id, hash, email, role, created_at, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      hashInvite(handle, value),
      email ? String(email).trim().toLowerCase() : null,
      role,
      now,
      expiresAt,
      createdBy ?? null
    );
  return { id, value, expiresAt, email: email ?? null, role };
}

/** The link a person receives. The token is in the PATH, never a query string —
 *  query strings are what analytics and link-preview tooling copy around. */
export function inviteUrl(publicUrl, value) {
  return `${String(publicUrl).replace(/\/+$/, '')}/join/${value}`;
}

function rowFor(handle, value) {
  if (typeof value !== 'string' || !value.startsWith(INVITE_PREFIX)) return null;
  const digest = hashInvite(handle, value);
  const row = handle.prepare('SELECT * FROM invites WHERE hash = ?').get(digest);
  if (!row) return null;
  // Constant-time compare on the digest, matching tokens.mjs.
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(row.hash, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return row;
}

/**
 * Look at an invite WITHOUT consuming it — what the landing page needs.
 *
 * Read-only on purpose: a crawler, link preview, or corporate scanner that
 * follows the link must not be able to burn the invite. That is otherwise a
 * very ordinary way for an invite to arrive already used.
 */
export function peekInvite(dataDir, value, now = Date.now()) {
  const handle = db(dataDir);
  const row = rowFor(handle, value);
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (row.redeemed_at) return { ok: false, reason: 'already-used' };
  if (row.expires_at <= now) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    invite: { id: row.id, email: row.email, role: row.role, expiresAt: row.expires_at },
  };
}

/**
 * Redeem an invite for a user account. Single-use, enforced by the database.
 *
 * `createAccount` is injected so this module never imports users.mjs — the
 * caller (server.mjs) owns the account creation and the session mint. Returning
 * the marked row before the account exists would be worse: an invite consumed
 * by a failed signup is one the person cannot retry with.
 *
 * @param {(args: {email: string, password: string, role: string}) => object} createAccount
 */
export function redeemInvite(dataDir, { value, email, password, createAccount }, now = Date.now()) {
  const handle = db(dataDir);
  const check = peekInvite(dataDir, value, now);
  if (!check.ok) return { ok: false, reason: check.reason };

  // WHEN AN INVITE IS BOUND TO AN ADDRESS, THAT ADDRESS WINS (B5). An invite
  // carries a role, so a link the admin scoped to `bob@acme.com, member` must
  // not be redeemable as `admin@acme.com` by whoever the link reaches — a
  // forwarded link would otherwise mint an account of the invited role under
  // any address the redeemer types. The redeemer's `email` only chooses the
  // address for an UNBOUND invite (one created without one).
  const bound = String(check.invite.email ?? '')
    .trim()
    .toLowerCase();
  const requested = String(email ?? '')
    .trim()
    .toLowerCase();
  if (bound && requested && requested !== bound) {
    return { ok: false, reason: 'email-mismatch' };
  }
  const address = bound || requested;
  if (!address) return { ok: false, reason: 'email-required' };

  // Create the account FIRST. If it fails — duplicate address, weak password —
  // the invite is untouched and the person can simply try again. Marking it
  // used first would burn the invite on a typo.
  let user;
  try {
    user = createAccount({ email: address, password, role: check.invite.role });
  } catch (err) {
    return { ok: false, reason: 'account-failed', detail: err.message };
  }

  // Single-use enforced by the WHERE clause, not by the read above: two
  // simultaneous redemptions both pass `peekInvite`, and exactly one gets
  // `changes === 1`.
  const marked = handle
    .prepare(
      `UPDATE invites SET redeemed_at = ?, redeemed_by = ?
       WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL`
    )
    .run(now, address, check.invite.id);
  if (marked.changes !== 1) return { ok: false, reason: 'already-used', user };

  return { ok: true, user, invite: check.invite };
}

/**
 * Revoke every OPEN invite bound to an address. Used when an account for that
 * address comes into being some other way (an OIDC approve) — an invite that
 * can now only fail with "already exists" is clutter in the admin list and a
 * confusing dead end for the person holding it.
 */
export function revokeInvitesForEmail(dataDir, email, now = Date.now()) {
  const address = String(email ?? '')
    .trim()
    .toLowerCase();
  if (!address) return 0;
  const handle = db(dataDir);
  return handle
    .prepare(
      `UPDATE invites SET revoked_at = ?
       WHERE lower(email) = ? AND revoked_at IS NULL AND redeemed_at IS NULL`
    )
    .run(now, address).changes;
}

export function revokeInvite(dataDir, id, now = Date.now()) {
  const handle = db(dataDir);
  const res = handle
    .prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(now, String(id));
  return res.changes === 1;
}

/**
 * List invites for the admin UI. NEVER returns the hash or anything from which
 * a value could be derived — an operator surface that displays outstanding
 * invites must not be a way to use them.
 */
export function listInvites(dataDir, { now = Date.now() } = {}) {
  try {
    return db(dataDir)
      .prepare('SELECT * FROM invites ORDER BY created_at DESC')
      .all()
      .map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        status: row.revoked_at
          ? 'revoked'
          : row.redeemed_at
            ? 'used'
            : row.expires_at <= now
              ? 'expired'
              : 'open',
        redeemedAt: row.redeemed_at ?? null,
        redeemedBy: row.redeemed_by ?? null,
      }));
  } catch {
    return [];
  }
}

/** Sweep invites that expired long ago. Housekeeping, not a security control —
 *  an expired invite already cannot be redeemed. */
export function purgeExpiredInvites(dataDir, { olderThanMs = 30 * 24 * 3600_000 } = {}) {
  const handle = db(dataDir);
  const res = handle
    .prepare('DELETE FROM invites WHERE expires_at < ? AND redeemed_at IS NULL')
    .run(Date.now() - olderThanMs);
  return res.changes;
}
