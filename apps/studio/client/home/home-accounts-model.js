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

import { accountFace } from './home-model.js';

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
