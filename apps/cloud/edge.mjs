// The control plane's EDGE — one place that every request passes through.
//
// Written after the 2026-07-30 /flow:validate found the plane had quietly
// become the single door for the whole fleet while keeping none of the hub's
// defenses. The findings were three, but the cause was one: there was no edge.
// Six separate `html()` helpers each carried their own header object, so the
// one surface that renders a PASSWORD FIELD (auth-routes.mjs) was also the one
// that had never been given a CSP — not by decision, by drift. And the login
// path spent 6×100k PBKDF2 iterations per unauthenticated request with no
// budget at all, while the hub's own login carries the comment "rate-limit
// BEFORE touching scrypt".
//
// So this module is deliberately NOT three fixes. It is the missing layer:
//
//   sameSiteGate   — a browser telling us the request came from another site
//   costGate       — a budget on the paths that cost real work to answer
//   harden         — the response headers every answer gets unless it opts out
//
// The rule that keeps it working: routes may TIGHTEN what the edge stamps
// (device-auth's `default-src 'none'` is stricter and survives untouched), but
// they can no longer FORGET it, and a new route inherits the floor for free.

/** Paths that pay for themselves — every other path is exempt from the budget. */
const COST_RULES = [
  // Password verification. The single most expensive unauthenticated call on
  // the plane, and the one an attacker most wants to repeat.
  {
    test: (p, m) => m === 'POST' && p === '/auth/login',
    limit: 10,
    windowMs: 60_000,
    cost: 'login',
  },
  {
    test: (p, m) => m === 'POST' && p === '/auth/signup',
    limit: 5,
    windowMs: 60_000,
    cost: 'signup',
  },
  // Choosing a new password derives the same 6×100k as a login, and does it
  // for a caller holding only a link — so it needs its own budget, not the
  // login one.
  {
    test: (p, m) => m === 'POST' && p === '/auth/reset',
    limit: 10,
    windowMs: 60_000,
    cost: 'reset',
  },
  // Asking for a reset link is cheap to answer but SENDS MAIL to an address
  // the caller names. Unbudgeted, that is a mail cannon pointed at any
  // customer, paid for out of our sending reputation.
  {
    test: (p, m) => m === 'POST' && p === '/auth/forgot',
    limit: 5,
    windowMs: 60_000,
    cost: 'forgot',
  },
  // Device + handoff codes are cheap to answer but mint credentials, so the
  // budget is about minting volume rather than CPU.
  {
    test: (p, m) => m === 'POST' && p === '/auth/device/code',
    limit: 10,
    windowMs: 60_000,
    cost: 'device',
  },
  {
    test: (p, m) => m === 'POST' && p === '/auth/handoff/exchange',
    limit: 20,
    windowMs: 60_000,
    cost: 'handoff',
  },
  // Guessing a device code at the human end.
  {
    test: (p, m) => m === 'POST' && p === '/activate',
    limit: 15,
    windowMs: 60_000,
    cost: 'activate',
  },
];

/**
 * Which budget this request draws on, or null when it draws on none.
 *
 * Keyed on the CLIENT (CF-Connecting-IP) plus the cost class, so a flood on
 * one path cannot exhaust another's budget for everybody.
 */
export function costOf(pathname, method) {
  return COST_RULES.find((r) => r.test(pathname, method)) ?? null;
}

