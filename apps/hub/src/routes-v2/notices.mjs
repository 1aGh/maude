// Access notices — V2-1.7 §5.6 hub stateless messages (S9.6).
//
// Two envelopes, both on the `maude.mode` family V2-1.12 already uses (a
// client that does not know a `type` drops the frame):
//
//   { type: 'maude.access', epoch, change: 'raised' | 'narrowed' | 'ended',
//     reason?: 'removed' | 'link-off' | 'expired',
//     by?: { name }, role?: <wire role>   (a narrowing only — P8 G1a)}
//     → ONLY the connections whose verified e-mail is the affected person's.
//       It carries NO grant data: the client re-exchanges and reads
//       `/api/access/me`. On `narrowed` / `ended` the hub waits `graceMs`
//       (`switchGraceMs`, 1.5 s) before it ends that person's sessions, so a
//       flush the client sent before the notice reached it still lands —
//       "Your last changes were saved first".
//
//   { type: 'maude.access-request', id, from: { name }, canvas?, at }
//     → ONLY connections whose session can `invite` (the owner's).
//
// `maude.files` stays one integer (decision d_820067712f8334f84fa39c30): no
// access traffic ever rides the ctl channel.
//
// The identity of a connection is what `onAuthenticate` VERIFIED and put on
// its context (`user.email`, `user.access`), never anything a client said.

import { resolveAccess } from '../../../studio/access/scope.ts';

export const ACCESS_CHANGES = Object.freeze(['raised', 'narrowed', 'ended']);
export const ACCESS_REASONS = Object.freeze(['removed', 'link-off', 'expired']);
/** P8 G1a — the wire roles a narrowing may name (`role`): what the person is NOW. */
export const NOTICE_ROLES = Object.freeze(['owner', 'member', 'viewer', 'observer']);
/** C0 / C1 controls, zero-width, line / paragraph separators, bidi, BOM — never in a name. */
const NAME_CONTROL_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to strip control characters from a name
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;
/** Who narrowed, as one short line of text ('' = say nobody). */
export function noticeName(v) {
  if (typeof v !== 'string') return '';
  return v.replace(NAME_CONTROL_RE, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** The V2-1.12 grace a mode switch already gives peers (hub-integration.mjs). */
export const DEFAULT_GRACE_MS = 1500;

const emailOf = (connection) => {
  const e = connection?.context?.user?.email;
  return typeof e === 'string' && e ? e.trim().toLowerCase() : null;
};

function send(connection, payload) {
  try {
    connection.sendStateless(JSON.stringify(payload));
    return true;
  } catch {
    return false; // a closing socket — the kick or its own close ends it anyway
  }
}

/**
 * @param {{
 *   connections: () => Iterable<object>,         // one Hocuspocus connection per live socket
 *   endSessions: (email: string) => number,       // revoke that person's peer tokens + kick their sockets
 *   remember?: (email: string, reason?: string) => unknown, // S9.21d: an ENDED person's sessions, before they die
 *   graceMs?: number,
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => unknown,
 * }} deps
 */
export function createAccessNotices({
  connections,
  endSessions,
  remember = () => 0,
  graceMs = DEFAULT_GRACE_MS,
  now = Date.now,
  setTimer = (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
}) {
  let epoch = 0;
  const nextEpoch = () => {
    epoch = Math.max(epoch + 1, now());
    return epoch;
  };
  const live = () => {
    const out = [];
    for (const c of connections() ?? [])
      if (c && typeof c.sendStateless === 'function') out.push(c);
    return out;
  };

  /**
   * Somebody's access changed. Returns how many connections heard it; for a
   * narrowing or an ending, `ended` resolves once the graced kick has run.
   */
  function accessChanged({ email, change, reason, by, role }) {
    const who = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!who || !ACCESS_CHANGES.includes(change)) {
      throw new Error('accessChanged: an email and a known change are required');
    }
    const payload = {
      type: 'maude.access',
      epoch: nextEpoch(),
      change,
      ...(reason && ACCESS_REASONS.includes(reason) ? { reason } : {}),
      // P8 G1a (11 pn-cant-open) — a narrowing may say who did it (a name, never an address) and the
      // role now, for "Tereza changed you to Can view." Additive: a client that does not read them
      // rebuilds the frame from the keys it knows (sync/access-notices.ts) and drops these.
      ...(change === 'narrowed' && noticeName(by) ? { by: { name: noticeName(by) } } : {}),
      ...(change === 'narrowed' && NOTICE_ROLES.includes(role) ? { role } : {}),
    };
    // S9.21d — a browser tab hears none of this frame (desktop shells only); its
    // next request does. Remember the sessions NOW, before the grace: the sweep
    // `endSessions` runs first would otherwise delete them unseen.
    if (change === 'ended') {
      try {
        remember(who, payload.reason);
      } catch (err) {
        console.error(`[access] remembering ended sessions failed: ${err?.message ?? err}`);
      }
    }
    let sent = 0;
    for (const c of live()) if (emailOf(c) === who && send(c, payload)) sent += 1;
    if (change === 'raised') return { sent, ended: Promise.resolve(0) };
    const ended = new Promise((resolve) => {
      setTimer(
        () => {
          let n = 0;
          try {
            // P8 G1a — a narrowing names the role now; the hub spares only tokens granting exactly it.
            n = endSessions(
              who,
              change === 'narrowed' && payload.role ? { keepRole: payload.role } : undefined
            );
          } catch (err) {
            console.error(`[access] ending sessions failed: ${err?.message ?? err}`);
          }
          resolve(n);
        },
        Math.max(0, graceMs)
      );
    });
    return { sent, ended };
  }

  /** Tell the owners someone asked to edit. Returns how many heard it. */
  function accessRequested({ id, from, canvas = null, at = now() }) {
    const payload = {
      type: 'maude.access-request',
      id,
      from: { name: String(from?.name ?? '') },
      ...(canvas ? { canvas } : {}),
      at,
    };
    let sent = 0;
    for (const c of live()) {
      const claim = c?.context?.user?.access ?? null;
      if (!claim) continue;
      if (!resolveAccess(claim).can('invite', null)) continue;
      if (send(c, payload)) sent += 1;
    }
    return sent;
  }

  return { accessChanged, accessRequested };
}
