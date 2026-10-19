// client/v2/settings/account.jsx — S9.20: Settings › General › Account (02 ob-settings, left card).
//
//   Account
//   (Y) you@studio.cz · Signed in to cloud.maude.sh
//   Plan                         Free trial · 12 days left
//   [Manage on cloud.maude.sh]
//   People and invites ↗ · Billing and plan ↗ · Your Macs ↗ · Download everything ↗ · Delete the account ↗
//
// The account IS a web page (S9.16): every row opens cloud.maude.sh in the browser, signed in.
// Nothing here changes the account itself. The Mac's own account is the owner's business — a
// read-only link asks for none of it (V2-4.9). The address is the one this Mac signs in against
// (`/_api/cloud/status.url`) or the cloud tab's dashboard, never a hard-coded vendor URL. The plan
// line is drawn only when the server reports it (`status.plan`), never guessed.

import { useEffect, useState } from 'react';

import { CLOUD_CHANGED_EVENT, openExternal } from '../../panels/CloudBar.jsx';
import { Group, Row } from './parts.jsx';

/** The five account pages (apps/cloud/account-pages.mjs `ACCOUNT_NAV`), in the canvas order. */
export const ACCOUNT_LINKS = Object.freeze([
  ['people', '/account/people', 'People and invites'],
  ['billing', '/account/billing', 'Billing and plan'],
  ['macs', '/account/macs', 'Your Macs'],
  ['download', '/account/download', 'Download everything'],
  ['delete', '/account/delete', 'Delete the account'],
]);

/** `https://cloud.maude.sh/x` → origin, or null for anything that is not http(s). */
export function accountOrigin(url) {
  try {
    const u = new URL(String(url ?? ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** "Free trial · 12 days left" — CONTRACT §4 words; null when the server reported no plan. */
export function planWords(plan) {
  if (!plan || typeof plan !== 'object') return null;
  if (plan.paid === true || plan.state === 'paid')
    return plan.name ? String(plan.name) : 'Paid plan';
  if (plan.state === 'trialing' || plan.state === 'none') {
    const n = Number.isFinite(plan.daysLeft) ? Math.max(0, Math.floor(plan.daysLeft)) : null;
    if (n === null) return 'Free trial';
    return `Free trial · ${n} ${n === 1 ? 'day' : 'days'} left`;
  }
  if (plan.state === 'ended') return 'Trial ended · Choose a plan to keep editing';
  return null;
}

/** The cloud account of THIS Mac (desktop only): `{ connected, email, url, plan }`, kept current. */
function useCloudAccount(enabled) {
  const [acct, setAcct] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let gone = false;
    const read = () =>
      fetch('/_api/cloud/status')
        .then((r) => r.json().catch(() => ({})))
        .then((j) => {
          if (!gone)
            setAcct({
              connected: !!j?.connected,
              email: j?.email ?? null,
              url: j?.url ?? null,
              plan: j?.plan ?? null,
            });
        })
        .catch(() => {
          if (!gone) setAcct({ connected: false, email: null, url: null, plan: null });
        });
    read();
    window.addEventListener(CLOUD_CHANGED_EVENT, read);
    return () => {
      gone = true;
      window.removeEventListener(CLOUD_CHANGED_EVENT, read);
    };
  }, [enabled]);
  return acct;
}

export function AccountBlock({
  // null = the desktop (this Mac's own account); undefined = /_config has not answered yet, so
  // nothing is fetched or drawn; an object = the cloud tab (its dashboard address).
  cloud,
  readOnly = false,
  account: accountProp,
  open = openExternal,
}) {
  const ownAccount = cloud === null && !readOnly;
  const fetched = useCloudAccount(ownAccount && accountProp === undefined);
  const acct = accountProp === undefined ? fetched : accountProp;
  const dashboardUrl =
    cloud === null ? (ownAccount ? acct?.url : null) : (cloud?.dashboardUrl ?? null);
  const origin = accountOrigin(dashboardUrl);
  if (!dashboardUrl || !origin) return null;
  const host = new URL(origin).host;
  const signedIn = ownAccount ? !!acct?.connected : true;
  const plan = signedIn ? planWords(ownAccount ? acct?.plan : cloud?.plan) : null;
  const who = ownAccount ? acct?.email : null;
  return (
    <Group title="Account" testid="settings-account">
      {ownAccount && (
        <Row
          label={signedIn ? (who ?? 'You') : 'Maude Cloud'}
          hint={signedIn ? undefined : 'Sign in under Connections to sync projects.'}
        >
          <span data-testid="settings-account-state">
            {signedIn ? `Signed in to ${host}` : 'Not signed in'}
          </span>
        </Row>
      )}
      {plan && (
        <Row label="Plan">
          <span data-testid="settings-account-plan">{plan}</span>
        </Row>
      )}
      <Row label="Your account on the web" hint="People, billing, your Macs and downloads.">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => open(dashboardUrl)}
          data-testid="settings-open-dashboard"
        >
          {`Manage on ${host}`}
        </button>
      </Row>
      {signedIn && (
        <ul className="v2s-acct-links" data-testid="settings-account-links">
          {ACCOUNT_LINKS.map(([key, path, label]) => (
            <li key={key}>
              <button
                type="button"
                className="row-item v2s-acct-link"
                data-testid={`settings-account-${key}`}
                onClick={() => open(`${origin}${path}`)}
              >
                <span>{label}</span>
                <span aria-hidden="true">↗</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
}
