// Hub user model — Cloud Phase 2 Task 1, implementing DDR-192 §3.
//
// The point of this file (and why it is in the SELF-HOST hub, not in a cloud
// package): the future cloud login is the same code a self-hoster gets. A user
// signing in mints a scoped, EXPIRING peer token on the existing HMAC spine
// (tokens.mjs) instead of a human copying a forever-secret out of a terminal.
// The DDR-053 admin Bearer is untouched and is still the operator credential —
// it is not a user credential and must never become one.
//
// Zero new dependencies, per the phase's constraint: passwords use node's own
// `crypto.scryptSync`, the store is the same `better-sqlite3` already carrying
// tokens.db.
//
// SQLite layout (<dataDir>/users.db, file mode 0600):
//   users(
//     email      TEXT PRIMARY KEY,   -- normalized: trimmed + lowercased
//     hash       TEXT NOT NULL,      -- scrypt$N$r$p$saltHex$hashHex
//     role       TEXT NOT NULL,      -- 'admin' | 'member'
//     scope      TEXT,               -- NULL = wildcard; else a documentName prefix
//     created_at INTEGER NOT NULL,
//     disabled   INTEGER NOT NULL DEFAULT 0
//   )
//
// Password hashes are scrypt, NOT HMAC. tokens.mjs can use HMAC because a token
// is 128 bits of CSPRNG output — brute force is not the threat there. A human's
// password is low-entropy, so it needs a *deliberately slow* KDF; using the
// token spine's HMAC for passwords would be the classic mistake.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { stampSchemaVersion } from './schema-version.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// OWASP-aligned scrypt parameters (N=2^15, r=8, p=1 ≈ 32 MB, ~100 ms).
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
// scryptSync enforces a memory ceiling of 32 MB by default; N=2^15 needs
// ~128*N*r = 32 MB exactly, so the limit has to be raised or it throws.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

const ROLES = new Set(['admin', 'member']);
export const MIN_PASSWORD_LENGTH = 12;

/** One open Database handle per dataDir (native init is expensive). */
const dbCache = new Map();

export function usersDbPath(dataDir) {
  return join(dataDir, 'users.db');
}

function db(dataDir) {
  const cached = dbCache.get(dataDir);
  if (cached?.open) return cached;
  const path = usersDbPath(dataDir);
  const handle = new Database(path);
  handle.exec(
    `CREATE TABLE IF NOT EXISTS users (
       email      TEXT PRIMARY KEY,
       hash       TEXT NOT NULL,
       role       TEXT NOT NULL DEFAULT 'member',
       scope      TEXT,
       created_at INTEGER NOT NULL,
       disabled   INTEGER NOT NULL DEFAULT 0
     )`
  );
  // OIDC pending — Track C C4. A SEPARATE TABLE, deliberately not a fourth
  // role. `assertValidRole` throws outside 'admin' | 'member', role-matrix.mjs
  // returns NOTHING for an unknown role, and its own comment warns that "the
  // next role added on either side re-opens this" — referring to the
  // dual-vocabulary bug that already shipped as readOnly on every session. A
  // pending identity is the ABSENCE of a role, so modelling it as one would be
  // paying that price to express "no access" in a system that already
  // expresses it by having no row.
  handle.exec(
    `CREATE TABLE IF NOT EXISTS oidc_pending (
       sub          TEXT PRIMARY KEY,
       email        TEXT,
       first_seen   INTEGER NOT NULL,
       last_attempt INTEGER NOT NULL
     )`
  );
  // The link between a verified subject and an account. Created ONLY by an
  // explicit admin action (see linkOidcSub) — never by a sign-in.
  const columns = handle
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((c) => c.name);
  if (!columns.includes('oidc_sub')) handle.exec('ALTER TABLE users ADD COLUMN oidc_sub TEXT');
  handle.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_oidc_sub ON users(oidc_sub)');
  // People an admin REMOVED or DISMISSED. A subject or an address in here is
  // never created by a rule or by an open link again — it can only ask (see
  // `isTurnedOut`). Rows, not a flag on `users`: the account is gone.
  handle.exec(
    `CREATE TABLE IF NOT EXISTS oidc_turned_out (
       sub   TEXT NOT NULL DEFAULT '',
       email TEXT NOT NULL DEFAULT '',
       at    INTEGER NOT NULL,
       PRIMARY KEY (sub, email)
     )`
  );
  // V2-1.7 §5.8 (S9.6) — the self-hosted authority's two additions, the
  // existing ADD COLUMN way:
  //   access     the account's AccessClaim JSON when it is narrower than its
  //              account role — today only a canvas-only person
  //              (`{ v: 1, role: null, grants }`). NULL = `legacyClaim` of the
  //              account role, which is every account that predates S9.6.
  //   public_id  the id the access API names a person by. NEVER the e-mail:
  //              a people answer to a non-owner carries no address (V2-1.16
  //              L17), so its ids must not be one either.
  if (!columns.includes('access')) handle.exec('ALTER TABLE users ADD COLUMN access TEXT');
  if (!columns.includes('public_id')) handle.exec('ALTER TABLE users ADD COLUMN public_id TEXT');
  handle.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_public_id ON users(public_id)');
  const unnamed = handle.prepare('SELECT email FROM users WHERE public_id IS NULL').all();
  if (unnamed.length) {
    const name = handle.prepare('UPDATE users SET public_id = ? WHERE email = ?');
    handle.transaction(() => {
      for (const { email } of unnamed) name.run(newPublicId(), email);
    })();
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows / read-only fs — best effort. */
  }
  // A2 — record the shape while we know it (see schema-version.mjs).
  stampSchemaVersion(handle);
  dbCache.set(dataDir, handle);
  return handle;
}