function clientKey(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Spend one unit of a budget. Returns `{ ok }` — and fails OPEN.
 *
 * A rate limiter whose storage is unreachable must not take the product down
 * with it: refusing every login because D1 hiccuped converts a minor outage
 * into a total one. The hub made the same call for the same reason.
 *
 * Sliding, not fixed-window: a fixed window lets an attacker spend the whole
 * budget at 59 s and the whole budget again at 61 s. One row per hit makes it
 * genuinely rolling, and the volume here is auth attempts, not traffic.
 *
 * UPGRADE PATH: Cloudflare's native rate-limiting binding does this with no
 * storage round-trip. When `env.RATE_LIMITER` is bound, it is used and D1 is
 * never touched — the fallback exists so the plane is not undefended while
 * that binding is unconfigured, which is exactly the state that produced this
 * finding.
 */
export async function spend(env, request, rule, { now = Date.now() } = {}) {
  if (!rule) return { ok: true };
  const key = `${rule.cost}:${clientKey(request)}`;

  if (env.RATE_LIMITER?.limit) {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key });
      return { ok: success !== false, limiter: 'binding' };
    } catch {
      /* fall through to D1 */
    }
  }

  try {
    const since = now - rule.windowMs;
    await env.DB.prepare('DELETE FROM rate_hits WHERE at < ?')
      .bind(now - 3_600_000)
      .run();
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ? AND at >= ?'
    )
      .bind(key, since)
      .first();
    if ((row?.n ?? 0) >= rule.limit) return { ok: false, limiter: 'd1' };
    await env.DB.prepare('INSERT INTO rate_hits (bucket, at) VALUES (?, ?)').bind(key, now).run();
    return { ok: true, limiter: 'd1' };
  } catch (err) {
    console.error(`[edge] rate limit unavailable (${rule.cost}): ${err.message}`);
    return { ok: true, limiter: 'unavailable' };
  }
}

/**
 * Refuse a state-changing request a browser says came from another SITE.
 *
 * `SameSite=Lax` is same-SITE, not same-ORIGIN, and every workspace lives at
 * `<project>.cloud.maude.sh` — the same registrable domain as the dashboard.
 * A workspace page therefore ships the session cookie on a cross-origin POST
 * here, and workspace pages render customer-authored canvas content, which
 * DDR-054 designates untrusted. Fetch-Metadata closes it: browsers always
 * stamp `Sec-Fetch-Site`; non-browser clients (the desktop app, the CLI, curl,
 * tests) never do — so a MISSING header is allowed and only an explicit
 * cross-site/same-site claim is refused. `same-site` is refused too: that IS
 * the sibling-subdomain case.
 *
 * `/internal/*` and the webhooks are exempt — they authenticate with a derived
 * secret or a signature, never with a cookie, so a browser's opinion about
 * them decides nothing.
 */
export function sameSiteGate(request, url) {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  if (url.pathname.startsWith('/internal/') || url.pathname.startsWith('/webhooks/')) return true;
  const site = request.headers.get('sec-fetch-site');
  if (!site) return true; // non-browser client
  return site === 'same-origin' || site === 'none';
}

/**
 * The header floor every response gets.
 *
 * `frame-ancestors 'none'` matters most: the cell and the view origins both
 * refuse framing, and the plane — the origin with the password field and the
 * device-approval button — was the one that did not. A route that already set
 * a header keeps its own value, so a tighter policy is never loosened here.
 *
 * HSTS is stamped only on HTTPS: a preload-eligible max-age on a local http
 * test origin would pin a developer's browser to a scheme the dev server does
 * not speak.
 */

/**
 * Where a form on our pages is allowed to end up.
 *
 * `'self'` alone was wrong, and wrong in the one place it costs money: the
 * wizard POSTs to `/projects/new`, which answers 303 to a Stripe-hosted
 * Checkout URL. Browsers apply `form-action` to the REDIRECT as well as the
 * initial action, so the submission was blocked before it left the page —
 * "Continue to payment details" did nothing at all, with no error the customer
 * could see. Every route that hands off to Stripe has the same shape:
 * `/projects/<id>/billing/portal` and `/billing/resume` both 303 to the portal.
 *
 * Deliberately two exact hosts, not `https://*.stripe.com` and not a relaxed
 * directive: the point of `form-action` here is that an injected form cannot
 * post a session cookie to somewhere we did not choose, and that guarantee is
 * only worth what the list is narrow.
 *
 * Not covered on purpose: Stripe's own pages redirect onward (3-D Secure, bank
 * hand-offs). Those happen on Stripe's origin under Stripe's CSP — once the
 * browser has left us, our policy no longer applies.
 */
