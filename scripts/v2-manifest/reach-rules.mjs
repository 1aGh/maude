// The pure half of the nothing-deleted reachability probe (Phase 4 gate; contract
// apps/studio/client/v2/contracts/V2-4-gate-nothing-deleted.md). probe-reach.mjs boots the studio and
// collects what is on screen; this file says where each row / kept target MUST be reachable and turns
// the collected evidence into reachability.json. No DOM, no browser — scripts/test covers it.

/** One headless boot per shell and per role that exists today (owner · member · viewer). */
export const PROBES = Object.freeze([
  { id: 'desktop', shell: 'desktop', role: 'owner', tauri: true },
  { id: 'browser', shell: 'browser', role: 'owner' },
  {
    id: 'cloud-owner',
    shell: 'cloud',
    role: 'owner',
    config: {
      cloud: {
        dashboardUrl: 'https://cloud.example/dashboard',
        projectName: 'Studio site',
        user: 'tereza@example.com',
        role: 'owner',
      },
    },
  },
  {
    id: 'cloud-member',
    shell: 'cloud',
    role: 'member',
    config: {
      cloud: {
        dashboardUrl: 'https://cloud.example/dashboard',
        projectName: 'Studio site',
        user: 'ola@example.com',
        role: 'member',
      },
    },
  },
  {
    id: 'cloud-viewer',
    shell: 'cloud',
    role: 'viewer',
    config: {
      readOnly: true,
      // the hub's viewer is Can comment (V2-1.7, S9.22): /_config.canComment puts cm=1 on the canvas URL, which
      // is what lights the Comment tool in a read-only canvas
      canComment: true,
      cloud: {
        dashboardUrl: 'https://cloud.example/dashboard',
        projectName: 'Studio site',
        user: 'jonas@example.com',
        role: 'viewer',
      },
    },
  },
  { id: 'viewer', shell: 'viewer', role: 'viewer', config: { readOnly: true } },
  { id: 'embed', shell: 'embed', role: 'viewer', query: '?embed=1' },
]);
export const PROBE_IDS = PROBES.map((p) => p.id);
/** The shells a local project runs in. */
export const LOCAL_PROBES = ['desktop', 'browser'];
/** Hub role → registry role (actions/types.ts Role; the hub's viewer is Can comment, V2-1.7). */
export const REGISTRY_ROLE = Object.freeze({ owner: 'owner', member: 'edit', viewer: 'comment' });

/** §A home codes (06 Advanced ITEMS col 3) only an editor reaches — a viewer probe is exempt. */
export const EDIT_HOMES = new Set(['insp', 'lay', 'assets', 'ds', 'tl', 'ai', 'vh', 'exp']);
/** v1 characterization golden prefix → the probes that shell became (a kept hook seen there in v1
 *  must stay reachable there). */
export const GOLDEN_SHELLS = Object.freeze({
  browser: ['browser'],
  tauri: ['desktop'],
  viewer: ['viewer'],
  cloud: ['cloud-owner', 'cloud-member'],
  'cloud-viewer': ['cloud-viewer'],
  'sync-offline': ['browser'],
});
/** §B rows whose home names its shells (the rest default to the local probes as owner). */
export const B_REACH = Object.freeze({ D19: ['desktop'] });

/** The v2 element that runs an action when the action has no menu row and no ⌘K row of its own
 *  (tools live on the in-canvas toolbars, V2-1.2; a few panels are opened by their own tab). */
