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
import { pathTestIdSlug } from '../shell/util.js';

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
  return 'Can edit';
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

/**
 * @param {{ shell?: object|null, index?: object|null, clouds?: object[]|null,
 *           filterPid?: string|null }} input
 */
export function buildHomeModel({ shell = null, index = null, clouds = null, filterPid = null }) {
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
  const localRows = registry.map((p) => {
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
    const status = gone ? 'gone' : inTab ? 'tab' : hub ? 'closed' : 'mac';
    return {
      kind: 'local',
      pid: p.pid,
      profile: p.profile || DEFAULT_PROFILE.id,
      name: ix?.project?.name || p.name || 'Untitled project',
      root: p.root || ix?.project?.root || '',
      status,
      place: p.place,
      focused: !!p.focused,
      ai: p.ai ?? null,
      canvasCount: typeof ix?.counts?.canvases === 'number' ? ix.counts.canvases : null,
      stale: !!ix?.stale,
      formatGate: p.formatGate ?? null,
      hub,
      boundHub,
      folder: (p.root || '').split('/').filter(Boolean).pop() ?? '',
      cover: firstCover(ix),
    };
  });
  localRows.sort((a, b) => {
    const ia = mru.has(a.pid) ? mru.get(a.pid) : Number.POSITIVE_INFINITY;
    const ib = mru.has(b.pid) ? mru.get(b.pid) : Number.POSITIVE_INFINITY;
    return ia - ib || a.name.localeCompare(b.name);
  });

  // one profile's copy never hides another profile's cloud row
  const bound = new Set(
    localRows.filter((r) => r.boundHub).map((r) => `${r.profile} ${r.boundHub}`)
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

  return {
    pinned,
    recent,
    recentProjects,
    groups,
    projectCount: localRows.length + cloudRows.length,
  };
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
