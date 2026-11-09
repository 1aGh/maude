// client/home/home-where-model.js — 2.1.1 B4 (artboard 14): where a project row lives and whether it
// connects. PURE; `home-model.js` calls these while it builds a row.
//
// A project is always in exactly one of the places the design names — your folder, kept by Maude, on
// Maude Cloud, on your server — and a synced one also has an account:
//   where.kind   'cloud'   the project is on a Maude Cloud account   → label = the account's e-mail
//                'server'  it is on a server of your own             → label = the server's host
//                'folder'  only on this Mac, in a folder you chose   → label "Your folder"
//                'kept'    only on this Mac, a copy Maude keeps      → label "Kept by Maude"
//   where.path   the folder, `~`-shortened — only for a folder the person chose (a copy Maude keeps has
//                no path to manage)
// "On an account" comes from the shell's own binding (`connectionOf`, home-model.js), never from the
// project's self-claimed `linkedHub` alone; the words are the project window's (project-account-model).

import { accountFace } from './home-model.js';

/** The project window's connection words — one set, so the top bar and Home never disagree. */
export const CONN_WORDS = Object.freeze({
  ok: 'Connected',
  syncing: 'Syncing',
  offline: 'Offline',
  missing: 'Sign-in missing',
  rejected: 'Sign-in stopped working',
  unreachable: 'Server unreachable',
  local: 'Only on this Mac',
});

/** How the badge reads: `ok` (green) · `bad` (a sign-in the person can fix) · `warn` · `off` (grey). */
export const CONN_TONE = {
  ok: 'ok',
  syncing: 'busy',
  offline: 'off',
  missing: 'bad',
  rejected: 'bad',
  unreachable: 'warn',
  local: 'off',
};

/** A path with the home folder as `~`. Home does not know the home folder; `/Users/<n>` and `/home/<n>` are. */
export function tildePath(root, home = null) {
  const p = String(root || '');
  if (!p) return '';
  if (home && (p === home || p.startsWith(`${home}/`))) return `~${p.slice(home.length)}`;
  const m = p.match(/^\/(?:Users|home)\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ''}` : p;
}

/** The app's own copy of a project lives under its data folder's `projects/` (managed.rs `managed_root`). */
const APP_PROJECTS = /\/com\.maude\.app\/projects\//;

export const isKeptByMaude = ({ root, copyOf }) => !!copyOf || APP_PROJECTS.test(`${root || ''}/`);

/**
 * @param {{ root?: string, copyOf?: string|null,
 *           connection?: { kind: string, host?: string|null, account?: string|null } }} row
 * @returns {{ kind: 'cloud'|'server'|'folder'|'kept', label: string, path: string|null }}
 */
export function whereOf(row) {
  const c = row.connection;
  const kept = isKeptByMaude(row);
  const path = kept ? null : tildePath(row.root) || null;
  if (c?.kind === 'cloud') return { kind: 'cloud', label: c.account || 'Maude Cloud', path };
  if (c?.kind === 'team') return { kind: 'server', label: c.host || 'Your server', path };
  return kept
    ? { kind: 'kept', label: 'Kept by Maude', path: null }
    : { kind: 'folder', label: 'Your folder', path };
}

/** A Maude Cloud project that is not on this Mac yet: it is on that profile's account. */
export const cloudRowWhere = (email) => ({
  kind: 'cloud',
  label: email || 'Maude Cloud',
  path: null,
});

/** Maude Cloud: how the account's listing reads. null = not answered yet (nothing is guessed). */
export function cloudState(listing) {
  if (!listing) return null;
  if (listing.signedIn) return listing.offline ? 'offline' : 'ok';
  return listing.rejected ? 'rejected' : 'missing';
}

/**
 * A team server from `/_home/accounts`: `byHub` = { normUrl: state } of the profile's saved sign-ins,
 * `null` while that has not answered. A server with no saved sign-in at all is "missing".
 */
export function serverState(byHub, url) {
  if (!byHub) return null;
  const st = byHub.get(url);
  if (st === undefined) return 'missing';
  return st === 'rejected' ? 'rejected' : st === 'unreachable' ? 'unreachable' : 'ok';
}

/** The badge: the state's word + tone, worn on the account's face. null = no state to show. */
export function connBadge(state, { kind, profile, email }) {
  if (!state) return null;
  const face =
    kind === 'cloud'
      ? {
          kind: 'cloud',
          ...accountFace({ id: profile?.id, label: email || profile?.label, email }),
        }
      : { kind: kind === 'team' ? 'server' : 'local' };
  return { state, word: CONN_WORDS[state], tone: CONN_TONE[state], face };
}