export const ACTION_SURFACE = Object.freeze({
  'tool.select': 'toolbar-slot-move',
  'tool.hand': 'toolbar-slot-hand',
  'tool.pen': 'toolbar-slot-pen',
  'tool.highlighter': 'toolbar-slot-pen', // Marker's second tip
  'tool.eraser': 'toolbar-slot-pen', // a Marker option
  'tool.shape': 'toolbar-slot-shape',
  'tool.rect': 'toolbar-slot-shape',
  'tool.ellipse': 'toolbar-slot-shape', // Shape › kinds
  'tool.text': 'toolbar-slot-text',
  'tool.sticky': 'toolbar-slot-sticky',
  'tool.comment': 'toolbar-slot-comment',
  'tool.arrow': 'toolbar-slot-arrow',
  'tool.browse': 'toolbar-slot-browse',
  'tool.section': 'toolbar-slot-section',
  'tool.el-pen': 'toolbar-slot-el-pen', // Edit's Pen (P): the vector pen
  'search.open': '[aria-label="Command palette"]',
  'canvases.search': 'canvas-search',
  'view.layers': 'panel-tab-layers',
  'view.assets': 'panel-tab-assets',
  'view.design-system': 'canvases-ds-row',
  'view.trash': 'canvases-trash-row',
  'canvases.refresh': 'canvases-refresh',
  'ai.chat': 'ai-chat-header',
  'view.comments': 'share-cluster-comments',
  'view.panels': 'share-cluster-panels',
  'share.open': 'share-cluster-share',
  // actions whose v2 home is a control inside a sheet rather than a menu / ⌘K row
  'export.rerun-last': 'export-recent-again-0', // "Export again" on every Recent row of the Export sheet
  'help.ai-readiness': 'project-menu-row-diag.ai-recheck', // the same words, under Menu › Diagnostics
  'app.check-updates': 'settings-check-updates', // Settings › Advanced › This Mac › Update (the native menu keeps the row)
});

/** The slot role a probe's person holds (canvas-modes.ts roleOfCaps): owner and member edit, a hub viewer
 *  is Can comment (V2-1.7). */
export const PROBE_SLOT_ROLE = Object.freeze({ owner: 'edit', member: 'edit', viewer: 'comment' });
const SLOT_RANK = Object.freeze({ view: 0, comment: 1, edit: 2 });

/**
 * Who a canvas tool is for. The registry keeps every `tool.*` key resolvable for every role (a denied key
 * must still reach the shell's denial line), so its `visible` over-promises tools to viewers; the
 * toolbar's own data does not (MODE_TOOLS `minRole`: Hand = view, Comment = comment, the rest = edit).
 * Returns `Map<ref, minRole>` for both the action (`tool.<id>`) and the slot hook (`toolbar-slot-<tool>`);
 * a ref in several modes takes the LOWEST role (Comment is in Preview and Viewing); a Marker tip inherits
 * its slot's. `slotActionId` is actions/defs/tool.ts's.
 */
export function toolRoles(modeTools, slotActionId) {
  const out = new Map();
  const put = (ref, role) => {
    const have = out.get(ref);
    if (!have || SLOT_RANK[role] < SLOT_RANK[have]) out.set(ref, role);
  };
  const visit = (s) => {
    put(slotActionId(s), s.minRole);
    if (s.tool) put(`toolbar-slot-${s.tool}`, s.minRole);
    for (const tip of s.tips ?? []) {
      put(`tool.${tip}`, s.minRole);
      put(`toolbar-tip-${tip}`, s.minRole);
    }
    for (const c of s.more ?? []) visit(c);
  };
  for (const bar of Object.values(modeTools)) for (const s of bar.slots) visit(s);
  return out;
}

/** The tool a row / hook / action points at, if any: a `tool.*` action or a concrete `toolbar-slot-*` hook. */
const toolRef = (ref) =>
  typeof ref === 'string' && (/^tool\./.test(ref) || /^toolbar-slot-[\w-]+$/.test(ref))
    ? ref
    : null;

/** Is `probe` allowed to need this tool? Anything that is not a tool, or has no toolbar data, passes. */
function toolAllows(refs, probe, roles) {
  if (!roles) return true;
  return refs.every((r) => {
    const ref = toolRef(r);
    if (!ref) return true;
    const min = roles.get(ref) ?? 'edit'; // no slot behind it: the rest are edit
    return SLOT_RANK[PROBE_SLOT_ROLE[probe.role]] >= SLOT_RANK[min];
  });
}

/** The registry context a probe's shell computes (actions/ctx.ts) with a canvas open. */
export function ctxFor(probe) {
  const facts = new Set(['canvasOpen', 'online']);
  if (probe.shell === 'desktop') facts.add('native');
  if (probe.shell === 'cloud') facts.add('linkedHub');
  return {
    role: REGISTRY_ROLE[probe.role],
    shell: probe.shell,
    mode: probe.role === 'viewer' ? 'viewing' : 'edit',
    focus: 'chrome',
    selection: 'none',
    facts,
  };
}

