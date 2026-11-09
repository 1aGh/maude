// client/home/home-accounts-model.js — 2.0.5 W4b: what Home's avatar lists. PURE.
//
// Every profile on this Mac by its label (`shell_state.profiles`), each with the accounts it is
// signed in with:
//   cloud    the profile's Maude Cloud listing says signed in → its e-mail; Sign out =
//            POST /_home/cloud/signout {profile} (that profile's cloud.json only)
//   team     each team server in that profile's hubs.json (`GET /_home/accounts`) → host + the
//            account it vouched for; Sign out = POST /_home/hub/signout {profile, url}
//   github   the login last signed in on the profile (profiles.json). Home has no GitHub sign-out
//            path of its own — it lives in the project's account card — so no button here
//            (Michal's rule: no dead buttons). A profile without a login offers "Sign in with GitHub…"
//            (the existing `home_github_sign_in`).
// Add / switch: "Add a Maude Cloud account…" is Home's own sign-in, which never re-signs a profile
// that holds a credential (`home_cloud_sign_in_prepare` makes a fresh one — that IS the switch);
// "Connect to a team server…" is the Advanced › hub sheet. A browser has no shell: facts only.

import { accountFace, normHubUrl } from './home-model.js';
import { CONN_WORDS, cloudState } from './home-where-model.js';

const hostOf = (url) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return String(url || '');
  }
};
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function signOutSpec(path, name, extra) {
  return {
    path,
    ...extra,
    label: `Sign out of ${name}…`,
    confirm: {
      title: `Sign out of ${name}?`,
      body:
        path === 'hub-signout'
          ? 'Projects on this account stop syncing with it. Your work stays on this Mac.'
          : 'Every project on this account is signed out. Your work stays on this Mac.',
      primary: 'Sign out',
      cancel: 'Cancel',
    },
  };
}

/**
 * @param in.native       the desktop app
 * @param in.shell        `shell_state` (profiles: [{ id, label, email?, github? }])
 * @param in.clouds       one `GET /_home/cloud` answer per profile
 * @param in.hubProfiles  `GET /_home/accounts` `profiles`
 */
export function homeAccounts({ native = false, shell = null, clouds = null, hubProfiles = null }) {
  const known = (shell?.profiles ?? []).filter((p) => p && typeof p.id === 'string');
  const ids = [
    ...known.map((p) => p.id),
    ...(clouds ?? [])
      .filter((c) => c?.signedIn && typeof c.profile === 'string')
      .map((c) => c.profile),
  ].filter((id, i, all) => all.indexOf(id) === i);

  const profiles = ids.map((id) => {
    const p = known.find((x) => x.id === id) ?? null;
    const label = str(p?.label) || (id === 'default' ? 'Default' : id);
    const cloud = (clouds ?? []).find((c) => c?.profile === id) ?? null;
    const accounts = [];
    if (cloud?.signedIn) {
      const email = str(cloud.account?.email) || str(p?.email);
      accounts.push({
        kind: 'cloud',
        key: 'cloud',
        title: 'Maude Cloud',
        host: null,
        who: email,
        signOut: native
          ? signOutSpec('cloud-signout', email || 'Maude Cloud', { profile: id })
          : null,
      });
    }
    for (const h of (hubProfiles ?? []).find((x) => x?.id === id)?.hubs ?? []) {
      if (!h || typeof h.url !== 'string') continue;
      const host = hostOf(h.url);
      accounts.push({
        kind: 'team',
        key: `team:${h.url}`,
        title: 'Team server',
        host,
        who: str(h.account),
        signOut: native ? signOutSpec('hub-signout', host, { profile: id, url: h.url }) : null,
      });
    }
    const gh = str(p?.github);
    if (gh)
      accounts.push({
        kind: 'github',
        key: 'github',
        title: 'GitHub',
        host: null,
        who: `@${gh.replace(/^@/, '')}`,
        signOut: null,
      });
    return {
      id,
      label,
      face: accountFace({ id, label, email: accounts[0]?.who?.replace(/^@/, '') || '' }),
      accounts,
      githubSignIn: native && !gh,
    };
  });

  const first = profiles.find((p) => p.accounts.length) ?? profiles[0] ?? null;
  const face = first
    ? {
        ...first.face,
        title: [first.label, first.accounts[0]?.who].filter(Boolean).join(' · ') || 'Your accounts',
      }
    : null;
  return {
    profiles,
    face,
    add: native ? { cloud: 'Add a Maude Cloud account…', team: 'Connect to a team server…' } : null,
  };
}

const projectsWord = (n) => (n === 0 ? 'No projects' : `${n} ${n === 1 ? 'project' : 'projects'}`);

