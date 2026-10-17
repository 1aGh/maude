// The data half of the reachability probe's state machine (Phase 4 gate; contract
// apps/studio/client/v2/contracts/V2-4-gate-nothing-deleted.md). probe-reach.mjs drives a browser through
// these; nothing here touches one, so scripts/test can pin it.
//
//   OPENERS         a short path from boot to a screen, written as steps — data, never per-row code
//   STATES          a named world the studio is in (linked to a hub, signed in to the cloud, a held AI edit):
//                   the canned server answers + the /_config keys + the Tauri commands + the WebSocket frames
//   ROUTE_ANSWERS   the canned JSON a state names, by answer name
//
// Every answer is the probe's own stub: the fixture server is real, a hub never is. An opener asks for a
// state by name (`state: 'linked-project'`) or for single routes (`routes: { <path>: <answer> }`).

const tid = (t) => `[data-testid="${t}"]`;

export { tid };

/** ⌘K as V2-4.6 draws it (client/dialogs/command-palette.jsx): the input, the row label text, and the
 *  row testid `palette-row-<group>:<action id>` — the exact id, so no label has to be guessed. */
export const PALETTE = {
  key: 'Meta+k',
  input: tid('palette-input'),
  rowTestid: '[data-testid^="palette-row-"]',
  label: '.st-pal-ltxt',
};

const HUB = 'https://hub.example.com';
const NOW = 1_760_000_000_000;