export const FORM_ACTION = "'self' https://checkout.stripe.com https://billing.stripe.com";

/**
 * Would a browser let a form on our page end up at `location`?
 *
 * The bug this exists to keep dead is invisible from the server: the route
 * answers a perfectly good 303 and the test asserting that 303 stays green,
 * while the browser refuses to send the form in the first place. So the route
 * tests that assert an off-origin hand-off assert THIS too — add a payment
 * provider without adding its host here and the checkout test goes red, not
 * production.
 *
 * A relative Location is always same-origin, hence always fine.
 */
export function formActionPermits(location) {
  if (!location) return false;
  if (location.startsWith('/') && !location.startsWith('//')) return true;
  let origin;
  try {
    origin = new URL(location).origin;
  } catch {
    return false;
  }
  return FORM_ACTION.split(/\s+/).includes(origin);
}

/**
 * The CSP of a page that sets its own — ONE builder, so no page can state
 * `form-action` by hand and forget Stripe.
 *
 * That is exactly what happened: seven modules each wrote
 * `form-action 'self'` into their own header, `harden()` below only fills a
 * CSP a route did NOT set, and so the Stripe allowance in FORM_ACTION applied
 * to nothing. Browsers apply `form-action` to the whole redirect chain; the
 * wizard, Choose a plan and the billing portal each answered a correct 303 and
 * Chromium stayed on the page (end-to-end run, 2026-11-24).
 *
 * `stripe: true` is for a page that RENDERS a form whose POST can answer a 303
 * to Stripe (checkout, billing, plan change). Every other page keeps `'self'`:
 * the directive is only worth what the list is narrow.
 */
export function pageCsp({ stripe = false } = {}) {
  return `default-src 'none'; style-src 'unsafe-inline'; form-action ${stripe ? FORM_ACTION : "'self'"}; frame-ancestors 'none'; base-uri 'none'`;
}

/**
 * Did this POST come from one of OUR pages, as far as `Origin` can say?
 *
 * Every page here is served `referrer-policy: no-referrer`, and under that
 * policy a browser sends `Origin: null` on a same-origin form POST — so "the
 * Origin must equal ours" refused every real browser (Chromium, Firefox and
 * Safari alike) while passing every test, which send no Origin at all.
 *
 * `null` is also what a sandboxed iframe or a cross-site redirect chain sends,
 * so it cannot simply be waved through. What tells the two apart is Fetch
 * Metadata, which the page cannot forge: `Sec-Fetch-Site: same-origin`. So:
 *
 *   - no Origin            → not stated (the desktop app, curl): allowed here,
 *                            the CSRF token decides;
 *   - Origin = ours        → allowed;
 *   - Origin: null         → allowed ONLY beside `Sec-Fetch-Site: same-origin`;
 *   - anything else        → refused.
 *
 * This is the Origin half only. The caller still checks its session-derived
 * token, and `sameSiteGate` has already refused cross-site and same-site
 * browser posts before any route ran.
 */
export function sameOriginPost(request, url) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin === url.origin) return true;
  if (origin === 'null') return request.headers.get('sec-fetch-site') === 'same-origin';
  return false;
}

export function harden(response, { url, html = false } = {}) {
  const h = new Headers(response.headers);
  const floor = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    ...(html
      ? {
          'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action ${FORM_ACTION}; frame-ancestors 'none'; base-uri 'none'`,
        }
      : {}),
    ...(url?.protocol === 'https:'
      ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' }
      : {}),
  };
  for (const [k, v] of Object.entries(floor)) if (!h.has(k)) h.set(k, v);
  return new Response(response.body, { status: response.status, headers: h });
}

/** True when this response is a document the CSP floor should apply to. */
export function isHtml(response) {
  return (response.headers.get('content-type') ?? '').includes('text/html');
}