/** Close + forget cached handles. Tests use this between temp dirs. */
export function closeUsers(dataDir) {
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

// ---------------------------------------------------------------- validation

/**
 * Normalize an address for storage + lookup: trim, lowercase.
 *
 * Case folding is what makes `Alice@Example.com` and `alice@example.com` the
 * same account. Without it, disabling one leaves the other live — an
 * offboarding hole, not a cosmetic issue.
 */
export function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * Deliberately permissive: one `@`, non-empty both sides, no whitespace or
 * control characters, bounded length. This is an identifier check, not an
 * attempt to validate deliverability — RFC-perfect email regexes are famously
 * wrong in both directions, and the address is never rendered unescaped.
 */
export function assertValidEmail(raw) {
  const email = normalizeEmail(raw);
  if (!email) throw new Error('email must be a non-empty string');
  if (email.length > 254) throw new Error('email must be at most 254 characters');
  // Whitespace + C0/C1 control characters, written as explicit \u escapes: a
  // literal control char in the source is invisible in review, and a range
  // typo here silently rejects valid addresses like `alice+tag@example.com`.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point.
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(email)) {
    throw new Error('email must not contain whitespace or control characters');
  }
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) {
    throw new Error('email must contain exactly one "@" with text on both sides');
  }
  return email;
}

export function assertValidPassword(password) {
  if (typeof password !== 'string') throw new Error('password must be a string');
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > 1024) throw new Error('password must be at most 1024 characters');
  return password;
}

export function assertValidRole(role) {
  if (role === undefined || role === null) return 'member';
  if (typeof role !== 'string' || !ROLES.has(role)) {
    throw new Error(`role must be one of: ${[...ROLES].join(', ')}`);
  }
  return role;
}

// ------------------------------------------------------------------- hashing

