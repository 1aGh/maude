// client/v2/shell/github-signin-host.jsx — 2.0.5 W4: where `account.github-signin` runs.
//
// The one GitHub sign-in of a project tab: the shell's device flow (`github_sign_in`, oauth.rs — the
// calling project's profile, bind-on-sign-in for another account on a shared one), through the SAME hook
// Settings › Connections uses (useGitHubConnection), and the same code sheet (GitHubDeviceDialog). The
// menu runner hands the action here over MENU_ACTION_EVENT, the way IdentityBar hears project.new, so the
// avatar's card, ⌘K, the Versions sheet's "Sign in with GitHub to publish" lines and New project… all
// start this one flow. Mounted by share-cluster-host.jsx, which every project tab draws.

import { useEffect, useRef } from 'react';
import { GitHubDeviceDialog } from '../../panels/IdentityBar.jsx';
import { shellToast } from '../../shell/util.js';
import { useGitHubConnection } from '../settings/use-connections.js';
import { MENU_ACTION_EVENT } from './menu-runner.js';

export function useGitHubSignInHost() {
  const gh = useGitHubConnection();
  const ref = useRef(gh);
  ref.current = gh;
  useEffect(() => {
    const on = (e) => {
      if (e.detail?.id !== 'account.github-signin') return;
      const g = ref.current;
      if (!g.native || g.signing) return;
      g.signIn();
    };
    window.addEventListener(MENU_ACTION_EVENT, on);
    return () => window.removeEventListener(MENU_ACTION_EVENT, on);
  }, []);
  // A failed flow says so once (the hook keeps the sentence for Settings' row too).
  const lastErr = useRef('');
  useEffect(() => {
    if (gh.error && gh.error !== lastErr.current) shellToast(gh.error);
    lastErr.current = gh.error;
  }, [gh.error]);
  return gh;
}

/** The device-code sheet while a sign-in started here waits for the browser. */
export function GitHubSignInSheet({ gh }) {
  return gh?.device ? <GitHubDeviceDialog device={gh.device} onClose={gh.closeDevice} /> : null;
}
