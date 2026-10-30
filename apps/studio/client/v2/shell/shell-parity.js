// client/v2/shell/shell-parity.js — V2-4.9: the v2 shell parity contract, as data.
//
// "One studio, every shell." The same client runs in seven places, and each one has a little different
// chrome. This file is the ONE table that says which chrome each place has and — for every absence — the
// one line of why. Nothing here is typed by hand where a model already knows the answer:
//
//   menu rows         the registry's `visible` / `enabled` predicates over PROJECT_MENU (project-menu-model.js)
//   Share cluster     save-status.js `accessStatus` + canvas-mode.js `capsFor` / `modeSegments`
//   left panel tabs   left-panel-model.js `leftTabs` over panel-availability.js `panelAvailable`
//   toolbars          bridge/canvas-modes.ts `MODE_TOOLS` through `visibleSlots`
//   Settings          settings-model.js `sectionsFor` / `rowShown`
//
// so a shell cannot gain or lose a control without this table changing — and the table is pinned by
// test/v2-shell-parity.test.tsx, committed as shell-parity.json (`bun scripts/gen-shell-parity.mjs`), and
// walked by the desktop e2e (apps/desktop/e2e/scenarios/shell-parity.e2e.ts) against the live shell.
//
// The seven shells are the nothing-deleted probe's (scripts/v2-manifest/reach-rules.mjs PROBES):
//   desktop · browser · cloud-owner · cloud-member · cloud-viewer · viewer · embed
//
// Roles: owner and member edit; a viewer is "Can comment" (V2-1.7) — the hub's `observer`, Can view, is
// the same chrome with no toolbar at all and is covered by the toolbar rule (`visibleSlots`), not a row.

import { ACTIONS_BY_ID } from '../../../actions/index.ts';
import { PROJECT_MENU } from '../../../actions/menu.ts';
import { isEnabled, isVisible } from '../../../actions/resolve.ts';
import { ROLE_RANK } from '../../../actions/types.ts';
import { initialMode, NO_CAPS, roleOfCaps, visibleSlots } from '../../../bridge/canvas-modes.ts';
import { DOCK_PANELS } from '../../shell/dock.jsx';
import { hiddenMenuIds } from '../diagnostics/diagnostics-model.js';
import { leftTabs } from '../left-panel/left-panel-model.js';
import { acrossProjects } from '../search/search-projects.js';
import { rowShown, SETTINGS_ROWS, sectionsFor } from '../settings/settings-model.js';
import { capsFor, MODE_WORD, modeSegments } from './canvas-mode.js';
import { panelAvailable } from './panel-availability.js';
import { buildProjectMenu, menuCtx, modelIds } from './project-menu-model.js';
import { accessStatus } from './save-status.js';

export const SCHEMA = 'maude.shell-parity/1';

/** The seven shells, in the probe's order. `by` is how a running shell identifies itself: `native`
 *  (window.__TAURI__), `cloudRole` (GET /_config → cloud.role, null = not a cloud tab), `readOnly`. */
export const SHELLS = Object.freeze([
  {
    id: 'desktop',
    label: 'Desktop app',
    surface: 'window',
    by: { native: true, cloudRole: null, readOnly: false },
  },
  {
    id: 'browser',
    label: 'Local browser',
    surface: 'tab',
    by: { native: false, cloudRole: null, readOnly: false },
  },
  {
    id: 'cloud-owner',
    label: 'Cloud tab (owner)',
    surface: 'tab',
    by: { native: false, cloudRole: 'owner', readOnly: false },
  },
  {
    id: 'cloud-member',
    label: 'Cloud tab (member)',
    surface: 'tab',
    by: { native: false, cloudRole: 'member', readOnly: false },
  },
  {
    id: 'cloud-viewer',
    label: 'Cloud tab (viewer)',
    surface: 'tab',
    by: { native: false, cloudRole: 'viewer', readOnly: true },
  },
  {
    id: 'viewer',
    label: 'Local read-only link',
    surface: 'tab',
    by: { native: false, cloudRole: null, readOnly: true },
  },
  { id: 'embed', label: 'Embed (?embed=1)', surface: 'frame', by: { embed: true } },
]);
export const SHELL_IDS = Object.freeze(SHELLS.map((s) => s.id));

/** The chrome parts, in the order a person meets them. */
export const PARTS = Object.freeze([
  'window-tabs',
  'project-pill',
  'back-to-home',
  'menu',
  'share-cluster',
  'mode-switch',
  'left-panel',
  'inspector',
  'comments',
  'history',
  'ai-chat',
  'toolbars',
  'settings',
  'diagnostics',
  'canvas',
]);

/** Menu rows whose presence depends on state the shell cannot know up front — the e2e tolerates their
 *  absence, never their presence where the table says absent. */
