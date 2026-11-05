// client/v2/shell/project-account-model.js — 2.0.5 W4: which account THIS project uses, and how.
//
// PURE: what the avatar's card says and which existing path each of its buttons runs. Michal's rule
// after 2.0.4 — every button does something, nothing fails — so a row exists only where its path does:
//
//   kind      team server · Maude Cloud · GitHub · nothing (this Mac only)
//   profile   `/_config.profile` — the account slot this project is bound to (V2-3.1; the server
//             learns it from env only, MAUDE_PROFILE_ID / _LABEL)
//   where     the team server's host, or the cloud project's name
//   who       the signed-in login / e-mail, only where the page already holds it (the hub's recorded
//             account from `/_api/connections/hub`, the cloud e-mail from `/_api/cloud/status`, the
//             GitHub login from `/_api/github/identity`, a cloud tab's `cfg.cloud.user.email`)
//
// Sign out, per kind — each the path its Settings › Connections row already runs, never a new one:
//   cloud-signout   POST /_api/cloud/signout — clears this project's PROFILE cloud credential (V2-3.8)
//   hub-detach      POST /_api/cloud/detach  — Settings' team-server "Sign out": the link + its sign-in
//   github-signout  the shell's `github_sign_out` — the calling project's profile keychain slot
// Switch, per kind — through the bind-on-sign-in rule (decision v2-3.8-bind-on-sign-in):
//   cloud           `account.switch` → `cloud_sign_in_prepare` (a fresh profile bound to this project)
//   github          `account.github-signin` → `github_sign_in` (settle_sign_in rebinds on another login)
//   team server     W4b: `hub-switch` → `team_sign_in_prepare` (this project moves to a fresh profile
//                   of its own when its profile is shared — the shell restarts it, the page reloads,
//                   the person signs in there) → `/_api/hub-signin/start` + the server's own page.
// A browser tab on this Mac has no shell: it says what is known and offers no button. A cloud tab's
// account is the hub's browser session: `account.switch` ends it (the v1 menubar's Sign out).

import { ACTIONS_BY_ID } from '../../../actions/index.ts';
import { isCloudHub } from '../settings/connections-model.js';

const hostOf = (url) => {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const labelOf = (id) => ACTIONS_BY_ID.get(id)?.label ?? '';

export const KIND_LABELS = Object.freeze({
  team: 'Team server',
  cloud: 'Maude Cloud',
  github: 'GitHub',
  local: 'This Mac only',
});

export const GITHUB_NEEDS_APP = 'Signing in with GitHub needs the Maude desktop app.';

/**
 * @param in.native          the desktop app (a Tauri shell)
 * @param in.cloudTab        `cfg.cloud` of a cloud tab, else null
 * @param in.profile         `/_config.profile` { id, label? }
 * @param in.project         this project's name
 * @param in.linkedHub       { url, credentialed } from `/_api/cloud/status`
 * @param in.hubAccount      the hub sign-in's recorded account (`/_api/connections/hub` `account`)
 * @param in.cloudUrl        the Maude Cloud address this Mac signs in against
 * @param in.cloudConnected  this profile holds a Maude Cloud sign-in
 * @param in.cloudEmail      its e-mail
 * @param in.github          { state: 'loading'|'in'|'out', login }
 */
export function projectAccount(input = {}) {
  const {
    native = false,
    cloudTab = null,
    profile = null,
    project = null,
    linkedHub = null,
    hubAccount = null,
    cloudUrl = '',
    cloudConnected = false,
    cloudEmail = null,
    github = null,
  } = input;
  const profileLabel = str(profile?.label) || str(profile?.id) || (native ? 'default' : null);

  if (cloudTab) {
    // A browser on a cell: a hub with a dashboard is Maude Cloud, one that serves a single project is a
    // team's own server. No Mac, no keychain, no GitHub.
    const email = str(cloudTab.user?.email);
    return {
      kind: cloudTab.dashboardUrl ? 'cloud' : 'team',
      kindLabel: KIND_LABELS[cloudTab.dashboardUrl ? 'cloud' : 'team'],
      profileLabel: null,
      where: str(cloudTab.projectName) || str(project),
      who: email,
      signOut: null,
      // the registry hides account.switch in a cloud tab without a user (app.jsx); so does the card
      switch: email ? { id: 'account.switch', label: labelOf('account.switch') } : null,
      github: null,
    };
  }

  const hubUrl = str(linkedHub?.url);
  const cloudHub = hubUrl ? isCloudHub(hubUrl, cloudUrl) : false;
  const ghIn = github?.state === 'in';
  const ghLogin = ghIn ? str(github?.login) : null;
  let kind = 'local';
  if (hubUrl && !cloudHub) kind = 'team';
  else if (cloudConnected || (hubUrl && cloudHub)) kind = 'cloud';
  else if (ghIn) kind = 'github';

  const who =
    kind === 'team'
      ? str(hubAccount)
      : kind === 'cloud'
        ? str(cloudEmail)
        : kind === 'github' && ghLogin
          ? `@${ghLogin}`
          : null;
  const where = kind === 'team' ? hostOf(hubUrl) || hubUrl : kind === 'cloud' ? str(project) : null;

  let signOut = null;
  let sw = null;
  if (native) {
    if (kind === 'cloud' && cloudConnected) {
      const name = who || profileLabel;
      // The account card's words (account-card-model.js), unchanged: one confirm on every surface.
      signOut = {
        path: 'cloud-signout',
        label: `Sign out of ${name}…`,
        confirm: {
          title: `Sign out of ${name}?`,
          body: 'Every project on it is signed out. Your work stays on this Mac.',
          primary: 'Sign out',
          cancel: 'Cancel',
        },
      };
      sw = { id: 'account.switch', label: labelOf('account.switch') };
    } else if (kind === 'team') {
      const host = where || 'this server';
      // 2.0.5 W4b — Switch through `team_sign_in_prepare`: a project on a profile other projects
      // share first moves to its own (the shell restarts it); then the team server's own page.
      sw = {
        path: 'hub-switch',
        url: hubUrl,
        label: linkedHub?.credentialed ? 'Sign in as someone else…' : `Sign in to ${host}…`,
      };
      if (linkedHub?.credentialed)
        signOut = {
          path: 'hub-detach',
          label: `Sign out of ${host}…`,
          confirm: {
            title: `Sign out of ${host}?`,
            body: 'This folder stops syncing with it. Your work stays on this Mac.',
            primary: 'Sign out',
            cancel: 'Cancel',
          },
        };
    } else if (kind === 'github' && ghLogin) {
      signOut = {
        path: 'github-signout',
        label: `Sign out of @${ghLogin}…`,
        confirm: {
          title: `Sign out of @${ghLogin}?`,
          body: 'Every project on it is signed out of GitHub. Your work stays on this Mac.',
          primary: 'Sign out',
          cancel: 'Cancel',
        },
      };
      sw = { id: 'account.github-signin', label: 'Sign in as another GitHub account…' };
    }
  }

  return {
    kind,
    kindLabel: KIND_LABELS[kind],
    profileLabel,
    where,
    who,
    signOut,
    switch: sw,
    // The GitHub line: sign in where the app can, sign out where it is the second account of the card.
    github: native
      ? {
          login: ghLogin,
          canSignIn: !ghIn && github?.state !== 'loading',
          canSignOut: ghIn && kind !== 'github',
        }
      : { login: null, canSignIn: false, canSignOut: false, note: GITHUB_NEEDS_APP },
  };
}
