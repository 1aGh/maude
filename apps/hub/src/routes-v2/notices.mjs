// Access notices — V2-1.7 §5.6 hub stateless messages (S9.6).
//
// Two envelopes, both on the `maude.mode` family V2-1.12 already uses (a
// client that does not know a `type` drops the frame):
//
//   { type: 'maude.access', epoch, change: 'raised' | 'narrowed' | 'ended',
//     reason?: 'removed' | 'link-off' | 'expired' }
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
  function accessChanged({ email, change, reason }) {
    const who = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!who || !ACCESS_CHANGES.includes(change)) {
      throw new Error('accessChanged: an email and a known change are required');
    }
    const payload = {
      type: 'maude.access',
      epoch: nextEpoch(),
      change,
      ...(reason && ACCESS_REASONS.includes(reason) ? { reason } : {}),
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
            n = endSessions(who);
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
