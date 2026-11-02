// The signup surface — Cloud Phase 13. Server-rendered minimal HTML.
//
// Copy discipline (DDR-193 §5, enforced by pages.test.mjs): these strings are
// read by people who have never used git. No "token", no "repository", no
// "OAuth" — the Google button says "Continue with Google", which is all a
// human needs to know about OAuth.
//
// The DDR-193 §4 disclosure lives INSIDE signup — consent collected where the
// decision happens, not on a page nobody visits. `disclosure_accepted_at` is
// written only when the box was actually ticked.

import { backToAppLink, googleButton, isAppState, publicPage } from './brand.mjs';
import { allDashboardHtml } from './dashboard.mjs';
import { allHandoffHtml } from './handoff.mjs';
import { allInviteHtml } from './invites.mjs';
import { allPeopleHtml } from './people-page.mjs';

/**
 * Escape a value bound for HTML.
 *
 * The reset link arrives already narrowed — `peekEmailToken` refuses anything
 * that is not a live `mer_<hex>` value — and an address hint comes from a live
 * invitation row. Escaping anyway, because "the caller validates it" is a
 * property of today's caller, not of this function.
 */
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/**
 * One page in the v2 public shell (brand.mjs `publicPage`, Maude v2 S9.14):
 * the mark on top, one heading, optional help line, then the body. Styling
 * comes from the design system, not from ad-hoc CSS.
 */
function page({ heading, body, sub = null, tab = null }) {
  // The home page's tab IS the product name — suffixing it again would read
  // "Maude Cloud — Maude Cloud" (Cloud Phase 23 A4).
  return publicPage({ title: heading, sub, body, tab: tab ?? heading }).replace(
    /<title>Maude Cloud — Maude<\/title>/,
    '<title>Maude Cloud</title>'
  );
}

// `googleButton` + its CSS moved to brand.mjs in Cloud Phase 24 (A12b) — the
// invitation's join screen needs the same button, and a second copy is how two
// of them drift. Re-exported so existing importers keep working.
export { googleButton };

/**
 * The app's sign-in nonce when this page was reached from the app's own
 * `/activate?…&state=<hex>` hand-off, else null (S6↔S9 §5.1 steps 3–7).
 * Anything that is not exactly 32 lowercase hex is dropped silently.
 */
export function appStateFrom(next) {
  const raw = String(next ?? '');
  if (!raw.startsWith('/activate?')) return null;
  try {
    const s = new URL(raw, 'https://cloud.invalid').searchParams.get('state');
    return isAppState(s) ? s : null;
  } catch {
    return null;
  }
}

const withNext = (path, next) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

/**
 * The bill of materials, said BEFORE anybody reaches a card (Cloud Phase 24 A1).
 *
 * The audit's sharpest finding was that every page is honest and the journey
 * lies: a customer authorizes payment for "a home for your design projects" and
 * then discovers, one door at a time, that they need a desktop computer, an
 * install, and a SECOND paid subscription with Anthropic. The string "Claude"
 * appeared in zero customer-facing cloud pages.
 *
 * It is framed as the reason the work stays private rather than as a caveat,
 * because that is what it actually is — the disclosure's own argument, told
 * forwards. Same block on the landing and in the wizard: the two places
 * somebody decides. (v2 voice, CONTRACT §4: no "we", no "us".)
 */
export const BILL_OF_MATERIALS_HTML = `
  <div class="card">
    <strong>What you’ll need</strong>
    <p class="quiet">Maude runs on your own computer — a Mac or a PC, not a phone or a tablet.
    You’ll install the free Maude app, and the AI that draws with you runs on
    <strong>your own Claude subscription</strong> (about €20 a month, paid to Anthropic,
    not to Maude).</p>
    <p class="quiet" style="margin-bottom:0">That is also why your work stays private: your
    project is synced and versioned here, but it is only ever drawn on your machine.</p>
  </div>`;

export const DISCLOSURE_HTML = `
  <div class="card">
    <strong>What Maude Cloud can and cannot see</strong>
    <p class="quiet">Maude Cloud stores and syncs your project: your designs, your edit history,
    and who is editing. It never opens, runs, or renders your work on its own computers —
    designs are only ever drawn on your own device. You can download everything and
    leave at any time.</p>
  </div>`;