export const CONDITIONAL_ROWS = Object.freeze({
  'nav.home': 'a cloud tab whose hub serves a dashboard',
  'account.switch': 'a cloud tab with a signed-in account',
  'sync.resync': 'a project linked to a hub',
  'sync.download-all': 'a linked project that syncs its files',
});

const EMBED_WHY = 'the embed is chromeless (DDR-247): one canvas, looking, nothing else';
const absent = (why) => ({ present: false, why });

/** The submenu trail of every action id (`['view', 'advanced']`), slugs as the pill's testids use them. */
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
function menuTrails(nodes = PROJECT_MENU, trail = [], out = new Map()) {
  for (const n of nodes) {
    if ('sep' in n) continue;
    if ('submenu' in n) menuTrails(n.items, [...trail, slug(n.submenu)], out);
    else if (!out.has(n.id)) out.set(n.id, trail);
  }
  return out;
}

/** What the running shell is called, from what it can read about itself (the e2e's identification). */
export function shellIdOf({ embed = false, native = false, cloudRole = null, readOnly = false }) {
  if (embed) return 'embed';
  const hit = SHELLS.find(
    (s) =>
      !s.by.embed &&
      s.by.native === !!native &&
      s.by.cloudRole === (cloudRole === 'observer' ? 'viewer' : cloudRole) &&
      (cloudRole ? true : s.by.readOnly === !!readOnly)
  );
  return hit?.id ?? null;
}

/** The inputs the shell's own code reads for one shell. */
function inputsOf(shell) {
  const { native, cloudRole, readOnly } = shell.by;
  const cloud = cloudRole
    ? { role: cloudRole, dashboardUrl: 'https://cloud.example/dashboard' }
    : null;
  return { native: !!native, cloud, readOnly: !!readOnly, role: cloudRole ?? undefined };
}

function menuPart(shell, { native, cloud, readOnly }) {
  const ctx = menuCtx({ native, cloudTab: !!cloud, readOnly, canvasOpen: true });
  const hidden = hiddenMenuIds({ cloud, syncStatus: { files: true } });
  const model = buildProjectMenu(ctx, { hidden });
  const rows = modelIds(model);
  const unique = [...new Set(rows)];
  const disabled = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'item' && n.disabled && !disabled.includes(n.id)) disabled.push(n.id);
      if (n.type === 'sub') walk(n.children);
    }
  };
  walk(model);
  return {
    present: true,
    // Top-level entries as the pill draws them: an action row (`project-menu-row-<id>`) or a submenu
    // (`project-menu-row-sub-<slug>`).
    top: model
      .filter((n) => n.type !== 'sep')
      .map((n) => (n.type === 'sub' ? `sub-${slug(n.label)}` : n.id)),
    rows: unique,
    disabled,
    ctx: { shell: ctx.shell, role: ctx.role },
  };
}

/** Every menu row any shell has, with the path to it and — per shell — why it is missing. */
function menuAbsences(menus) {
  const everything = new Set(Object.values(menus).flatMap((m) => m.rows));
  const trails = menuTrails();
  const out = {};
  for (const [id, m] of Object.entries(menus)) {
    const why = {};
    for (const rowId of everything) {
      if (m.rows.includes(rowId)) continue;
      why[rowId] = whyRowAbsent(rowId, m.ctx);
    }
    out[id] = why;
  }
  return {
    everything: [...everything],
    trails: Object.fromEntries([...trails].filter(([k]) => everything.has(k))),
    why: out,
  };
}

function whyRowAbsent(rowId, ctx) {
  const def = ACTIONS_BY_ID.get(rowId);
  const v = def?.visible;
  if (v?.shell && !v.shell.includes(ctx.shell))
    return `${def.label} is for ${v.shell.join(' and ')} only`;
  // A6c — only when the role is below it: a Can view floor must not explain a member's missing row.
  if (v?.minRole && ROLE_RANK[ctx.role] < ROLE_RANK[v.minRole])
    return `${def.label} needs ${v.minRole} rights`;
  if (rowId === 'sync.resync' || rowId === 'sync.download-all')
    return 'a cloud project syncs through its hub: the hub refuses a member’s resync (DDR-209 D1)';
  // S11.15 (06 ad-edge-where): a cloud tab runs no process of yours — its Server row says "Runs in the cloud".
  if (rowId === 'diag.address' || rowId === 'diag.process' || rowId === 'diag.project-folder')
    return 'a cloud tab runs no process of its own: the Server row says “Runs in the cloud”';
  return 'not offered in this shell';
}

