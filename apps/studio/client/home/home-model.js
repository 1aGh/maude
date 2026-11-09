// client/home/home-model.js — the Home page's merge (V2-1.1 §5.6 step 4), pure.
//
// Inputs are the three answers the page collects: `shell` = Rust's `shell_state` (null outside the
// desktop app), `index` = `GET /_home/index` (HomeIndex), `clouds` = one `GET /_home/cloud` answer
// per profile. Output is what the page draws:
//   pinned          every pinned canvas row, most recently pinned first
//   recent          canvas rows with an `openedAt`, newest first (optionally one project only)
//   recentProjects  the projects that have recent rows (the Recent filter's choices)
//   groups          Projects by profile: local registry entries ∪ cloud projects that have no copy
//                   on this Mac — "has a copy" = the shell's own binding (`shell.projects[].hub`,
//                   a managed copy's server), never a project's self-claimed linkedHub (N-M4)
// No I/O, no React, no Date.now() unless `now` is omitted — the S6 Home extends this, so it stays a
// plain module with fixtures in test/home-page-model.test.ts.

import { localIdentityMatches } from '../share-link.js';
import { accountTone } from '../shell/account-tone.js';
import { pathTestIdSlug } from '../shell/util.js';
import { cloudRowWhere, cloudState, connBadge, serverState, whereOf } from './home-where-model.js';

/** `canvas-row-<slug>`'s rule, so Home rows and tree rows name a canvas the same way. */
export const rowSlug = (rel) => pathTestIdSlug(rel);

/** `managed.rs` `managed_key` — the folder a managed (cloud) copy lives in. */
export function managedKey(serverUrl, projectId) {
  const s = String(serverUrl || '');
  const i = s.indexOf('://');
  const host = (i >= 0 ? s.slice(i + 3) : s).replace(/:/g, '-');
  const clean = (v) => String(v).replace(/[^A-Za-z0-9\-_.]/g, '-');
  return `${clean(host)}--${clean(projectId)}`;
}

/** A hub URL compared by what it names: lower-cased origin + path, no trailing slash. */
export function normHubUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return null;
  }
}

/** CONTRACT §6 / V2-1.1 §5.7 — roles in people words. */
export function cloudRoleWord(role) {
  if (role === 'observer') return 'Can view';
  if (role === 'viewer') return 'Can comment';
  if (role === 'owner') return 'Owner';
  return 'Can edit';
}

/**
 * Whose project a row is, in CONTRACT §4 words: "Tereza's", and "Yours" for your own — the possessive was
 * built as `${name}'s` and printed "You's" (02 ob-edge-other-mac). null = say nothing.
 */
export function ownerWord(ownerName, role) {
  const name = typeof ownerName === 'string' ? ownerName.trim() : '';
  if (role === 'owner' || /^you$/i.test(name)) return 'Yours';
  return name ? `${name}'s` : null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** CONTRACT §4 times: relative first ("2 min ago", "yesterday"), then a weekday, then "6 Oct". */
export function relativeTime(ms, now = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const d = now - ms;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  const then = new Date(ms);
  const today = new Date(now);
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= dayStart) return `${Math.floor(d / 3_600_000)} h ago`;
  if (ms >= dayStart - 86_400_000) return 'yesterday';
  if (ms >= dayStart - 6 * 86_400_000) return WEEKDAYS[then.getDay()];
  const base = `${then.getDate()} ${MONTHS[then.getMonth()]}`;
  return then.getFullYear() === today.getFullYear() ? base : `${base} ${then.getFullYear()}`;
}

/** "1 canvas" / "5 canvases" — CONTRACT §4 counts. */
export const canvasCount = (n) => `${n} ${n === 1 ? 'canvas' : 'canvases'}`;

/** The picture URL for a row's cover key, or null. */
export const thumbUrl = (pid, key) =>
  key ? `/_home/thumb/${encodeURIComponent(pid)}/${encodeURIComponent(key)}.jpg` : null;

function canvasRow(pid, projectName, c) {
  return {
    pid,
    projectName,
    rel: c.rel,
    slug: rowSlug(c.rel),
    name: c.name || c.rel,
    folder: c.folder || '',
    thumb: thumbUrl(pid, c.cover?.key),
    madeByAi: !!c.madeByAi,
    pinnedAt: typeof c.pinnedAt === 'number' ? c.pinnedAt : null,
    openedAt: typeof c.openedAt === 'number' ? c.openedAt : null,
  };
}

