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
// an annotation on the canvas, by its id (the probe fixture's board, probe-reach.mjs annotationsFixture)
const A = (id) => `.dc-annot-el[data-id="${id}"]`;
// what the shell tells the canvas about the vote it shows (bridge/dgn-protocol.ts `vote-state`)
const VOTE = { id: 'vt1', targets: ['ab:home-hero', 'ab:home-pricing'], perVoter: 3 };
const voteState = (vote, mine = {}) => ({ dgn: 'vote-state', vote: { ...VOTE, ...vote }, mine });

// Preview is where annotations are picked (Edit leaves them quiet and click-through)
const PREVIEW = { click: tid('palette-mode-preview') };

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
  // the project's own history (accepted revisions): who did what, with Preview / Restore / Undo
  projectHistory: {
    ok: true,
    history: [
      {
        revision: 3,
        actionId: 'act-3',
        label: 'Tightened the hero',
        actor: 'Tereza',
        committedAt: NOW,
        canvases: ['.design/ui/Home.tsx'],
        mine: true,
        kind: 'edit',
      },
      {
        revision: 2,
        actionId: 'act-2',
        label: 'First pass at pricing',
        actor: 'Ola',
        committedAt: NOW - 3_600_000,
        canvases: ['.design/ui/Home.tsx'],
        mine: false,
        kind: 'edit',
      },
    ],
  },
  // a project that saves through git, not accepted revisions
  projectLegacy: { ok: false, reason: 'legacy' },
  // nothing to save, but the remote has moved on: the empty panel offers Get latest
  gitClean: {
    repo: true,
    branch: 'main',
    files: [],
    unpushed: 0,
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
  // ── the ACP chat (desktop): the bridge's availability probe and the readiness report behind it ────
  acpAvailable: { available: true },
  acpMissing: { available: false, reason: 'Claude Code is not installed.' },
  preflightNoClaude: {
    ready: false,
    items: [
      {
        id: 'claude',
        label: 'Claude Code',
        status: 'missing',
        required: true,
        detail: 'Not found on this Mac.',
        remediation: 'Install Claude Code, then check again.',
        action: 'install',
        installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
      },
    ],
  },
  // Claude Code found on the PATH but not signed in, plugins ready: Diagnostics > AI setup draws its four rows (Found at
  // …) and the Sign in to Claude button from this. The server's own probe runs `claude` on the machine, so under load
  // it answers late or not at all ("Couldn't reach the readiness probe", no row on screen) and what the audit saw
  // depended on the machine
  preflightReady: {
    ready: false,
    items: [
      {
        id: 'claude',
        label: 'Claude Code',
        status: 'missing',
        required: true,
        detail: 'Not signed in.',
        remediation: 'Sign in to Claude, then check again.',
        action: 'signin',
        resolvedPath: '/Users/probe/.local/bin/claude',
        resolvedViaMaude: false,
      },
      // every item carries a `detail` (readiness.ts ReadinessItem): the list renders it as text, and a stub without it
      // crashed the desktop shell ("This window stopped drawing")
      {
        id: 'plugins',
        label: 'Plugins',
        status: 'present',
        required: true,
        detail: 'Design and flow plugins are installed.',
      },
    ],
  },
  // ── comments: the Comments panel's list, the in-canvas overlay's, and who "me" is ───────────────────
  commentsAll: {
    '.design/ui/Home.tsx': [
      {
        id: 'c1',
        file: '.design/ui/Home.tsx',
        selector: '[data-cd-id="home-hero-title"]',
        bounds: null,
        text: 'Make this headline tighter',
        status: 'open',
        created: '2026-10-16T10:00:00Z',
        resolved_at: null,
        author: 'Tereza',
        thread: [],
        dom_path: ['div', 'h1'],
        // a moment on a video (the thread's "at 0:12" chip) and a converted sticky (its "From Jonas's sticky…" line)
        t: 12,
        from: { author: 'Jonas', convertedBy: 'Tereza' },
      },
      {
        id: 'c2',
        file: '.design/ui/Home.tsx',
        selector: '[data-cd-id="home-hero-body"]',
        bounds: null,
        text: 'Body copy is too long',
        status: 'resolved',
        created: '2026-10-15T10:00:00Z',
        resolved_at: '2026-10-16T09:00:00Z',
        author: 'Ola',
        thread: [],
        dom_path: ['div', 'p'],
      },
    ],
  },
  viewerIdentity: { name: 'Tereza', email: 'tereza@example.com' },
  // the comment door refuses a write (S9.22): the canvas says it in one sentence and keeps the text
  // this Mac has opened nothing yet (GET /_api/pins): ⌘K's Recent says so
  pinsNone: { pins: [], opened: {} },
  commentRefused: { __status: 403, ok: false, error: 'That did not go through.' },
  // a sticky turned into a comment by this session (S4.7's answer: the new thread's id and its op-log action): the
  // shell remembers the conversion, so that thread's header offers Undo (the fixture's c1 is Tereza's converted sticky)
  stickyConverted: { ok: true, commentId: 'c1', actionId: 'act-probe-1' },
  // ── routes that never answer / fail (a slow start, a canvas that does not load) ───────────────────
  pngImage: { __png: true },
  brandImportOk: { ok: true, path: 'assets/logo.svg' },
  brandExtracted: {
    ok: true,
    palette: ['#336699', '#ffcc00'],
    fonts: ['Inter'],
    logoRef: 'assets/ab12cd34.png',
    logoRasterRef: 'assets/ab12cd34.png',
    hadWordmarkText: false,
  },
  brandExtractFailed: { __status: 422, ok: false, error: 'That file has no readable shapes.' },
  sourceConflictGone: { ok: false, error: 'This conflict is already resolved.' },
  cloudSigninBadUrl: {
    ok: true,
    deviceCode: 'probe-device-code',
    userCode: 'ABCD-1234',
    verificationUrl: 'https://not-the-cloud.example/device',
    interval: 60,
  },
  hang: { __hang: true },
  abort: { __abort: true },
  // S8.19: the answer GET /_api/asset-state gives for a picture no device has (the canvas then frames it, Relink…)
  assetMissing: { items: [{ rel: 'assets/ab12cd34.png', state: 'missing' }] },
  serverError: { __status: 500, error: 'probe: the server answered 500' },
  // ── the bug-report dialog's service, the source-conflict body, the offline download ──────────────
  reportOk: { ok: true, issueUrl: 'https://github.com/1aGh/maude/issues/1', issueNumber: 1 },
  reportFailed: { __status: 503, ok: false, error: 'The report service is down.' },
  sourceConflict: {
    ok: true,
    mine: 'headline: Hello\nbody: A\n',
    theirs: 'headline: Hello there\nbody: A\n',
    original: 'headline: Hello\n',
    base: 'headline: Hi\nbody: A\n',
  },
  syncOffline: { ok: true, complete: true, pulled: 3 },
  // ── Figma ───────────────────────────────────────────────────────────────────────────────────
  figmaProbeOk: { ok: true, handle: 'tereza' },
  figmaProbeBad: { ok: false, error: 'Figma did not accept that token.' },
  // the link step's Import reads the page's frames (v2 FigmaSheet: /_api/figma/frames), the pick step's Import brings the
  // picked ones in (/_api/figma/import-frames) and the done step is the summary
  figmaFrames: {
    ok: true,
    surface: 'design',
    fileName: 'Probe',
    page: 'Page 1',
    more: 0,
    frames: [
      { id: '1:2', name: 'Hero', width: 1440, height: 900 },
      { id: '1:3', name: 'Pricing', width: 1440, height: 1100 },
    ],
  },
  figmaImportFramesOk: {
    ok: true,
    artboards: 2,
    comments: { placed: 1, resolved: 0, elsewhere: 0 },
    assets: { pending: 0, resolved: 0 },
    dispositions: [
      { disposition: 'imported', name: 'Hero' },
      { disposition: 'imported', name: 'Pricing' },
      { disposition: 'skipped', name: 'Comment layer', reason: 'not a design' },
    ],
  },
  figmaFramesBad: { __status: 400, ok: false, reason: 'bad-url' },
  // signed out of Maude Cloud, with the cloud's own address (the sign-in link is checked against it)
  cloudOut: { ok: true, connected: false, url: 'https://cloud.example' },
  cloudProjectsNone: { ok: true, projects: [] },
  githubIdentity: { ok: true, login: 'tereza', name: 'Tereza', avatar_url: null },
  figmaIn: { configured: true, handle: 'tereza', email: 'tereza@example.com' },
};