/** `scrypt$N$r$p$saltHex$hashHex` — self-describing so parameters can change. */
export function hashPassword(password) {
  assertValidPassword(password);
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Constant-time verify against a stored `scrypt$...` string. */
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // A stored record could name parameters larger than this process is willing
  // to spend memory on. Refuse rather than let a crafted row become a DoS.
  if (N > SCRYPT_N || r > SCRYPT_R * 4 || p > SCRYPT_P * 4) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let derived;
  try {
    derived = scryptSync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// ---------------------------------------------------------------------- CRUD

function rowToRecord(row) {
  const access = accessFromColumn(row.access);
  return {
    email: row.email,
    role: row.role,
    scope: row.scope ?? '*',
    createdAt: row.created_at,
    disabled: !!row.disabled,
    ...(row.public_id ? { id: row.public_id } : {}),
    ...(access ? { access } : {}),
  };
}

const newPublicId = () => `u_${randomBytes(8).toString('hex')}`;

/**
 * The stored claim, or null. A malformed column reads as NO ACCESS rather
 * than as the account role: an unreadable narrowing must never widen.
 */
function accessFromColumn(raw) {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeAccess(parsed);
  } catch {
    return { v: 1, role: null, grants: [] };
  }
}

/**
 * What a self-hosted account's `access` column may hold: a canvas-only claim
 * (`role: null`) whose grants are `member` — the only role below owner a
 * self-hosted hub has (V2-1.7 §5.8, "no view-only accounts"). Sorted by
 * canvas, de-duplicated, at most 256 (the claim's bound).
 */
export function normalizeAccess(access) {
  if (access === null || access === undefined) return null;
  const ok =
    typeof access === 'object' &&
    !Array.isArray(access) &&
    access.v === 1 &&
    access.role === null &&
    Array.isArray(access.grants ?? []);
  if (!ok) throw new Error('access must be a canvas-only claim ({ v: 1, role: null, grants })');
  const byCanvas = new Map();
  for (const g of access.grants ?? []) {
    if (!g || typeof g.c !== 'string' || !g.c || g.r !== 'member') {
      throw new Error('a self-hosted grant is { c: <canvas path>, r: "member" }');
    }
    byCanvas.set(g.c, { c: g.c, r: 'member' });
  }
  const grants = [...byCanvas.values()].sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : 0));
  if (grants.length > 256) throw new Error('at most 256 canvases');
  return { v: 1, role: null, grants };
}

/**
 * Create a user. Throws on a duplicate address (callers map that to 409) so a
 * signup can never silently overwrite an existing account's password.
 */
export function createUser(dataDir, { email, password, role, scope, access } = {}) {
  const normalized = assertValidEmail(email);
  assertValidPassword(password);
  const effectiveRole = assertValidRole(role);
  const storedAccess = normalizeAccess(access);
  // A canvas-only person is never an admin: `admin` is the project's owner.
  if (storedAccess && effectiveRole !== 'member') {
    throw new Error('a canvas-only account has the member role');
  }
  const storedScope = scope && scope !== '*' ? String(scope) : null;
  const handle = db(dataDir);
  if (handle.prepare('SELECT 1 FROM users WHERE email = ?').get(normalized)) {
    throw new Error(`user "${normalized}" already exists`);
  }
  const createdAt = Date.now();
  const id = newPublicId();
  handle
    .prepare(
      'INSERT INTO users (email, hash, role, scope, created_at, disabled, access, public_id) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
    )
    .run(
      normalized,
      hashPassword(password),
      effectiveRole,
      storedScope,
      createdAt,
      storedAccess ? JSON.stringify(storedAccess) : null,
      id
    );
  return {
    email: normalized,
    role: effectiveRole,
    scope: storedScope ?? '*',
    createdAt,
    disabled: false,
    id,
    ...(storedAccess ? { access: storedAccess } : {}),
  };
}

/** The account the access API names by `id` (`public_id`), or null. */
export function getUserById(dataDir, id) {
  if (typeof id !== 'string' || !/^u_[0-9a-f]{16}$/.test(id)) return null;
  try {
    const row = db(dataDir).prepare('SELECT * FROM users WHERE public_id = ?').get(id);
    return row ? rowToRecord(row) : null;
  } catch {
    return null;
  }
}

/**
 * Set (a canvas-only claim) or clear (null: the account role decides again)
 * one account's access. Returns the updated record, or null when absent.
 * Ending the sessions the old claim minted is the CALLER's job — the access
 * API pairs this with a `maude.access` notice and a graced kick.
 */