/**
 * 2.1.1 B4 (artboard 14) — the accounts row on top of Home: one card per account the projects (or the
 * sign-ins) name, with its state and, when the person can fix it in one click, the button.
 *   cloud   a Maude Cloud account, by its e-mail. Listed when signed in, when its sign-in was refused,
 *           or when a project is on it but no sign-in is left ("Sign-in missing").
 *   server  a server of your own, by its account (or host). Listed per saved sign-in, and for a server
 *           a project is on but no sign-in is saved for.
 * "This Mac only" is not a card: nothing to connect, and the project rows already say it.
 * `fix`: `{ path: 'cloud-signin', profile }` (Home's own Maude Cloud sign-in) or
 * `{ path: 'hub-signin', profile, url }` (the team-server sign-in, address prefilled) — only for a
 * sign-in that is missing or stopped working; a server that does not answer has nothing to fix here.
 *
 * @param in.shell        `shell_state`
 * @param in.clouds       one `GET /_home/cloud` answer per profile
 * @param in.hubProfiles  `GET /_home/accounts` `profiles` (each hub with its `state`)
 * @param in.groups       `buildHomeModel().groups` (rows carry `where` / `connection`)
 */
export function homeAccountCards({ shell = null, clouds = null, hubProfiles = null, groups = [] }) {
  const profiles = (shell?.profiles ?? []).filter((p) => p && typeof p.id === 'string');
  const ids = [...profiles.map((p) => p.id), ...groups.map((g) => g.profile?.id)].filter(
    (id, i, all) => typeof id === 'string' && all.indexOf(id) === i
  );
  const out = [];
  for (const id of ids) {
    const prof = profiles.find((p) => p.id === id) ?? null;
    const rows = groups.find((g) => g.profile?.id === id)?.rows ?? [];
    const listing = (clouds ?? []).find((c) => c?.profile === id) ?? null;
    const email = str(listing?.account?.email) || str(prof?.email);
    const onCloud = rows.filter((r) => r.where?.kind === 'cloud');
    const cloudOwn = rows.some((r) => r.connection?.kind === 'cloud');

    if (listing?.signedIn || listing?.rejected || cloudOwn) {
      const state = cloudState(listing) ?? (cloudOwn ? 'missing' : null);
      if (state)
        out.push({
          key: `cloud:${id}`,
          kind: 'cloud',
          profile: id,
          url: null,
          face: { kind: 'cloud', ...accountFace({ id, label: email || prof?.label, email }) },
          title: email || 'Maude Cloud',
          sub: `Maude Cloud · ${projectsWord(onCloud.length)}`,
          state,
          word: CONN_WORDS[state],
          fix:
            state === 'rejected' || state === 'missing'
              ? {
                  path: 'cloud-signin',
                  profile: id,
                  label: state === 'rejected' ? 'Sign in again' : 'Sign in',
                }
              : null,
        });
    }

    const saved = (hubProfiles ?? []).find((x) => x?.id === id)?.hubs ?? [];
    const servers = new Map();
    for (const h of saved)
      if (h && typeof h.url === 'string' && normHubUrl(h.url))
        servers.set(normHubUrl(h.url), { url: h.url, account: str(h.account), state: h.state });
    for (const r of rows) {
      const url = r.connection?.kind === 'team' ? r.boundHub || r.hub : null;
      if (url && !servers.has(url)) servers.set(url, { url, account: null, state: 'missing' });
    }
    for (const [norm, h] of servers) {
      const state =
        h.state === 'missing' || h.state === 'rejected' || h.state === 'unreachable'
          ? h.state
          : 'ok';
      const host = hostOf(h.url);
      const n = rows.filter(
        (r) => r.where?.kind === 'server' && (r.boundHub || r.hub) === norm
      ).length;
      out.push({
        key: `server:${id}:${norm}`,
        kind: 'server',
        profile: id,
        url: h.url,
        face: { kind: 'server' },
        title: h.account || host,
        sub: `${h.account ? host : 'Your server'} · ${projectsWord(n)}`,
        state,
        word: CONN_WORDS[state],
        fix:
          state === 'rejected' || state === 'missing'
            ? {
                path: 'hub-signin',
                profile: id,
                url: h.url,
                label: state === 'rejected' ? 'Sign in again' : 'Sign in',
              }
            : null,
      });
    }
  }
  return out;
}

/** The testid tail of a card: `<profile>-cloud` or `<profile>-<host>`. */
export const slugOf = (card) =>
  card.kind === 'cloud'
    ? `${card.profile}-cloud`
    : `${card.profile}-${hostOf(card.url)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')}`;
