// client/v2/shell/project-account-model.js — 2.1.1 T2/T4: the account chip and the avatar menu of THIS
// project (canvas 17 Accounts and Connections · ac-states, ac-menus, ac-menu-broken, ac-switch).
//
// PURE: what the chip's face shows and what the menu says, from what the page already holds. The
// connection state itself is connection-state.js; this module only words it per project.
//
//   face      the kind is the face — a circle with a letter for a Maude Cloud account, a server tile for
//             your server, a laptop for this Mac only — with at most one badge (broken link · warning ·
//             grey · a turning ring while syncing). A project only on this Mac never has a badge.
//   block     the top of the menu: name · where it lives (Your folder / Kept by Maude / On <server>) ·
//             the account · the status with the last sync; red with "Sign in again" + the server
//             address when the sign-in is broken (the address is never typed again).
//   actions   what this state needs: a local project gets its two ways out (Put on Maude Cloud, Link
//             your server); a reachable folder Show in Finder; an unreachable server Retry.
//   switch    "Switch account": the accounts already on this Mac (`accounts_list`, profiles.rs — the
//             caller's own e-mail only; every other account an alias id, a neutral label such as
//             "Account 2", `signedIn` and the shell's `tone`), "No account — this Mac only" (the
//             `default` profile), then Add a Maude Cloud account / Sign in with custom server.
//             Picking one asks first (`switchSheet`), then `project_use_account`, which for another
//             account asks the person again in a native dialog before it rebinds the project —
//             nothing is moved or uploaded.

import { ACCOUNT_TONES, accountTone } from '../../shell/account-tone.js';
import { connectionWords, isBrokenSignIn } from './connection-state.js';

export const DEFAULT_PROFILE = 'default';
const TONES = new Set(ACCOUNT_TONES);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const initialOf = (s) => (s ? Array.from(s)[0].toUpperCase() : '·');