export function setUserAccess(dataDir, email, access) {
  const normalized = normalizeEmail(email);
  const stored = normalizeAccess(access);
  const handle = db(dataDir);
  const row = handle.prepare('SELECT role FROM users WHERE email = ?').get(normalized);
  if (!row) return null;
  if (stored && row.role !== 'member') throw new Error('a canvas-only account has the member role');
  handle
    .prepare('UPDATE users SET access = ? WHERE email = ?')
    .run(stored ? JSON.stringify(stored) : null, normalized);
  return getUser(dataDir, normalized);
}

export function getUser(dataDir, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  try {
    const row = db(dataDir).prepare('SELECT * FROM users WHERE email = ?').get(normalized);
    return row ? rowToRecord(row) : null;
  } catch {
    return null;
  }
}

export function listUsers(dataDir) {
  try {
    return db(dataDir)
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all()
      .map(rowToRecord);
  } catch {
    return [];
  }
}

export function userCount(dataDir) {
  try {
    return db(dataDir).prepare('SELECT COUNT(*) AS n FROM users').get().n;
  } catch {
    return 0;
  }
}

/**
 * Authenticate a password.
 *
 * Returns `{ ok: false, reason }` rather than a bare boolean so the caller can
 * log the distinction while still returning ONE opaque message to the client.
 * `reason` values: 'unknown-user' | 'bad-password' | 'disabled'.
 *
 * An unknown address still pays the scrypt cost (against a throwaway hash), so
 * response timing does not disclose whether an account exists.
 */
export function authenticate(dataDir, email, password) {
  const normalized = normalizeEmail(email);
  let row = null;
  try {
    row = normalized
      ? db(dataDir).prepare('SELECT * FROM users WHERE email = ?').get(normalized)
      : null;
  } catch {
    row = null;
  }
  if (!row) {
    verifyPassword(typeof password === 'string' ? password : '', DUMMY_HASH);
    return { ok: false, reason: 'unknown-user' };
  }
  if (!verifyPassword(password, row.hash)) return { ok: false, reason: 'bad-password' };
  // Checked AFTER the password so a disabled account can't be probed for
  // existence with an arbitrary password.
  if (row.disabled) return { ok: false, reason: 'disabled' };
  const user = rowToRecord(row);
  // A narrowed account's claim rides the result, where the mint door
  // (`claimOf` → `peerTokenDoor`) reads it: a v1 client meets 426, never a
  // project-wide session. Absent for every account without one — the v1.9.1
  // answer is unchanged.
  return { ok: true, user, ...(user.access ? { access: user.access } : {}) };
}

/** Set/clear the disabled flag. Returns the updated record, or null if absent. */
export function setUserDisabled(dataDir, email, disabled) {
  const normalized = normalizeEmail(email);
  const handle = db(dataDir);
  const info = handle
    .prepare('UPDATE users SET disabled = ? WHERE email = ?')
    .run(disabled ? 1 : 0, normalized);
  if (info.changes === 0) return null;
  return getUser(dataDir, normalized);
}

export function setUserPassword(dataDir, email, password) {
  const normalized = normalizeEmail(email);
  assertValidPassword(password);
  const info = db(dataDir)
    .prepare('UPDATE users SET hash = ? WHERE email = ?')
    .run(hashPassword(password), normalized);
  return info.changes > 0;
}

/** Permanently remove a user. Token revocation is the CALLER's job (server.mjs
 *  pairs this with revokeTokensForOwner + a session kick). */
export function removeUser(dataDir, email) {
  const normalized = normalizeEmail(email);
  const info = db(dataDir).prepare('DELETE FROM users WHERE email = ?').run(normalized);
  return info.changes > 0;
}

// A fixed, valid scrypt record used only to burn equivalent CPU on an unknown
// address. Its plaintext is irrelevant — nothing ever authenticates against it.
const DUMMY_HASH = hashPassword('maude-dummy-password-not-a-secret');

// ------------------------------------------------------- OIDC subjects (C4)

