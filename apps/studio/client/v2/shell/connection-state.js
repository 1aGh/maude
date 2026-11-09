// client/v2/shell/connection-state.js — 2.1.1 T2: is THIS project's connection working, and whose move
// is it? (canvas 17 · ac-states). PURE: one place derives the state the account chip's badge, the save
// word, the avatar menu's project block and the once-per-session toast all say.
//
// Eight states, from what the page already holds:
//   local            no `linkedHub` in this folder: nothing leaves this Mac (a plain laptop, never a badge)
//   unconfirmed      the folder NAMES a server this Mac never linked or confirmed (`/_api/cloud/status`
//                    `linkedHub.confirmed === false`, from this Mac's link record — gate-b-sec4 parked it).
//                    A committed address is a peer's text: no toast, no badge, no prefilled sign-in — only
//                    a neutral line and Review…, which opens the Share sheet's Connect (the consent step).
//   signin-missing   a server this Mac linked (`confirmed`) and holds no sign-in for
//                    (`linkedHub.credentialed === false`)
//   signin-rejected  the server refuses the sign-in this Mac holds: the accepted lane's
//                    `accepted.credentialRefused` (sync/status.ts), or every document refused with
//                    `invalid-token` (DDR-102's own classification, sync/index.ts `AuthFailureClass`)
//   offline          this Mac has no network (`navigator.onLine === false`) — the face greys, nothing to do
//   unreachable      the network is up but the server does not answer (the hub monitor's offline /
//                    offline-long, or syncPresentation's offline / stalled)
//   syncing          a pass is running or changes are going out
//   connected        everything else on a linked folder
//
// The badge says whose move it is (canvas 17 note 2): `broken` only for a sign-in the person can repair
// in one click, `warn` for the server's side, `grey` for the network, a turning `ring` while syncing.

import { isCloudHub } from '../settings/connections-model.js';

export const CONNECTION_STATES = Object.freeze([
  'connected',
  'syncing',
  'offline',
  'signin-missing',
  'signin-rejected',
  'unreachable',
  'unconfirmed',
  'local',
]);

const UNREACHABLE_PHASES = new Set(['offline', 'stalled']);
const SYNCING_PHASES = new Set(['connecting', 'syncing']);

