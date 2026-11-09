// client/v2/settings/this-project-model.js — 2.1.1 T6: Settings › General › This project (canvas 17, 08 · 09).
//
// PURE (no DOM, no React, no fetch). The card says three things about THIS project — where it lives, which
// account it uses, whether it connects — and carries the one fix in its header when a sign-in broke:
//
//   This project  Brand site
//   Your folder · ~/git/brand-site · also on Maude Cloud
//   ● Connected · synced 2 min ago
//     Lives in    [Your folder ~/git/brand-site]      Change…
//     Account     alice@example.com                   Switch…
//     Connection  ● Connected · synced 2 min ago
//     › Sync details                Project files · trash · first link
//
// The connection state is a thin adapter over what the page already has — `/_api/cloud/status`
// (`linkedHub.credentialed`) and the shell's sync payload (`syncPresentation`) — in the seven states and
// words of canvas 17 §2 (`CONN`): ok · syncing · offline · missing · rejected · unreachable · local.
// The avatar's model (2.1.1 B1) reads the same states; the words here are the canvas's, so the two agree.
//
// Where it lives: the server's own project folder (`/_api/diagnostics` `projectFolder`). A copy the app
// keeps for a cloud or server project lives in the app's own data folder (managed.rs `managed_root`,
// `<app data>/projects/…`), which is how a kept copy is told from a folder of the person's.

import { syncPresentation } from '../../../sync/presentation.ts';
import { isCloudHub } from './connections-model.js';

/** The seven states, in canvas 17's words. `sw` is the status dot (ok · busy · off · error · warn). */
export const CONN_WORDS = Object.freeze({
  ok: { word: 'Connected', sw: 'ok' },
  syncing: { word: 'Syncing', sw: 'busy' },
  offline: { word: 'Offline — changes wait on this Mac', sw: 'off' },
  missing: { word: 'Sign in to sync', sw: 'error' },
  rejected: { word: 'Sign-in stopped working', sw: 'error' },
  unreachable: { word: 'Can’t reach', sw: 'warn' },
  local: { word: 'Only on this Mac', sw: 'off' },
});

const hostOf = (url) => {
  try {
    return new URL(String(url)).host.toLowerCase();
  } catch {
    return '';
  }
};
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** `/Users/me/git/x` → `~/git/x` for display. */
export function tildePath(path) {
  return String(path ?? '').replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
}

/** A folder inside the app's own data folder is a copy Maude keeps (managed.rs `managed_root`). */
export function isKeptByMaude(folder) {
  const p = String(folder ?? '');
  return /\/com\.maude\.app\/projects\//.test(p) || /\/com\.maude\.app\/projects$/.test(p);
}