/**
 * Remember a verified subject that has no account yet.
 *
 * THE RULE THIS ENFORCES: authentication grants nothing. A subject arriving
 * from the IdP lands here and nowhere else — no row in `users`, no session, no
 * role — until an admin acts. `email` is the IdP's CLAIM, stored for display
 * so an operator can recognise who is waiting; it is never matched against.
 */
/** The queue is an operator review surface, not a log — cap it (B6). */
export const PENDING_OIDC_CAP = 500;

export function recordPendingOidc(dataDir, { sub, email = null } = {}) {
  const subject = String(sub ?? '').trim();
  if (!subject) throw new Error('recordPendingOidc: a subject is required');
  const handle = db(dataDir);
  const now = Date.now();
  // Updating an existing subject is always allowed (it is already in the
  // queue); a NEW subject is refused once the queue is full, so a bulk-
  // provisioning account at an allowlisted domain cannot bury the real
  // entries. The caller (resolveSubject) only reaches here for an
  // allowlisted, verified subject, which already bounds who can queue at all.
  const known = handle.prepare('SELECT 1 FROM oidc_pending WHERE sub = ?').get(subject);
  if (!known) {
    const count = handle.prepare('SELECT COUNT(*) AS n FROM oidc_pending').get().n;
    if (count >= PENDING_OIDC_CAP) {
      const err = new Error('the pending sign-in queue is full; an admin must clear it');
      err.code = 'PENDING_FULL';
      throw err;
    }
  }
  handle
    .prepare(
      `INSERT INTO oidc_pending (sub, email, first_seen, last_attempt) VALUES (?, ?, ?, ?)
       ON CONFLICT(sub) DO UPDATE SET last_attempt = excluded.last_attempt,
                                      email = COALESCE(excluded.email, oidc_pending.email)`
    )
    .run(subject, email ? String(email).trim().toLowerCase() : null, now, now);
  return { sub: subject, email, firstSeen: now, lastAttempt: now };
}

/** How many accounts have an OIDC identity linked — the strict-mode boot gate. */
export function countLinkedOidc(dataDir) {
  try {
    return db(dataDir).prepare('SELECT COUNT(*) AS n FROM users WHERE oidc_sub IS NOT NULL').get()
      .n;
  } catch {
    return 0;
  }
}

/** Everyone waiting for an admin to act. Rendered by the People view. */
export function listPendingOidc(dataDir) {
  return db(dataDir)
    .prepare('SELECT sub, email, first_seen, last_attempt FROM oidc_pending ORDER BY first_seen')
    .all()
    .map((r) => ({
      sub: r.sub,
      email: r.email,
      firstSeen: r.first_seen,
      lastAttempt: r.last_attempt,
    }));
}

export function removePendingOidc(dataDir, sub) {
  return db(dataDir).prepare('DELETE FROM oidc_pending WHERE sub = ?').run(String(sub)).changes > 0;
}

/** The account a verified subject maps to, or null. Identity IS the subject. */
export function getUserByOidcSub(dataDir, sub) {
  const subject = String(sub ?? '').trim();
  if (!subject) return null;
  const row = db(dataDir).prepare('SELECT * FROM users WHERE oidc_sub = ?').get(subject);
  return row ? rowToRecord(row) : null;
}

/**
 * Bind a verified subject to an existing account — AN EXPLICIT ADMIN ACT.
 *
 * This is the function whose ABSENCE from the sign-in path is the security
 * property. The first draft of this track had sign-in auto-link "when the email
 * already exists"; `users.mjs` keys accounts BY EMAIL, and `createUser`'s own
 * docstring says it throws on a duplicate address "so a signup can never
 * silently overwrite an existing account's password". Auto-linking does not
 * defeat a missing guard — it routes around that one, reaching the same
 * outcome by aliasing an identity onto the row instead of rewriting its hash.
 * One request asserting `admin@company.com` at a permissive issuer would have
 * been enough.
 */
