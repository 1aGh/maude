// client/v2/onboarding/github-home.js — "From GitHub" on Home (02 ob-adv-sheets, S6.10): the words, the small pure
// rules, and the four Home-only shell commands (Rust github_home.rs). The page names a repo and a profile; Rust
// holds the token, reads the list, claims ~/Maude/<repo> (" 2" on a collision) and clones. Nothing here ever sees
// a token: every answer is names, a visibility flag, the public login and a folder.

import { shellInvoke } from '../../home/home-api.js';

export const GITHUB_WORDS = {
  private: 'Private',
  public: 'Public',
  paste: 'Or paste a GitHub link',
  newGithub: 'New project on GitHub — private by default',
  newName: 'Project name',
  loading: 'Loading your GitHub projects…',
  empty: 'No projects on GitHub yet.',
  signInLine: 'Sign in to GitHub to see your projects here.',
  signIn: 'Sign in with GitHub',
  waiting: 'Waiting for GitHub…',
  code: (code) => `Enter ${code} on github.com/login/device`,
  chooseFolder: 'Choose another folder…',
  inMaude: 'Saves in your Maude folder.',
  pickNext: "You'll choose the folder next.",
  failed: "Couldn't open that project. Nothing changed.",
};

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^(?!\.)[A-Za-z0-9._-]{1,100}$/;

/** `owner/repo` or a github.com link → `owner/repo`, else null — only to enable Open; Rust validates again. */
export function repoRef(input) {
  const s = typeof input === 'string' ? input.trim() : '';
  if (!s || /\s/.test(s)) return null;
  let path = s;
  if (s.startsWith('git@github.com:')) path = s.slice('git@github.com:'.length);
  else if (s.includes('://')) {
    let u;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'github.com') return null;
    if (u.port || u.username || u.password || u.search || u.hash) return null;
    path = u.pathname.replace(/^\/+/, '');
  }
  const parts = path.replace(/\/+$/, '').split('/');
  if (parts.length !== 2) return null;
  const [owner, raw] = parts;
  const repo = raw.replace(/\.git$/, '');
  return OWNER.test(owner) && REPO.test(repo) ? `${owner}/${repo}` : null;
}

/** What Open would do with the segment's state: `{kind:'clone', fullName}` | `{kind:'create', name}` | null. */
export function githubChoice({ picked = null, link = '', isNew = false, name = '' } = {}) {
  if (isNew) return name.trim() ? { kind: 'create', name: name.trim() } : null;
  // a link in the field is the choice — one that is not a github.com project enables nothing
  if (typeof link === 'string' && link.trim()) {
    const pasted = repoRef(link);
    return pasted ? { kind: 'clone', fullName: pasted } : null;
  }
  return picked ? { kind: 'clone', fullName: picked } : null;
}

const withProfile = (profile, args = {}) =>
  typeof profile === 'string' && profile ? { ...args, profile } : args;

/** `{profile, signedIn, login?, repos: [{fullName, private}]}` (null outside the app). */
export const githubRepos = (profile, invoke = shellInvoke) =>
  invoke('github_repos', withProfile(profile));
/** The device flow for Home → `{profile, login}`; the code arrives as `github://device-code`. */
export const githubSignIn = (profile, invoke = shellInvoke) =>
  invoke('home_github_sign_in', withProfile(profile));

/** Run a choice → `{root, profile, name}`, or null when the person closed the folder picker. */
export function runGithubChoice(choice, { profile, chooseFolder = false, invoke = shellInvoke }) {
  if (choice?.kind === 'clone')
    return invoke(
      'github_clone',
      withProfile(profile, { fullName: choice.fullName, chooseFolder })
    );
  if (choice?.kind === 'create')
    return invoke('github_create', withProfile(profile, { name: choice.name, chooseFolder }));
  return Promise.resolve(null);
}
