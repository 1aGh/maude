// The hub routes that predate the v2 table — classified, still served by their
// own branches in `server.mjs onRequest` (S9.3, decision v2-S9-hub-v2-route-table).
//
// A row here has NO handler: it only says what capability each method half needs
// at the access gate and which `scope` class it is (V2-1.16 U3). Moving a branch
// out of `server.mjs` into an area file is a later, separate change; classifying
// it is not optional — an unclassified hub path is a red
// `test/access-route-classes.test.mjs`.
//
// `cap.safe` covers GET/HEAD/OPTIONS, `cap.unsafe` every other method. `null`
// means the access gate checks nothing on that half: the route authenticates by
// something that is not a peer token (a public probe, the cell secret, the admin
// secret, a sign-in body) and answers for itself. A write the route has always
// refused a read-only token on states `edit` — exactly the pre-v2 gate.
//
// A19 lives in the `export` cells: every route that hands project BYTES away as
// a file needs `export` on a GET too, so Can view (`observer`) is refused it.

/** `/api/projects/:project/v1/<route>[/<id>]` — the accepted-revisions lane (DDR-241). */
const accepted = (route) =>
  new RegExp(`^/api/projects/[A-Za-z0-9._-]{1,128}/v1/${route}(?:/[A-Za-z0-9_-]{1,128})?$`);

