// The product-analytics vocabulary — Cloud Phase 26 Stage 2, the pure half.
//
// Data + pure functions + exhaustive tests, in the shape of pricing-core.mjs.
// Nothing here writes anything; `analytics.mjs` owns the binding.
//
// WHY A CLOSED VOCABULARY RATHER THAN `track('whatever', {...})`.
//
// The privacy notice now says an event is "the name of something that
// happened, your account id, and a timestamp… never your email address, and
// never anything from inside your designs." A free-form event bag makes that
// sentence a promise about future authors' discipline, which is the kind of
// promise a claim-guard test cannot check. So every event is DECLARED here,
// every property is an ENUM, and the two identifiers are shape-validated:
//
//   - `accountId` must match `acct_…`, so an email address cannot be passed
//     as one. This is the single most load-bearing check in the file: an
//     email in a blob would make the published notice false, silently, from
//     one careless call site.
//   - `projectId` must be the tenant-id shape the rest of the plane already
//     validates — it is a routing identifier, not content.
//   - every other property must be one of a fixed set of strings. Not
//     "should not be free text" — CANNOT be, because a value outside the set
//     is rejected.
//
// A path is not exempt from that rule, which is why `page_view` carries a
// normalized ROUTE TEMPLATE (`/projects/:id`) rather than a URL. A raw
// pathname is a place a name, a token or a search term eventually appears.

/** `acct_<random>` — accounts.id. An email address cannot satisfy this. */
const ACCOUNT_ID = /^acct_[A-Za-z0-9_-]{1,64}$/;
/** The tenant id shape cli/lib/cell-plan.mjs validates before D1 ever sees it. */
const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Every event this platform may emit.
 *
 * `props` are enum-constrained strings that become blobs; `doubles` are named
 * numeric measures. An event declaring neither carries the count `1`, which is
 * what makes "how many logins this week" a sum rather than a row count.
 */
export const EVENTS = {
  // ---- the funnel
  signup: { props: { method: ['password', 'google', 'invite'] } },
  login: { props: { method: ['password', 'google', 'device'] } },
  login_failed: { props: { reason: ['no-such-account', 'bad-password', 'rate-limited'] } },
  checkout_started: {
    props: { plan: ['project', 'dedicated'], interval: ['monthly', 'annual'] },
  },
  // No `interval`: `projects` records a plan and not a billing interval, so a
  // completed checkout cannot honestly name one. The interval lives on
  // `checkout_started`, where the form said which it was.
  checkout_completed: { props: { plan: ['project', 'dedicated'] } },
  project_provisioned: { props: {} },

  // ---- what people do with it
  project_opened: { props: { surface: ['browser', 'desktop', 'cli'] } },
  invite_created: { props: {} },
  invite_redeemed: { props: {} },
  export_downloaded: { props: { kind: ['generation', 'file'] } },
  report_submitted: { props: {} },
  page_view: { props: { route: null } }, // filled below from ROUTES

  // ---- leaving, which is worth measuring precisely because it is
  //      uncomfortable to look at
  billing_portal_opened: { props: {} },
  cancel_requested: { props: {} },
  delete_requested: { props: {} },

  // ---- the platform reporting on itself (Stage 3 + Stage 4). Cell-sourced
  //      counts, never a canvas name and never a path.
  tenant_stats: {
    props: {},
    doubles: ['canvases', 'artboards', 'designSystems', 'assetsBytes'],
  },
  tenant_render: {
    props: {},
    doubles: [
      'builds',
      'cacheHits',
      'cacheMisses',
      'rejectedImports',
      'timeouts',
      'memoryKills',
      'durationMsP50',
      'durationMsP95',
      'durationMsMax',
      'cpuMsTotal',
      'largestGraphBytes',
      // Not a measure — the window's start, carried so a row of zeroes can be
      // told apart from a cell that rebooted a minute ago. Without it, "no
      // builds" and "no data" are the same row.
      'windowStartedAt',
    ],
  },
  tenant_wake: { props: {}, doubles: ['coldStartMs'] },
};

/**
 * Route templates a `page_view` may name.
 *
 * Templates, never URLs. `/projects/alligators` becomes `/projects/:id`: the
 * project id is already carried in its own blob when it is relevant, and a
 * pathname is where a token or a search term eventually turns up.
 */