ROUTE_ANSWERS.commentsFile = { comments: ROUTE_ANSWERS.commentsAll['.design/ui/Home.tsx'] };

/** Named worlds. `routes` = { path: answer name } · `config` merges into /_config · `invoke` answers the
 *  desktop's Tauri commands · `push` = WS frames (WS_PUSH names) sent once the page is up. */
export const STATES = {
  'linked-project': {
    dropFrames: ['git-status'],
    config: { linkedHub: { url: `${HUB}/p/studio`, credentialed: true } },
    routes: {
      '/_sync-status': 'linked',
      '/_api/sync/settings': 'syncSettings',
      '/_api/sync/ownership': 'ownershipRepo',
      '/_api/git/status*': 'gitBehind',
    },
  },
  'linked-hub-owned': {
    extends: 'linked-project',
    routes: { '/_api/sync/ownership': 'ownershipHub' },
  },
  'linked-rich': {
    extends: 'linked-project',
    routes: {
      '/_sync-status': 'linkedRich',
      '/_api/sync/trash': 'syncTrash',
      '/_api/project/conflict*': 'sourceConflict',
      '/_api/sync/offline': 'syncOffline',
    },
  },
  'linked-rich-failed': {
    extends: 'linked-project',
    routes: { '/_sync-status': 'linkedRichFailed', '/_api/sync/trash': 'syncTrash' },
  },
  'git-dirty': {
    dropFrames: ['git-status'],
    routes: {
      '/_api/git/status*': 'gitBehind',
      '/_api/git/log*': 'gitLog',
      '/_api/git/branches': 'gitBranches',
    },
  },
  'project-history': { routes: { '/_api/project/history*': 'projectHistory' } },
  // saving through the cloud, and the cloud's history cannot be read
  'cloud-history-down': {
    extends: 'cloud-in',
    routes: { '/_api/project/history*': 'projectLegacy', '/_api/cloud/history*': 'serverError' },
  },
  'git-clean-behind': { dropFrames: ['git-status'], routes: { '/_api/git/status*': 'gitClean' } },
  'trash-full': { routes: { '/_api/sync/trash': 'syncTrash' } },
  'git-on-draft': { extends: 'git-dirty', routes: { '/_api/git/status*': 'gitOnDraft' } },
  'cloud-in': {
    routes: { '/_api/cloud/status': 'cloudIn', '/_api/cloud/projects': 'cloudProjects' },
  },
  'cloud-signing-in': {
    // the desktop asks its shell before the device flow (client/github.js cloudSignInPrepare)
    invoke: { cloud_sign_in_prepare: false, cloud_signed_in: false },
    routes: { '/_api/cloud/signin/start': 'cloudSigninStart', '/_api/cloud/status': 'cloudOut' },
  },
  // the bug-report dialog: shots that arrive, a window shot that does not, a service that answers or fails
  'report-shots': { routes: { '/_api/export': 'pngImage', '/_api/shell-shot': 'hang' } },
  'report-sent': {
    routes: {
      '/_api/export': 'pngImage',
      '/_api/shell-shot': 'pngImage',
      '/_api/report': 'reportOk',
    },
  },
  'report-failed': {
    routes: {
      '/_api/export': 'pngImage',
      '/_api/shell-shot': 'pngImage',
      '/_api/report': 'reportFailed',
    },
  },
  'figma-probe-ok': {
    extends: 'figma-in',
    routes: { '/_api/figma/probe': 'figmaProbeOk' },
  },
  'figma-probe-bad': {
    extends: 'figma-in',
    routes: { '/_api/figma/probe': 'figmaProbeBad' },
  },
  'figma-import-ok': {
    extends: 'figma-in',
    routes: {
      '/_api/figma/frames': 'figmaFrames',
      '/_api/figma/import-frames': 'figmaImportFramesOk',
    },
  },
  'figma-import-bad': { extends: 'figma-in', routes: { '/_api/figma/frames': 'figmaFramesBad' } },
  // a maude:// link the shell parked at launch (take_pending_deep_link)
  'deeplink-connect': {
    invoke: { take_pending_deep_link: 'maude://open/studio-site?code=mhc_00112233445566778899' },
  },
  'deeplink-file': {
    invoke: { take_pending_deep_link: 'maude://open/other-project?open=.design/ui/Home.tsx' },
  },
  // …for a project that IS on this Mac (the dialog offers Open)
  'deeplink-file-here': {
    invoke: {
      take_pending_deep_link: 'maude://open/other-project?open=.design/ui/Home.tsx',
      resolve_project_for_link: '/Users/probe/other-project',
    },
  },
  // the team-server dialog: recent team projects the shell knows; cloud projects; and an open that works
  // the team-server dialog, opened from the draft switcher (the full variant: recents + Maude Cloud; Settings'
  // own door is address-only). The switcher needs a repo, so every state here sits on `git-dirty`.
  'team-signed-out': {
    extends: 'git-dirty',
    invoke: { cloud_sign_in_prepare: false, cloud_signed_in: false },
    routes: { '/_api/cloud/signin/start': 'cloudSigninStart', '/_api/cloud/status': 'cloudOut' },
  },
  'team-recents': {
    extends: 'git-dirty',
    invoke: {
      managed_projects_list: [
        { key: 'r1', name: 'Studio site', server_url: HUB, project_id: 'studio' },
      ],
    },
    routes: { '/_api/cloud/status': 'cloudIn', '/_api/cloud/projects': 'cloudProjects' },
  },
  'team-empty': {
    extends: 'git-dirty',
    routes: { '/_api/cloud/status': 'cloudIn', '/_api/cloud/projects': 'cloudProjectsNone' },
  },
  'team-opening': {
    extends: 'team-recents',
    invoke: { managed_project_open: '/Users/probe/studio' },
  },
  // the browser would not be allowed to open the sign-in address
  'cloud-open-refused': {
    extends: 'cloud-signing-in',
    invoke: { open_cloud_url: { __reject: 'Refusing to open that address' } },
  },
  'brand-extracted': {
    routes: { '/_api/import-asset': 'brandImportOk', '/_api/import-brand': 'brandExtracted' },
  },
  // the desktop's native picker hands back the file's bytes
  'brand-extracted-desktop': {
    extends: 'brand-extracted',
    invoke: { pick_media_file: { bytes: [60, 115, 118, 103, 62] } },
  },
  'brand-failed': {
    routes: { '/_api/import-asset': 'brandImportOk', '/_api/import-brand': 'brandExtractFailed' },
  },
  // a conflict somebody else already resolved
  'linked-rich-conflict-gone': {
    extends: 'linked-rich',
    routes: { '/_api/project/conflict*': 'sourceConflictGone' },
  },
  // the sign-in address the cloud sent is not the cloud's own
  'cloud-signin-bad-url': {
    extends: 'cloud-signing-in',
    routes: { '/_api/cloud/signin/start': 'cloudSigninBadUrl' },
  },
  'github-in': {
    invoke: { github_is_signed_in: true },
    routes: { '/_api/github/identity': 'githubIdentity' },
  },
  'figma-in': { routes: { '/_api/figma/status': 'figmaIn' } },
  // the desktop's AI chat with an agent behind it (acp-stub.mjs plays the bridge): `acp` names the script
  'acp-chat': { acp: 'chat', routes: { '/_api/acp/status': 'acpAvailable' } },
  'acp-connecting': { acp: 'chat-connecting', routes: { '/_api/acp/status': 'acpAvailable' } },
  'acp-plan': { acp: 'chat-plan', routes: { '/_api/acp/status': 'acpAvailable' } },
  'acp-elicit': { acp: 'chat-elicit', routes: { '/_api/acp/status': 'acpAvailable' } },
  'acp-error': { acp: 'chat-error', routes: { '/_api/acp/status': 'acpAvailable' } },
  'acp-done': { acp: 'chat-done', routes: { '/_api/acp/status': 'acpAvailable' } },
  'acp-limit': { acp: 'chat-limit', routes: { '/_api/acp/status': 'acpAvailable' } },
  // a Home canvas with an open comment (Tereza's own) and a resolved one: the panel, the pin, the thread
  // `re:` keys are a regular expression over the whole URL — the canvas runs on its own origin
  comments: {
    routes: {
      '/_comments-all': 'commentsAll',
      're:/_comments\\?file=': 'commentsFile',
      're:/_api/git-user': 'viewerIdentity',
    },
  },
  // …and the sticky on the board turns into a comment of this session (the stub answers the convert route)
  'comments-converted': {
    extends: 'comments',
    routes: { '/_api/annotations/to-comment': 'stickyConverted' },
  },
  'comments-refused': {
    extends: 'comments',
    routes: { '/_api/comments/op': 'commentRefused' },
  },
  'acp-chat-comments': {
    extends: 'acp-chat',
    routes: {
      '/_comments-all': 'commentsAll',
      're:/_comments\\?file=': 'commentsFile',
      're:/_api/git-user': 'viewerIdentity',
    },
  },
  // the project index never answers: the tree shows its loading card
  'tree-slow': { routes: { '/_index-data': 'hang' } },
  // a picture the fixture canvas names is gone from every device: the studio says Missing and the file never loads, so
  // the canvas frames it (S8.19 — `asset-frames`, `asset-frame`, `asset-frame-relink`)
  'asset-missing': {
    routes: { '/_api/asset-state*': 'assetMissing', 're:/assets/ab12cd34\\.png': 'abort' },
  },
  // the canvas shell never loads: the opening card, then (after the 15 s cap) the failure card
  // S1.5: the desktop shell knows another project with a Pricing canvas (Rust `index_search`)
  'other-projects': {
    invoke: {
      index_search: {
        groups: [
          {
            pid: 'l0123456789abcdef',
            name: 'Pricing site',
            place: 'closed',
            rows: [{ key: 'ui/Pricing.tsx', name: 'Pricing', group: 'canvases', meta: null }],
          },
        ],
      },
    },
  },
  'nothing-opened': { routes: { '/_api/pins*': 'pinsNone' } },
  'canvas-hung': { routes: { 're:/_canvas-shell': 'hang' } },
  // no Claude Code on this Mac: the explainer and its "Set up AI editing" button
  'acp-missing': {
    routes: { '/_api/acp/status': 'acpMissing', '/_api/preflight': 'preflightNoClaude' },
  },
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
  let acp = null;
  const dropFrames = new Set();
  for (const st of chain) {
    if (st.acp) acp = st.acp;
    for (const t of st.dropFrames ?? []) dropFrames.add(t);
    Object.assign(routes, st.routes);
    config = { ...config, ...st.config };
    invoke = { ...invoke, ...st.invoke };
  }
  Object.assign(routes, opener.routes);
  Object.assign(config, opener.config);
  if (opener.acp) acp = opener.acp;
  const json = {};
  for (const [path, name] of Object.entries(routes)) {
    if (!(name in answers)) throw new Error(`opener ${opener.id}: no route answer "${name}"`);
    json[path] = answers[name];
  }
  return { routes: json, config, invoke, acp, dropFrames: [...dropFrames] };
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

/** step kinds: frameDom (a DOM click on a canvas element Playwright would call off-screen) · post ([path, body] — a same-origin POST) · hover · frameDown (press on a canvas element and hold) · mouseMove ([dx, dy] while held) · mouseUp · click (main frame) · frameClick (canvas iframe) · frameDblclick · frameContext (right-click in the canvas iframe) · dblclick · wait (ms) · `unless` (skip when that selector is on screen) · key · expandMenu · expand (every
 *  aria-expanded=false inside a root, bounded) · palette (⌘K + type each needed action's label) ·
 *  run (⌘K, pick one action by id) · push (a WS frame) · type (into the focused field) · fill
 *  ([selector, text]) · ensureOpen (a fold toggle: clicked only while aria-expanded="false") · `optional`
 *  skips a click whose target is not on screen. */
const LOCAL_SHELLS = ['desktop', 'browser'];
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
      { click: tid('sync-offline'), optional: true },
      { wait: 400 },
      { click: tid('sync-resolve-ui-home'), optional: true },
      { wait: 600 },
      { click: '.scp-recovery summary:has-text("Original draft")', optional: true },
      { click: '.scp-recovery summary:has-text("Starting version")', optional: true },
    ],
  },
  { id: 'diag-sync-files-failed', state: 'linked-rich-failed', steps: diagView('sync') },
  ...['server', 'logs', 'sync'].map((v) => ({ id: `diag-${v}`, steps: diagView(v) })),
  { id: 'diag-ai', routes: { '/_api/preflight': 'preflightReady' }, steps: diagView('ai') },
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
  {
    id: 'left-layers',
    steps: [
      { click: tid('panel-tab-layers') },
      { wait: 2500 },
      // S11.9: the tag and id after each layer's name sit behind Layers › Advanced › Show tags and ids
      { ensureOpen: tid('layers-advanced') },
      { click: tid('layers-show-tags'), optional: true },
      { wait: 400 },
    ],
  },
  // searching the Canvases list also lists the other groups' files (Design system, project and runtime files)
  {
    id: 'left-search',
    steps: [{ fill: [tid('canvas-search'), 'colors'] }, { wait: 700 }],
  },
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
      // Preview opens on the board it last rested on (Pricing, with the Hero scrolled off to the left); Fit shows both
      { frameKey: 'Meta+0' },
      { wait: 700 },
      { frameClick: tid('toolbar-slot-comment') },
      // `at`: near the element's corner — in Preview the b-roll player sits over the middle of the Hero's blocks and takes
      // the pointer there
      { frameClick: '[data-cd-id="home-hero-body"]', at: [8, 8] },
    ],
  },
  { id: 'palette', steps: [{ palette: true }] },
  { id: 'shortcuts', steps: [{ key: 'Shift+Slash' }] },
  { id: 'export', steps: [{ key: 'Shift+Meta+E' }] },
  // S9.19 — the Share sheet: the web / app / this-Mac links live under its › Advanced · Other ways in
  {
    id: 'share',
    steps: [{ click: tid('share-cluster-share') }, { ensureOpen: tid('share-other-ways-toggle') }],
  },
  // Share… from the menu: a viewer has no Share button in the cluster, but the menu row is there
  {
    id: 'share-menu',
    steps: [
      { click: tid('project-pill') },
      { click: tid('project-menu-row-share.open') },
      { ensureOpen: tid('share-other-ways-toggle') },
    ],
  },
  { id: 'comments', steps: [{ click: tid('share-cluster-comments') }] },
  { id: 'ai-chat', steps: [{ key: 'Meta+Slash' }] },
  { id: 'history', steps: [{ key: 'Alt+Meta+H' }] },
  // the project's history: the rows, then one previewed (the version bar, Restore)
  {
    id: 'history-project',
    state: 'project-history',
    steps: [
      { key: 'Alt+Meta+H' },
      { wait: 600 },
      { click: tid('fold-history-toggle'), unless: tid('git-panel'), optional: true },
      { wait: 1200 },
    ],
  },
  {
    id: 'history-project-preview',
    state: 'project-history',
    steps: [
      { key: 'Alt+Meta+H' },
      { wait: 600 },
      { click: tid('fold-history-toggle'), unless: tid('git-panel'), optional: true },
      { wait: 1200 },
      { click: tid('project-history-preview-3'), optional: true },
      { wait: 2500 },
    ],
  },
  {
    id: 'history-cloud-down',
    state: 'cloud-history-down',
    steps: [
      { key: 'Alt+Meta+H' },
      { wait: 600 },
      { click: tid('fold-history-toggle'), unless: tid('git-panel'), optional: true },
      { wait: 1200 },
    ],
  },
  {
    id: 'history-clean',
    state: 'git-clean-behind',
    steps: [
      { key: 'Alt+Meta+H' },
      { wait: 800 },
      { click: tid('fold-history-toggle'), unless: tid('git-panel'), optional: true },
      { wait: 700 },
    ],
  },
  {
    id: 'history-dirty',
    state: 'git-dirty',
    steps: [
      { key: 'Alt+Meta+H' },
      { wait: 800 },
      { click: tid('fold-history-toggle'), unless: tid('git-panel'), optional: true },
      { wait: 700 },
    ],
  },
  // Version history › Advanced on a repo with changes: the unsaved list, then the versions (a short sha each)
  {
    id: 'history-saved',
    state: 'git-dirty',
    steps: [
      { key: 'Alt+Meta+H' },
      { wait: 800 },
      { click: tid('fold-history-toggle'), unless: tid('git-panel'), optional: true },
      { wait: 700 },
    ],
  },
  // S11.10 — the git buttons' dialogs, one opener each (the fold, then the button)
  {
    id: 'history-save-dialog',
    state: 'git-dirty',
    steps: [
      { key: 'Alt+Meta+H' },
      { wait: 800 },
      { click: tid('fold-history-toggle'), unless: tid('git-panel'), optional: true },
      { wait: 700 },
      { click: tid('vh-git-save'), optional: true },
    ],
  },
  {
    id: 'history-branch-dialog',
    state: 'git-dirty',
    steps: [
      { key: 'Alt+Meta+H' },
      { wait: 800 },
      { click: tid('fold-history-toggle'), unless: tid('git-panel'), optional: true },
      { wait: 700 },
      { click: tid('switcher-new-branch'), optional: true },
    ],
  },
  // a branch checked out (Advanced offers "Add to main")
  {
    id: 'history-add-dialog',
    state: 'git-on-draft',
    steps: [
      { key: 'Alt+Meta+H' },
      { wait: 800 },
      { click: tid('fold-history-toggle'), unless: tid('git-panel'), optional: true },
      { wait: 700 },
      { click: tid('switcher-merge'), optional: true },
    ],
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
    steps: [
      { frameContext: '[data-cd-id="home-hero-title"]' },
      { frameDom: tid('canvas-menu-item-advanced'), optional: true },
    ],
  },
  // …and on a container, where Convert layout to absolute is offered
  {
    id: 'canvas-menu-container',
    steps: [
      { frameContext: '[data-cd-id="home-hero-grid"]' },
      { frameDom: tid('canvas-menu-item-advanced'), optional: true },
    ],
  },
  {
    id: 'canvas-menu-artboard',
    steps: [
      { frameContext: '[data-dc-screen="home-hero"] .dc-artboard-label', optional: true },
      { frameDom: tid('canvas-menu-item-advanced'), optional: true },
      { frameDom: tid('canvas-menu-item-theme'), optional: true },
    ],
  },
  // the Inspector's Advanced section (custom CSS / attribute rows) and an artboard's own Inspector. Since
  // S2.2 `css-panel`, `inspector-section-*` and `inspector-body-layout` sit inside the Inspector's
  // › Advanced fold, so each opener opens it first (`ensureOpen`, a no-op when it is open already).
  {
    id: 'inspector-advanced',
    steps: [
      { frameClick: '[data-cd-id="home-hero-title"]' },
      { ensureOpen: tid('fold-inspector-toggle') },
      { click: tid('inspector-section-advanced'), optional: true },
    ],
  },
  // a click selects and the Inspector opens on its CSS tab; Inspect (the selector header) and Layers (the
  // DOM tree with its artboard count) are one tab away
  {
    id: 'inspector-inspect',
    steps: [
      { frameClick: '[data-cd-id="home-hero-title"]' },
      { ensureOpen: tid('fold-inspector-toggle') },
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
      { ensureOpen: tid('fold-inspector-toggle') },
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
    steps: [
      { frameClick: '[data-dc-screen="home-hero"] .dc-artboard-label', optional: true },
      // a board does not open the Inspector by itself (an element does): open it, unless the page remembers it open
      { key: 'Shift+Meta+I', unless: tid('inspector-panel') },
      { wait: 400 },
      { ensureOpen: tid('fold-inspector-toggle') },
    ],
  },
  // Export: the options each format opens, and the note a workspace with no render service gets
  { id: 'export-png', steps: [{ key: 'Shift+Meta+E' }, { click: tid('export-format-png') }] },
  {
    id: 'export-pdf',
    steps: [
      { key: 'Shift+Meta+E' },
      // S8.2: PNG / JPG sit on the sheet; every other format is under "Other…"
      { click: tid('export-other') },
      { click: tid('export-format-pdf') },
      { ensureOpen: tid('export-advanced-toggle') },
    ],
  },
  // a video comp: open it, open the Timeline (⇧⌘T), pick the first clip (its inspector)
  {
    id: 'video-timeline',
    steps: [
      { click: tid('canvas-row-ui-reel') },
      { wait: 5000 },
      { key: 'Shift+Meta+T' },
      { waitFor: '[data-testid^="timeline-seq-"]', timeout: 20_000 },
      { click: '[data-testid^="timeline-seq-"]', optional: true },
      { dblclick: '[data-testid="timeline-seq-0"]', optional: true },
      // the fixture comp is past the long-video cap (3 600 frames): its badge opens Advanced, where the keyframe
      // markers sit on the clips (timeline-kf-<i>-<k>)
      { click: tid('timeline-long-badge'), optional: true },
      { wait: 600 },
    ],
  },
  { id: 'export-no-render', config: { exportLane: 'none' }, steps: [{ key: 'Shift+Meta+E' }] },
  { id: 'inspector-panel', steps: [{ key: 'Shift+Meta+I' }] },
  // ── drawn annotations (the fixture's Home.annotations.svg) ────────────────────────────────────
  {
    id: 'annot-select',
    steps: [PREVIEW, { frameClick: '.dc-annot-el[data-id="r1"]' }, { wait: 500 }],
  },
  // lock it (the badge, then the toolbar offers Unlock), then edit its text
  {
    id: 'annot-lock',
    steps: [
      PREVIEW,
      { frameClick: '.dc-annot-el[data-id="r1"]' },
      { wait: 400 },
      { frameClick: tid('annot-ctx-lock'), optional: true },
      { wait: 400 },
    ],
  },
  // a standalone text annotation edited (Enter on a selected text)
  {
    id: 'annot-edit-note',
    steps: [
      PREVIEW,
      { frameClick: '.dc-annot-el[data-id="t2"]' },
      { wait: 300 },
      { key: 'Enter' },
      { wait: 600 },
    ],
  },
  {
    id: 'annot-edit-enter',
    steps: [
      PREVIEW,
      { frameClick: '.dc-annot-el[data-id="r1"]' },
      { wait: 300 },
      { key: 'Enter' },
      { wait: 600 },
    ],
  },
  // ── wave A's annotation surfaces (the fixture's board: stickies, a section, a sticker the AI placed, stamps,
  // arrows with words / bound / dangling, an open vote) ─────────────────────────────────────────────
  // an arrow selected: its small toolbar (inks, line, two-way); "+5" opens the other inks
  {
    id: 'annot-arrow-sel',
    steps: [
      PREVIEW,
      { frameClick: A('a2') },
      { wait: 500 },
      { frameClick: tid('annot-arrow-ink-more'), optional: true },
      { wait: 300 },
    ],
  },
  // the field a double-click on an arrow opens
  { id: 'annot-arrow-label-edit', steps: [PREVIEW, { frameDblclick: A('a2') }, { wait: 600 }] },
  // an arrow whose element is gone: the open circle, then (selected) the card with Point to…
  { id: 'annot-arrow-dangling', steps: [PREVIEW, { frameClick: A('a3') }, { wait: 600 }] },
  // a sticky: Resolve · Turn into a comment · List · Size · the other papers
  {
    id: 'annot-sticky-sel',
    steps: [
      PREVIEW,
      { frameClick: A('st1') },
      { wait: 500 },
      { frameClick: tid('annot-sticky-paper-more'), optional: true },
      { wait: 300 },
    ],
  },
  // the right-click menu over a sticky (copy … Turn into a comment, Resolve)
  { id: 'annot-menu-sticky', steps: [PREVIEW, { frameContext: A('st1') }, { wait: 500 }] },
  // a section by its title chip: Fold · Ask AI about it
  {
    id: 'annot-section-sel',
    steps: [PREVIEW, { frameClick: `${A('sc1')} [data-section-chip]` }, { wait: 500 }],
  },
  // a gallery sticker: Flip · Replace… · Duplicate and the size chip
  { id: 'annot-sticker-sel', steps: [PREVIEW, { frameClick: A('si1') }, { wait: 500 }] },
  // two annotations (then every one): the toolbar counts them
  {
    id: 'annot-select-all',
    steps: [
      PREVIEW,
      { frameClick: A('st1') },
      { wait: 300 },
      // Shift adds the sticker to the selection: two annotations, so the bar counts them
      { frameClick: A('si1'), modifiers: ['Shift'] },
      { wait: 600 },
      { frameKey: 'Shift+Meta+A' },
      { wait: 600 },
    ],
  },
  // the stamps on one spot gathered; hovering opens the list
  {
    id: 'annot-stamps-hover',
    steps: [
      PREVIEW,
      { frameHover: `${tid('annot-stamp-cluster')} button`, optional: true },
      { wait: 500 },
    ],
  },
  // what the shell tells the canvas: the vote open (the "+"), your dots, a vote that ended, the AI's offer
  {
    id: 'annot-vote-open',
    steps: [
      { frameMsg: voteState({ state: 'open' }) },
      { wait: 1400 },
      { frameClick: tid('vote-add-home-hero'), optional: true },
      { wait: 300 },
    ],
  },
  {
    id: 'annot-vote-mine',
    steps: [{ frameMsg: voteState({ state: 'open' }, { 'ab:home-hero': 2 }) }, { wait: 1400 }],
  },
  {
    id: 'annot-vote-ended',
    steps: [
      {
        frameMsg: voteState({
          state: 'ended',
          tallies: { 'ab:home-hero': 4, 'ab:home-pricing': 1 },
        }),
      },
      { wait: 1400 },
    ],
  },
  {
    id: 'annot-ai-seen',
    steps: [
      {
        frameMsg: {
          dgn: 'ai-seen',
          targets: [{ ref: 'ab:home-hero', tag: 'The hero picture' }],
        },
      },
      { wait: 600 },
    ],
  },
  // the Marker's two tips (Ink · Thickness / Highlighter · nibs) and the sticky's colours: a popover of each slot
  {
    id: 'preview-popovers-tips',
    steps: [
      { click: tid('palette-mode-preview') },
      { frameClick: tid('toolbar-slot-pen') },
      { frameClick: tid('toolbar-slot-pen') },
      { frameClick: tid('toolbar-tip-pen'), optional: true },
      { wait: 300 },
      { frameClick: tid('toolbar-tip-highlighter'), optional: true },
      { wait: 300 },
      { frameClick: tid('toolbar-slot-sticky') },
      { frameClick: tid('toolbar-slot-sticky') },
      { wait: 300 },
    ],
  },
  // a Can-comment person lands in Preview, where the Share cluster is compact (the faces step aside — the what-shows
  // table); Viewing is the full form with the access word, faces and all
  {
    id: 'viewing-mode',
    probes: ['cloud-viewer', 'viewer'],
    steps: [{ click: tid('palette-mode-viewing'), optional: true }, { wait: 500 }],
  },
  // ── the canvas's own chrome and gestures ─────────────────────────────────────────────────────
  // an artboard dragged by its label: the lifted board, the snap guides (released at the end)
  {
    id: 'artboard-drag',
    steps: [
      { frameDown: '[data-dc-screen="home-pricing"] .dc-artboard-label' },
      { mouseMove: [-40, 0] },
      { mouseMove: [-10, 0] },
      { mouseMove: [-6, 4] },
      { wait: 700 },
      // …and back to where it started: the drop is saved to Home.meta.json, so a board left 56 px to the left would
      // sit under the left panel for the next shell's pass (the browser probe saw no label to press)
      { mouseMove: [56, -4] },
      { wait: 300 },
      { mouseUp: true },
    ],
  },
  // a drawn shape dragged
  {
    id: 'annot-drag',
    steps: [
      PREVIEW,
      { frameDown: '.dc-annot-el[data-id="r1"]' },
      { mouseMove: [40, 30] },
      { wait: 300 },
      { mouseUp: true },
    ],
  },
  // a heading edited in place (the caret), an artboard renamed in place
  {
    id: 'text-edit',
    steps: [
      { frameClick: '[data-cd-id="home-hero-title"]' },
      { wait: 600 },
      { frameDblclick: '[data-cd-id="home-hero-title"]' },
      { wait: 500 },
      // a second double-click drills one more level when the first only moved the selection
      { frameDblclick: '[data-cd-id="home-hero-title"]' },
      { wait: 500 },
      { frameClick: '[data-cd-id="home-hero-title"]' },
      { wait: 700 },
    ],
  },
  {
    id: 'artboard-rename',
    steps: [{ frameDblclick: '[data-dc-screen="home-hero"] .dc-artboard-label' }, { wait: 500 }],
  },
  // the Marker and Shape popovers open on the SECOND click of a lit slot
  {
    id: 'preview-popovers',
    steps: [
      { click: tid('palette-mode-preview') },
      { frameClick: tid('toolbar-slot-shape') },
      { frameClick: tid('toolbar-slot-shape') },
      { wait: 300 },
      { frameClick: tid('toolbar-slot-pen') },
      { frameClick: tid('toolbar-slot-pen') },
      { wait: 300 },
    ],
  },
  // Stickers is a panel the shell draws, anchored to the toolbar
  {
    id: 'preview-stickers',
    steps: [
      { click: tid('palette-mode-preview') },
      { frameClick: tid('toolbar-slot-stickers') },
      { wait: 1200 },
    ],
  },
  // "Replace image…" on a photo: the asset picker
  {
    id: 'asset-picker',
    steps: [
      { frameContext: '[data-cd-id="home-hero-photo"]' },
      // S2.6: "Replace image…" sits under the object menu's Advanced ▸ (its flyout opens off the window's edge)
      { frameDom: tid('canvas-menu-item-advanced') },
      { frameDom: tid('canvas-menu-item-replace-media') },
      { wait: 1000 },
    ],
  },
  // a Canvases row's own menu (Rename…, Duplicate, Move to…, Delete, Share…)
  { id: 'left-row-menu', steps: [{ click: '[data-testid^="tree-row-menu-"]' }, { wait: 300 }] },
  // a print artboard: its bleed / trim / margin guides are the artboard's own overlay
  { id: 'print-canvas', steps: [{ click: tid('canvas-row-ui-flyer') }, { wait: 3500 }] },
  // a plain one-artboard canvas (probe fixture; a new project starts empty, S6.15)
  { id: 'welcome', steps: [{ click: tid('canvas-row-ui-welcome') }, { wait: 3500 }] },
  // a row in the Canvases tree: hover shows its Delete
  {
    id: 'left-row-hover',
    steps: [
      { click: tid('canvases-advanced'), optional: true },
      { hover: tid('canvas-row-ui-home') },
    ],
  },
  // ── small sheets and states ───────────────────────────────────────────────────────────────────
  { id: 'new-video-prompt', steps: [{ run: 'canvas.new-video' }, { wait: 400 }] },
  {
    id: 'palette-nothing',
    steps: [{ key: 'Meta+k' }, { fill: [tid('palette-input'), 'zzqxv'] }, { wait: 300 }],
  },
  // nothing opened on this Mac yet: Recent says so (the shell alone opens no canvas)
  {
    id: 'palette-day-one',
    canvas: false,
    state: 'nothing-opened',
    steps: [{ key: 'Meta+k' }, { wait: 500 }],
  },
  // close matches that are not a pure misspelling: some word is right (the status note above the list)
  {
    id: 'palette-close-note',
    steps: [
      { key: 'Meta+k' },
      { fill: [tid('palette-input'), 'expor canvas'] },
      { wait: 300 },
      { fill: [tid('palette-input'), 'zoom to fitt'] },
      { wait: 300 },
      { fill: [tid('palette-input'), 'new canvs'] },
      { wait: 300 },
      { fill: [tid('palette-input'), 'togle layers'] },
      { wait: 300 },
    ],
  },
  // S1.5: ⌘K also lists the person's other projects (the desktop shell answers `index_search`)
  {
    id: 'palette-projects',
    state: 'other-projects',
    steps: [
      { key: 'Meta+k' },
      { fill: [tid('palette-input'), 'pricing'] },
      { wait: 700 },
      { fill: [tid('palette-input'), 'pricnig'] },
      { wait: 700 },
    ],
  },
  {
    id: 'palette-close',
    steps: [{ key: 'Meta+k' }, { fill: [tid('palette-input'), 'exprt'] }, { wait: 300 }],
  },
  {
    id: 'shortcuts-nothing',
    steps: [{ key: 'Shift+Slash' }, { fill: [tid('shortcuts-find'), 'zzqxv'] }, { wait: 300 }],
  },
  // Version history: the saved versions' Compare
  {
    id: 'history-compare',
    state: 'git-dirty',
    steps: [
      { key: 'Alt+Meta+H' },
      { wait: 1200 },
      { click: tid('fold-history-toggle'), unless: tid('git-panel'), optional: true },
      { wait: 700 },
      { click: tid('git-compare'), optional: true },
      { wait: 2500 },
    ],
  },
  // the tree before the index arrives, and a canvas that never loads
  { id: 'tree-loading', canvas: false, state: 'tree-slow', steps: [{ wait: 500 }] },
  {
    id: 'canvas-load-failed',
    state: 'canvas-hung',
    steps: [{ wait: 2500 }, { wait: 14500 }],
  },
  // S8.19 — a missing picture is framed on the canvas, with Relink…
  { id: 'asset-frames', state: 'asset-missing', steps: [{ wait: 2500 }] },
  // Edit's More popover (Line · Ellipse · Polygon · Export area) and the size tag of an element inspected in Preview
  { id: 'edit-more', steps: [{ frameClick: tid('toolbar-slot-more') }] },
  {
    id: 'preview-inspect',
    steps: [
      { click: tid('palette-mode-preview') },
      { frameKey: 'Meta+0' },
      { wait: 700 },
      { frameClick: '[data-cd-id="home-hero-title"]', at: [8, 8] },
      { wait: 400 },
    ],
  },
  // S8.3 — Advanced › Print PDF needs a print artboard: the Flyer
  {
    id: 'export-print',
    steps: [
      { click: tid('canvas-row-ui-flyer') },
      { wait: 3500 },
      { key: 'Shift+Meta+E' },
      { click: tid('export-other') },
      { click: tid('export-format-pdf') },
      { ensureOpen: tid('export-advanced-toggle') },
    ],
  },
  // ── the bug-report dialog, further along ───────────────────────────────────────────────────────
  {
    id: 'dialog-report-bug-shots',
    state: 'report-shots',
    steps: [
      { run: 'help.report-bug' },
      { fill: [tid('report-bug-description'), 'The probe describes a bug.'] },
      { click: tid('report-bug-preview') },
      { wait: 1500 },
      { click: tid('report-bug-redact'), optional: true },
    ],
  },
  {
    id: 'dialog-report-bug-sent',
    state: 'report-sent',
    steps: [
      { run: 'help.report-bug' },
      { fill: [tid('report-bug-description'), 'The probe describes a bug.'] },
      { click: tid('report-bug-preview') },
      { wait: 1500 },
      { click: tid('report-bug-send') },
      { wait: 800 },
    ],
  },
  {
    id: 'dialog-report-bug-failed',
    state: 'report-failed',
    steps: [
      { run: 'help.report-bug' },
      { fill: [tid('report-bug-description'), 'The probe describes a bug.'] },
      { click: tid('report-bug-preview') },
      { wait: 1500 },
      { click: tid('report-bug-send') },
      { wait: 800 },
    ],
  },
  // ── Figma: a token that works / is refused; an import that runs / fails ────────────────────────
  {
    id: 'settings-figma-test',
    state: 'figma-probe-ok',
    steps: [...settingsTab('connections'), { click: tid('figma-test') }, { wait: 500 }],
  },
  {
    id: 'settings-figma-refused',
    state: 'figma-probe-bad',
    steps: [...settingsTab('connections'), { click: tid('figma-test') }, { wait: 500 }],
  },
  {
    id: 'dialog-figma-import-run',
    state: 'figma-import-ok',
    steps: [
      { run: 'import.figma' },
      { fill: [tid('figma-import-url'), 'https://www.figma.com/design/abc123/Probe'] },
      { click: tid('figma-import-preview') },
      // the frames come back: the picker (figma-import-mode-<id>), then Import brings the picked ones in and the sheet
      // says what came across (figma-import-summary)
      { waitFor: tid('figma-import-run') },
      { click: tid('figma-import-run') },
      { waitFor: tid('figma-import-summary') },
    ],
  },
  {
    id: 'dialog-figma-import-bad',
    state: 'figma-import-bad',
    steps: [
      { run: 'import.figma' },
      { fill: [tid('figma-import-url'), 'https://www.figma.com/design/abc123/Probe'] },
      { click: tid('figma-import-preview') },
      { wait: 800 },
    ],
  },
  // ── maude:// links the shell hands the window (desktop) ────────────────────────────────────────
  { id: 'deeplink-connect', state: 'deeplink-connect', steps: [{ wait: 800 }] },
  { id: 'deeplink-file', state: 'deeplink-file', steps: [{ wait: 800 }] },
  { id: 'deeplink-file-here', state: 'deeplink-file-here', steps: [{ wait: 800 }] },
  // ── the team-server dialog, from the draft switcher ───────────────────────────────────────────
  {
    id: 'team-signed-out',
    state: 'team-signed-out',
    steps: [
      { click: tid('repo-switcher-trigger') },
      { click: tid('switcher-open-team') },
      { wait: 800 },
      { click: tid('team-cloud-signin'), optional: true },
      { wait: 600 },
    ],
  },
  {
    id: 'team-recents',
    state: 'team-recents',
    steps: [
      { click: tid('repo-switcher-trigger') },
      { click: tid('switcher-open-team') },
      { wait: 800 },
      { click: tid('team-recent-r1'), optional: true },
      { wait: 600 },
    ],
  },
  {
    id: 'team-empty',
    state: 'team-empty',
    steps: [
      { click: tid('repo-switcher-trigger') },
      { click: tid('switcher-open-team') },
      { wait: 800 },
    ],
  },
  {
    id: 'team-opening',
    state: 'team-opening',
    steps: [
      { click: tid('repo-switcher-trigger') },
      { click: tid('switcher-open-team') },
      { wait: 800 },
      { click: tid('team-recent-r1'), optional: true },
      { wait: 600 },
    ],
  },
  // the sign-in sheet's address: shown, and (desktop) refused when the shell will not open it
  {
    id: 'settings-cloud-signin-link',
    state: 'cloud-open-refused',
    steps: [
      ...settingsTab('connections'),
      { click: tid('cloud-signin') },
      { wait: 600 },
      { click: tid('cloud-signin-link'), optional: true },
      { wait: 500 },
    ],
  },
  // ── the brand upload panel (File › Bring my existing brand): a browser picks a file, the desktop asks its shell ──
  {
    id: 'brand-up',
    state: 'brand-extracted',
    steps: [
      { run: 'import.brand' },
      { upload: ['input[type="file"]', 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'] },
      { wait: 500 },
      // S8: the sheet takes the file, then reads it on Import
      { click: tid('brand-import') },
      { wait: 1200 },
      // the result's Advanced fold: Copy command, Start again
      { ensureOpen: tid('brand-advanced') },
      { wait: 300 },
    ],
    probes: ['browser'],
  },
  {
    id: 'brand-up-failed',
    state: 'brand-failed',
    steps: [
      { run: 'import.brand' },
      { upload: ['input[type="file"]', 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'] },
      { wait: 500 },
      { click: tid('brand-import') },
      { wait: 1200 },
    ],
    probes: ['browser'],
  },
  {
    id: 'brand-up-desktop',
    state: 'brand-extracted-desktop',
    steps: [
      { run: 'import.brand' },
      { click: tid('brand-up-pick-file') },
      { wait: 600 },
      { click: tid('brand-import'), optional: true },
      { wait: 1200 },
      { ensureOpen: tid('brand-advanced') },
      { wait: 300 },
    ],
    probes: ['desktop'],
  },
  // the desktop's native picker is not there in the probe: the panel says so
  {
    id: 'brand-up-native',
    steps: [{ run: 'import.brand' }, { click: tid('brand-up-pick-file') }, { wait: 600 }],
    probes: ['desktop'],
  },
  {
    id: 'diag-sync-conflict-gone',
    state: 'linked-rich-conflict-gone',
    steps: [
      ...diagView('sync'),
      { click: tid('sync-resolve-ui-home'), optional: true },
      { wait: 600 },
    ],
    probes: LOCAL_SHELLS,
  },
  {
    id: 'settings-cloud-signin-bad-url',
    state: 'cloud-signin-bad-url',
    steps: [...settingsTab('connections'), { click: tid('cloud-signin') }, { wait: 600 }],
    probes: LOCAL_SHELLS,
  },
  // two boards selected together: the multi-artboard toolbar
  {
    id: 'artboards-multi',
    steps: [
      { frameClick: '[data-dc-screen="home-hero"] .dc-artboard-label' },
      { frameClick: '[data-dc-screen="home-pricing"] .dc-artboard-label', modifiers: ['Shift'] },
      { wait: 500 },
    ],
    probes: LOCAL_SHELLS,
  },
  // ── the desktop's AI chat (⌘/), against the stub bridge of acp-stub.mjs ──────────────────────
  { id: 'acp-missing', state: 'acp-missing', steps: [{ key: 'Meta+Slash' }] },
  {
    id: 'acp-connecting',
    state: 'acp-connecting',
    steps: [{ key: 'Meta+Slash' }, { wait: 500 }, { ensureOpen: tid('ai-advanced') }],
  },
  { id: 'acp-plan', state: 'acp-plan', steps: [{ key: 'Meta+Slash' }] },
  // the panel as it is at rest (caps, the gauge, the rate-limit banner), its slash menu and its info popover
  {
    id: 'acp-idle',
    state: 'acp-chat',
    steps: [
      { key: 'Meta+Slash' },
      { wait: 800 },
      // S5: model / effort / Ask before / transcript / context live in the chat's › Advanced fold
      { ensureOpen: tid('ai-advanced') },
      { wait: 300 },
      { click: tid('chat-foot-info-btn'), optional: true },
      { fill: ['.chat-input', '/d'] },
      { wait: 400 },
    ],
  },
  // a selection on the canvas rides along as a context chip
  {
    id: 'acp-context',
    state: 'acp-chat',
    steps: [{ frameClick: '[data-cd-id="home-hero-title"]' }, { key: 'Meta+Slash' }, { wait: 800 }],
  },
  // one turn: tools (a group), a reply, an out-of-project write waiting on the person with a second behind it
  {
    id: 'acp-turn',
    state: 'acp-chat',
    steps: [
      { key: 'Meta+Slash' },
      { wait: 800 },
      { fill: ['.chat-input', 'Tighten the hero'] },
      { click: '[aria-label="Send message"]' },
      { wait: 1500 },
    ],
  },
  {
    id: 'acp-elicit',
    state: 'acp-elicit',
    steps: [
      { key: 'Meta+Slash' },
      { wait: 800 },
      { fill: ['.chat-input', 'Change the hero'] },
      { click: '[aria-label="Send message"]' },
      { wait: 1200 },
      { click: tid('chat-elicit-option-question_0-other'), optional: true },
      { click: tid('chat-elicit-next'), optional: true },
      { click: tid('chat-elicit-next'), optional: true },
    ],
  },
  // open comments on the canvas: the chat offers to implement them
  {
    id: 'acp-comments',
    state: 'acp-chat-comments',
    // the chip waits on the comment count the shell reads after the chat opens; wait for it, not for a clock
    steps: [{ key: 'Meta+Slash' }, { waitFor: tid('chat-qa-implement-comments') }],
  },
  // the Comments panel with its resolved comments listed (Reopen) …
  {
    id: 'comments-panel',
    state: 'comments',
    steps: [
      { click: tid('share-cluster-comments') },
      { click: tid('comment-filter-all'), optional: true },
    ],
  },
  // … and a pin in the canvas: its thread, the author's own Edit and Save
  {
    id: 'comment-thread',
    state: 'comments',
    steps: [
      { frameClick: '[data-comment-pin]', optional: true },
      { wait: 600 },
      { frameClick: tid('comment-edit'), optional: true },
    ],
  },
  // … a converted comment's thread: the ⋯ menu with "Turn back into a sticky", and (the sticky was turned into this
  // comment in this very session) the header's Undo
  {
    id: 'comment-thread-converted',
    state: 'comments-converted',
    steps: [
      PREVIEW,
      { frameClick: A('st1') },
      { wait: 500 },
      { frameClick: tid('annot-ctx-to-comment'), optional: true },
      { wait: 800 },
      { frameClick: '[data-comment-pin]', optional: true },
      { wait: 800 },
      { frameClick: '[data-testid^="comment-menu-"]', optional: true },
      { wait: 300 },
    ],
  },
  // … and Resolve refused by the door: the canvas's one-sentence notice
  {
    id: 'comment-refused',
    state: 'comments-refused',
    steps: [
      { frameClick: '[data-comment-pin]', optional: true },
      { wait: 600 },
      { frameClick: '[data-testid^="comment-resolve-"]', optional: true },
      { wait: 800 },
    ],
  },
  { id: 'acp-limit', state: 'acp-limit', steps: [{ key: 'Meta+Slash' }, { wait: 900 }] },
  {
    id: 'acp-error',
    state: 'acp-error',
    steps: [
      { key: 'Meta+Slash' },
      { wait: 800 },
      { fill: ['.chat-input', 'Tighten the hero'] },
      { click: '[aria-label="Send message"]' },
      { wait: 1200 },
    ],
  },
  {
    id: 'acp-done',
    state: 'acp-done',
    steps: [
      { key: 'Meta+Slash' },
      { wait: 800 },
      { fill: ['.chat-input', 'Tighten the hero'] },
      { click: '[aria-label="Send message"]' },
      { wait: 1200 },
    ],
  },
  // the minimap and the zoom toolbar are View preferences (off by default, kept in the server's prefs, shared
  // by every opener): switch both on, then put the stored prefs back
  {
    id: 'canvas-chrome',
    steps: [
      { wait: 800 },
      { run: 'view.minimap' },
      { wait: 800 },
      { run: 'view.zoom-controls' },
      { wait: 500 },
      { post: ['/_api/ui-prefs', { minimap: false, zoom: false }] },
    ],
  },
  // zoomed out below a quarter: the mosaic. LAST in the list: the camera is remembered per canvas, and every opener
  // after this one starts from where it was left (the Edit openers press the Hero's title, left of the zoomed view)
  {
    id: 'annot-lod',
    resetCamera: true,
    steps: [
      PREVIEW,
      // ⌃ + wheel over empty canvas: the viewport's zoom gesture; the mosaic takes over below a quarter
      { wheelZoom: 2400 },
      { wait: 300 },
      { wheelZoom: 2400 },
      { wait: 600 },
      { frameHover: `${tid('annotations-lod')} [data-lod="section"]`, optional: true },
      { wait: 500 },
      // back to the fit (the camera is remembered per canvas: the next opener must find the boards)
      { key: 'Meta+0' },
      { wait: 400 },
    ],
  },
];

// Openers only the shells that draw their surface need to run (the full probe is ~100 openers × 7 shells).
const LOCAL = ['desktop', 'browser'];
// …and the shells whose person can change the project: a Can comment / Can view person has no Share button, no Figma
// import and no shape tools, so an opener for them would only wait out its timeouts (absence is expressed here,
// by role, not by waiting — the contract's "role/shell-gated expectation")
const EDITORS = ['desktop', 'browser', 'cloud-owner', 'cloud-member'];
const WHERE = [
  // Settings has General only inside a cloud tab (DDR-209 D1, S11.13): Connections / Advanced are the Mac's
  [/^settings-(connections|advanced|cloud-in|cloud-signin$|github-in|figma-in|team-server)/, LOCAL],
  [
    /^(dialog-figma-import|dialog-figma-import-in|preview-shape-options|preview-comment|share|export-print|left-trash)$/,
    EDITORS,
  ],
  [/^(acp-|deeplink-|team-|settings-cloud-signin-link|palette-projects)/, ['desktop']],
  // the git buttons are the desktop app's (a browser tab reads the fold, it does not press it)
  [/^history-(save|branch|add)-dialog$/, ['desktop']],
  [
    /^(dialog-figma-import-run|dialog-figma-import-bad|settings-figma-test|settings-figma-refused)$/,
    LOCAL,
  ],
  [
    /^(asset-frames|left-search|palette-day-one|palette-close-note|edit-more|preview-inspect|annot-|artboard-|print-canvas|left-row-menu|text-edit|preview-popovers|preview-stickers|asset-picker|welcome|left-row-hover|new-video-prompt|palette-nothing|palette-close|shortcuts-nothing|tree-loading|canvas-load-failed|canvas-chrome|dialog-report-bug-|history-project|history-cloud-down|history-clean|history-compare)/,
    LOCAL,
  ],
  [/^(comments-panel|comment-thread|comment-thread-converted|comment-refused)$/, LOCAL],
];
// Preview eases the camera onto the board in view and the studio remembers it per canvas (`_canvas-state/<slug>.view.json`):
// an opener that went to Preview gives the camera back, so the Edit openers after it (the Hero's title, a board's label)
// find the boards where they stood
for (const o of OPENERS)
  if (JSON.stringify(o.steps).includes('palette-mode-preview')) o.resetCamera = true;
for (const o of OPENERS) {
  const hit = WHERE.find(([re]) => re.test(o.id));
  if (hit && !o.probes) o.probes = hit[1];
}