export const LEGACY_ROWS = Object.freeze([
  // ---- public, secret-held and sign-in doors ---------------------------------
  { path: '/health', cap: { safe: null, unsafe: 'edit' }, scope: 'none' },
  // The control plane's "look now" nudge — the cell secret, never a member.
  { path: '/internal/revocation-sweep', cap: { safe: null, unsafe: null }, scope: 'none' },
  // The landing a hub with no project shows (with a studio, `/` is the studio's).
  { path: '/', cap: { safe: null, unsafe: 'edit' }, scope: 'none' },
  { path: '/auth/login', cap: { safe: null, unsafe: null }, scope: 'none' },
  // Ending your OWN session is not changing the project.
  { path: '/auth/logout', cap: { safe: null, unsafe: 'session' }, scope: 'none' },
  { path: '/auth/session', cap: { safe: null, unsafe: null }, scope: 'none' },
  { path: '/auth/browser', cap: { safe: null, unsafe: null }, scope: 'none' },
  { path: '/auth/browser/signout', cap: { safe: null, unsafe: 'session' }, scope: 'none' },
  { path: '/studio/signin', cap: { safe: null, unsafe: null }, scope: 'none' },
  { path: '/auth/oidc/start', cap: { safe: null, unsafe: null }, scope: 'none' },
  { path: '/auth/oidc/callback', cap: { safe: null, unsafe: null }, scope: 'none' },
  // Any other `/auth/…` is hub-owned (never proxied) and served by no branch.
  { path: '/auth/*', cap: { safe: null, unsafe: 'edit' }, scope: 'none' },
  // Magic-link invites: `/join/<token>` only looks; `/join` POST redeems.
  { path: '/join', cap: { safe: null, unsafe: null }, scope: 'none' },
  { path: '/join/*', cap: { safe: null, unsafe: null }, scope: 'none' },
  // The admin console authenticates with the admin secret, never a peer token.
  { path: '/admin', cap: { safe: null, unsafe: null }, scope: 'none' },
  { path: '/admin/*', cap: { safe: null, unsafe: null }, scope: 'none' },
  // Hub-owned on the shell origin (studio-door.mjs HUB_OWNED), no branch of its own.
  { path: '/invites*', cap: { safe: null, unsafe: 'edit' }, scope: 'none' },
  { path: '/.well-known/*', cap: { safe: null, unsafe: 'edit' }, scope: 'none' },

  // ---- the file plane (Sync v2, DDR-226) --------------------------------------
  // `canvasDoor` (S9.4, V2-1.16 L1/L5): each handler asks `access-files.mjs`
  // per path, so a canvas-only session lists, pulls, probes and writes only its
  // canvases' closure. `/api/file-limits` reveals only the caller's own quota.
  {
    path: '/api/journal',
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'filtered',
    canvasDoor: true,
  },
  // The studio child's loopback nudge.
  { path: '/api/journal/report', cap: { safe: null, unsafe: 'edit' }, scope: 'none' },
  {
    path: '/api/files',
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'filtered',
    canvasDoor: true,
  },
  // One manifest entry's BYTES (A19).
  {
    path: '/_project-file/*',
    cap: { safe: 'export', unsafe: 'edit' },
    scope: 'canvas',
    canvasDoor: true,
  },
  { path: '/api/file/*', cap: { safe: 'read', unsafe: 'edit' }, scope: 'canvas', canvasDoor: true },
  {
    path: '/api/file-uploads*',
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'canvas',
    canvasDoor: true,
  },
  {
    path: '/api/file-limits',
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'project',
    canvasDoor: true,
  },
  { path: '/api/project-config', cap: { safe: 'read', unsafe: 'edit' }, scope: 'project' },
  { path: '/api/project-format', cap: { safe: 'read', unsafe: 'edit' }, scope: 'project' },
  // The materializer's own token (cell boot), never a member's.
  { path: '/_materialize', cap: { safe: null, unsafe: null }, scope: 'project' },
  // The asset proxy: a GET hands the asset's BYTES away (A19); writes alias the file door.
  { path: '/assets/*', cap: { safe: 'export', unsafe: 'edit' }, scope: 'canvas', canvasDoor: true },
  // GET is presence-only by a recorded review decision; PUT aliases the file door.
  {
    path: '/_asset-file/*',
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'canvas',
    canvasDoor: true,
  },
  // A presence probe sent as POST, with the gates of the push sweep it serves.
  {
    path: '/_asset-probe',
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'filtered',
    canvasDoor: true,
  },

  // ---- documents (plane A) -----------------------------------------------------
  // `canvasDoor` (S9.5, V2-1.16 L2/L4/L6): the handler filters or refuses per
  // target for a canvas-only session; without it the gate refuses them all.
  {
    path: '/api/documents',
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'filtered',
    canvasDoor: true,
  },
  { path: '/api/documents/*', cap: { safe: 'read', unsafe: 'edit' }, scope: 'canvas' },

  // ---- accepted revisions (DDR-241) ---------------------------------------------
  // The bootstrap manifest, a lane body and a blob are the project's bytes (A19).
  // V2-1.16 L4: bootstrap is FILTERED for a canvas-only session (docs, dirs,
  // canvas groups and project config cut to what it sees).
  {
    pattern: accepted('bootstrap'),
    cap: { safe: 'export', unsafe: 'edit' },
    scope: 'filtered',
    canvasDoor: true,
  },
  {
    pattern: accepted('lane'),
    cap: { safe: 'export', unsafe: 'edit' },
    scope: 'canvas',
    canvasDoor: true,
  },
  {
    pattern: accepted('blobs'),
    cap: { safe: 'export', unsafe: 'edit' },
    scope: 'canvas',
    canvasDoor: true,
  },
  // The kernel judges every operation of a proposal per canvas.
  {
    pattern: accepted('proposals'),
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'canvas',
    canvasDoor: true,
  },
  {
    pattern: accepted('transactions'),
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'filtered',
    canvasDoor: true,
  },
  {
    pattern: accepted('revisions'),
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'filtered',
    canvasDoor: true,
  },
  {
    pattern: accepted('history'),
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'filtered',
    canvasDoor: true,
  },
  // S1.7 — the shared Trash's records; L18: cut to a canvas-only session's canvases.
  {
    pattern: accepted('trash'),
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'filtered',
    canvasDoor: true,
  },
  { pattern: accepted('mode'), cap: { safe: 'read', unsafe: 'edit' }, scope: 'project' },
  { pattern: accepted('parity'), cap: { safe: 'read', unsafe: 'edit' }, scope: 'project' },
  // Any other shape answers its own 404 / 405; it is still the project's lane.
  { path: '/api/projects/*', cap: { safe: 'read', unsafe: 'edit' }, scope: 'project' },

  // ---- the cell's git history --------------------------------------------------
  {
    path: '/api/history',
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'filtered',
    canvasDoor: true,
  },
  // A file AT a commit: raw bytes (A19).
  {
    path: '/api/history/file',
    cap: { safe: 'export', unsafe: 'edit' },
    scope: 'canvas',
    canvasDoor: true,
  },

  // ---- take your work home -----------------------------------------------------
  // POST because it takes work; the route keeps its own owner-only gate (cell-ops).
  { path: '/api/export', cap: { safe: null, unsafe: 'export' }, scope: 'project' },
]);
