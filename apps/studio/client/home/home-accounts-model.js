// client/home/home-accounts-model.js — what Home's accounts chip lists (2.1.2 HB1, canvas 17
// artboards 15–18; the cards came with 2.1.1 B4, the sign-outs with 2.0.5 W4b). PURE.
//
// One card per account: a Maude Cloud account by its e-mail, a server of your own by its account or
// host; never a Maude Cloud cell (its projects are the Maude Cloud account's).
//   Sign out   cloud → POST /_home/cloud/signout {profile} (that profile's cloud.json only)
//              server → POST /_home/hub/signout {profile, url}; asks first
//   GitHub     the login last signed in on the profile (profiles.json). Home has no GitHub sign-out
//              of its own — it lives in the project's account card — so no button for it (Michal's
//              rule: no dead buttons). A profile without a login offers "Sign in with GitHub…".
//   Forget     an old server (no answer, no project) — the same hub sign-out, on the person's click.
// Add / switch: "Add a Maude Cloud account…" is Home's own sign-in, which never re-signs a profile
// that holds a credential (`home_cloud_sign_in_prepare` makes a fresh one — that IS the switch);
// "Connect to a team server…" is the team-server sheet. A browser has no shell: facts only.

import { accountFace, isCloudHubUrl, normHubUrl } from './home-model.js';
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
 * 2.1.2 HB1: `stale` = a server that does not answer and holds no project (folded, `forget` offered);
 * `projects` = the names whose changes wait on this account; `signOut` = the confirm spec, or null
 * when no credential is saved on this Mac.
 *
 * @param in.shell        `shell_state`
 * @param in.clouds       one `GET /_home/cloud` answer per profile
 * @param in.hubProfiles  `GET /_home/accounts` `profiles` (each hub with its `state`)
 * @param in.groups       `buildHomeModel().groups` (rows carry `where` / `connection`)
 * @param in.cloudUrl     the control plane (`/_config.cloudOrigin`); null ⇒ no server card at all
 */