/** host, plus the port when it is not the scheme's default — how every surface names a server */
export function hostOf(url) {
  try {
    return new URL(String(url)).host.toLowerCase();
  } catch {
    return '';
  }
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const count = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

/** The sign-in this Mac holds is refused (only a literal `true`, never a guess). */
export function signInRefused(syncStatus) {
  const s = syncStatus && typeof syncStatus === 'object' ? syncStatus : null;
  if (!s) return false;
  if (s.accepted && typeof s.accepted === 'object' && s.accepted.credentialRefused === true)
    return true;
  // Every document refused, and refused for an invalid token: the sign-in itself stopped working.
  const docs = s.docs && typeof s.docs === 'object' ? s.docs : null;
  const items = Array.isArray(s.items) ? s.items : [];
  if (!docs || count(docs.rejected) === 0 || count(docs.synced) > 0) return false;
  return items.some((i) => i?.state === 'auth-rejected' && i?.reason === 'invalid-token');
}

/**
 * @param in.linkedHub   `/_api/cloud/status` `linkedHub` — `{ url, credentialed, confirmed }` or null
 * @param in.cloudUrl    the Maude Cloud address this Mac signs in against (tells cloud from your server)
 * @param in.syncStatus  the shell's raw sync status (the hub monitor + the accepted lane)
 * @param in.phase       syncPresentation(syncStatus).phase, or null
 * @param in.pending     changes still going out (queued ops + the outbox)
 * @param in.online      false only when the browser says there is no network
 * @returns {{ state, kind: 'cloud'|'server'|'local', host: string|null, url: string|null,
 *             (an unconfirmed claim is kind 'local' — nothing leaves this Mac — with the named host)
 *             badge: 'broken'|'warn'|'grey'|'ring'|null }}
 */
export function connectionState(input = {}) {
  const {
    linkedHub = null,
    cloudUrl = '',
    syncStatus = null,
    phase = null,
    pending = 0,
    online = true,
  } = input ?? {};
  const url = str(linkedHub?.url);
  if (!url) return { state: 'local', kind: 'local', host: null, url: null, badge: null };
  // An address this Mac never confirmed: what the repo says, worded as such — never as a repair.
  if (linkedHub?.confirmed === false)
    return { state: 'unconfirmed', kind: 'local', host: hostOf(url) || null, url, badge: null };
  const kind = isCloudHub(url, cloudUrl) ? 'cloud' : 'server';
  const host = hostOf(url) || url;
  const out = (state, badge) => ({ state, kind, host, url, badge });
  if (linkedHub?.credentialed !== true) return out('signin-missing', 'broken');
  if (signInRefused(syncStatus)) return out('signin-rejected', 'broken');
  if (online === false) return out('offline', 'grey');
  const hub = syncStatus?.state;
  if (hub === 'offline' || hub === 'offline-long' || UNREACHABLE_PHASES.has(phase))
    return out('unreachable', 'warn');
  if (SYNCING_PHASES.has(phase) || count(pending) > 0) return out('syncing', 'ring');
  return out('connected', null);
}

/** Where the sign-in lives, in the menu's words: "Maude Cloud" or the server's host. */
const placeName = (c) => (c.kind === 'cloud' ? 'Maude Cloud' : c.host || 'the server');

/**
 * The words each state says (canvas 17 · ac-states, CONTRACT voice): the save word beside the chip, the
 * status line of the avatar menu, and the one-click fix.
 * @param c connectionState()
 * @param in.pending changes going out ("Syncing · 3 changes going out")
 * @returns {{ word, icon, tone, line, fix: null | { id: 'sign-in'|'retry'|'move-to-cloud', label } }}
 */
export function connectionWords(c, { pending = 0 } = {}) {
  const where = placeName(c ?? {});
  const n = count(pending);
  switch (c?.state) {
    case 'signin-missing':
      return {
        word: 'Sign in to sync',
        icon: 'lock',
        tone: 'error',
        line: `This project is on ${where} — sign in to sync.`,
        fix: { id: 'sign-in', label: 'Sign in' },
      };
    case 'signin-rejected':
      return {
        word: 'Sign-in stopped working',
        icon: 'lock',
        tone: 'error',
        line: `Your sign-in to ${where} stopped working. Changes wait on this Mac.`,
        fix: { id: 'sign-in', label: 'Sign in again' },
      };
    case 'unreachable':
      return {
        word: `Can’t reach ${where}`,
        icon: 'problem',
        tone: 'warn',
        line: `${where} doesn’t answer. Changes wait on this Mac.`,
        fix: { id: 'retry', label: `Retry ${where}` },
      };
    case 'offline':
      return {
        word: 'Offline — changes wait on this Mac',
        icon: 'offline',
        tone: 'warn',
        line: 'Offline — changes wait on this Mac. They go out when it’s back online.',
        fix: null,
      };
    case 'syncing':
      return {
        word: 'Syncing…',
        icon: 'sync',
        tone: '',
        line: n > 0 ? `Syncing · ${n} change${n === 1 ? '' : 's'} going out` : 'Syncing',
        fix: null,
      };
    case 'connected':
      return { word: 'Saved', icon: 'cloud', tone: '', line: 'Connected', fix: null };
    case 'unconfirmed':
      return {
        word: 'Not linked on this Mac',
        icon: 'laptop',
        tone: '',
        line: `This project names ${c.host || 'a server'}. Not linked on this Mac.`,
        fix: { id: 'review-link', label: 'Review…' },
      };
    default:
      return {
        word: 'Only on this Mac',
        icon: 'laptop',
        tone: '',
        line: 'Nothing leaves this Mac.',
        fix: { id: 'move-to-cloud', label: 'Put on Maude Cloud…' },
      };
  }
}

/** True for the two states the person repairs with one sign-in (the broken-link badge, the toast). */
export const isBrokenSignIn = (c) =>
  c?.state === 'signin-missing' || c?.state === 'signin-rejected';

/**
 * The once-per-session toast for a broken sign-in (canvas 17 · ac-toast), or null. Keyed by project and
 * state, so a missing sign-in fixed and later rejected is told again — but never twice for the same.
 */
export function signInToast(c, { project = '' } = {}) {
  if (!isBrokenSignIn(c)) return null;
  const w = connectionWords(c);
  return {
    key: `${project || '-'}|${c.url || ''}|${c.state}`,
    id: `signin-${c.state}`,
    title: w.line,
    kind: 'warning',
    actionLabel: w.fix.label,
  };
}