export function linkOidcSub(dataDir, email, sub) {
  const normalized = assertValidEmail(email);
  const subject = String(sub ?? '').trim();
  if (!subject) throw new Error('linkOidcSub: a subject is required');
  const handle = db(dataDir);
  const owner = handle.prepare('SELECT email FROM users WHERE oidc_sub = ?').get(subject);
  if (owner && owner.email !== normalized) {
    throw new Error(`that identity is already linked to ${owner.email}`);
  }
  // NEVER OVERWRITE A LINK. An account that already signs in with one identity
  // does not silently start signing in with another: that swap is a takeover
  // with an audit line. Changing it is two explicit acts — `unlinkOidcSub`
  // (admin key), then link.
  const row = handle.prepare('SELECT oidc_sub FROM users WHERE email = ?').get(normalized);
  if (!row) throw new Error(`no such user "${normalized}"`);
  if (row.oidc_sub && row.oidc_sub !== subject) {
    throw new Error('this account already has a different sign-in linked — unlink it first');
  }
  linkAndRetirePassword(handle, normalized, subject);
  removePendingOidc(dataDir, subject);
  clearTurnedOut(dataDir, { sub: subject, email: normalized });
  return getUserByOidcSub(dataDir, subject);
}

/**
 * Set the link AND replace the password hash with one nobody knows.
 *
 * Whoever made this account first chose its password — and on an open invite
 * that can be someone who typed an address that is not theirs. Once the real
 * owner (or an admin) links the provider identity, that older password must
 * not remain a second way in. Password sign-in is dead for this account until
 * an admin-key reset. Ending the SESSIONS that password already minted is the
 * caller's job (it knows which one, if any, to keep).
 */
function linkAndRetirePassword(handle, email, subject) {
  handle
    .prepare('UPDATE users SET oidc_sub = ?, hash = ? WHERE email = ?')
    .run(subject, hashPassword(randomBytes(32).toString('base64url')), email);
}

/**
 * Remove an account's provider link — an explicit ADMIN-KEY act, and the only
 * way a linked account can be linked to a different identity afterwards.
 * Returns the subject that was linked, or null.
 */
export function unlinkOidcSub(dataDir, email) {
  const normalized = normalizeEmail(email);
  const handle = db(dataDir);
  const row = handle.prepare('SELECT oidc_sub FROM users WHERE email = ?').get(normalized);
  if (!row?.oidc_sub) return null;
  handle.prepare('UPDATE users SET oidc_sub = NULL WHERE email = ?').run(normalized);
  return row.oidc_sub;
}

// ------------------------------------------------ removed / dismissed people

/**
 * Remember that an admin turned this identity out (Remove, Dismiss).
 * `sub` and `email` are each optional; whichever is known is remembered.
 */
export function markTurnedOut(dataDir, { sub = '', email = '' } = {}) {
  const subject = typeof sub === 'string' ? sub.trim() : '';
  const address = normalizeEmail(email);
  if (!subject && !address) return;
  db(dataDir)
    .prepare('INSERT OR REPLACE INTO oidc_turned_out (sub, email, at) VALUES (?, ?, ?)')
    .run(subject, address, Date.now());
}

/** Was this subject OR this address turned out by an admin? */
export function isTurnedOut(dataDir, { sub = '', email = '' } = {}) {
  const subject = typeof sub === 'string' ? sub.trim() : '';
  const address = normalizeEmail(email);
  try {
    return Boolean(
      db(dataDir)
        .prepare(
          `SELECT 1 FROM oidc_turned_out
            WHERE (? != '' AND sub = ?) OR (? != '' AND email = ?) LIMIT 1`
        )
        .get(subject, subject, address, address)
    );
  } catch {
    // Unreadable is "turned out": the safe side of an auto-admit decision.
    return true;
  }
}

/** An admin said yes again (Let in, a link, an invitation that names the address). */
export function clearTurnedOut(dataDir, { sub = '', email = '' } = {}) {
  const subject = typeof sub === 'string' ? sub.trim() : '';
  const address = normalizeEmail(email);
  db(dataDir)
    .prepare(
      `DELETE FROM oidc_turned_out
        WHERE (? != '' AND sub = ?) OR (? != '' AND email = ?)`
    )
    .run(subject, subject, address, address);
}