/** Canned server answers, by name. */
export const ROUTE_ANSWERS = {
  // ── sync ───────────────────────────────────────────────────────────────────────────────────
  linked: {
    linked: true,
    state: 'offline-long',
    queuedOps: 3,
    hub: HUB,
    docs: { total: 4, synced: 3, rejected: 1 },
    conflicts: [
      { kind: 'cold-start-diverged', path: '.design/ui/Home.tsx', at: '2026-01-01T00:00:00Z' },
    ],
  },
  // the file plane up: counts, a rate-limit pause, a held deletion, per-file delivery, a seed phase, a
  // refused document, a failed asset, an unfinished AI edit and two notices (SyncPanel's readers)
  linkedRich: {
    linked: true,
    state: 'offline-long',
    url: HUB,
    queuedOps: 0,
    docs: { total: 3, synced: 2, pending: 0, rejected: 1 },
    items: [
      { slug: 'ui-home', state: 'synced' },
      { slug: 'ui-pricing', state: 'auth-rejected', reason: 'sign-in expired' },
    ],
    assets: {
      total: 4,
      done: 2,
      pushed: 2,
      skipped: 0,
      failedCount: 1,
      failures: [{ key: 'hero.png', reason: 'too big' }],
      finished: false,
      active: 'hero.png',
    },
    files: {
      synced: 5,
      pulled: 2,
      pushed: 1,
      conflicts: 1,
      failed: 0,
      rateLimited: { waiting: 2 },
      held: [
        { kind: 'mass-delete', detail: '12 files vanished.', count: 2, paths: ['a.png', 'b.png'] },
      ],
      delivery: { 'a.png': 'stuck', 'b.png': 'durable' },
      progress: {
        tracked: 10,
        delivered: 6,
        remaining: 4,
        phase: 'blocked',
        blocked: [{ class: 'quota', count: 2 }],
      },
    },
    notices: [
      { id: 'shared-doc-on', text: 'Shared canvases are on for this workspace.' },
      { id: 'source-conflict-ui-home', text: 'Home has changes on both sides.' },
    ],
    aiAction: { state: 'held', label: 'Redesign the hero', canvases: ['.design/ui/Home.tsx'] },
  },
  // …and the other branch of the file plane's failure line (a failure that is not a rate limit)
  linkedRichFailed: {
    linked: true,
    state: 'offline-long',
    url: HUB,
    docs: { total: 1, synced: 1, pending: 0, rejected: 0 },
    files: { synced: 3, pulled: 0, pushed: 0, conflicts: 0, failed: 2 },
  },
  syncSettings: {
    ok: true,
    settings: { syncFiles: true, propagateDeletes: true, resolveFirstAnchor: 'ask' },
  },
  ownershipRepo: {
    ok: true,
    mode: 'repo-owned',
    linked: true,
    git: true,
    trackedCount: 3,
    hubUrl: HUB,
  },
  ownershipHub: {
    ok: true,
    mode: 'hub-owned',
    linked: true,
    git: true,
    trackedCount: 0,
    hubUrl: HUB,
  },
  syncTrash: {
    ok: true,
    entries: [
      { trashRel: '_trash/ui/Old.tsx', sourceRel: 'ui/Old.tsx', reason: 'conflict', at: NOW },
    ],
    total: 1,
    bytes: 2048,
  },
  // ── git ────────────────────────────────────────────────────────────────────────────────────
  gitBehind: {
    repo: true,
    branch: 'main',
    files: [{ path: '.design/ui/Home.tsx', status: 'modified' }],
    unpushed: 1,
    behind: 2,
    remoteAhead: true,
  },
  // a saved-version list (GET /_api/git/log): each row carries a short sha
  gitLog: {
    entries: [
      {
        sha: 'a1b2c3d4e5f6a7b8',
        author: 'Tereza',
        date: '2026-10-16T10:00:00Z',
        message: 'Tighten the hero',
      },
      {
        sha: '0f9e8d7c6b5a4f3e',
        author: 'Ola',
        date: '2026-10-15T09:00:00Z',
        message: 'First pass at pricing',
      },
    ],
  },
  // the branch list the draft switcher reads: the shared version and two drafts (one newer)
  gitBranches: {
    branches: [
      { name: 'main', where: 'local', updatedAt: 1_760_000_000 },
      { name: 'hero-pass', where: 'local', updatedAt: 1_759_900_000 },
      { name: 'pricing-ideas', where: 'local', updatedAt: 1_759_000_000 },
    ],
  },
  // the same repo with a draft checked out (the switcher offers "add to shared")
  gitOnDraft: {
    repo: true,
    branch: 'hero-pass',
    files: [{ path: '.design/ui/Home.tsx', status: 'modified' }],
    unpushed: 1,
    behind: 0,
  },
  // ── Maude Cloud (CloudBar) ─────────────────────────────────────────────────────────────────
  cloudIn: {
    ok: true,
    connected: true,
    email: 'tereza@example.com',
    url: 'https://cloud.example',
    project: 'reachability',
    linkedHub: { url: HUB, credentialed: true },
  },
  cloudProjects: {
    ok: true,
    projects: [
      { id: 'studio', name: 'Studio site', url: HUB, role: 'owner', stateLabel: 'ready' },
      {
        id: 'docs',
        name: 'Docs',
        url: 'https://hub2.example.com',
        role: 'member',
        stateLabel: 'ready',
      },
      {
        id: 'brand',
        name: 'Brand',
        url: 'https://hub3.example.com',
        role: 'viewer',
        stateLabel: '',
      },
    ],
  },
  cloudSigninStart: {
    ok: true,
    deviceCode: 'probe-device-code',
    userCode: 'ABCD-1234',
    verificationUrl: 'https://cloud.example/device',
    interval: 60,
  },
  // ── other connections ──────────────────────────────────────────────────────────────────────
  githubIdentity: { ok: true, login: 'tereza', name: 'Tereza', avatar_url: null },
  figmaIn: { configured: true, handle: 'tereza', email: 'tereza@example.com' },
};

/** Named worlds. `routes` = { path: answer name } · `config` merges into /_config · `invoke` answers the
 *  desktop's Tauri commands · `push` = WS frames (WS_PUSH names) sent once the page is up. */