/** "synced just now" · "synced 2 min ago" · "synced at 14:05" · null. */
export function syncedWords(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const age = Math.max(0, now - ms);
  if (age < 60_000) return 'synced just now';
  if (age < 60 * 60_000) return `synced ${Math.floor(age / 60_000)} min ago`;
  const d = new Date(ms);
  return `synced at ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The connection state of this project (canvas 17 §2).
 * @param in.linkedHub   `/_api/cloud/status` `{ url, credentialed }` or null
 * @param in.syncStatus  the shell's sync payload (null before the first one)
 * @param in.online      `navigator.onLine` — a hub that does not answer while this Mac is online is the server's side
 */
export function connectionState({ linkedHub, syncStatus, online = true } = {}) {
  if (!linkedHub?.url) return 'local';
  if (linkedHub.credentialed === false) return 'missing';
  const p = syncPresentation(syncStatus ?? null);
  if (!p) return 'ok';
  switch (p.phase) {
    case 'refused':
      return 'rejected';
    case 'offline':
    case 'stalled':
      return online === false ? 'offline' : 'unreachable';
    case 'connecting':
    case 'syncing':
      return 'syncing';
    default:
      return 'ok';
  }
}

/** The status line for a state — the card's header line and its Connection row. */
export function connectionWords(conn, { host = '', syncStatus = null, now = Date.now() } = {}) {
  if (conn === 'ok') {
    const synced = syncedWords(syncStatus?.lastSyncAt, now);
    return synced ? `Connected · ${synced}` : 'Connected';
  }
  if (conn === 'syncing') {
    const n = syncStatus?.docs?.pending;
    return Number.isInteger(n) && n > 0
      ? `Syncing · ${n} ${n === 1 ? 'change' : 'changes'} going out`
      : 'Syncing…';
  }
  if (conn === 'unreachable') return host ? `Can’t reach ${host}` : 'Can’t reach the server';
  return (CONN_WORDS[conn] ?? CONN_WORDS.local).word;
}

/**
 * The whole card.
 * @param in.status      `/_api/cloud/status` json (`connected`, `email`, `url`, `project`, `linkedHub`)
 * @param in.syncStatus  the shell's sync payload
 * @param in.folder      the project folder (`/_api/diagnostics` `projectFolder`), '' before it answers
 * @param in.hubAccount  the team-server sign-in's recorded account (`/_api/connections/hub` `account`)
 * @param in.native      the desktop app (Show in Finder is the Mac app's door)
 */
export function thisProjectModel({
  status = null,
  syncStatus = null,
  folder = '',
  hubAccount = null,
  online = true,
  native = false,
  now = Date.now(),
} = {}) {
  const linkedHub = status?.linkedHub?.url ? status.linkedHub : null;
  const cloudUrl = status?.url ?? '';
  const linkKind = !linkedHub ? null : isCloudHub(linkedHub.url, cloudUrl) ? 'cloud' : 'server';
  const host = linkedHub ? hostOf(linkedHub.url) : '';
  const conn = connectionState({ linkedHub, syncStatus, online });
  const kept = isKeptByMaude(folder);
  const path = folder ? tildePath(folder) : '';

  // Lives in: the person's folder, or a copy Maude keeps — of a server project it reads "On <host>".
  let place;
  if (kept && linkKind === 'server') place = { kind: 'server', label: `On ${host}`, path: '' };
  else if (kept) place = { kind: 'kept', label: 'Kept by Maude', path: '' };
  else place = { kind: 'folder', label: 'Your folder', path };

  const where = place.kind === 'folder' && path ? `Your folder · ${path}` : place.label;
  let desc;
  if (place.kind === 'server') desc = `${where} · copy kept by Maude`;
  else if (linkKind === 'cloud') desc = `${where} · also on Maude Cloud`;
  else if (linkKind === 'server') desc = `${where} · also on ${host}`;
  else desc = `${where} · only on this Mac`;

  // Account: who this project talks as — never a token, only the name the page already holds.
  let account;
  if (linkKind === 'cloud')
    account = { kind: 'cloud', label: str(status?.email) ?? 'Maude Cloud', host };
  else if (linkKind === 'server') account = { kind: 'server', label: str(hubAccount) ?? host, host };
  else account = { kind: 'local', label: 'No account', host: '' };

  const bad = conn === 'missing' || conn === 'rejected';
  const fix = conn === 'missing' ? 'sign-in' : conn === 'rejected' ? 'sign-in-again' : null;
  const statusWord = connectionWords(conn, { host, syncStatus, now });
  const callout =
    conn === 'rejected'
      ? {
          title: `Your sign-in to ${host || 'the server'} stopped working.`,
          line: 'Changes wait on this Mac and go out after you sign in.',
        }
      : conn === 'missing'
        ? {
            title: `This project is on ${host || 'a server'} — sign in to sync.`,
            line: 'Changes wait on this Mac and go out after you sign in.',
          }
        : null;

  // Change…: only what this Mac can do today. Moving a project between the person's folder and a copy
  // Maude keeps has no backend yet, so those rows are listed as unavailable and never drawn.
  const changeOptions = [
    {
      id: 'folder',
      label: 'Your folder',
      detail: place.kind === 'folder' ? path : '',
      current: place.kind === 'folder',
      available: place.kind === 'folder',
    },
    { id: 'another-folder', label: 'Use another folder…', current: false, available: false },
    {
      id: 'kept',
      label: 'Let Maude keep it',
      detail: 'no path',
      current: place.kind !== 'folder',
      available: place.kind !== 'folder',
    },
    { id: 'finder', label: 'Show in Finder', current: false, available: !!native },
  ];

  return {
    name: str(status?.project) ?? 'this project',
    conn,
    statusWord,
    sw: (CONN_WORDS[conn] ?? CONN_WORDS.local).sw,
    bad,
    fix,
    fixLabel: fix === 'sign-in' ? 'Sign in' : fix === 'sign-in-again' ? 'Sign in again' : null,
    callout,
    place,
    desc,
    account,
    linkKind,
    hubUrl: linkedHub?.url ?? null,
    host,
    local: conn === 'local',
    changeOptions,
    // the menu is drawn only when it has something to do beyond saying where the project is
    canChange: changeOptions.some((o) => o.available && !o.current),
  };
}
