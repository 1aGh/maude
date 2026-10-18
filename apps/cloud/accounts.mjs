// Control-plane accounts + sessions — Cloud Phase 13.
//
// ONE account (DDR-197 debate: "nobody logs in twice"). Two doors into it:
// email+password here, Google in oauth-google.mjs — both land on the same row.
//
// The rules that carry the security weight:
//
//   1. UNKNOWN ADDRESS BURNS FULL COST. authenticate() derives against a dummy
//      hash when there is no row, so neither the body nor the clock says
//      whether an address exists (same discipline as the hub).
//   2. NO SILENT MERGE. A Google sign-in whose email matches an existing
//      password account links ONLY if that account's address was verified.
//      Otherwise anyone could pre-register victim@gmail.com with a password
//      and capture the victim's Google sign-in — or the reverse.
//   3. SESSIONS ARE ROWS; the cookie value is random and only its SHA-256 is
//      stored. Revocation deletes the row and the session is over — not
//      "over at the next refresh".

import { assertValidPassword, DUMMY_HASH, hashPassword, verifyPassword } from './passwords.mjs';

const SESSION_TTL_MS = 30 * 24 * 3600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const encoder = new TextEncoder();

// Exported because email-tokens.mjs stores its links the same way sessions are
// stored — random value out, SHA-256 in the row. Two copies of "how we mint and
// hash a credential" is how one of them ends up with 8 bytes of entropy.
export async function sha256Hex(value) {
  const d = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

export function normalizeEmail(raw) {
  const email = String(raw ?? '')
    .trim()
    .toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

// ------------------------------------------------------------------ accounts

export async function createAccount(
  db,
  { email, password = null, name = null, googleSub = null, emailVerified = false },
  { now = Date.now() } = {}
) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('that address does not look like an email');
  if (password !== null) assertValidPassword(password);

  const existing = await db
    .prepare('SELECT id FROM accounts WHERE email = ?')
    .bind(normalized)
    .first();
  // A duplicate signup must not say "this address already has an account" to a
  // stranger — but the flow needs to know. Callers translate to a neutral
  // user-facing message; the thrown name is for code, not for the response.
  if (existing) {
    const err = new Error('account-exists');
    err.code = 'account-exists';
    throw err;
  }

  const id = `acct_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await db
    .prepare(
      'INSERT INTO accounts (id, email, name, created_at, password_hash, google_sub, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      id,
      normalized,
      name,
      now,
      password !== null ? await hashPassword(password) : null,
      googleSub,
      emailVerified ? now : null
    )
    .run();
  return { id, email: normalized };
}

export async function getAccountByEmail(db, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return db.prepare('SELECT * FROM accounts WHERE email = ?').bind(normalized).first();
}

/**
 * Email+password authentication. Returns `{ ok, account? , reason? }` with one
 * opaque failure shape — the caller's HTTP response must not distinguish.
 */
export async function authenticate(db, email, password) {
  const row = await getAccountByEmail(db, email);
  if (!row?.password_hash) {
    await verifyPassword(typeof password === 'string' ? password : '', DUMMY_HASH);
    return { ok: false, reason: row ? 'no-password-set' : 'unknown-account' };
  }
  if (!(await verifyPassword(password, row.password_hash))) {
    return { ok: false, reason: 'bad-password' };
  }
  return { ok: true, account: { id: row.id, email: row.email, name: row.name } };
}

/**
 * Record that this address was proven to belong to whoever holds the account.
 *
 * THE WRITE THAT WAS MISSING (RCA 2026-08-04). `accountForGoogle`'s
 * no-silent-merge rule refuses a Google sign-in until `email_verified_at` is
 * set — and for two phases nothing in the product could set it. The only
 * caller that ever produced the state was a test fixture reaching around the
 * app with raw SQL, which is exactly what an unreachable state looks like from
 * the inside. Every password account was therefore barred from Google
 * permanently, with no reset to fall back on: a lockout wearing a policy's
 * clothes.
 *
 * Callers must have PROOF of mailbox control — a consumed verification link or
 * a consumed reset link. Nothing here checks that; the token is the proof and
 * email-tokens.mjs is where it is verified.
 *
 * COALESCE, so re-verifying keeps the FIRST proof's timestamp — the date this
 * address became trusted is a fact about the past, not about the last click.
 */
export async function markEmailVerified(db, accountId, { now = Date.now() } = {}) {
  await db
    .prepare('UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?')
    .bind(now, accountId)
    .run();
}

/**
 * Set (or replace) an account's password — the tail of a reset.
 *
 * Verifies the address as a side effect, and deliberately so: the only way to
 * reach this is by holding a link we mailed to that address, which is the same
 * proof a verification link carries. Making the caller remember to also call
 * `markEmailVerified` is how one path forgets.
 *
 * Live sessions are NOT revoked here — that is the caller's decision, because
 * "reset my password" and "an admin set one for me" want opposite answers.
 */
export async function setPassword(db, accountId, password, { now = Date.now() } = {}) {
  assertValidPassword(password);
  await db
    .prepare(
      'UPDATE accounts SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?'
    )
    .bind(await hashPassword(password), now, accountId)
    .run();
}

/**
 * Resolve a Google identity to an account — the NO-SILENT-MERGE rule.
 *
 * Returns `{ action: 'signed-in'|'created'|'refused', account?, reason? }`.
 */
export async function accountForGoogle(
  db,
  { sub, email, emailVerified },
  { now = Date.now() } = {}
) {
  if (!sub) return { action: 'refused', reason: 'no-google-subject' };

  const linked = await db.prepare('SELECT * FROM accounts WHERE google_sub = ?').bind(sub).first();
  if (linked) {
    return { action: 'signed-in', account: { id: linked.id, email: linked.email } };
  }

  // Google-side unverified addresses never link or create — Google itself
  // does not vouch for them.
  if (!emailVerified) return { action: 'refused', reason: 'google-email-unverified' };

  const normalized = normalizeEmail(email);
  if (!normalized) return { action: 'refused', reason: 'bad-email' };

  const byEmail = await db
    .prepare('SELECT * FROM accounts WHERE email = ?')
    .bind(normalized)
    .first();
  if (byEmail) {
    if (!byEmail.email_verified_at && byEmail.password_hash) {
      // The account-takeover primitive from the plan: an unverified password
      // account squatting on this address must not capture the Google user
      // (nor be captured). The password holder proves the address first.
      return { action: 'refused', reason: 'unverified-password-account' };
    }
    await db
      .prepare(
        'UPDATE accounts SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?'
      )
      .bind(sub, now, byEmail.id)
      .run();
    return { action: 'signed-in', account: { id: byEmail.id, email: byEmail.email } };
  }

  const account = await createAccount(
    db,
    { email: normalized, googleSub: sub, emailVerified: true },
    { now }
  );
  return { action: 'created', account };
}

// ------------------------------------------------------------------ sessions

export async function createSession(db, accountId, { now = Date.now() } = {}) {
  const token = randomToken('mcs');
  await db
    .prepare('INSERT INTO sessions (id, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), accountId, now, now + SESSION_TTL_MS)
    .run();
  // Every sign-in door ends here, so this is "the first sign-in" (A3).
  await startTrial(db, accountId, { now });
  return { token, expiresAt: now + SESSION_TTL_MS };
}

// --------------------------------------------------------------------- trial

/**
 * Start the account's A3 trial if it has not started (Maude v2 S9.15).
 *
 * COALESCE: the FIRST sign-in is the start, a later one never moves it. Best
 * effort — a D1 that has not met its v19 migration yet must not fail a sign-in.
 */
export async function startTrial(db, accountId, { now = Date.now() } = {}) {
  try {
    await db
      .prepare('UPDATE accounts SET trial_started_at = COALESCE(trial_started_at, ?) WHERE id = ?')
      .bind(now, accountId)
      .run();
  } catch {
    /* pre-v19 D1: the trial starts at the next sign-in */
  }
}

/**
 * The key a trial claim is stored under: the normalized address, hashed and
 * domain-separated. A claim outlives its account row (that is its point), and
 * a hash is all it needs to keep.
 */
export async function trialEmailKey(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('trialEmailKey: not an address');
  return sha256Hex(`maude-trial:${normalized}`);
}

export async function sessionAccount(db, token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token.startsWith('mcs_')) return null;
  const row = await db
    .prepare(
      'SELECT a.id, a.email, a.name, a.stripe_customer_id, a.disclosure_accepted_at FROM sessions s JOIN accounts a ON a.id = s.account_id ' +
        'WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?'
    )
    .bind(await sha256Hex(token), now)
    .first();
  return row ?? null;
}

export async function revokeSession(db, token, { now = Date.now() } = {}) {
  if (typeof token !== 'string') return;
  await db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(now, await sha256Hex(token))
    .run();
}

/** Revoke every live session for an account — offboarding that offboards. */
export async function revokeAccountSessions(db, accountId, { now = Date.now() } = {}) {
  await db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL')
    .bind(now, accountId)
    .run();
}
