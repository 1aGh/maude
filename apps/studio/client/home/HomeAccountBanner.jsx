// client/home/HomeAccountBanner.jsx — 2.1.2 HB1 (canvas 17, artboard 16): the one banner on top of Home,
// only for a sign-in the person can fix. One problem: what broke, which projects' changes wait on this
// Mac, and the line's own fix (Sign in again / Sign in, `useAccountFix` — the same attempt the accounts
// list shows). Two or more: "2 sign-ins stopped working" and Review, which opens the accounts list. A
// server that does not answer never raises it (`homeAccountBanner`).

import { BrokenLink } from './HomeConnection.jsx';
import { WAITING_WORD } from './use-account-fix.js';

/**
 * @param {{ banner: ReturnType<typeof import('./home-accounts-model.js').homeAccountBanner>,
 *           native: boolean, fixer: { busy: string|null, error: string|null,
 *           fix: (card: object) => unknown }, onReview: () => void }} props
 */
export function HomeAccountBanner({ banner, native, fixer, onReview }) {
  if (!banner) return null;
  const one = banner.kind === 'one';
  const waiting = one && fixer.busy === banner.card.key;
  return (
    <div
      className="home-acb"
      role="alert"
      data-kind={banner.kind}
      data-testid="home-account-banner"
    >
      <span className="home-acb-ic" aria-hidden="true">
        <BrokenLink size={12} />
      </span>
      <span className="home-acb-t">
        <strong>{banner.title}</strong>
        {banner.body ? <span>{banner.body}</span> : null}
        {one && fixer.error ? (
          <span className="home-acb-err" data-testid="home-account-banner-error">
            {fixer.error}
          </span>
        ) : null}
      </span>
      {one ? (
        <button
          type="button"
          className="btn btn--primary btn--sm"
          data-testid="home-account-banner-fix"
          disabled={!native || waiting}
          title={native ? undefined : 'Sign in from the Maude app on your Mac.'}
          onClick={() => fixer.fix(banner.card)}
        >
          {waiting ? WAITING_WORD : banner.action}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--sm"
          data-testid="home-account-banner-review"
          onClick={onReview}
        >
          {banner.action}
        </button>
      )}
    </div>
  );
}