/**
 * Probes where a ROW must be reachable. Order: an explicit `v2.reach` (probe ids) → §B default →
 * the owning model's local flag (settings-model `local: true` = absent in a cloud tab, DDR-209 D1) →
 * the registry's `visible` predicate when the row names an action → editor-only homes → never embed.
 */
export function rowProbes(row, { settingsLocal, actions, isVisible, toolRoles: roles }) {
  if (Array.isArray(row.v2?.reach)) return row.v2.reach.filter((p) => PROBE_IDS.includes(p));
  if (row.id.startsWith('D')) return B_REACH[row.id] ?? LOCAL_PROBES;
  let out = PROBES.filter((p) => p.shell !== 'embed');
  out = out.filter((p) => toolAllows([row.v2?.action, row.v2?.testid], p, roles));
  if (settingsLocal.has(row.id)) out = out.filter((p) => LOCAL_PROBES.includes(p.id));
  const a = row.v2?.action && actions.get(row.v2.action);
  if (a) out = out.filter((p) => isVisible(a, ctxFor(p)));
  if (EDIT_HOMES.has(row.home)) out = out.filter((p) => p.role !== 'viewer');
  return out.map((p) => p.id);
}

/** Probes where a kept registry action must be reachable: wherever the registry shows it. */
export function actionProbes(action, isVisible, roles) {
  return PROBES.filter(
    (p) => p.shell !== 'embed' && isVisible(action, ctxFor(p)) && toolAllows([action.id], p, roles)
  ).map((p) => p.id);
}

/**
 * Hooks that exist in one kind of shell only, by what the code gates on (not by what v1 happened to show):
 * the desktop shell's keychain and Tauri commands (GitHub sign-in, the team-server dialog, Ask AI, the ACP chat)
 * and the link a native shell does not draw. A match replaces the v1-golden / local default. Every entry
 * was seen in the named shell and absent from the other by the probe itself.
 */