export const STATES = {
  'linked-project': {
    config: { linkedHub: { url: `${HUB}/p/studio`, credentialed: true } },
    routes: {
      '/_sync-status': 'linked',
      '/_api/sync/settings': 'syncSettings',
      '/_api/sync/ownership': 'ownershipRepo',
      '/_api/git/status': 'gitBehind',
    },
  },
  'linked-hub-owned': {
    extends: 'linked-project',
    routes: { '/_api/sync/ownership': 'ownershipHub' },
  },
  'linked-rich': {
    extends: 'linked-project',
    routes: { '/_sync-status': 'linkedRich', '/_api/sync/trash': 'syncTrash' },
  },
  'linked-rich-failed': {
    extends: 'linked-project',
    routes: { '/_sync-status': 'linkedRichFailed', '/_api/sync/trash': 'syncTrash' },
  },
  'git-dirty': {
    routes: {
      '/_api/git/status': 'gitBehind',
      '/_api/git/log*': 'gitLog',
      '/_api/git/branches': 'gitBranches',
    },
  },
  'trash-full': { routes: { '/_api/sync/trash': 'syncTrash' } },
  'git-on-draft': { extends: 'git-dirty', routes: { '/_api/git/status': 'gitOnDraft' } },
  'cloud-in': {
    routes: { '/_api/cloud/status': 'cloudIn', '/_api/cloud/projects': 'cloudProjects' },
  },
  'cloud-signing-in': {
    // the desktop asks its shell before the device flow (client/github.js cloudSignInPrepare)
    invoke: { cloud_sign_in_prepare: false, cloud_signed_in: false },
    routes: { '/_api/cloud/signin/start': 'cloudSigninStart' },
  },
  'github-in': {
    invoke: { github_is_signed_in: true },
    routes: { '/_api/github/identity': 'githubIdentity' },
  },
  'figma-in': { routes: { '/_api/figma/status': 'figmaIn' } },
};

/** WebSocket frames the studio's own server would send (client/app.jsx `m.type` branches). */
export const WS_PUSH = {
  // a branch switch / pull mid-session: Diagnostics › Server offers a reload
  'git-lifecycle': {
    type: 'git-lifecycle',
    payload: { kind: 'branch-switch', from: 'main', to: 'next' },
  },
};

/** An opener with its state folded in (a state may extend another): the one shape the browser driver reads. */
export function resolveOpener(opener, states = STATES, answers = ROUTE_ANSWERS) {
  const chain = [];
  for (let s = opener.state; s; s = states[s]?.extends) {
    if (!states[s]) throw new Error(`opener ${opener.id}: unknown state ${s}`);
    chain.unshift(states[s]);
  }
  const routes = {};
  let config = {};
  let invoke = {};
  for (const st of chain) {
    Object.assign(routes, st.routes);
    config = { ...config, ...st.config };
    invoke = { ...invoke, ...st.invoke };
  }
  Object.assign(routes, opener.routes);
  Object.assign(config, opener.config);
  const json = {};
  for (const [path, name] of Object.entries(routes)) {
    if (!(name in answers)) throw new Error(`opener ${opener.id}: no route answer "${name}"`);
    json[path] = answers[name];
  }
  return { routes: json, config, invoke };
}

const settingsTab = (tab) => [
  { key: 'Meta+Comma' },
  { click: tid(`settings-tab-${tab}`) },
  { expand: tid('settings-sheet') },
];
const diagView = (v) => [
  { click: tid('project-pill') },
  { click: tid('project-menu-row-sub-diagnostics') },
  { click: tid(`project-menu-row-diag.${v}`) },
  { expand: tid('diagnostics-sheet') },
];

/** step kinds: click (main frame) · frameClick (canvas iframe) · frameContext (right-click in the canvas iframe) · dblclick · wait (ms) · `unless` (skip when that selector is on screen) · key · expandMenu · expand (every
 *  aria-expanded=false inside a root, bounded) · palette (⌘K + type each needed action's label) ·
 *  run (⌘K, pick one action by id) · push (a WS frame) · type (into the focused field) · fill
 *  ([selector, text]) · `optional`
 *  skips a click whose target is not on screen. */