export function homeAccountCards({
  shell = null,
  clouds = null,
  hubProfiles = null,
  groups = [],
  cloudUrl = null,
}) {
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
          projects: onCloud.map((r) => r.name),
          stale: false,
          forget: null,
          // a sign-out needs a credential on this Mac: signed in, or one that stopped working
          signOut:
            listing?.signedIn || listing?.rejected
              ? signOutSpec('cloud-signout', email || 'Maude Cloud', { profile: id })
              : null,
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

    // 2.1.2 HB1: a server card only once the control plane is known — until then a saved sign-in to
    // a Maude Cloud cell cannot be told from a server of your own, and nothing is guessed. A cell is
    // never a server: its projects already count under the Maude Cloud account above, whose own
    // sign-in is the state (the cell's token is re-made from it).
    const saved = cloudUrl ? ((hubProfiles ?? []).find((x) => x?.id === id)?.hubs ?? []) : [];
    const servers = new Map();
    for (const h of saved)
      if (h && typeof h.url === 'string' && normHubUrl(h.url) && !isCloudHubUrl(h.url, cloudUrl))
        servers.set(normHubUrl(h.url), {
          url: h.url,
          account: str(h.account),
          state: h.state,
          saved: true,
        });
    for (const r of rows) {
      const url = r.connection?.kind === 'team' ? r.boundHub || r.hub : null;
      if (url && !servers.has(url))
        servers.set(url, { url, account: null, state: 'missing', saved: false });
    }
    for (const [norm, h] of servers) {
      const state =
        h.state === 'missing' || h.state === 'rejected' || h.state === 'unreachable'
          ? h.state
          : 'ok';
      const host = hostOf(h.url);
      const mine = rows.filter((r) => r.where?.kind === 'server' && (r.boundHub || r.hub) === norm);
      const n = mine.length;
      // an old server: it does not answer and no project is on it — folded, offered Forget…
      const stale = state === 'unreachable' && n === 0;
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
        projects: mine.map((r) => r.name),
        stale,
        forget: stale && h.saved ? { profile: id, url: h.url, host } : null,
        signOut: h.saved ? signOutSpec('hub-signout', host, { profile: id, url: h.url }) : null,
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

const isBad = (c) => c.state === 'rejected' || c.state === 'missing';
const countOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * 2.1.2 HB1 (canvas 17, artboards 15–17) — the chip at the top right of Home: "3 accounts", plus
 * "1 needs sign-in" (with its dot) while a sign-in is missing or stopped working. Old servers (no
 * answer, no project) are not counted: they fold at the foot of the accounts list (artboard 18).
 */
export function homeAccountsSummary(cards) {
  const live = cards.filter((c) => !c.stale);
  const old = cards.filter((c) => c.stale);
  const needs = live.filter(isBad).length;
  return {
    live,
    old,
    word: live.length ? countOf(live.length, 'account', 'accounts') : 'Accounts',
    needs,
    needsWord: needs ? `${needs} ${needs === 1 ? 'needs' : 'need'} sign-in` : null,
    oldWord: old.length ? countOf(old.length, 'old server', 'old servers') : null,
  };
}

const namesWord = (names) =>
  names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;

/**
 * 2.1.2 HB1 (artboard 16) — the one banner on top of Home: only a sign-in the person can fix (missing
 * or stopped working). One → it names the place, the projects whose changes wait, and the card's own
 * fix. Two or more → a count and Review (the accounts list). A server that does not answer never
 * raises it. null = nothing needs the person.
 */
export function homeAccountBanner(cards) {
  const bad = cards.filter((c) => !c.stale && isBad(c) && c.fix);
  if (!bad.length) return null;
  if (bad.length > 1)
    return {
      kind: 'many',
      key: bad.map((c) => c.key).join('|'),
      card: null,
      title: bad.every((c) => c.state === 'rejected')
        ? `${bad.length} sign-ins stopped working`
        : `${bad.length} sign-ins need you`,
      body: null,
      action: 'Review',
    };
  const card = bad[0];
  const place = card.kind === 'cloud' ? 'Maude Cloud' : hostOf(card.url);
  const names = (card.projects ?? []).filter(Boolean);
  return {
    kind: 'one',
    key: card.key,
    card,
    title:
      card.state === 'rejected'
        ? `Your sign-in to ${place} stopped working.`
        : `Your sign-in to ${place} is missing.`,
    body: names.length ? `Changes to ${namesWord(names)} wait on this Mac.` : null,
    action: card.fix.label,
  };
}

/**
 * The GitHub login of a profile, for its first card's "…" menu: `{ login }` when signed in,
 * `{ signIn: true }` when not (Home's `home_github_sign_in`). Home has no GitHub sign-out of its own.
 */
export function githubOf(shell, profile) {
  const p = (shell?.profiles ?? []).find((x) => x?.id === profile);
  const gh = str(p?.github);
  return gh ? { login: `@${gh.replace(/^@/, '')}`, signIn: false } : { login: null, signIn: true };
}

/** The confirm for Forget… on one old server, or on all of them (artboard 18). */
export function forgetSpec(servers) {
  if (servers.length === 1)
    return {
      id: 'forget',
      servers,
      title: 'Forget this server?',
      body: `The saved sign-in for ${servers[0].host} is removed from this Mac. Nothing on the server or in your projects is deleted.`,
      primary: 'Forget this server',
      cancel: 'Cancel',
    };
  const n = servers.length;
  return {
    id: 'forget-all',
    servers,
    title: `Forget ${n} old servers?`,
    body: `The saved sign-ins for these ${n} servers are removed from this Mac. Nothing on the servers or in your projects is deleted.`,
    primary: `Forget ${n} old servers`,
    cancel: 'Cancel',
  };
}
