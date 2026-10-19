// client/v2/advanced/where-matrix.js — S11.15: "where you are changes a few Advanced rows" (06 · ad-edge-where),
// as DATA. Ten rows, five places, one cell each: shown, hidden, swapped for a word, greyed with its reason, or
// read-only. Never shown broken.
//
//   places   Mac app · In the browser · Can comment (Jonas, on a Mac) · Local project · Offline
//   cell     show | hidden | swap:<label> | greyed:<reason> | readonly   (+ the word a status row says)
//
// The matrix is not drawn anywhere by itself. Every surface already decides its own rows (the registry's
// `visible` / `enabled`, `fileMenuItems`, `buildShareLinks`, `gitSurface`, `hiddenMenuIds`, …); this file is
// the one table those decisions are held to — `test/v2-where-matrix.test.ts` computes each cell from the
// surface's own code and fails on the first row that disagrees. Hidden is not refused: for every row the
// matrix hides from Can comment, `serverRoutes` names the write the server refuses that role (checked
// against `access/request.ts` — the gate the server runs), or `native` says there is no studio route at all.
//
// Words are CONTRACT §6 / the canvas, exact. Pure data and two lookups; no DOM, no React.

/** A cell. `label` is the word a swap says, the reason a grey gives, or the status word of a `show`. */
const cell = (kind, label) => Object.freeze(label === undefined ? { kind } : { kind, label });
export const show = (word) => cell('show', word);
export const hidden = () => cell('hidden');
export const swap = (label) => cell('swap', label);
export const greyed = (reason) => cell('greyed', reason);
export const readonly = () => cell('readonly');

/** `show` | `hidden` | `swap:<label>` | `greyed:<reason>` | `readonly` — the contract's spelling of a cell. */
export const cellText = (c) => (c.label === undefined ? c.kind : `${c.kind}:${c.label}`);

/** The five places, in the canvas's column order. */
export const WHERE_CONTEXTS = Object.freeze([
  Object.freeze({ id: 'app', label: 'Mac app' }),
  Object.freeze({ id: 'browser', label: 'In the browser' }),
  Object.freeze({ id: 'comment', label: 'Can comment' }),
  Object.freeze({ id: 'local', label: 'Local project' }),
  Object.freeze({ id: 'offline', label: 'Offline' }),
]);
export const CONTEXT_IDS = Object.freeze(WHERE_CONTEXTS.map((c) => c.id));

/**
 * What each place IS, in the shell's own vocabulary — the inputs `menuCtx()`, `gitSurface()`, `saveStatus()` and
 * the other surfaces take. Jonas ("Can comment") is on a Mac in the app, joined to the project read-only:
 * the canvas shows him Address · Process · Project folder, so he is not a browser tab.
 *   native     the desktop app (Tauri doors exist)
 *   cloudTab   a tab served by a hub (cfg.cloud set)
 *   role       'view' | 'comment' | 'edit' | 'owner'
 *   linked     the project has a hub / cloud link
 *   online     the network is up
 *   repo       the folder is a git repository
 */
export const WHERE_FACTS = Object.freeze({
  app: Object.freeze({
    native: true,
    cloudTab: false,
    role: 'owner',
    linked: true,
    online: true,
    repo: true,
  }),
  browser: Object.freeze({
    native: false,
    cloudTab: true,
    role: 'owner',
    linked: true,
    online: true,
    repo: false,
  }),
  comment: Object.freeze({
    native: true,
    cloudTab: false,
    role: 'comment',
    linked: true,
    online: true,
    repo: true,
  }),
  local: Object.freeze({
    native: true,
    cloudTab: false,
    role: 'owner',
    linked: false,
    online: true,
    repo: true,
  }),
  offline: Object.freeze({
    native: true,
    cloudTab: false,
    role: 'owner',
    linked: true,
    online: false,
    repo: true,
  }),
});

/** Is the place read-only (Can view / Can comment)? */
export const isReadOnlyFacts = (f) => f.role === 'view' || f.role === 'comment';

const SAME = show();
const H = hidden();

/**
 * The ten rows. `home` is the panel the row lives in (the canvas's second line); `serverRoutes` are the
 * writes behind the row (paths as the server's gate sees them); `native` marks a row whose only door is a
 * Tauri command (Rust confines it — no studio route exists to refuse); `notRefused` names a route that stays
 * open to the read-only roles on purpose, with the reason.
 */