export const OPENERS = [
  { id: 'shell', canvas: false, steps: [] },
  { id: 'canvas', steps: [] },
  { id: 'menu', steps: [{ click: tid('project-pill') }, { expandMenu: true }] },
  ...['general', 'connections', 'advanced'].map((s) => ({
    id: `settings-${s}`,
    steps: settingsTab(s),
  })),
  // ── a project linked to a workspace: Settings › Advanced › This project, the Sync view ────────
  { id: 'settings-advanced-linked', state: 'linked-project', steps: settingsTab('advanced') },
  {
    id: 'settings-advanced-adopt',
    state: 'linked-project',
    steps: [...settingsTab('advanced'), { click: tid('sync-ownership-adopt') }],
  },
  {
    id: 'settings-advanced-detach',
    state: 'linked-hub-owned',
    steps: [...settingsTab('advanced'), { click: tid('sync-ownership-detach') }],
  },
  { id: 'diag-sync-linked', state: 'linked-project', steps: diagView('sync') },
  {
    id: 'diag-sync-files',
    state: 'linked-rich',
    steps: [
      ...diagView('sync'),
      { click: tid('sync-trash-prune'), optional: true },
      { click: tid('sync-resolve-ui-home'), optional: true },
    ],
  },
  { id: 'diag-sync-files-failed', state: 'linked-rich-failed', steps: diagView('sync') },
  ...['server', 'logs', 'ai', 'sync'].map((v) => ({ id: `diag-${v}`, steps: diagView(v) })),
  {
    id: 'diag-server-repo-changed',
    steps: [...diagView('server'), { push: 'git-lifecycle' }],
  },
  // ── Maude Cloud, GitHub, Figma, a team server (Settings › Connections) ────────────────────────
  { id: 'settings-cloud-in', state: 'cloud-in', steps: settingsTab('connections') },
  {
    id: 'settings-cloud-signin',
    state: 'cloud-signing-in',
    steps: [...settingsTab('connections'), { click: tid('cloud-signin') }],
  },
  { id: 'settings-github-in', state: 'github-in', steps: settingsTab('connections') },
  { id: 'settings-figma-in', state: 'figma-in', steps: settingsTab('connections') },
  {
    id: 'settings-team-server',
    steps: [...settingsTab('connections'), { click: tid('settings-team-server-add') }],
  },
  // ── dialogs a person opens by name ────────────────────────────────────────────────────────────
  {
    id: 'dialog-report-bug',
    steps: [
      { run: 'help.report-bug' },
      { fill: [tid('report-bug-description'), 'The probe describes a bug.'] },
      { click: tid('report-bug-preview') },
    ],
  },
  { id: 'dialog-figma-import', steps: [{ run: 'import.figma' }] },
  { id: 'dialog-figma-import-in', state: 'figma-in', steps: [{ run: 'import.figma' }] },
  {
    id: 'left-canvases',
    steps: [{ click: tid('canvases-advanced') }, { expand: tid('dock-slot-left') }],
  },
  { id: 'left-layers', steps: [{ click: tid('panel-tab-layers') }, { wait: 2500 }] },
  { id: 'left-assets', steps: [{ click: tid('panel-tab-assets') }] },
  // ── the canvas, with something on it ──────────────────────────────────────────────────────────
  { id: 'inspector', steps: [{ frameClick: '[data-cd-id="home-hero-title"]' }] },
  {
    id: 'selection-multi',
    steps: [
      { frameClick: '[data-cd-id="home-hero-title"]' },
      { frameClick: '[data-cd-id="home-pricing-title"]', modifiers: ['Shift'] },
    ],
  },
  { id: 'preview', steps: [{ click: tid('palette-mode-preview') }] },
  {
    id: 'preview-shape-options',
    steps: [
      { click: tid('palette-mode-preview') },
      { frameClick: tid('toolbar-slot-shape') },
      { frameClick: tid('toolbar-slot-pen'), optional: true },
    ],
  },
  {
    id: 'preview-comment',
    steps: [
      { click: tid('palette-mode-preview') },
      { frameClick: tid('toolbar-slot-comment') },
      { frameClick: '[data-cd-id="home-hero-body"]' },
    ],
  },
  { id: 'palette', steps: [{ palette: true }] },
  { id: 'shortcuts', steps: [{ key: 'Shift+Slash' }] },
  { id: 'export', steps: [{ key: 'Shift+Meta+E' }] },
  { id: 'share', steps: [{ click: tid('share-cluster-share') }] },
  { id: 'comments', steps: [{ click: tid('share-cluster-comments') }] },
  { id: 'ai-chat', steps: [{ key: 'Shift+Meta+A' }] },
  { id: 'history', steps: [{ key: 'Shift+Meta+G' }] },
  { id: 'history-dirty', state: 'git-dirty', steps: [{ key: 'Shift+Meta+G' }] },
  // Version history on a repo with changes: the unsaved list, then the saved versions (a short sha each)
  {
    id: 'history-saved',
    state: 'git-dirty',
    steps: [{ key: 'Shift+Meta+G' }, { click: '.gp-tabs [role="tab"]:nth-child(2)' }],
  },
  // the draft switcher at the foot of Canvases (desktop): its menu, then a draft checked out
  {
    id: 'switcher',
    state: 'git-dirty',
    steps: [{ click: tid('repo-switcher-trigger'), optional: true }],
  },
  {
    id: 'switcher-draft',
    state: 'git-on-draft',
    steps: [{ click: tid('repo-switcher-trigger'), optional: true }],
  },
  // Canvases > Advanced with hidden files on: sidecars, the runtime group, supporting-file previews
  {
    id: 'left-hidden-files',
    steps: [
      { click: tid('canvases-advanced'), unless: tid('canvases-hidden-files') },
      { click: tid('canvases-hidden-files') },
      { expand: tid('dock-slot-left') },
    ],
  },
  // right-click in the canvas: the element menu (Copy CSS, Copy style, Convert layout…), then an artboard's
  {
    id: 'canvas-menu',
    steps: [{ frameContext: '[data-cd-id="home-hero-title"]' }],
  },
  // …and on a container, where Convert layout to absolute is offered
  { id: 'canvas-menu-container', steps: [{ frameContext: '[data-cd-id="home-hero-grid"]' }] },
  {
    id: 'canvas-menu-artboard',
    steps: [{ frameContext: '[data-dc-screen="home-hero"] .dc-artboard-label', optional: true }],
  },
  // the Inspector's Advanced section (custom CSS / attribute rows) and an artboard's own Inspector
  {
    id: 'inspector-advanced',
    steps: [
      { frameClick: '[data-cd-id="home-hero-title"]' },
      { click: tid('inspector-section-advanced'), optional: true },
    ],
  },
  // a click selects and the Inspector opens on its CSS tab; Inspect (the selector header) and Layers (the
  // DOM tree with its artboard count) are one tab away
  {
    id: 'inspector-inspect',
    steps: [
      { frameClick: '[data-cd-id="home-hero-title"]' },
      { click: 'button.st-rp-tab:has-text("Inspect")', optional: true },
    ],
  },
  {
    id: 'inspector-layers',
    steps: [
      { frameClick: '[data-cd-id="home-hero-title"]' },
      { click: 'button.st-rp-tab:has-text("Layers")', optional: true },
      { wait: 1500 },
    ],
  },
  {
    id: 'inspector-grid',
    steps: [
      { frameClick: '[data-cd-id="home-hero-grid"]', modifiers: ['Meta'] },
      { click: tid('inspector-section-grid'), optional: true },
    ],
  },
  // a content-addressed photo: the Inspector offers a Photo tab (the knobs)
  {
    id: 'photo',
    steps: [
      { frameClick: '[data-cd-id="home-hero-photo"]' },
      { click: 'button.st-rp-tab:has-text("Photo")', optional: true },
    ],
  },
  { id: 'left-trash', state: 'trash-full', steps: [{ click: tid('canvases-trash-row') }] },
  {
    id: 'inspector-artboard',
    steps: [{ frameClick: '[data-dc-screen="home-hero"] .dc-artboard-label', optional: true }],
  },
  // Export: the options each format opens, and the note a workspace with no render service gets
  { id: 'export-png', steps: [{ key: 'Shift+Meta+E' }, { click: tid('export-format-png') }] },
  {
    id: 'export-pdf',
    steps: [
      { key: 'Shift+Meta+E' },
      { click: tid('export-format-pdf') },
      { click: tid('export-pdf-marks'), optional: true },
    ],
  },
  // a video comp: open it, open the Timeline (⇧⌘T), pick the first clip (its inspector)
  {
    id: 'video-timeline',
    steps: [
      { click: tid('canvas-row-ui-reel') },
      { wait: 5000 },
      { key: 'Shift+Meta+T' },
      { wait: 3000 },
      { click: '[data-testid^="timeline-seq-"]', optional: true },
      { dblclick: '[data-testid="timeline-seq-0"]', optional: true },
    ],
  },
  { id: 'export-no-render', config: { exportLane: 'none' }, steps: [{ key: 'Shift+Meta+E' }] },
  { id: 'inspector-panel', steps: [{ key: 'Shift+Meta+I' }] },
];
