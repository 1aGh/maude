// client/v2/settings/this-project-model.js — 2.1.1 T6: Settings › General › This project (canvas 17 · 08 · 09).
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
// The connection is the shell's one model (shell/connection-state.js, 2.1.1 T2): the same seven states and
// words the avatar, the save word and the toast say. Where it lives is `/_api/cloud/status` `place`
// (`{ kept: true }` for a copy Maude keeps, else `{ kept: false, folder }` with home as `~`).

import { syncPresentation } from '../../../sync/presentation.ts';
import { connectionState, connectionWords } from '../shell/connection-state.js';

/** The status dot per state (canvas 17 `StatusWord`: ok · busy · off · error · warn). */
const DOT = Object.freeze({
  connected: 'ok',
  syncing: 'busy',
  offline: 'off',
  'signin-missing': 'error',
  'signin-rejected': 'error',
  unreachable: 'warn',
  unconfirmed: 'off',
  local: 'off',
});

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** "synced just now" · "synced 2 min ago" · "synced at 14:05" · null. */
export function syncedWords(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const age = Math.max(0, now - ms);
  if (age < 60_000) return 'synced just now';
  if (age < 60 * 60_000) return `synced ${Math.floor(age / 60_000)} min ago`;
  const d = new Date(ms);
  return `synced at ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The card's status line for a connection (the header line and the Connection row say the same). */
export function statusLine(conn, { syncStatus = null, pending = 0, now = Date.now() } = {}) {
  const w = connectionWords(conn, { pending });
  switch (conn.state) {
    case 'connected': {
      const synced = syncedWords(syncStatus?.lastSyncAt, now);
      return synced ? `Connected · ${synced}` : 'Connected';
    }
    case 'syncing':
      return w.line;
    default:
      return w.word;
  }
}

/**
 * The whole card.
 * @param in.status      `/_api/cloud/status` json (`connected`, `email`, `url`, `project`, `linkedHub`, `place`)
 * @param in.syncStatus  the shell's sync payload
 * @param in.hubAccount  the team-server sign-in's recorded account (`/_api/connections/hub` `account`)
 * @param in.native      the desktop app (Show in Finder is the Mac app's door)
 */
export function thisProjectModel({
  status = null,
  syncStatus = null,
  hubAccount = null,
  online = true,
  native = false,
  now = Date.now(),
} = {}) {
  const linkedHub = status?.linkedHub?.url ? status.linkedHub : null;
  const pending = Number(syncStatus?.queuedOps) || Number(syncStatus?.docs?.pending) || 0;
  const conn = connectionState({
    linkedHub,
    cloudUrl: status?.url ?? '',
    syncStatus,
    phase: syncPresentation(syncStatus ?? null)?.phase ?? null,
    pending,
    online,
  });
  const words = connectionWords(conn, { pending });
  const host = conn.host ?? '';
  const linkKind = conn.kind === 'local' ? null : conn.kind;
  const kept = status?.place?.kept === true;
  const folder = !kept ? (str(status?.place?.folder) ?? '') : '';

  // Lives in: the person's folder, or a copy Maude keeps — of a server project it reads "On <host>".
  let place;
  if (kept && linkKind === 'server') place = { kind: 'server', label: `On ${host}`, path: '' };
  else if (kept) place = { kind: 'kept', label: 'Kept by Maude', path: '' };
  else place = { kind: 'folder', label: 'Your folder', path: folder };

  const where = place.kind === 'folder' && folder ? `Your folder · ${folder}` : place.label;
  let desc;
  if (place.kind === 'server') desc = `${where} · copy kept by Maude`;
  else if (linkKind === 'cloud') desc = `${where} · also on Maude Cloud`;
  else if (linkKind === 'server') desc = `${where} · also on ${host}`;
  else desc = `${where} · only on this Mac`;

  // Account: who this project talks as — never a token, only the name the page already holds.
  let account;
  if (linkKind === 'cloud')
    account = { kind: 'cloud', label: str(status?.email) ?? 'Maude Cloud', host };
  else if (linkKind === 'server')
    account = { kind: 'server', label: str(hubAccount) ?? host, host };
  else account = { kind: 'local', label: 'No account', host: '' };

  const bad = conn.state === 'signin-missing' || conn.state === 'signin-rejected';
  const where2 = linkKind === 'cloud' ? 'Maude Cloud' : host || 'the server';
  const callout =
    conn.state === 'signin-rejected'
      ? {
          title: `Your sign-in to ${where2} stopped working.`,
          line: 'Changes wait on this Mac and go out after you sign in.',
        }
      : conn.state === 'signin-missing'
        ? {
            title: `This project is on ${where2} — sign in to sync.`,
            line: 'Changes wait on this Mac and go out after you sign in.',
          }
        : null;

  // Change…: only what this Mac can do today. Moving a project between the person's folder and a copy
  // Maude keeps has no backend yet, so those rows are listed as unavailable and never drawn.
  const changeOptions = [
    {
      id: 'folder',
      label: 'Your folder',
      detail: place.kind === 'folder' ? folder : '',
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
    statusWord: statusLine(conn, { syncStatus, pending, now }),
    sw: DOT[conn.state] ?? 'off',
    bad,
    fixLabel: bad ? (words.fix?.label ?? 'Sign in') : null,
    callout,
    place,
    desc,
    account,
    linkKind,
    // an address this Mac never confirmed is never handed to a sign-in (2.1.1 T8): Review… instead
    unconfirmed:
      conn.state === 'unconfirmed'
        ? { line: words.line, label: words.fix?.label ?? 'Review…' }
        : null,
    hubUrl: conn.state === 'unconfirmed' ? null : (linkedHub?.url ?? null),
    host,
    local: conn.state === 'local',
    changeOptions,
    // the menu is drawn only when it has something to do beyond saying where the project is
    canChange: changeOptions.some((o) => o.available && !o.current),
  };
}