/**
 * Remove an account AND remember its identity as turned out, so "Remove"
 * sticks whatever "who can join" says. Token revocation stays the caller's.
 */
export function removeUserForGood(dataDir, email) {
  const normalized = normalizeEmail(email);
  const handle = db(dataDir);
  const row = handle.prepare('SELECT oidc_sub FROM users WHERE email = ?').get(normalized);
  if (!row) return false;
  markTurnedOut(dataDir, { sub: row.oidc_sub ?? '', email: normalized });
  return removeUser(dataDir, normalized);
}

/**
 * Approve a pending identity: CREATE the account for `email` and link the
 * subject to it, in one transaction.
 *
 * The gap this closes (2026-08-21): a person invited by link who signed in
 * through the provider instead landed in `oidc_pending`, and the only verbs the
 * admin had were "Link to an EXISTING account" (→ `no such user`) and
 * "dismiss". Creating the account first meant inventing an initial password
 * for someone who will never use one. So: the account is created with a
 * random, never-revealed password — it is an OIDC-only account; a later
 * "Reset" in the console gives it a password if one is ever wanted — and the
 * subject is linked in the same step.
 *
 * What it deliberately is NOT: a lookup by the claimed email. `email` is what
 * the ADMIN typed or confirmed. If an account with that address already
 * exists this throws — that case is `linkOidcSub`, the explicit act of
 * attaching an identity to an existing account, and the two must not blur
 * (oidc-routes.mjs: matching an IdP-asserted address to an existing account is
 * the takeover).
 */
export function approveOidcSub(dataDir, { sub, email, role } = {}) {
  const subject = typeof sub === 'string' ? sub.trim() : '';
  if (!subject) throw new Error('approveOidcSub: a subject is required');
  const handle = db(dataDir);
  const owner = handle.prepare('SELECT email FROM users WHERE oidc_sub = ?').get(subject);
  if (owner) throw new Error(`that identity is already linked to ${owner.email}`);
  // Approve is "let the person in MY queue in" — the subject must be one the
  // provider actually presented here. A typed-in subject is not an approval,
  // it is an account pre-created for an identity nobody has seen.
  if (!handle.prepare('SELECT 1 FROM oidc_pending WHERE sub = ?').get(subject)) {
    throw new Error('that identity is not waiting for access');
  }
  const run = handle.transaction(() => {
    // 32 random bytes, base64url — nobody knows it, nothing ever types it.
    const user = createUser(dataDir, {
      email,
      password: randomBytes(32).toString('base64url'),
      role,
    });
    handle.prepare('UPDATE users SET oidc_sub = ? WHERE email = ?').run(subject, user.email);
    removePendingOidc(dataDir, subject);
    return user.email;
  });
  const address = run();
  // "Let in" is the admin saying yes: a person once removed or dismissed is welcome again.
  clearTurnedOut(dataDir, { sub: subject, email: address });
  return getUserByOidcSub(dataDir, subject) ?? getUser(dataDir, address);
}

// ------------------------------------- the invite / the rule as the approval

/**
 * Create an account FOR a verified subject and link it, in one transaction.
 *
 * The callers are the two places where something other than an admin's click
 * is the approval: an invitation the person holds (browser-auth.mjs → the
 * invite rides through the provider sign-in), and the "colleagues come
 * straight in" rule (settings.mjs `whoCanJoin: 'domain'`).
 *
 * What makes it safe is what it REFUSES: an address that already has an
 * account (that is `linkOidcSub`'s explicit act — never a match on the
 * provider's claim), and a subject that is already somebody. `email` must be
 * the provider's VERIFIED, allow-listed address (`usableEmailClaim`); the
 * caller checks that, this function cannot.
 *
 * The password is 32 random bytes nobody ever sees, exactly as in
 * `approveOidcSub`: this is a provider-only account until an admin resets it.
 */