function shareClusterPart(shell, { readOnly, role }) {
  const access = accessStatus({ canEdit: !readOnly, role });
  const parts = ['share-cluster-status', 'share-cluster-mode', 'share-cluster-panels'];
  parts.push(access ? 'share-cluster-ask' : 'share-cluster-share');
  return {
    present: true,
    testids: ['share-cluster', ...parts],
    // Only after something happened — never asserted present, only never asserted absent-by-mistake.
    when: {
      'share-cluster-exports': 'once any export exists',
      // P8 C3 (10 S1): the host draws it only once the canvas has comments (or while the panel is open)
      'share-cluster-comments':
        'once the open canvas has a comment (or while the Comments panel shows)',
      'share-cluster-faces': 'when other people (or Claude) are in the project',
      // p8-held-conflict-status — Not saved · Compare (save-status.js): every editing shell, the cloud tab
      // included (a cell's held conflict rides the same /_sync-status notices); a read-only session's slot
      // is its access word, with no status action.
      ...(access
        ? {}
        : { 'share-cluster-compare': 'while a held source conflict waits (Not saved · Compare)' }),
      // S1.22a — the account chip: the desktop's Mac accounts (a cloud tab's account is the hub's).
      ...(shell.id === 'desktop'
        ? { 'share-cluster-account': 'signed in, with two or more accounts on this Mac' }
        : {}),
    },
    access: access ? access.word : null,
    action: access ? access.action : 'Share',
    why: access
      ? 'a read-only session does not share: it says what it can do and offers “Ask to edit” (V2-1.7)'
      : undefined,
  };
}

function modeSwitchPart(shell, { readOnly, role }) {
  const caps = capsFor({ canEdit: !readOnly, role });
  const segments = modeSegments(caps);
  return {
    present: true,
    segments,
    words: segments.map((s) => MODE_WORD[s]),
    testids: segments.map((s) => (s === 'present' ? 'palette-mode-present' : `palette-mode-${s}`)),
    caps,
    note: readOnly ? 'the first slot is Viewing, never a greyed Edit (04 · md-model)' : undefined,
  };
}

function leftPanelPart({ readOnly, native }) {
  const tabs = leftTabs({ layersMode: 'separate' })
    .filter((t) => panelAvailable(t.id, { viewerMode: readOnly, native, layersMode: 'separate' }))
    .map((t) => t.id);
  return {
    present: true,
    tabs,
    testids: ['canvas-list', 'canvas-search', ...tabs.map((t) => `panel-tab-${t}`)],
  };
}

function islandPart(id, regId, { readOnly, native }, ctx, note) {
  const def = ACTIONS_BY_ID.get(regId);
  const has =
    panelAvailable(id, { viewerMode: readOnly, native, layersMode: 'separate' }) &&
    (!def || isVisible(def, ctx));
  return has
    ? { present: true, readOnly: readOnly || undefined, note: readOnly ? note : undefined }
    : absent('not offered in this shell');
}

function aiChatPart(shell, { native, cloud, readOnly }, ctx) {
  const def = ACTIONS_BY_ID.get('ai.chat');
  const hasIsland = panelAvailable('assistant', { viewerMode: readOnly, native });
  if (hasIsland)
    return { present: true, testids: ['ai-chat-header'], keys: '⌘/', opens: 'the chat island' };
  if (cloud)
    return {
      present: false,
      why: 'the chat runs Claude on your own Mac — it lives in the desktop app (DDR-123)',
      // ⌘K says so instead of staying silent (the cloud-shell-surfaces rule: absent WITH A NOTICE).
      search: {
        row: `${def.label} — ${def.search.note}`,
        disabled: !isEnabled(def, ctx),
      },
    };
  return absent(
    readOnly
      ? 'the chat edits the project — a read-only link has no agent'
      : 'the chat runs Claude on your own Mac — it needs the desktop app (DDR-123)'
  );
}

function toolbarsPart({ readOnly, role }) {
  const caps = capsFor({ canEdit: !readOnly, role });
  const r = roleOfCaps(caps);
  const modes = modeSegments(caps).filter((m) => m !== 'present');
  const bars = {};
  for (const m of modes) bars[m] = visibleSlots(m, r).map((s) => s.label);
  return {
    present: true,
    role: r,
    modes: bars,
    presenting: 'no toolbar (Present hides every control)',
    why: readOnly
      ? 'editing tools are hidden, never greyed: Viewing keeps Hand and Comment, Preview the same (V2-1.2)'
      : undefined,
  };
}

function settingsPart({ native, cloud, readOnly }) {
  const sections = sectionsFor(cloud, readOnly).map((s) => s.id);
  const rows = SETTINGS_ROWS.filter(
    (r) => rowShown(r, { cloud: cloud ?? null, readOnly }) && (!r.native || native)
  ).map((r) => ({
    testid: r.testid,
    section: r.section,
    // The account row needs an address the shell may not have (a desktop not signed in, a hub with no dashboard).
    ...(r.account ? { conditional: true } : {}),
  }));
  return {
    present: true,
    sections,
    rows,
    why:
      sections.length < 3
        ? readOnly
          ? 'a read-only session has the preferences of the person (General) — never the Mac’s keys, engines or sync (Connections, Advanced)'
          : 'a browser tab has no keychain, ffmpeg or whisper: Connections and Advanced configure the Mac the project lives on (DDR-209 D1)'
        : undefined,
  };
}