export function signupPage({
  googleEnabled = false,
  error = null,
  next = null,
  email = null,
} = {}) {
  // `next` is carried exactly like the sign-in page's: a new person the app (or
  // an invitation) sent here must land back there, not on a dashboard (S9.14).
  const state = appStateFrom(next);
  return page({
    heading: 'Create your account',
    sub: state ? 'Then this page sends you back to the app.' : null,
    body: `
    ${error ? `<p class="error">${error}</p>` : ''}
    ${googleEnabled ? `${googleButton({ next, wide: true })}<div class="or">or</div>` : ''}
    <form method="post" action="${withNext('/auth/signup', next)}">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email" required${
        email ? ` value="${esc(email)}"` : ''
      }>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="new-password" minlength="12" required>
      <p class="quiet">At least 12 characters.</p>
      ${DISCLOSURE_HTML}
      <label style="font-weight:400"><input type="checkbox" name="disclosure" value="yes" required>
      I understand what Maude Cloud stores and what it never does.</label>
      <p class="quiet">Creating an account means you accept the
        <a href="https://maude.sh/terms">Terms</a> and the
        <a href="https://maude.sh/privacy">Privacy notice</a>.</p>
      <button type="submit" class="wide">Create account</button>
    </form>
    <p class="fine">Already have an account? <a href="${esc(withNext('/login', next))}">Sign in</a>.</p>
    ${backToAppLink(state)}`,
  });
}

/**
 * Sign in (canvas 02 ob-signin-browser). `next` carries the page that sent
 * them here — an invitation, or the app's own `/activate` hand-off — so
 * signing in lands them back where they were going (Cloud Phase 23 A5). From
 * the app it says so, and offers the quiet way back to it.
 *
 * `email` is a server-side hint (`inviteHintFor`: the address an invitation is
 * FOR), never read from the URL.
 */
export function loginPage({
  googleEnabled = false,
  error = null,
  next = null,
  email = null,
  host = 'cloud.maude.sh',
} = {}) {
  const state = appStateFrom(next);
  return page({
    heading: state ? `Sign in to ${host}` : 'Sign in',
    tab: 'Sign in',
    sub: state ? 'Then this page sends you back to the app.' : null,
    body: `
    ${error ? `<p class="error">${error}</p>` : ''}
    ${googleEnabled ? `${googleButton({ next, wide: true })}<div class="or">or</div>` : ''}
    <form method="post" action="${esc(withNext('/auth/login', next))}">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email" required${
        email ? ` value="${esc(email)}"` : ''
      }>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <p style="margin-top:var(--space-5)"><button type="submit" class="wide">Sign in</button></p>
    </form>
    <p class="fine"><a href="/forgot">Forgot your password?</a></p>
    <p class="fine">New here? <a href="${esc(withNext('/signup', next))}">Create an account</a>.</p>
    ${backToAppLink(state)}`,
  });
}

/**
 * "Send me a link" — the door out of a forgotten password (RCA 2026-08-04).
 *
 * Its absence was half of a total lockout: an account whose password was gone
 * could not be recovered by any means the product offered, and the other half
 * (Google sign-in) refused the same account because its address had never been
 * confirmed. Neither door had a handle.
 */
export function forgotPage({ error = null, next = null } = {}) {
  return page({
    heading: 'Forgot your password',
    sub: 'Type the address you signed up with, and a link to choose a new password is emailed to it.',
    body: `
    ${error ? `<p class="error">${error}</p>` : ''}
    <form method="post" action="${esc(withNext('/auth/forgot', next))}">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email" required>
      <p style="margin-top:var(--space-5)"><button type="submit" class="wide">Email me a link</button></p>
    </form>
    <p class="fine">Remembered it? <a href="/login">Sign in</a>.</p>`,
  });
}

/**
 * The answer to "email me a link", for every address.
 *
 * SAME PAGE whether or not an account exists. The neutral sentence is the whole
 * point — a form that says "no account with that address" is a free membership
 * oracle, and this one sits unauthenticated in front of the entire customer
 * list.
 */