export const ROUTES = [
  '/',
  '/login',
  '/signup',
  '/account',
  '/account/people',
  '/account/billing',
  '/account/macs',
  '/account/download',
  '/account/delete',
  '/projects/new',
  '/projects/:id',
  '/projects/:id/connect',
  '/projects/:id/people',
  '/projects/:id/billing',
  '/projects/:id/mirror',
  '/projects/:id/audit',
  '/projects/:id/download',
  '/projects/:id/delete',
  '/projects/:id/setup',
  '/invites/:id',
  '/operator',
  'other',
];
EVENTS.page_view.props.route = ROUTES;

/**
 * A pathname → one of ROUTES.
 *
 * Anything unrecognised is `other` rather than passed through. That default is
 * the whole safety property: a route added tomorrow shows up as `other` until
 * somebody lists it, which is a gap in a chart. Passing the path through would
 * instead be a silent widening of what leaves this machine.
 */
export function normalizeRoute(pathname) {
  const path =
    String(pathname ?? '')
      .split('?')[0]
      .replace(/\/+$/, '') || '/';
  if (ROUTES.includes(path)) return path;
  const project = path.match(/^\/projects\/[a-z0-9-]+(\/[a-z-]+)?$/);
  if (project) {
    const template = `/projects/:id${project[1] ?? ''}`;
    return ROUTES.includes(template) ? template : 'other';
  }
  if (/^\/invites\/[A-Za-z0-9_-]+$/.test(path)) return '/invites/:id';
  if (path === '/operator' || path.startsWith('/operator/')) return '/operator';
  return 'other';
}

/**
 * Is this a thing we may record?
 *
 * Returns `{ ok }` rather than throwing: a bad event must never become a
 * failed request. `analytics.mjs` drops what does not validate and logs it.
 */
export function validateEvent(event) {
  if (!event || typeof event !== 'object') return { ok: false, error: 'not an event' };
  const spec = EVENTS[event.name];
  if (!spec) return { ok: false, error: `unknown event "${event.name}"` };

  if (event.accountId !== undefined && event.accountId !== null) {
    if (!ACCOUNT_ID.test(String(event.accountId))) {
      // The check that keeps the published notice true. An email address
      // reaching a blob is one careless call site away without it.
      return { ok: false, error: 'accountId is not an account id' };
    }
  }
  if (event.projectId !== undefined && event.projectId !== null) {
    if (!PROJECT_ID.test(String(event.projectId))) {
      return { ok: false, error: 'projectId is not a project id' };
    }
  }

  const given = Object.keys(event.props ?? {});
  const declared = Object.keys(spec.props ?? {});
  for (const key of given) {
    if (!declared.includes(key)) return { ok: false, error: `unknown property "${key}"` };
    const allowed = spec.props[key];
    if (!allowed.includes(event.props[key])) {
      // Not "looks like free text" — IS not one of the declared values. A
      // property whose values are open is a property that will one day carry
      // a customer's own words.
      return { ok: false, error: `"${event.props[key]}" is not a value of "${key}"` };
    }
  }
  for (const key of declared) {
    if (!given.includes(key)) return { ok: false, error: `missing property "${key}"` };
  }

  for (const key of spec.doubles ?? []) {
    const value = event.measures?.[key];
    if (value !== undefined && value !== null && !Number.isFinite(Number(value))) {
      return { ok: false, error: `measure "${key}" is not a number` };
    }
  }
  return { ok: true };
}

/**
 * Event → the Analytics Engine datapoint shape.
 *
 * ONE index, because AE allows one and it is what the SQL API groups by
 * cheaply — so it is the event name, which is the only dimension every query
 * starts from.
 *
 * Blob order is FIXED and positional: AE has no column names, so `blob1` means
 * "account id" forever. Appending is safe; reordering silently rewrites
 * history, which is why the order lives here rather than at the call sites.
 *
 * An absent measure becomes `NaN`-free `0`? No — it becomes `null`, which AE
 * stores as an absent double, so "this image did not report" stays
 * distinguishable from "it reported zero" all the way to the board.
 */
export function toDataPoint(event) {
  const spec = EVENTS[event.name];
  const props = spec?.props ?? {};
  return {
    indexes: [event.name],
    blobs: [
      event.accountId ?? '',
      event.projectId ?? '',
      ...Object.keys(props).map((k) => String(event.props?.[k] ?? '')),
    ],
    doubles: spec?.doubles
      ? spec.doubles.map((k) => {
          const v = event.measures?.[k];
          return v === undefined || v === null ? null : Number(v);
        })
      : [1],
  };
}

/** Position of each blob, for the SQL the operator board writes. */
export const BLOB = { accountId: 'blob1', projectId: 'blob2' };