export const HOOK_SHELLS = Object.freeze([
  [
    /^settings-github-sign(in|out)$/,
    ['desktop'],
    'IdentityBar draws GitHub only in the native shell',
  ],
  [/^team-/, ['desktop'], 'TeamProjectsDialog is native-only (needs the shell for a keychain)'],
  [/^palette-ask-ai$/, ['desktop'], 'Ask AI is desktop only (palette-ask-ai meaning)'],
  [
    /^(chat-|acp-|dock-ai-|\.chat-|\.btn--danger \(permission|\[aria-label="(Send message|Stop)"\])/,
    ['desktop'],
    'the ACP chat panel exists only in the desktop app',
  ],
  [
    /^(g[i]t-save-all|g[i]t-get-latest|publish|save-local|pull)$/,
    ['desktop'],
    "a browser tab opens Version history › Advanced read-only (gitSurface: !native): saving and publishing are the app's",
  ],
  [
    /^(cloud-deeplink-|file-deeplink-|cloud-signin-refused$|sync-signin-again$|readiness-autosetup-where$)/,
    ['desktop'],
    'the shell hands the window a maude:// link, opens addresses and holds the sign-in: native only (isNativeApp())',
  ],
  [
    /^root-missing-/,
    ['desktop'],
    "the moved-folder card is the desktop shell's own page (apps/desktop/src/root-missing.html), shown when a tab's folder is gone",
  ],
  [
    /^palette-project-(label|square)$/,
    ['desktop'],
    "⌘K lists the person's other projects only in the desktop app (its tabs, its Home index — search-projects.js acrossProjects)",
  ],
  [
    /^settings-update-restart$/,
    ['desktop'],
    "a staged update is the desktop shell's (`update-ready`, advanced-section UpdateRow): a browser tab has no updater to stage one",
  ],
  [
    /^switcher-open-(folder|team)$/,
    ['desktop'],
    "the pill's Switch project submenu is drawn only by the desktop shell (useProjectSwitcher: `node` is null outside the app)",
  ],
  [/^embed-/, ['embed'], 'the embed shell (?embed=1)'],
  [
    /^share-open-app$/,
    ['browser', 'cloud-owner', 'cloud-member', 'cloud-viewer', 'viewer'],
    'no "Open in app" inside the app (share-open-app meaning)',
  ],
]);

/**
 * State-internal proofs (V2-4.gate-d, lead decision). A kept hook that only exists mid-gesture or in a transient
 * state (snap guides while a board is dragged, a peer's cursor, a holding card during a hot reload, a collaborator
 * edit notice) is not worth a probe state that fakes a second person or a race. The audit accepts a NAMED RENDER
 * TEST instead: the hook counts as reached in a shell when its `container` (a hook the probe reaches in that shell)
 * is reached there AND `test` exists AND contains the title `name` AND contains the hook (or every string in
 * `needles`: a hook written as several selectors is found by its own spellings). The test must render the hook;
 * `proofHolds` only checks that the test still says so. A proof for a hook the probe CAN reach is a smell: prefer a
 * probe state.
 *   hook → { container, test: '<repo-relative file>', name: '<test title substring>', needles?: string[] }
 */
const proof = (test, name, needles) => ({
  container: 'canvas-frame',
  test,
  name,
  ...(needles ? { needles } : {}),
});
export const HOOK_PROOFS = Object.freeze({
  // a collaborator's frame / halo / drawn-gesture ghost: a second person is connected. Rendered, and followed
  // through a pan and a zoom, by the peer-selection test
  '.dc-cursor / .dc-peer-selection / [data-peer-gesture]': {
    container: 'canvas-frame',
    test: 'apps/studio/test/peer-selection-follows-camera.test.tsx',
    name: 'the frame follows a pan',
    needles: ['.dc-peer-selection'],
  },
  // the "holding" card shown for the instant a hot reload swaps the canvas module
  '.dc-hmr-holding': {
    container: 'canvas-frame',
    test: 'apps/studio/test/canvas-hmr-loaded.test.tsx',
    name: 'soft HMR announces only committed replacement DOM',
    needles: ['dc-hmr-holding'],
  },
  // the canvas's own participant stack: the Share cluster hosts the faces inside the shell, so only a standalone
  // canvas (or an embed) draws it
  '.dc-participants / .dc-participant(--agent)': {
    container: 'canvas-frame',
    test: 'apps/studio/test/v2-gate-proofs.test.tsx',
    name: 'draws the working agent as a participant',
    needles: ['.dc-participants', '.dc-participant'],
  },
  // a section's label chip; the probe fixture draws no section
  '[data-section-chip] / [data-edit-notice]': {
    container: 'canvas-frame',
    test: 'apps/studio/test/v2-gate-proofs.test.tsx',
    name: 'is the section label chip',
    needles: ['data-section-chip'],
  },
  // the frame round a section the page grew: drawn for a few seconds after the page changes underneath an open
  // canvas; the probe fixture's board never grows
  'artboard-new-section': proof(
    'apps/studio/test/v2-gate-proofs.test.tsx',
    'artboard-new-section is on the page, named for the section',
    ['artboard-new-section']
  ),
  // the scrub bar of a video board: it belongs to a clip that has PLAYED (07 ve-play), and a headless page cannot be asked to
  // play a Remotion Player with sound. The chrome test renders the played state (a Player stub that says it is playing)
  'video-scrub-bar': proof(
    'apps/studio/test/video-play-chrome.test.tsx',
    'the centre button gives way to the scrub bar with the time'
  ),
  'video-scrub-time': proof(
    'apps/studio/test/video-play-chrome.test.tsx',
    'the centre button gives way to the scrub bar with the time'
  ),
  'video-scrub-fill': proof(
    'apps/studio/test/video-play-chrome.test.tsx',
    'the fill follows the frame'
  ),
  // the local harness canvas `maude design photo-bg-remove` drives; nobody opens it
  '[data-photo-bgremove-status]': {
    container: 'canvas-frame',
    test: 'apps/studio/test/v2-gate-proofs.test.tsx',
    name: 'is on the page, pending first',
    needles: ['data-photo-bgremove-status'],
  },
  // ── Phase 5 wave A: states a headless boot cannot stage (a second person, an AI run, a trashed canvas, a page the
  // desktop shell owns). Each is rendered, and asserted, by the named test.
  // the moved-folder card: the shell's own page, not served by the studio the probe boots
  'root-missing-card': proof(
    'apps/studio/test/v2-gate-proofs.test.tsx',
    'root-missing-card names the project'
  ),
  'root-missing-title': proof(
    'apps/studio/test/v2-gate-proofs.test.tsx',
    'root-missing-card names the project'
  ),
  'root-missing-place': proof(
    'apps/studio/test/v2-gate-proofs.test.tsx',
    'root-missing-card names the project'
  ),
  'root-missing-find': proof(
    'apps/studio/test/v2-gate-proofs.test.tsx',
    'root-missing-card names the project'
  ),
  'root-missing-error': proof(
    'apps/studio/test/v2-gate-proofs.test.tsx',
    'root-missing-error says why a picked folder'
  ),
  // the AI's rings on the artboards it is working on (the shell names them; a probe has no running chat)
  'ai-rings': proof(
    'apps/studio/test/v2-ai-runs-ui.test.tsx',
    'a ring and its tag appear on the artboard the shell names'
  ),
  'ai-ring-<artboardId>': proof(
    'apps/studio/test/v2-ai-runs-ui.test.tsx',
    'a ring and its tag appear on the artboard the shell names',
    ['ai-ring-']
  ),
  // the outlines an all-trashed canvas keeps where its artboards stood
  'artboard-ghosts': proof(
    'apps/studio/test/v2-all-trashed.test.tsx',
    'outlines in world coordinates, no hit area'
  ),
  'artboard-ghost-<artboard-id>': proof(
    'apps/studio/test/v2-all-trashed.test.tsx',
    'outlines in world coordinates, no hit area',
    ['artboard-ghost-']
  ),
  // following someone, and Bring everyone here: a second person is connected
  'presence-follow-pill': proof(
    'apps/studio/test/presence-canvas.test.tsx',
    'following mirrors her camera; the frame and the pill say so'
  ),
  'presence-frame': proof(
    'apps/studio/test/presence-canvas.test.tsx',
    'following mirrors her camera; the frame and the pill say so'
  ),
  'presence-spotlight-pill': proof(
    'apps/studio/test/presence-canvas.test.tsx',
    'draws the glide nearest first, and the pill counts who follows me'
  ),
  'presence-bring-glide': proof(
    'apps/studio/test/presence-canvas.test.tsx',
    'draws the glide nearest first, and the pill counts who follows me'
  ),
  'presence-bring-ghost-<clientID>': proof(
    'apps/studio/test/presence-canvas.test.tsx',
    'draws the glide nearest first, and the pill counts who follows me',
    ['presence-bring-ghost-']
  ),
  'presence-spotlight-stop': proof(
    'apps/studio/test/presence-canvas.test.tsx',
    'Stop clears the field for everyone and takes the pill away'
  ),
  // the Pointer (L) while presenting, and other people's Pointers
  'present-pointer': proof(
    'apps/studio/test/pointer-dot.test.tsx',
    'the dot sits on the pointer and peers get the world point'
  ),
  'present-pointer-dot': proof(
    'apps/studio/test/pointer-dot.test.tsx',
    'the dot sits on the pointer and peers get the world point'
  ),
  'present-pointer-trail': proof(
    'apps/studio/test/pointer-dot.test.tsx',
    'the dot sits on the pointer and peers get the world point'
  ),
  'present-peer-pointer': proof(
    'apps/studio/test/follow-view.test.tsx',
    "the presenter's Pointer: drawn when valid, dropped when malformed"
  ),
  'present-peer-pointers': proof(
    'apps/studio/test/follow-view.test.tsx',
    "the presenter's Pointer: drawn when valid, dropped when malformed"
  ),
  // the Design system canvas (S10.6): the probe's fixture canvas is not one the shell opens as a board
  'ds-bar': proof(
    'apps/studio/test/ds-board-render.test.tsx',
    'name · Light | Dark · changes waiting',
    ['data-testid="ds-bar"']
  ),
  'ds-bar-mode-<mode>': proof(
    'apps/studio/test/ds-board-render.test.tsx',
    'name · Light | Dark · changes waiting',
    ['ds-bar-mode-']
  ),
  'ds-bar-pending': proof(
    'apps/studio/test/ds-board-render.test.tsx',
    'name · Light | Dark · changes waiting',
    ['data-testid="ds-bar-pending"']
  ),
  'ds-section-<kind>': proof(
    'apps/studio/test/ds-board-render.test.tsx',
    'Dark sets .ds-dark + the dark theme on every section; Light sets neither',
    ['ds-section-']
  ),
  // the chip an element with a link wears when it is the one selection (Edit)
  'edit-link-chip': proof(
    'apps/studio/test/link-chip-overlay.test.tsx',
    'one linked element selected: the chip says where it goes and never takes the pointer'
  ),
  // a note's or text's editor is open only mid-edit (and the probe's canvas keeps its annotations behind the artboards)
  '.dc-annot-editor / [data-annot-editor]': proof(
    'apps/studio/test/annotations-v2-text.test.tsx',
    'opens focused with the text selected (keyboard entry) and the editor marker',
    ['dc-annot-editor', 'data-annot-editor']
  ),
  'Annotation node labels': proof(
    'apps/studio/test/v2-gate-proofs.test.tsx',
    'annotation text and sticky editors carry the labels the node is read by',
    ['Edit sticky note text', 'aria-label="Edit text"']
  ),
  // ── gate A reach: annotation states that exist for one gesture or one moment (an arrow end being dropped, a bind
  // the file refused, an artboard dragged with arrows riding it, a pick trailing the pointer, an AI rewrite). A
  // probe would have to fake the race; the named render tests draw each one and say what it reads.
  'annot-arrow-aim-ring': proof(
    'apps/studio/test/annotations-arrow-bind-ui.test.tsx',
    'the ring names what it is on; the edge draws the whole artboard'
  ),
  'annot-arrow-aim-tag': proof(
    'apps/studio/test/annotations-arrow-bind-ui.test.tsx',
    'the ring names what it is on; the edge draws the whole artboard'
  ),
  'annot-arrow-candidate': proof(
    'apps/studio/test/annotations-arrow-bind-ui.test.tsx',
    'the ring names what it is on; the edge draws the whole artboard'
  ),
  'annot-arrow-edge': proof(
    'apps/studio/test/annotations-arrow-bind-ui.test.tsx',
    'the ring names what it is on; the edge draws the whole artboard'
  ),
  'annot-arrow-bound-tag': proof(
    'apps/studio/test/annotations-arrow-bind-ui.test.tsx',
    '"Bound to the artboard" is announced politely'
  ),
  'annot-arrow-rewritten': proof(
    'apps/studio/test/annotations-arrow-bind-ui.test.tsx',
    'AI rewrote the element: the ring names the new words'
  ),
  // the Highlighter's three nibs: the Marker options swap to them when the Highlighter tip is the one in use
  'toolbar-highlighter-width-<size>': proof(
    'apps/studio/test/tool-palette.test.tsx',
    'Marker options (an-marker)',
    ['Highlighter width']
  ),
  'annot-placing': proof(
    'apps/studio/test/annotations-sticker-drop.test.tsx',
    'nothing is drawn until the pointer is in; then a sticker at the size it will land'
  ),
  'annot-ride': proof(
    'apps/studio/test/s4-18-ride-above.test.tsx',
    'a riding sticky and the re-route overlay sit above the dragged artboard'
  ),
  'annot-cross-tag': proof(
    'apps/studio/test/annotations-reroute-live.test.tsx',
    'a translate composes with the rotation; clear restores every node'
  ),
  // the readiness dialog opens from the desktop menu's native item only
  'readiness-autosetup-where': {
    container: 'canvas-frame',
    test: 'apps/studio/test/v2-gate-proofs.test.tsx',
    name: 'names the setting that stops the offers',
    needles: ['readiness-autosetup-where'],
  },
});

/** Does the proof still hold? `readText(repoRelPath)` → the file's text or null. Pure. */
export function proofHolds(hook, proof, readText) {
  if (!proof) return false;
  const text = readText(proof.test);
  if (typeof text !== 'string') return false;
  if (!text.includes(proof.name)) return false;
  return (proof.needles ?? [hook]).every((n) => text.includes(n));
}

/** Probes where a kept hook must be reachable: every shell v1 showed it in, else the local probes. */
export function hookProbes(hook, v1Seen, roles) {
  const seen = v1Seen.get(hook);
  const named = HOOK_SHELLS.find(([re]) => re.test(hook));
  const base = named ? named[1] : seen?.size ? PROBE_IDS.filter((p) => seen.has(p)) : LOCAL_PROBES;
  return base.filter((id) =>
    toolAllows(
      [hook],
      PROBES.find((p) => p.id === id),
      roles
    )
  );
}

/**
 * How the probe recognises a testids.json hook on screen.
 *   testid   [data-testid] value, `<x>` placeholders (and `[-<x>]` optional parts) as wildcards
 *   tour     [data-tour] value
 *   css      the selector alternatives (" / " separated, explanatory "(…)" suffixes dropped)
 * Returns null for prose hooks ("Inspector field labels") — nothing to look for.
 */
/** Hooks on an element that is mounted but draws no box (a host that only owns dialogs, `.cb-host`): the probe
 *  counts them when they are in the document, not when they have a client rect. */
export const PRESENCE_ONLY = Object.freeze(new Set(['cloud-host']));

/** A hook whose testids.json text is prose + a selector: the selector the page is asked about. */
export const CSS_ALIASES = Object.freeze({
  '.btn--danger (permission prompt)': [
    '.chat-perm .btn--danger',
    '[data-testid="chat-permission-prompt"] .btn--danger',
  ],
  '[aria-expanded] on tree rows': ['[role="tree"] [aria-expanded]'],
  '[aria-label="Delete canvas <name>"]': ['[aria-label^="Delete canvas "]'],
  // label sets written as prose in testids.json: any one of the spellings on screen is the hook on screen
  'Annotation node labels': ['[aria-label="Edit text"]', '[aria-label="Edit sticky note text"]'],
  'Annotation toolbar labels': [
    '[aria-label="Annotation properties"]',
    '[aria-label="Align and distribute"]',
    '[aria-label="Group selection"]',
  ],
  'Photo tab field labels': ['[aria-label="Brightness"]', '[aria-label="Contrast"]'],
  'menuitem by name (row menu)': ['.st-dropdown [role="menuitem"]'],
  '[data-theme] on DS/artboard wrappers': ['[data-theme]:not(html)'],
  '[data-path] on canvas-frame': ['[data-testid="canvas-frame"][data-path]'],
});

export function hookMatcher(def) {
  const hook = typeof def === 'string' ? def : def.hook;
  const kind = typeof def === 'string' ? 'testid' : def.kind;
  if (kind === 'data-tour') return { tour: hook.replace(/^\[data-tour="(.*)"\]$/, '$1') };
  if (kind === 'testid' && /^[A-Za-z0-9._<>[\]${}-]+$/.test(hook)) {
    if (!/[<[$]/.test(hook)) return { testid: hook };
    const src = hook
      .replace(/\[-?<[^>]+>\]/g, '~OPT~')
      .replace(/\$\{[^}]+\}|<[^>]+>/g, '~ANY~')
      .replace(/[.*+?^()|\\]/g, '\\$&')
      .replace(/~OPT~/g, '(?:-.+)?')
      .replace(/~ANY~/g, '.+');
    return { testidRe: `^${src}$` };
  }
  if (CSS_ALIASES[hook]) return { css: CSS_ALIASES[hook] };
  const alts = hook
    .split(' / ')
    .map((a) => a.replace(/\s*\((?:\+|--)[^)]*\)\s*$/, '').trim())
    .map((a) => a.replace(/\(--[a-z-]+\)$/, ''))
    // a CSS alternative starts with . [ # or is one compound tag selector; prose has bare spaces
    .filter((a) => /^[.[#]/.test(a) || /^[a-z][\w-]*[.[#:]\S*$/i.test(a));
  return alts.length ? { css: alts } : null;
}

/** Does one opener's evidence contain the hook? */
export function seenIn(evidence, def) {
  const m = hookMatcher(def);
  if (!m) return false;
  if (m.testid) return evidence.testids.includes(m.testid);
  if (m.testidRe) {
    const re = new RegExp(m.testidRe);
    return evidence.testids.some((t) => re.test(t));
  }
  if (m.tour) return evidence.tours.includes(m.tour);
  return evidence.css.includes(typeof def === 'string' ? def : def.hook);
}

/**
 * Evidence → reachability.json.
 * @param evidence  { [probeId]: { [openerId]: { ok, err?, testids, tours, css, palette: {id: bool} } } }
 * @param subjects  { rows: [{ id, need: probeIds, testid, action }], targets: [{ id, need, hook|action }] }
 */
export function summarize({ evidence, subjects, hooksByName, taken, bundle, proofs = new Map() }) {
  const findHook = (probe, hook) => {
    const def = hooksByName.get(hook) ?? hook;
    for (const [opener, ev] of Object.entries(evidence[probe] ?? {}))
      if (seenIn(ev, def)) return opener;
    return null;
  };
  const findAction = (probe, id) => {
    const viaMenu = findHook(probe, `project-menu-row-${id}`);
    if (viaMenu) return `${viaMenu} (menu row)`;
    const surface = ACTION_SURFACE[id] && findHook(probe, ACTION_SURFACE[id]);
    if (surface) return `${surface} (${ACTION_SURFACE[id]})`;
    for (const [opener, ev] of Object.entries(evidence[probe] ?? {}))
      if (ev.palette?.[id]) return `${opener} (⌘K)`;
    // ⌘K deliberately leaves out the keyboard-only actions (nudge, annotation keys, holds); the "?" sheet
    // lists every action that has a key, as `shortcuts-row-<id>` — that is where a person finds them.
    const sheet = findHook(probe, `shortcuts-row-${id}`);
    if (sheet) return `${sheet} ("?" sheet)`;
    return null;
  };
  const perShell = Object.fromEntries(PROBE_IDS.map((p) => [p, { rows: {}, targets: {} }]));
  const judge = (subj, bucket) => {
    if (!subj.need.length) return 'applies in no probe — give the row a v2.reach or check the rule';
    if (!subj.hook && !subj.action) return 'no v2 home yet (v2.action / v2.testid empty)';
    const missing = [];
    for (const p of subj.need) {
      // a hook that has a named render test counts where its container is on screen (HOOK_PROOFS)
      const proof = subj.hook ? proofs.get(subj.hook) : null;
      const viaProof =
        proof?.ok && findHook(p, proof.container) ? `proof(${proof.test} › ${proof.name})` : null;
      const at =
        (subj.hook && findHook(p, subj.hook)) ||
        (subj.action && findAction(p, subj.action)) ||
        viaProof;
      perShell[p][bucket][subj.id] = at ? `ok: ${at}` : 'missing';
      if (!at) missing.push(p);
    }
    for (const p of PROBE_IDS) if (!subj.need.includes(p)) perShell[p][bucket][subj.id] = 'n/a';
    if (!missing.length) return true;
    const what = [subj.hook && `testid ${subj.hook}`, subj.action && `action ${subj.action}`]
      .filter(Boolean)
      .join(' / ');
    return `${what} not reached in ${missing.join(', ')}`;
  };
  const rows = {};
  for (const r of subjects.rows) rows[r.id] = judge(r, 'rows');
  const targets = {};
  for (const t of subjects.targets) targets[t.id] = judge(t, 'targets');
  const openers = {};
  for (const [p, byOpener] of Object.entries(evidence))
    openers[p] = Object.fromEntries(
      Object.entries(byOpener).map(([o, ev]) => [o, ev.ok === false ? `failed: ${ev.err}` : 'ok'])
    );
  return {
    schema: 'maude.reachability/1',
    about:
      'Written by scripts/v2-manifest/probe-reach.mjs (headless boot per shell and role). rows / targets: true = reachable in every probe it applies to, else why not. perShell = evidence per probe (opener that reached it, missing, n/a).',
    taken,
    bundle,
    probes: PROBES.map(({ id, shell, role }) => ({ id, shell, role })),
    openers,
    rows,
    targets,
    perShell,
  };
}