/** "synced just now" · "synced 4 min ago" · "synced 3 h ago" · "synced yesterday" · "synced 5 days ago" */
export function syncedAgo(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.floor(Math.max(0, now - ms) / 60_000);
  if (min < 1) return 'synced just now';
  if (min < 60) return `synced ${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `synced ${h} h ago`;
  if (h < 48) return 'synced yesterday';
  return `synced ${Math.floor(h / 24)} days ago`;
}

/** The status word's tone for the menu's dot (StatusWord). */
const DOT = {
  connected: 'ok',
  syncing: 'busy',
  offline: 'off',
  'signin-missing': 'error',
  'signin-rejected': 'error',
  unreachable: 'warn',
  unconfirmed: 'off',
  local: 'off',
};

/**
 * The account chip's face.
 * @param in.conn            connectionState()
 * @param in.profile         `/_config.profile` { id, label? }
 * @param in.cloudConnected  this project's profile holds a Maude Cloud sign-in
 * @param in.cloudEmail      its e-mail
 */
export function accountFace({ conn, profile = null, cloudConnected = false, cloudEmail = null }) {
  const c = conn ?? { state: 'local', kind: 'local', badge: null };
  const id = str(profile?.id) || DEFAULT_PROFILE;
  const profileLabel = str(profile?.label) || id;
  const kind = c.kind !== 'local' ? c.kind : cloudConnected ? 'cloud' : 'local';
  const label =
    kind === 'server'
      ? c.host || 'Your server'
      : kind === 'cloud'
        ? str(cloudEmail) || profileLabel
        : 'This Mac';
  const words = connectionWords(c);
  return {
    kind,
    state: c.state,
    badge: c.state === 'local' ? null : (c.badge ?? null),
    label,
    initial: kind === 'cloud' ? initialOf(label) : '',
    tone: kind === 'cloud' ? accountTone(id, profileLabel) : kind === 'server' ? 'green' : 'grey',
    title: `${label} — ${words.word}`,
  };
}

/**
 * Everything the avatar menu says.
 * @param in.native       the desktop app
 * @param in.cloudTab     a cloud tab (`cfg.cloud`) — its account is the hub's browser session
 * @param in.project      this project's name
 * @param in.conn         connectionState()
 * @param in.face         accountFace()
 * @param in.place        `/_api/cloud/status` `place` — `{ kept: true }` | `{ kept: false, folder }`
 * @param in.hubAccount   the team server sign-in's recorded account
 * @param in.pending      changes going out
 * @param in.lastSyncAt   the hub monitor's last real sync (ms), or null
 */
export function accountMenu(input = {}) {
  const {
    native = false,
    cloudTab = null,
    project = null,
    conn,
    face,
    place = null,
    hubAccount = null,
    pending = 0,
    lastSyncAt = null,
    now = Date.now(),
  } = input;
  const c = conn ?? { state: 'local', kind: 'local' };
  const w = connectionWords(c, { pending });
  const bad = isBrokenSignIn(c);
  const folder = place && place.kept === false ? str(place.folder) : null;
  const kept = place?.kept === true;

  // where it lives — exactly one of three places
  let where;
  if (c.kind === 'server')
    where = {
      kind: 'server',
      text: `On ${c.host}`,
      extra: kept ? 'copy kept by Maude' : folder ? `copy in ${folder}` : null,
    };
  else if (kept)
    where = {
      kind: 'kept',
      text: 'Kept by Maude',
      extra: c.kind === 'cloud' ? 'also on Maude Cloud' : null,
    };
  else
    where = {
      kind: 'folder',
      text: 'Your folder',
      mono: folder,
      extra: c.kind === 'cloud' ? 'also on Maude Cloud' : null,
    };

  // which account
  let account;
  if (cloudTab) {
    const email = str(cloudTab.user?.email);
    account = { kind: 'cloud', text: email || 'Maude Cloud', sub: email ? 'Maude Cloud' : null };
  } else if (face?.kind === 'server')
    account = { kind: 'server', text: str(hubAccount) || c.host, sub: 'your server' };
  else if (face?.kind === 'cloud')
    account = { kind: 'cloud', text: face.label, sub: 'Maude Cloud' };
  else account = { kind: 'local', text: 'No account — only on this Mac', sub: null };

  // the status, with the last sync where it says something
  const ago = syncedAgo(lastSyncAt, now);
  const statusText =
    c.state === 'local'
      ? 'Only on this Mac'
      : c.state === 'signin-rejected'
        ? `Sign-in stopped working${ago ? ` · ${ago}` : ''}`
        : c.state === 'connected'
          ? `Connected${ago ? ` · ${ago}` : ''}`
          : w.line;

  const fix = bad
    ? {
        text: 'Changes wait on this Mac and go out after you sign in.',
        address: c.host,
        url: c.url,
        label: w.fix.label,
        // your server: its own sign-in page with the linked address; Maude Cloud: its sign-in in Settings
        path: c.kind === 'server' ? 'hub-signin' : 'cloud-signin',
      }
    : null;

  const actions = [];
  if (!cloudTab) {
    if (c.state === 'local') {
      if (native)
        actions.push({
          id: 'share.move-to-cloud',
          label: 'Put this project on Maude Cloud…',
          icon: 'cloud',
        });
      actions.push({ id: 'account.link-server', label: 'Link your server…', icon: 'server' });
    } else if (c.state === 'unreachable') {
      actions.push({ id: 'retry', label: w.fix.label, icon: 'reload' });
    } else if (c.state === 'unconfirmed') {
      // an address the repo names: Review… opens the Share sheet's Connect (the person confirms it is
      // theirs) — never a sign-in with that address filled in
      actions.push({ id: 'review-link', label: w.fix.label, icon: 'link' });
    } else if (!bad && native && !kept && folder) {
      actions.push({ id: 'show-in-finder', label: 'Show in Finder', icon: 'folder' });
    }
  }

  return {
    name: str(cloudTab?.projectName) || str(project) || 'This project',
    bad,
    where,
    account,
    status: { tone: DOT[c.state] ?? 'off', text: statusText },
    fix,
    actions,
    // Switch account: the desktop's list; a cloud tab's account.switch ends its browser session
    switch: native && !cloudTab ? 'list' : cloudTab?.user?.email ? 'sign-out' : null,
  };
}

/**
 * The Switch account list (canvas 17 · ac-switch).
 * @param accounts `accounts_list` rows `[{ id, label, email, signedIn }]`, or null (an older shell)
 * @param profile  this project's `/_config.profile`
 * @param cloudEmail this project's own cloud e-mail (the caller's row carries it too)
 * @returns {{ rows: Array<{ id, kind: 'local'|'cloud', title, sub, initial, tone, current }>, foot }}
 */
export function switchList({ accounts = null, profile = null, cloudEmail = null } = {}) {
  const currentId = str(profile?.id) || DEFAULT_PROFILE;
  const list = Array.isArray(accounts)
    ? accounts.filter((a) => a && typeof a.id === 'string')
    : [
        {
          id: currentId,
          label: str(profile?.label) || currentId,
          email: cloudEmail,
          signedIn: !!cloudEmail,
        },
      ];
  const me = list.find((a) => a.id === currentId) ?? null;
  const signedIn = (a) => a.signedIn === true || !!str(a.email);
  const def = list.find((a) => a.id === DEFAULT_PROFILE) ?? {
    id: DEFAULT_PROFILE,
    signedIn: false,
  };
  const rows = [];
  // "No account" = the `default` profile while it holds no sign-in. Ticked when this project's own
  // account holds none — the way back for a project an earlier switch left on an empty profile.
  if (!signedIn(def))
    rows.push({
      id: DEFAULT_PROFILE,
      kind: 'local',
      title: 'No account — this Mac only',
      sub: 'Nothing leaves this Mac',
      initial: '',
      tone: 'grey',
      current: !me || !signedIn(me),
    });
  for (const a of list) {
    if (!signedIn(a)) continue;
    const title = (a.id === currentId && str(a.email)) || str(a.label) || a.id;
    rows.push({
      id: a.id,
      kind: 'cloud',
      title,
      sub: 'Maude Cloud',
      initial: initialOf(title),
      // The shell's own tone (tabs.rs `account_tone` of the real id): another account's `id` is an
      // alias and its label may be neutral ("Account 2"), so neither can recompute it (2.1.1 L5).
      tone: TONES.has(a.tone) ? a.tone : accountTone(a.id, str(a.label) || a.id),
      current: a.id === currentId,
    });
  }
  return {
    rows,
    foot: [
      { id: 'account.add-cloud', label: 'Add a Maude Cloud account…', icon: 'plus' },
      {
        id: 'account.link-server',
        params: { intent: 'sign-in' },
        label: 'Sign in with custom server…',
        icon: 'server',
      },
    ],
  };
}

/** The confirm sheet before a switch (canvas 17 · ac-switch): what happens, and the way back. */
export function switchSheet({ row, project, place = null, conn = null }) {
  const name = str(project) || 'This project';
  const folder = place && place.kept === false ? str(place.folder) : null;
  const stays = folder
    ? { text: `${name} stays in `, mono: folder, after: '. Nothing is moved or uploaded.' }
    : { text: `${name} stays where it is. Nothing is moved or uploaded.` };
  const linked = conn && conn.kind !== 'local';
  const none = row?.kind === 'local';
  const goes = none
    ? { text: 'Nothing leaves this Mac until you put it on Maude Cloud or link your server.' }
    : linked
      ? {
          text: `It syncs with ${conn.host} as `,
          strong: row.title,
          after: ' — sign in there if it asks.',
        }
      : { text: 'When you put it on Maude Cloud, it goes to ', strong: row.title, after: '.' };
  return {
    title: none ? `Use no account for ${name}?` : `Use ${row?.title} for ${name}?`,
    lines: [
      { icon: 'folder', ...stays },
      { icon: none ? 'laptop' : 'cloud', ...goes },
      {
        icon: 'undo',
        text: none
          ? 'Switch to an account at any time, from the same list.'
          : 'Switch back to No account at any time, from the same list.',
      },
    ],
    primary: 'Use account',
    cancel: 'Cancel',
  };
}