export function createOidcUser(dataDir, { sub, email, role, access } = {}) {
  const subject = typeof sub === 'string' ? sub.trim() : '';
  if (!subject) throw new Error('createOidcUser: a subject is required');
  const handle = db(dataDir);
  const owner = handle.prepare('SELECT email FROM users WHERE oidc_sub = ?').get(subject);
  if (owner) throw new Error(`that identity is already linked to ${owner.email}`);
  const run = handle.transaction(() => {
    const user = createUser(dataDir, {
      email,
      password: randomBytes(32).toString('base64url'),
      role,
      ...(access ? { access } : {}),
    });
    handle.prepare('UPDATE users SET oidc_sub = ? WHERE email = ?').run(subject, user.email);
    removePendingOidc(dataDir, subject);
    return user;
  });
  return run();
}

/**
 * "Link my sign-in" — the account holder links their OWN provider identity.
 *
 * `email` is the account of the session that started the flow (never a claim);
 * the caller has already required the provider's verified address to be that
 * same address. Refuses a subject that is someone else's, and an account that
 * already has a different identity (changing one is an admin's `linkOidcSub`).
 */
export function selfLinkOidcSub(dataDir, email, sub) {
  const normalized = assertValidEmail(email);
  const subject = typeof sub === 'string' ? sub.trim() : '';
  if (!subject) throw new Error('selfLinkOidcSub: a subject is required');
  const handle = db(dataDir);
  const row = handle
    .prepare('SELECT oidc_sub, disabled FROM users WHERE email = ?')
    .get(normalized);
  if (!row) throw new Error('no such account');
  if (row.disabled) throw new Error('this account is turned off');
  if (row.oidc_sub && row.oidc_sub !== subject) {
    throw new Error('this account already has a different sign-in linked');
  }
  const owner = handle.prepare('SELECT email FROM users WHERE oidc_sub = ?').get(subject);
  if (owner && owner.email !== normalized) {
    throw new Error('that sign-in belongs to another account');
  }
  // Same as an admin's link: the password this account was made with stops
  // working. The caller ends every session but the one doing the linking.
  linkAndRetirePassword(handle, normalized, subject);
  removePendingOidc(dataDir, subject);
  clearTurnedOut(dataDir, { sub: subject, email: normalized });
  return getUser(dataDir, normalized);
}

/** The addresses whose account has a provider identity linked. */
export function oidcLinkedEmails(dataDir) {
  try {
    return new Set(
      db(dataDir)
        .prepare('SELECT email FROM users WHERE oidc_sub IS NOT NULL')
        .all()
        .map((r) => r.email)
    );
  } catch {
    return new Set();
  }
}

/** One pending identity by subject, or null. */
export function getPendingOidc(dataDir, sub) {
  const r = db(dataDir)
    .prepare('SELECT sub, email, first_seen, last_attempt FROM oidc_pending WHERE sub = ?')
    .get(String(sub ?? ''));
  return r
    ? { sub: r.sub, email: r.email, firstSeen: r.first_seen, lastAttempt: r.last_attempt }
    : null;
}

/**
 * Change an account's role (admin ⇄ member). Returns the updated record, or
 * null when there is no such account. A canvas-only account is never an admin
 * (the same rule `createUser` and `setUserAccess` keep). Ending the sessions
 * minted under the old role is the CALLER's job.
 */
export function setUserRole(dataDir, email, role) {
  const normalized = normalizeEmail(email);
  if (role !== 'admin' && role !== 'member') throw new Error('role must be one of: admin, member');
  const handle = db(dataDir);
  const row = handle.prepare('SELECT access FROM users WHERE email = ?').get(normalized);
  if (!row) return null;
  if (role === 'admin' && row.access) {
    throw new Error('this person only has some canvases — give them the whole project first');
  }
  handle.prepare('UPDATE users SET role = ? WHERE email = ?').run(role, normalized);
  return getUser(dataDir, normalized);
}

/** How many accounts are admins that can sign in. */
export function activeAdminCount(dataDir) {
  try {
    return db(dataDir)
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0")
      .get().n;
  } catch {
    return 0;
  }
}