function diagnosticsPart(menu) {
  const trails = menuTrails();
  const rows = menu.rows.filter((id) => trails.get(id)?.[0] === 'diagnostics');
  return { present: true, rows };
}

function embedParts() {
  const out = {};
  for (const p of PARTS) out[p] = absent(EMBED_WHY);
  out.canvas = {
    present: true,
    governed: true,
    // embed-view.jsx seeds the canvas with `set-mode` over the V2-4.3b lane.
    setMode: { mode: 'preview', caps: NO_CAPS },
    testids: [],
  };
  return out;
}

function canvasPart({ readOnly, role }) {
  const caps = capsFor({ canEdit: !readOnly, role });
  return { present: true, governed: true, bootMode: initialMode(caps), caps };
}

/** The whole contract for one shell. */
export function parityFor(id) {
  const shell = SHELLS.find((s) => s.id === id);
  if (!shell) throw new Error(`unknown shell ${id}`);
  if (shell.by.embed) {
    return { id, label: shell.label, surface: shell.surface, by: shell.by, parts: embedParts() };
  }
  const inp = inputsOf(shell);
  const menu = menuPart(shell, inp);
  const ctx = menuCtx({
    native: inp.native,
    cloudTab: !!inp.cloud,
    readOnly: inp.readOnly,
    canvasOpen: true,
  });
  const desktop = shell.id === 'desktop';
  const parts = {
    'window-tabs': {
      ...(desktop
        ? { present: true, where: 'the tab strip webview (V2-3.7) — not part of a project page' }
        : absent(
            inp.cloud
              ? 'a cloud project is one browser tab; the dashboard is the list of projects'
              : 'the browser tab is the tab'
          )),
      // S1.5: ⌘K reaches the other projects only where there are other tabs (search-projects.js)
      search: acrossProjects({ native: desktop }),
    },
    'project-pill': { present: true, testids: ['project-pill'] },
    'back-to-home':
      ACTIONS_BY_ID.get('nav.home') && isVisible(ACTIONS_BY_ID.get('nav.home'), ctx)
        ? {
            present: true,
            label: ACTIONS_BY_ID.get('nav.home').label,
            opens: desktop ? 'the Home tab' : 'the cloud dashboard',
            testids: ['project-menu-row-nav.home'],
          }
        : absent('a local project outside the desktop app has no Home to go back to'),
    menu,
    'share-cluster': shareClusterPart(shell, inp),
    'mode-switch': modeSwitchPart(shell, inp),
    'left-panel': leftPanelPart(inp),
    inspector: islandPart(
      'inspector',
      'view.inspector',
      inp,
      ctx,
      'measures and reads values; changes nothing (Cloud Phase 27 C1)'
    ),
    comments: islandPart(
      'comments',
      'view.comments',
      inp,
      ctx,
      'reads threads and may comment; cannot resolve or delete (Cloud Phase 25 C2)'
    ),
    history: islandPart(
      'changes',
      'history.open',
      inp,
      ctx,
      'reads the versions; cannot save or restore'
    ),
    'ai-chat': aiChatPart(shell, inp, ctx),
    toolbars: toolbarsPart(inp),
    settings: settingsPart(inp),
    diagnostics: diagnosticsPart(menu),
    canvas: canvasPart(inp),
  };
  return { id, label: shell.label, surface: shell.surface, by: shell.by, parts };
}

/** The committed contract (shell-parity.json): every shell, plus the cross-shell facts the e2e needs. */
export function buildParity() {
  const shells = Object.fromEntries(SHELL_IDS.map((id) => [id, parityFor(id)]));
  const menus = Object.fromEntries(
    SHELL_IDS.filter((id) => id !== 'embed').map((id) => [id, shells[id].parts.menu])
  );
  const { everything, trails, why } = menuAbsences(menus);
  for (const id of Object.keys(menus)) shells[id].parts.menu.absent = why[id];
  return {
    schema: SCHEMA,
    about:
      'Generated by scripts/gen-shell-parity.mjs from client/v2/shell/shell-parity.js — do not edit. test/v2-shell-parity.test.tsx pins it to the models; the desktop e2e walks it against the live shell.',
    parts: PARTS,
    conditional: CONDITIONAL_ROWS,
    menuRows: { all: everything.sort(), trails },
    dockPanels: DOCK_PANELS.map((p) => p.id),
    shells,
  };
}
