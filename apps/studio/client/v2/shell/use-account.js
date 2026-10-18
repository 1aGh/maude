// client/v2/shell/use-account.js — S1.22a: what the account chip's host reads and does.
//
//   connected / email   ← GET /_api/cloud/status (this tab's profile's cloud sign-in), re-read when any
//                         surface changes the link (CLOUD_CHANGED_EVENT) — Settings › Connections, the
//                         Share panel, this card
//   accounts            ← the shell's account list for the caller, or null (github.js accountsList)
//   signOut()           ← the EXISTING path: POST /_api/cloud/signout (same-origin write, trusted host).
//                         V2-3.8: it clears the calling project's profile credential; projects that
//                         share the profile are signed out with it. No new auth flow.

import { useCallback, useEffect, useState } from 'react';
import { accountsList } from '../../github.js';
import { CLOUD_CHANGED_EVENT } from '../../panels/CloudBar.jsx';
import { shellToast } from '../../shell/util.js';

export function useAccount(enabled) {
  const [state, setState] = useState({ connected: false, email: null, accounts: null });

  useEffect(() => {
    if (!enabled) return undefined;
    let gone = false;
    const read = () => {
      fetch('/_api/cloud/status')
        .then((r) => r.json().catch(() => ({})))
        .then((j) => {
          if (!gone)
            setState((s) => ({ ...s, connected: !!j?.connected, email: j?.email ?? null }));
        })
        .catch(() => {
          if (!gone) setState((s) => ({ ...s, connected: false, email: null }));
        });
      accountsList().then((accounts) => {
        if (!gone) setState((s) => ({ ...s, accounts }));
      });
    };
    read();
    window.addEventListener(CLOUD_CHANGED_EVENT, read);
    return () => {
      gone = true;
      window.removeEventListener(CLOUD_CHANGED_EVENT, read);
    };
  }, [enabled]);

  const email = state.email;
  const signOut = useCallback(async () => {
    try {
      const r = await fetch('/_api/cloud/signout', { method: 'POST' });
      if (!r.ok) throw new Error(String(r.status));
      window.dispatchEvent(
        new CustomEvent(CLOUD_CHANGED_EVENT, { detail: { from: 'account-card' } })
      );
      shellToast(`Signed out of ${email || 'this account'}. Your work stays on this Mac.`, true);
    } catch {
      shellToast('Could not sign out. Nothing changed — try again.');
    }
  }, [email]);

  return { ...state, signOut };
}
