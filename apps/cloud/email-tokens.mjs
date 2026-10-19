// Links we mail to an address to prove somebody reads it — RCA 2026-08-04.
//
// Two flows need the same primitive and must NOT share an instance of it:
//
//   'verify' — you own this address, so Google may link to your account
//   'reset'  — you own this address, so you may choose a new password
//   'unsub'  — stop mention e-mails to this account (S9.18). It does that and
//              NOTHING else: it is not a session (sessions are their own
//              table, keyed by an `mcs_` value), not a verify, not a reset.
//
// The PURPOSE IS BOUND INTO THE ROW and re-checked on consumption. Without
// that, a verification link (24h, sits in an inbox) would also be a password
// reset, and the weakest of the two flows would set the strength of both.
//
// Posture, mirroring sessions and handoff codes:
//   - the value goes out once and is never stored; the row keys on its SHA-256,
//     so a database dump is not a bag of live links;
//   - single use, enforced by a conditional UPDATE whose `changes` count is the
//     verdict — two simultaneous clicks cannot both win;
//   - minting supersedes this account's earlier live links of the SAME purpose,
//     so "send me another one" means the previous one stops working — except
//     'unsub', where every mention e-mail carries its own link and an older
//     e-mail's "stop these" must keep working after a newer one arrives.

import { randomToken, sha256Hex } from './accounts.mjs';

/**
 * TTLs, chosen by what the link can do rather than by convenience.
 *
 * A reset link is a credential — it sets a password. It gets an hour. A verify
 * link only asserts a fact the holder already proved by receiving it, and gets
 * a day, because "confirm your address" mail is routinely read the next
 * morning and a flow that expires overnight is a flow people give up on.
 */
export const TOKEN_TTL_MS = {
  verify: 24 * 3600_000,
  reset: 3600_000,
  // An unsubscribe link can only turn e-mail OFF, and people act on old mail:
  // it lives as long as an inbox is plausibly read.
  unsub: 60 * 24 * 3600_000,
};

const PREFIX = { verify: 'mev', reset: 'mer', unsub: 'meu' };

/** Purposes whose newer link kills the older ones ("send me another one"). */
const SUPERSEDES = { verify: true, reset: true, unsub: false };

/** The purposes this module will act on. Anything else is a programming error. */
function assertPurpose(purpose) {
  if (!Object.hasOwn(PREFIX, purpose)) throw new Error(`unknown email link purpose: ${purpose}`);
}

/**
 * Mint a single-use link value for one account and purpose.
 *
 * Returns `{ token, expiresAt }`. The token is the ONLY copy — it goes into an
 * email and is not recoverable afterwards.
 */
export async function mintEmailToken(db, { accountId, purpose }, { now = Date.now() } = {}) {
  assertPurpose(purpose);
  // Supersede first. If minting failed halfway, the safe residue is "no live
  // link" rather than "two live links, one of them unaccounted for".
  if (SUPERSEDES[purpose]) {
    await db
      .prepare(
        'UPDATE email_tokens SET used_at = ? WHERE account_id = ? AND purpose = ? AND used_at IS NULL'
      )
      .bind(now, accountId, purpose)
      .run();
  }

  const token = randomToken(PREFIX[purpose]);
  const expiresAt = now + TOKEN_TTL_MS[purpose];
  await db
    .prepare(
      'INSERT INTO email_tokens (id, account_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(await sha256Hex(token), accountId, purpose, now, expiresAt)
    .run();
  return { token, expiresAt };
}

/**
 * Look at a link WITHOUT spending it — for rendering the reset form.
 *
 * The form's GET must be able to say "this link is dead, ask for a new one"
 * before the person types a password. Consuming here instead would burn the
 * link on a page load, so a refresh, a link preview fetch, or a mail client's
 * safe-browsing prefetch would silently destroy it.
 */
export async function peekEmailToken(db, token, purpose, { now = Date.now() } = {}) {
  assertPurpose(purpose);
  if (typeof token !== 'string' || !token.startsWith(`${PREFIX[purpose]}_`)) {
    return { ok: false, reason: 'malformed' };
  }
  const row = await db
    .prepare('SELECT * FROM email_tokens WHERE id = ?')
    .bind(await sha256Hex(token))
    .first();
  // One shape for every failure. A link that is expired, spent, or invented
  // must not be distinguishable — otherwise the page reports which guesses got
  // closer.
  if (!row || row.purpose !== purpose || row.used_at || row.expires_at <= now) {
    return { ok: false, reason: 'dead' };
  }
  return { ok: true, accountId: row.account_id, expiresAt: row.expires_at };
}

/**
 * Spend a link. Returns `{ ok, accountId? }`.
 *
 * The burn is a CONDITIONAL update (`used_at IS NULL`) and the row count is the
 * verdict — checking `used_at` in a prior SELECT and then updating would let
 * two concurrent submissions both pass the check.
 */
export async function consumeEmailToken(db, token, purpose, { now = Date.now() } = {}) {
  const seen = await peekEmailToken(db, token, purpose, { now });
  if (!seen.ok) return seen;
  const burn = await db
    .prepare('UPDATE email_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .bind(now, await sha256Hex(token))
    .run();
  if (burn?.meta?.changes !== 1) return { ok: false, reason: 'dead' };
  return { ok: true, accountId: seen.accountId };
}