export function checkInboxPage({ heading = 'Check your email' } = {}) {
  return page({
    heading,
    body: `<p>If that address has a Maude account, a link is on its way. It works once and
       expires, so use the most recent mail if you asked more than once.</p>
     <p class="quiet">Nothing arrived after a few minutes? Check the spam folder, then
       <a href="/forgot">try again</a>.</p>
     <p><a href="/login">Back to sign in</a></p>`,
  });
}

/** Choose a new password, reached only by following the emailed link. */
export function resetPage({ token, error = null } = {}) {
  return page({
    heading: 'Choose a new password',
    body: `
    ${error ? `<p class="error">${error}</p>` : ''}
    <form method="post" action="/auth/reset">
      <input type="hidden" name="t" value="${esc(token)}">
      <label for="password">New password</label>
      <input id="password" name="password" type="password" autocomplete="new-password"
             minlength="12" required>
      <p class="quiet">At least 12 characters. Saving it signs out anything already signed
        in as you, everywhere.</p>
      <button type="submit" class="wide">Save and sign in</button>
    </form>`,
  });
}

/**
 * The address is confirmed — now say what that just unlocked.
 *
 * Ending on "you can now continue with Google" matters: confirming the address
 * is never the thing anybody wanted, it is the thing standing between them and
 * the button that refused them.
 */
export function verifiedPage({ googleEnabled = false } = {}) {
  return page({
    heading: 'Address confirmed',
    sub: 'This address is confirmed as yours.',
    body: `<p class="quiet">You can now sign in with Google as well as with your password.</p>
     <div class="stack">
       ${googleEnabled ? googleButton({ wide: true }) : ''}
       <a class="btn secondary wide" href="/login">Sign in</a>
     </div>`,
  });
}

export function homePage({ account = null, googleEnabled = false } = {}) {
  // Google both creates the account and signs in (accountForGoogle), so on
  // the landing page it earns a first-class button — one click instead of
  // signup page → buried link (owner feedback 2026-07-30).
  if (account) {
    return page({
      heading: 'You’re signed in',
      tab: 'Maude Cloud',
      body: `<p class="fine">${esc(account.email)}</p>
         <div class="stack"><a class="btn wide" href="/">Your projects</a></div>
         <form method="post" action="/auth/logout"><button type="submit" class="ghost wide">Sign out</button></form>`,
    });
  }
  return page({
    heading: 'A home for your design projects',
    tab: 'Maude Cloud',
    sub: 'Synced, versioned, and always yours to take with you.',
    body: `<div class="stack">
           ${googleEnabled ? googleButton({ wide: true }) : ''}
           <a class="btn secondary wide" href="/signup">Create an account</a>
         </div>
         <p class="fine">Already have an account? <a href="/login">Sign in</a>.</p>
         ${BILL_OF_MATERIALS_HTML}`,
  });
}

export function messagePage(title, text) {
  return page({ heading: title, body: `<p>${text}</p><p><a href="/">Back</a></p>` });
}

/**
 * Every customer-facing string, for the vocabulary lint.
 *
 * The dashboard is included HERE rather than lint-tested only in its own file:
 * a surface that has to opt IN to the copy discipline is a surface that
 * eventually does not.
 */
export function allCustomerFacingHtml() {
  return [
    allDashboardHtml(),
    allHandoffHtml(),
    allInviteHtml(),
    allPeopleHtml(),
    signupPage({ googleEnabled: true }),
    loginPage({ googleEnabled: true, error: 'That email and password don’t match.' }),
    loginPage({ googleEnabled: true, next: `/activate?code=ABCD-EFGH&state=${'a'.repeat(32)}` }),
    signupPage({ googleEnabled: true, next: `/activate?code=ABCD-EFGH&state=${'a'.repeat(32)}` }),
    forgotPage(),
    checkInboxPage(),
    resetPage({ token: 'x'.repeat(48), error: 'That link has expired.' }),
    verifiedPage({ googleEnabled: true }),
    homePage(),
    homePage({ googleEnabled: true }),
    homePage({ account: { email: 'a@example.com' } }),
    messagePage('Sign-in is not ready', 'Google sign-in is not configured here yet.'),
  ].join('\n');
}