const DEFAULT_PROFILE = { id: 'default', label: 'This Mac' };

const hostOfUrl = (url) => {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
};

// What a row calls a hub: the host, plus the port when it is not the scheme's default (URL.host drops
// 443/80 itself) — the same words the account card and the project's account card use.
const hubLabelOf = (url) => {
  try {
    return new URL(String(url)).host.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * A hub of Maude Cloud (the control plane's host or a cell under it) — connections-model's rule.
 * `cloudUrl` is the control plane this Home server talks to (`/_config.cloudOrigin`, from
 * `MAUDE_CLOUD_URL`); the client never names the vendor's address itself, so a self-hosted
 * control plane is "Maude Cloud" here too. Not known yet ⇒ false (nothing is guessed).
 */
export function isCloudHubUrl(hubUrl, cloudUrl) {
  const host = hostOfUrl(hubUrl);
  const cloud = cloudUrl ? hostOfUrl(cloudUrl) : '';
  return !!host && !!cloud && (host === cloud || host.endsWith(`.${cloud}`));
}

/**
 * 2.0.5 W4b — the project id of a managed copy, read from its folder: `managed.rs`
 * `managed_key_for` names it `[<profile>@]<host>--<id>` under the app's data folder. null = the
 * folder is not the copy of `boundHub` (a folder the person opened is never a copy).
 */
export function copyProjectId(root, boundHub) {
  if (!boundHub) return null;
  const base =
    String(root || '')
      .split('/')
      .filter(Boolean)
      .pop() ?? '';
  const key = base.includes('@') ? base.slice(base.indexOf('@') + 1) : base;
  const prefix = managedKey(boundHub, '');
  return key.length > prefix.length && key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/**
 * 2.0.5 W4b (3) — how a project is connected and as whom, in one line: "Local · this Mac only",
 * "Maude Cloud · <account>", "Team server · <host> · <account>". An account nobody recorded is
 * left out, never guessed.
 */
export function connectionOf({ hub, profileEmail = null, hubAccount = null, cloudUrl = null }) {
  if (!hub) return { kind: 'local', host: null, account: null, words: 'Local · this Mac only' };
  // the control plane is not known yet (Home's /_config has not answered): say nothing rather
  // than call a Maude Cloud project a team server
  if (!cloudUrl) return { kind: 'unknown', host: hubLabelOf(hub), account: null, words: null };
  if (isCloudHubUrl(hub, cloudUrl)) {
    const account = profileEmail || null;
    return {
      kind: 'cloud',
      host: hubLabelOf(hub),
      account,
      words: ['Maude Cloud', account].filter(Boolean).join(' · '),
    };
  }
  const host = hubLabelOf(hub);
  const account = hubAccount || null;
  return {
    kind: 'team',
    host,
    account,
    words: ['Team server', host, account].filter(Boolean).join(' · '),
  };
}

/**
 * @param {{ shell?: object|null, index?: object|null, clouds?: object[]|null,
 *           filterPid?: string|null }} input
 */
export function buildHomeModel({
  shell = null,
  index = null,
  clouds = null,
  filterPid = null,
  hubAccounts = null,
  hubStates = null,
  cloudUrl = null,
}) {
  const indexed = new Map();
  for (const p of index?.projects ?? []) if (p && typeof p.pid === 'string') indexed.set(p.pid, p);

  // the registry: Rust's projects, or (no shell — a browser) whatever the index answered for
  const registry = shell?.projects?.length
    ? shell.projects.filter((p) => p && typeof p.pid === 'string')
    : [...indexed.values()].map((p) => ({
        pid: p.pid,
        root: p.project?.root ?? '',
        name: p.project?.name ?? '',
        profile: DEFAULT_PROFILE.id,
        place: 'closed',
        focused: false,
      }));
  const nameOf = (pid) => {
    const r = registry.find((p) => p.pid === pid);
    return indexed.get(pid)?.project?.name || r?.name || 'Untitled project';
  };

  // ── canvases ───────────────────────────────────────────────────────────────────────────────
  const rows = [];
  for (const p of indexed.values()) {
    if (p.state !== 'ok' || !Array.isArray(p.canvases)) continue;
    const projectName = nameOf(p.pid);
    for (const c of p.canvases)
      if (c && typeof c.rel === 'string') rows.push(canvasRow(p.pid, projectName, c));
  }
  const pinned = rows.filter((r) => r.pinnedAt != null).sort((a, b) => b.pinnedAt - a.pinnedAt);
  const opened = rows.filter((r) => r.openedAt != null).sort((a, b) => b.openedAt - a.openedAt);
  const recentProjects = [];
  for (const r of opened)
    if (!recentProjects.some((p) => p.pid === r.pid))
      recentProjects.push({ pid: r.pid, name: r.projectName });
  const recent = filterPid ? opened.filter((r) => r.pid === filterPid) : opened;

  // ── projects by profile ──────────────────────────────────────────────────────────────────
  const mru = new Map((shell?.recent ?? []).map((pid, i) => [pid, i]));
  const emailOf = (id) =>
    (shell?.profiles ?? []).find((x) => x?.id === id)?.email ||
    (clouds ?? []).find((c) => c?.profile === id)?.account?.email ||
    null;
  const accountsOn = new Map();
  for (const [id, byHub] of Object.entries(hubAccounts ?? {})) {
    const m = new Map();
    for (const [url, who] of Object.entries(byHub ?? {}))
      if (normHubUrl(url) && typeof who === 'string' && who) m.set(normHubUrl(url), who);
    accountsOn.set(id, m);
  }
  // 2.1.1 — per profile, whether each saved team sign-in still works (`/_home/accounts` `state`)
  const statesOn = new Map();
  for (const [id, byHub] of Object.entries(hubStates ?? {})) {
    const m = new Map();
    for (const [url, st] of Object.entries(byHub ?? {}))
      if (normHubUrl(url) && typeof st === 'string') m.set(normHubUrl(url), st);
    statesOn.set(id, m);
  }
  const allLocal = registry.map((p) => {
    const ix = indexed.get(p.pid);
    const gone = ix?.state === 'gone';
    // `hub` (display + the 'mac' word) is the project's own linkedHub — a HINT it wrote itself.
    // `boundHub` is the shell's record of a copy it made (V2-3.6 N-M4): the only proof that a
    // cloud project is on this Mac.
    const hub = normHubUrl(p.linkedHub?.url ?? ix?.project?.linkedHub?.url);
    const boundHub = normHubUrl(p.hub);
    // 'mac' = "this Mac only" — true only of a project with no hub; a linked one that is not in a
    // tab is plain 'closed' (no state word)
    const inTab = p.place === 'tab' || p.place === 'resting';
    // W4b: a managed copy whose own config lost its claim is still the app's copy of a hub — never
    // "this Mac only"
    const status = gone ? 'gone' : inTab ? 'tab' : hub || boundHub ? 'closed' : 'mac';
    const profile = p.profile || DEFAULT_PROFILE.id;
    const shown = boundHub || hub;
    return {
      kind: 'local',
      pid: p.pid,
      profile,
      name: ix?.project?.name || p.name || 'Untitled project',
      root: p.root || ix?.project?.root || '',
      status,
      place: p.place,
      focused: !!p.focused,
      ai: p.ai ?? null,
      canvasCount: typeof ix?.counts?.canvases === 'number' ? ix.counts.canvases : null,
      byKind: ix?.counts?.byKind && typeof ix.counts.byKind === 'object' ? ix.counts.byKind : {},
      stale: !!ix?.stale,
      formatGate: p.formatGate ?? null,
      hub,
      boundHub,
      copyOf: copyProjectId(p.root, boundHub),
      designReal: !gone && typeof ix?.designReal === 'string' ? ix.designReal : null,
      connection: connectionOf({
        hub: shown,
        profileEmail: emailOf(profile),
        hubAccount: shown ? (accountsOn.get(profile)?.get(shown) ?? null) : null,
        cloudUrl,
      }),
      copies: [],
      folder: (p.root || '').split('/').filter(Boolean).pop() ?? '',
      cover: firstCover(ix),
    };
  });
  allLocal.sort((a, b) => {
    const ia = mru.has(a.pid) ? mru.get(a.pid) : Number.POSITIVE_INFINITY;
    const ib = mru.has(b.pid) ? mru.get(b.pid) : Number.POSITIVE_INFINITY;
    return ia - ib || a.name.localeCompare(b.name);
  });
  const listingFor = (id) => (clouds ?? []).find((c) => c?.profile === id) ?? null;
  // 2.1.1 (artboard 14) — where the row lives and how it connects, after the folded copies settled
  const placed = (r) => {
    const kind = r.connection?.kind;
    const state =
      kind === 'local'
        ? 'local'
        : kind === 'cloud'
          ? cloudState(listingFor(r.profile))
          : kind === 'team'
            ? serverState(
                hubStates ? (statesOn.get(r.profile) ?? new Map()) : null,
                r.boundHub || r.hub
              )
            : null;
    return {
      ...r,
      where: whereOf(r),
      conn: connBadge(state, {
        kind,
        profile: { id: r.profile },
        email: r.connection?.account ?? null,
      }),
    };
  };
  const localRows = attachWorktrees(collapseDuplicates(allLocal, cloudUrl), shell?.worktrees).map(
    (r) => (r.status === 'gone' ? r : placed(r))
  );

  // one profile's copy never hides another profile's cloud row
  const bound = new Set(
    allLocal.filter((r) => r.boundHub).map((r) => `${r.profile} ${r.boundHub}`)
  );
  const cloudRows = [];
  for (const listing of clouds ?? []) {
    if (!listing?.signedIn || typeof listing.profile !== 'string') continue;
    for (const cp of listing.projects ?? []) {
      if (!cp || typeof cp.id !== 'string') continue;
      const hub = normHubUrl(cp.url);
      if (hub && bound.has(`${listing.profile} ${hub}`)) continue;
      cloudRows.push({
        kind: 'cloud',
        pid: null,
        profile: listing.profile,
        projectId: cp.id,
        name: cp.name || cp.id,
        ownerName: cp.ownerName ?? null,
        role: cp.role ?? null,
        url: cp.url ?? null,
        where: cloudRowWhere(listing.account?.email || emailOf(listing.profile)),
        conn: null,
        status: 'cloud',
        updatedAt: cp.updatedAt ?? null,
      });
    }
  }
  cloudRows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const profiles = (shell?.profiles ?? []).filter((p) => p && typeof p.id === 'string');
  const listingOf = (id) => (clouds ?? []).find((c) => c?.profile === id) ?? null;
  const ids = [
    ...profiles.map((p) => p.id),
    ...localRows.map((r) => r.profile),
    ...cloudRows.map((r) => r.profile),
  ].filter((id, i, all) => all.indexOf(id) === i);
  const groups = ids
    .map((id) => {
      const known = profiles.find((p) => p.id === id);
      const cloud = listingOf(id);
      return {
        profile: {
          id,
          label: known?.label || (id === DEFAULT_PROFILE.id ? DEFAULT_PROFILE.label : id),
          email: known?.email || cloud?.account?.email || null,
        },
        cloud,
        rows: [
          ...localRows.filter((r) => r.profile === id),
          ...cloudRows.filter((r) => r.profile === id),
        ],
      };
    })
    .filter((g) => g.rows.length > 0 || g.cloud?.signedIn);
  // 11 pn-home: the account with the most recently used project leads (the board draws Work above Personal). A
  // group with no local project has no recency and keeps the shell's order after the ones that have.
  const rank = (g) =>
    Math.min(
      ...g.rows.filter((r) => r.kind === 'local' && mru.has(r.pid)).map((r) => mru.get(r.pid)),
      Number.POSITIVE_INFINITY
    );
  const ranked = groups
    .map((g, i) => ({ g, i, r: rank(g) }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map((x) => x.g);

  return {
    pinned,
    recent,
    recentProjects,
    groups: ranked,
    projectCount: localRows.length + cloudRows.length,
  };
}

/**
 * #206 T6.3g (contract 206 §5 "Home and Recent") — the worktree folders this Mac opened as tabs
 * (`shell_state.worktrees`, newest first) go under their main project's row as `worktrees`, never as
 * rows of their own. A row folded into another (`copies`) hands its worktrees to that row; a worktree
 * whose main project Home does not list is not shown.
 */
function attachWorktrees(rows, worktrees) {
  const valid = (worktrees ?? []).filter(
    (w) =>
      w &&
      typeof w.pid === 'string' &&
      typeof w.mainPid === 'string' &&
      typeof w.branch === 'string' &&
      w.branch
  );
  return rows.map((r) => {
    const owners = new Set([r.pid, ...r.copies.map((c) => c.pid)]);
    const mine = valid
      .filter((w) => owners.has(w.mainPid))
      .map((w) => ({
        pid: w.pid,
        branch: w.branch,
        place: w.place ?? 'closed',
        root: w.root ?? '',
      }));
    return { ...r, worktrees: mine };
  });
}

/**
 * 2.0.5 W4b (4) — one row per project. Identity, never the label:
 *   (a) a managed copy (profile + its bound hub + the project id in its folder name) folds into the
 *       ONE folder of the same profile that links that hub; the folder the person opened stays the
 *       row. Two copies on one hub, or two such folders, cannot be told apart: nothing folds.
 *   (b) rows whose design root is one realpath (a `.design` symlink) fold into the last opened.
 * A folded row stays openable from its primary's `copies`. Rows arrive MRU-sorted; nothing is
 * removed from the registry — this is only what Home draws.
 */
function collapseDuplicates(rows, cloudUrl) {
  const out = rows.map((r) => ({ ...r, copies: [] }));
  const drop = new Set();
  const live = (r) => r.status !== 'gone';
  const fold = (primary, r, kind, label) => {
    primary.copies.push({ pid: r.pid, kind, label, place: r.place, root: r.root, name: r.name });
    if (primary.canvasCount == null && r.canvasCount != null) {
      primary.canvasCount = r.canvasCount;
      primary.byKind = r.byKind;
    }
    if (!primary.cover && r.cover) primary.cover = r.cover;
    if (primary.status === 'mac' && r.status !== 'mac') primary.status = 'closed';
    if (primary.connection?.kind === 'local' && r.connection?.kind !== 'local')
      primary.connection = r.connection;
    drop.add(r.pid);
  };

  // (a) a managed copy into the folder that links the same hub
  for (const c of out) {
    if (!c.copyOf || !live(c)) continue;
    const sameHub = out.filter(
      (x) => x.copyOf && x.profile === c.profile && x.boundHub === c.boundHub
    );
    if (sameHub.length !== 1) continue;
    const folders = out.filter(
      (x) =>
        !x.copyOf && live(x) && !drop.has(x.pid) && x.profile === c.profile && x.hub === c.boundHub
    );
    if (folders.length !== 1) continue;
    fold(
      folders[0],
      c,
      'cloud-copy',
      !cloudUrl ? 'copy' : isCloudHubUrl(c.boundHub, cloudUrl) ? 'cloud copy' : 'server copy'
    );
  }

  // (b) one design root, many folders: the last opened leads (rows are MRU-sorted)
  const byReal = new Map();
  for (const r of out) {
    if (drop.has(r.pid) || !r.designReal || !live(r)) continue;
    const key = `${r.profile} ${r.designReal}`;
    const primary = byReal.get(key);
    if (!primary) byReal.set(key, r);
    else fold(primary, r, 'folder', r.folder || r.name);
  }
  return out.filter((r) => !drop.has(r.pid));
}

// ── where the sentence lands (S6.4 — the chip under the question) ─────────────────────────────

/** `https://alligators.cloud.maude.sh` → `alligators.cloud.maude.sh` (a hint's words; '' when none). */
function hubHost(url) {
  if (typeof url !== 'string' || !url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** The chip's last choice: a project that does not exist yet. Signed in AND online it is a cloud
 *  project in the making ("a new project"); otherwise it stays on this Mac, and says so. */
export const newProjectWord = ({ signedIn, online }) =>
  signedIn && online ? 'a new project' : 'a project on this Mac';

/**
 * The projects a sentence can start a canvas in: projects on this Mac (a managed cloud copy is one of
 * them), cloud projects not here yet (the person can edit them; offline they are greyed — there is no
 * copy to open), then "a new project". A project that is not where it was, and a cloud project the
 * person can only comment on or view, are not choices.
 */
export function targetChoices({ model, signedIn, online }) {
  const local = [];
  const cloud = [];
  const where = new Map();
  for (const g of model?.groups ?? []) {
    for (const r of g.rows) {
      if (r.kind === 'local') {
        if (r.status === 'gone') continue;
        local.push({
          key: `local:${r.pid}`,
          kind: 'local',
          pid: r.pid,
          profile: r.profile,
          name: r.name,
          canvases: r.canvasCount,
          byKind: r.byKind ?? {},
          hint: null,
          disabled: false,
        });
        // r1 (img 7): what tells two same-named folders apart — the synced copy's cloud, else the folder
        where.set(r.pid, hubHost(r.boundHub) || r.folder || null);
      } else if (r.kind === 'cloud') {
        if (r.role === 'observer' || r.role === 'viewer') continue;
        cloud.push({
          key: `cloud:${r.profile}:${r.projectId}`,
          kind: 'cloud',
          profile: r.profile,
          projectId: r.projectId,
          name: r.name,
          canvases: null,
          byKind: {},
          hint: 'not on this Mac yet',
          disabled: !online,
        });
      }
    }
  }
  // Two registered folders may carry one project name (a ~/Maude folder and the app's synced copy of the
  // same cloud project; two repos whose config says the same name). Both are real targets, so neither is
  // dropped: a name on more than one local row gets its `where` as the hint.
  const seen = new Map();
  for (const c of local) {
    const n = c.name.trim().toLowerCase();
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  for (const c of local) {
    if ((seen.get(c.name.trim().toLowerCase()) ?? 0) > 1) c.hint = where.get(c.pid) ?? null;
  }
  return [
    ...local,
    ...cloud,
    {
      key: 'new',
      kind: 'new',
      name: newProjectWord({ signedIn, online }),
      canvases: 0,
      byKind: {},
      hint: null,
      disabled: false,
    },
  ];
}

/** The key the chip starts on: the project opened most recently (Rust's MRU, then the newest canvas
 *  opened), else the first on this Mac, else "a new project". */
export function defaultTarget(items, { shell = null, model = null } = {}) {
  const usable = items.filter((i) => i.kind === 'local' && !i.disabled);
  for (const pid of shell?.recent ?? []) {
    const hit = usable.find((i) => i.pid === pid);
    if (hit) return hit.key;
  }
  for (const r of model?.recent ?? []) {
    const hit = usable.find((i) => i.pid === r.pid);
    if (hit) return hit.key;
  }
  return usable[0]?.key ?? 'new';
}

// ── Shared with you (V2-1.1 §5.7 `shared[]`) ──────────────────────────────────────────────────
const WEEK = 7 * 24 * 3_600_000;

/** Every signed-in profile's `shared[]` as rows, newest grant first. `meta` is canvas 11's line:
 *  "Liga ČAAF 2027 · Jonas's · 1 h ago". A canvas share is named by its canvas, a project share by
 *  its project. */
export function sharedRows(clouds, now = Date.now()) {
  const rows = [];
  for (const listing of clouds ?? []) {
    if (!listing?.signedIn || typeof listing.profile !== 'string') continue;
    for (const s of listing.shared ?? []) {
      if (!s || typeof s.projectId !== 'string') continue;
      const when = typeof s.grantedAt === 'number' ? s.grantedAt : null;
      rows.push({
        key: `${listing.profile}:${s.projectId}:${s.canvas?.path ?? ''}`,
        profile: listing.profile,
        projectId: s.projectId,
        projectName: s.projectName || s.projectId,
        ownerName: s.ownerName ?? null,
        grantedBy: s.grantedBy ?? null,
        canvasPath: s.canvas?.path ?? null,
        title: s.canvas?.name || s.projectName || s.projectId,
        role: s.role ?? 'observer',
        roleWord: cloudRoleWord(s.role),
        grantedAt: when,
        meta: [
          s.projectName || s.projectId,
          ownerWord(s.ownerName, s.role),
          when != null ? relativeTime(when, now) : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }
  }
  return rows.sort((a, b) => (b.grantedAt ?? 0) - (a.grantedAt ?? 0));
}

/**
 * Every signed-in profile's pending invitations (`invited[]`) as rows, newest first. A row names the project (and
 * the canvas) — the key Join / Leave send — and carries no invite id and no address: the cloud sends none, and only
 * these fields are copied. No inviter name (unset, or from before v18) → "Invited to …", never an address (O3).
 */
export function invitedRows(clouds, now = Date.now()) {
  const rows = [];
  for (const listing of clouds ?? []) {
    if (!listing?.signedIn || typeof listing.profile !== 'string') continue;
    for (const s of listing.invited ?? []) {
      if (!s || typeof s.projectId !== 'string' || !s.projectId) continue;
      const projectName = s.projectName || s.projectId;
      const canvasPath = typeof s.canvas?.path === 'string' && s.canvas.path ? s.canvas.path : null;
      const canvasName = canvasPath ? s.canvas.name || canvasPath : null;
      const fromName =
        typeof s.fromName === 'string' && s.fromName.trim() ? s.fromName.trim() : null;
      const target = canvasName ?? projectName;
      const when = typeof s.invitedAt === 'number' ? s.invitedAt : null;
      rows.push({
        key: `${listing.profile}:${s.projectId}:${canvasPath ?? ''}`,
        profile: listing.profile,
        projectId: s.projectId,
        projectName,
        fromName,
        canvasPath,
        canvasName,
        role: s.role ?? 'observer',
        roleWord: cloudRoleWord(s.role),
        invitedAt: when,
        title: fromName ? `${fromName} invited you to ${target}` : `Invited to ${target}`,
        meta: [canvasName ? projectName : null, when != null ? relativeTime(when, now) : null]
          .filter(Boolean)
          .join(' · '),
      });
    }
  }
  return rows.sort((a, b) => (b.invitedAt ?? 0) - (a.invitedAt ?? 0));
}

/** "3 new this week": granted in the last 7 days and not yet opened on this Mac (`seen` = row keys). */
export const newThisWeek = (rows, seen, now = Date.now()) =>
  rows.filter((r) => r.grantedAt != null && now - r.grantedAt < WEEK && !seen.has(r.key)).length;

export const sharedAside = (n) =>
  `canvases from other people's projects${n > 0 ? ` · ${n} new this week` : ''}`;

// ── the person's face (a circle — never the project's square) ──────────────────────────────────
/** An account's initial and its tone — the ONE tone function (shell/account-tone.js, tabs.rs twin). */
export function accountFace({ id = '', label = '', email = '' } = {}) {
  const pick = (s) => (typeof s === 'string' ? s.match(/[\p{L}\p{N}]/u)?.[0] : null);
  const initial = (pick(label) ?? pick(email) ?? '·').toUpperCase();
  return { initial, tone: accountTone(id, label) };
}

function firstCover(ix) {
  if (!ix || !Array.isArray(ix.canvases)) return null;
  const withCover = ix.canvases
    .filter((c) => c?.cover?.key)
    .sort((a, b) => (b.openedAt ?? b.mtimeMs ?? 0) - (a.openedAt ?? a.mtimeMs ?? 0));
  return withCover[0] ? thumbUrl(ix.pid, withCover[0].cover.key) : null;
}

/** The pids Home asks the index about, and the ones that are running (`place: 'tab'`). */
export function indexQuery(shell) {
  const projects = shell?.projects ?? [];
  return {
    pids: projects.map((p) => p.pid).filter((p) => typeof p === 'string'),
    running: projects.filter((p) => p.place === 'tab').map((p) => p.pid),
  };
}

// ── a maude:// link Home was handed (V2-3.5) ───────────────────────────────────────────────────
// Rust sends Home only the links it could not route to a project tab (deep_link.rs): a project
// this Mac does not know, or one whose tab failed to open.

const baseName = (root) =>
  String(root ?? '')
    .replace(/\/+$/, '')
    .split('/')
    .pop();

/** The local project a link's `<project>` names — the rule a project window's CloudBar uses
 *  (`localIdentityMatches`: the linked hub's id wins, else the name's slug). null = none. */
export function localPidForLink(shell, project) {
  for (const p of shell?.projects ?? []) {
    if (!p || typeof p.pid !== 'string') continue;
    const linkedHub = p.linkedHub ?? null;
    if (
      localIdentityMatches({ project: p.name, linkedHub }, project) ||
      localIdentityMatches({ project: baseName(p.root), linkedHub }, project)
    )
      return p.pid;
  }
  return null;
}

/** The profile a connect link opens under: the signed-in one whose cloud lists the project, else
 *  the first signed in, else the first profile (the server then says to sign in). */
export function linkProfile(shell, clouds, project) {
  const signed = (clouds ?? []).filter((c) => c?.signedIn && typeof c.profile === 'string');
  const owner = signed.find((c) => (c.projects ?? []).some((cp) => cp?.id === project));
  return (owner ?? signed[0])?.profile ?? shell?.profiles?.[0]?.id ?? 'default';
}

/**
 * The Projects list keeps its first `cap` rows across the groups (11 pn-home: five of twenty, then "15 more");
 * a group left with no row drops out. `more` is what stays hidden.
 */
export function capProjectGroups(groups, cap) {
  let left = cap;
  let more = 0;
  const out = [];
  for (const g of groups) {
    const keep = g.rows.slice(0, Math.max(0, left));
    left -= keep.length;
    more += g.rows.length - keep.length;
    if (keep.length) out.push({ ...g, rows: keep });
  }
  return { groups: out, more };
}