export const WHERE_ROWS = Object.freeze([
  {
    id: 'save-status',
    label: 'Save status',
    home: 'beside the faces',
    cells: {
      app: show('Saved'),
      browser: show('Saved'),
      comment: show('Can comment'),
      local: show('Local project'),
      offline: show('Offline — kept on this Mac'),
    },
    serverRoutes: [],
  },
  {
    id: 'reveal-open',
    label: 'Reveal in Finder · Open in editor',
    home: 'Canvases › Advanced',
    cells: {
      app: SAME,
      browser: swap('Open in the Mac app'),
      comment: H,
      local: SAME,
      offline: SAME,
    },
    native: true,
    serverRoutes: [],
  },
  {
    id: 'terminal',
    label: 'Open in terminal',
    home: 'AI chat panel › Advanced',
    cells: { app: SAME, browser: H, comment: H, local: SAME, offline: SAME },
    native: true,
    // The chat behind it needs Can edit: no AI below it (C30).
    serverRoutes: ['/_api/acp/chats/clear'],
  },
  {
    id: 'this-mac-link',
    label: 'This Mac only link',
    home: 'Share › Advanced',
    cells: { app: SAME, browser: H, comment: H, local: SAME, offline: SAME },
    serverRoutes: [],
    // An address, not a capability: the page behind it enforces the role.
    noServerCapability: 'An address, not a capability: the page behind it enforces the role.',
  },
  {
    id: 'link-rules',
    label: 'Link rules · GitHub invite',
    home: 'Share › Advanced',
    cells: {
      app: SAME,
      browser: SAME,
      comment: H,
      local: swap('Move to the cloud to share'),
      offline: greyed('needs the internet'),
    },
    serverRoutes: ['/_api/share/invites', '/_api/share/people/p1'],
  },
  {
    id: 'diag-values',
    label: 'Address · Process · Project folder',
    home: 'Diagnostics › Advanced',
    cells: {
      app: SAME,
      browser: swap('Runs in the cloud'),
      comment: SAME,
      local: SAME,
      offline: SAME,
    },
    serverRoutes: [],
  },
  {
    id: 'resync-download',
    label: 'Resync now · Download all',
    home: 'Diagnostics › Advanced',
    cells: {
      app: SAME,
      browser: swap('Download all only'),
      comment: swap('Download all only'),
      local: hidden(),
      offline: greyed('back online'),
    },
    serverRoutes: ['/_api/sync/resync'],
  },
  {
    id: 'raw-css',
    label: 'Raw CSS · Property · Attribute',
    home: 'Inspector › Advanced',
    cells: { app: SAME, browser: SAME, comment: readonly(), local: SAME, offline: SAME },
    serverRoutes: ['/_api/edit-css', '/_api/edit-attr'],
  },
  {
    id: 'git',
    label: 'Branch · Publish · Fetch',
    home: 'Version history › Advanced',
    cells: {
      app: SAME,
      browser: hidden(),
      comment: H,
      local: SAME,
      offline: greyed('Publish waits'),
    },
    serverRoutes: ['/_api/git/branch', '/_api/git/push'],
    // Fetch moves remote-tracking refs and nothing else: the gate files it under "your own place".
    notRefused: { '/_api/git/fetch': 'moves remote-tracking refs only (SESSION_WRITES)' },
  },
  {
    id: 'settings-this-mac',
    label: 'Settings › Advanced › This Mac',
    home: 'Settings',
    cells: { app: SAME, browser: H, comment: SAME, local: SAME, offline: SAME },
    serverRoutes: [],
  },
]);

export const ROW_IDS = Object.freeze(WHERE_ROWS.map((r) => r.id));

/** The cell for one row in one place. */
export function whereCell(rowId, contextId) {
  const row = WHERE_ROWS.find((r) => r.id === rowId);
  return row?.cells[contextId] ?? null;
}

/** Rows the matrix hides from a place — each needs its server refusal checked (hidden is not refused). */
export function hiddenRows(contextId) {
  return WHERE_ROWS.filter((r) => r.cells[contextId]?.kind === 'hidden');
}
