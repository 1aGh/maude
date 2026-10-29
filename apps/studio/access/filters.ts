// access/filters.ts — the canvas-only filters (V2-1.16 §5.3). Every filter is the IDENTITY
// for a project-level session (`access.role !== null`, U7): today's bytes, untouched.
//
// Sections are owned by slice, so parallel slices merge as a union:
//   • S9.11 — socket frames (L11 presence, L12 broadcasts, L13 AI runs) and the canvas
//     origin's static lane (L15). Exports: `seerOf`, `seesSlug`, `WS_FRAME_CLASSES`,
//     `frameFor`, `snapshotFor`, `visibleTo`, `createWsVisibility`, `filterRunsView`,
//     `canvasOriginTarget`.
//   • S9.10 — listings (L6–L10), below its own banner.
//
// S9.10 — V2-1.16 §5.3 L6–L10 studio halves (S9.10).
//
// THE RULE for every filtered answer: a canvas-only session sees exactly what it would
// see if the other canvases did not exist. Same shapes, counts derived from the visible
// set (U5), free text that could name another canvas rewritten from the visible paths
// or dropped (U4), invisible answers like absent (U1). A project-role session gets its
// input back unchanged — every filter here is the identity when `access.role !== null`
// (U7: v1 owner / member / viewer bodies stay byte-identical).
//
// TOP-LEVEL API (S9.11 adds `visibleTo` beside these — keep this list a union):
//
//   Visibility
//     visibilityOf(access, closure?)        one session's answer to "may I see rel?"
//     projectVisibility(ctx)                the per-project closure source (shared by
//                                           http.ts's gate and api.ts's filters):
//                                           .closureOf(access) · .visibilityFor(access) ·
//                                           .current() (this request's, via currentAccess)
//   L8 tree / config / system data
//     filterIndexData(data, vis, designRel)        GET /_index-data
//     visibleDesignSystems(list, vis)              the DS entries a session renders with
//     filterConfig(json, vis, designSystems)       GET /_config
//     filterSystemData(data, vis, designRel, ...)  GET /_system-data
//   L9 usage (the V2-1.17 project index)
//     filterIndexSnapshot(snap, vis) · filterIndexSearch(result, vis)   GET /_api/index
//   L10 comments
//     filterCommentsAll(all, vis, designRel)       GET /_comments-all, and every id lookup
//                                                  (reply / patch / delete) through it
//   L6 git / history
//     canvasOnlyLogPaths(vis, path, designRel) · mergeCanvasOnlyLog(runs, limit)
//                                                  GET /_api/git/log
//     filterGitDiff(entries, vis, designRel) · diffRefusal(vis)    GET /_api/git/diff
//     diffShaVisible(gitCommitFiles(sha), vis, designRel)           its `?sha=` (S9.12b, U1)
//     filterAcceptedHistory(rows, vis, designRel)                  GET /_api/project/history
//     changedSubject(canvases)                     the U4 subject ("Changed A, B")
//   L7 export (canvas-only rows; S8 owns the everyone-fixes)
//     exportTargetVerdict(vis, scope, files, designRel)   POST /_api/export(-jobs)
//
// Pure apart from `projectVisibility` (disk reader + bus subscription, once per project).

import type { ServerWebSocket } from 'bun';

import { canvasSlugFromRel } from '../canvas-slug.ts';
import type { Context } from '../context.ts';
import type { ProjectIndexSnapshot, SearchResult } from '../index/types.ts';
import {
  type Closure,
  type ClosureCache,
  canvasImportsReport,
  closureFor,
  createClosureCache,
  projectClosureConfig,
} from './closure.ts';
import { closureConfigFor, knownCanvasesFor } from './known-canvases.ts';
import { currentAccess, diskProjectReader, toDesignRel } from './request.ts';
import { type Access, sees } from './scope.ts';

// ===========================================================================
// S9.12 — the revert-guard seam (V2-1.16 §7 `acl-revert-guard`, rule 10)
// ===========================================================================

/**
 * The checks `test/acl-revert-guard.test.ts` reverts one at a time to prove the canary
 * sweep goes red without each. Every listed check asks `aclCheckOn` on its live path,
 * so a check that is moved off that path (a dead copy) turns the guard red too.
 */
export const ACL_CHECKS = Object.freeze([
  'canvasScopeRefusal', // access/request.ts — any target outside the grants + closure
  'frameFor', // socket frames (L11/L12)
  'pathFirst', // the design root's files judged on their path (L15)
  'commentsAll', // `loadAllComments` and every comment id lookup (L10)
  'runs', // the AI run view (L13)
  'indexData', // the Files tree (L8)
] as const);
export type AclCheck = (typeof ACL_CHECKS)[number];

const revertedForTest = new Set<AclCheck>();

/**
 * TEST ONLY — behave as if `check`'s line were reverted (it becomes the identity). Nothing
 * in the product calls this and no env var or request reaches it: the guard's server is
 * started with `bun --preload test/_acl-seam-preload.ts`, which is the only caller.
 */
export function revertAclCheckForTest(check: AclCheck): void {
  if (!ACL_CHECKS.includes(check)) throw new Error(`unknown ACL check: ${check}`);
  revertedForTest.add(check);
}

/** Is `check` live? Always true outside the revert guard. */
export const aclCheckOn = (check: AclCheck): boolean => !revertedForTest.has(check);

// ===========================================================================
// S9.11 — socket frames + canvas origin
// ===========================================================================

/** designRoot-relative path → may this session see it; `holds(dir)`: a grant lies under `dir`. */
export type Seer = ((rel: string) => boolean) & { holds?: (dir: string) => boolean };

/**
 * The session's seer, or `null` for the identity (a project-level session, U7). A
 * canvas-only session sees its grants' closure (`sees`); a session with neither a role
 * nor grants sees nothing.
 */
export function seerOf(access: Access, closure: () => Closure | null): Seer | null {
  if (access.role !== null) return null;
  if (!access.canvasOnly) return Object.assign(() => false, { holds: () => false });
  let memo: Closure | null | undefined;
  const see = (rel: string): boolean => {
    if (access.seesCanvas(rel)) return true;
    if (memo === undefined) {
      try {
        memo = closure();
      } catch {
        memo = null; // fail closed: an unreadable tree shows nothing beyond the grants
      }
    }
    return sees(access, memo, rel);
  };
  const holds = (dir: string): boolean => {
    const prefix = `${dir.replace(/\/+$/, '')}/`;
    return access.grants.some((g) => g.c.startsWith(prefix));
  };
  return Object.assign(see, { holds });
}

/**
 * L11 — may this session join collab room `slug`? A project role: yes (`read`). A
 * canvas-only session: only a granted canvas's slug (rooms are per canvas — the same
 * test the hub's `seesDoc` makes for a Y.Doc name).
 */
export function seesSlug(access: Access, slug: string, designRel: string): boolean {
  if (access.role !== null) return access.can('read', null);
  if (!access.canvasOnly) return false;
  return access.grants.some(
    (g) => access.can('read', g.c) && canvasSlugFromRel(g.c, designRel) === slug
  );
}

/** The granted canvas behind a collab slug (for `roleFor`), or null. */
export function canvasOfSlug(access: Access, slug: string, designRel: string): string | null {
  return access.grants.find((g) => canvasSlugFromRel(g.c, designRel) === slug)?.c ?? null;
}

/**
 * U3 — every inspector / HMR frame type has a class. For a canvas-only socket:
 *   none     — carries nothing about any canvas: delivered as is;
 *   canvas   — about ONE path (`file`): delivered only when that path is visible;
 *   filtered — rewritten to what the session sees (dropped when nothing is left);
 *   project  — about the whole project: never delivered.
 * A type missing from this table is dropped for a canvas-only socket (fail closed).
 */
export const WS_FRAME_CLASSES = Object.freeze({
  'config-updated': 'none',
  'acp-focus': 'none',
  refused: 'none',
  // S1.7b — the shared Trash moved: `{ seq }` only, no path. A canvas-only session re-reads
  // `GET /_api/trash`, which lists only its canvases (routes/trash.ts, L18).
  'trash:changed': 'none',
  // S9.21b — an access change names no canvas and carries no text (a canvas-only session hears its
  // own ending); a request names a person and a canvas for the owner — never a canvas-only session.
  access: 'none',
  // p8-e2e-rolefix (2) — hubs.json changed: `{ type }` only, the shell re-reads its own /_config.
  'access-changed': 'none',
  'access-request': 'project',
  'fs:html': 'canvas',
  'fs:css': 'canvas',
  'fs:json': 'canvas',
  comments: 'canvas',
  'ai-activity': 'canvas',
  active: 'canvas',
  activity: 'canvas',
  'canvas-hmr': 'filtered',
  selected: 'filtered',
  snapshot: 'filtered',
  'canvas-list-update': 'filtered',
  'index-changed': 'filtered',
  'project:action': 'filtered',
  'export:job': 'filtered',
  'ui-open': 'filtered',
  // project: the changed-file list, sync trouble slugs, the branch, a content hash,
  // the run registry's head, a generation job's assets (no owner on the job)
  'git-status': 'project',
  'sync:status': 'project',
  'git-lifecycle': 'project',
  'thumb-ready': 'project',
  'ai:runs': 'project',
  'generate:job': 'project',
} as const satisfies Record<string, 'none' | 'canvas' | 'filtered' | 'project'>);

type Frame = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Any path a frame names (`.design/x.tsx`, `x.tsx`) → designRoot-relative, or null. */
function relOf(raw: unknown, designRel: string): string | null {
  const s = str(raw);
  return s === null ? null : toDesignRel(s, designRel);
}

const visibleRel = (raw: unknown, see: Seer, designRel: string): boolean => {
  const rel = relOf(raw, designRel);
  return rel !== null && see(rel);
};

/** `selected` as the inspector stores it: one element, several, or none. */
function filterSelected(sel: unknown, see: Seer, designRel: string): unknown {
  if (Array.isArray(sel)) {
    const kept = sel.filter((e) => visibleRel((e as Frame | null)?.file, see, designRel));
    return kept.length === 0 ? null : kept.length === 1 ? kept[0] : kept;
  }
  if (sel && typeof sel === 'object')
    return visibleRel((sel as Frame).file, see, designRel) ? sel : null;
  return null;
}

const nameOf = (rel: string): string =>
  (rel.split('/').pop() ?? rel).replace(/\.(?:tsx|jsx|html)$/, '');

export interface FrameAudience {
  /** The broadcast was addressed to ONE session (an export job's owner): this socket's. */
  addressed?: boolean;
}

/**
 * L12 — the frame this session may receive, or null. Identity for `see === null`.
 * Never mutates `frame`.
 */
export function frameFor(
  frame: Frame,
  see: Seer | null,
  designRel: string,
  audience: FrameAudience = {}
): Frame | null {
  if (see === null || !aclCheckOn('frameFor')) return frame;
  const type = str(frame.type) ?? '';
  const cls = (WS_FRAME_CLASSES as Record<string, string>)[type];
  if (cls === undefined || cls === 'project') return null;
  if (cls === 'none') return frame;
  if (cls === 'canvas') return visibleRel(frame.file, see, designRel) ? frame : null;
  switch (type) {
    case 'canvas-hmr':
      // a library reload names no canvas; everything else is about its `file`
      if (frame.file === undefined && frame.scope === 'lib') return frame;
      return visibleRel(frame.file, see, designRel) ? frame : null;
    case 'selected': {
      const selected = filterSelected(frame.selected, see, designRel);
      return { ...frame, selected };
    }
    case 'snapshot':
      return snapshotFor(frame, see, designRel);
    case 'canvas-list-update':
      return canvasListUpdateFor(frame, see, designRel);
    case 'index-changed': {
      const rels = Array.isArray(frame.rels)
        ? frame.rels.filter((r) => visibleRel(r, see, designRel))
        : [];
      return rels.length > 0 ? { ...frame, rels } : null;
    }
    case 'project:action':
      return projectActionFor(frame, see, designRel);
    case 'export:job':
      // the owner's own job (a cell addresses it to the owner's session); a project-wide
      // job feed is never a canvas-only session's
      return audience.addressed ? frame : null;
    case 'ui-open': {
      const open = (frame.open ?? null) as Frame | null;
      const target = open ? (open.canvas ?? open.file) : undefined;
      return target === undefined || visibleRel(target, see, designRel) ? frame : null;
    }
    default:
      return null;
  }
}

/** A canvas moved in or out of view is an add or a removal; a folder only when it held a grant. */
function canvasListUpdateFor(frame: Frame, see: Seer, designRel: string): Frame | null {
  const p = (frame.payload ?? null) as Frame | null;
  if (!p) return null;
  if (p.action === 'removed-folder') {
    const dir = relOf(p.dir, designRel);
    return dir !== null && see.holds?.(dir) === true ? frame : null;
  }
  const to = visibleRel(p.rel, see, designRel);
  if (p.fromRel === undefined) return to ? frame : null;
  const from = visibleRel(p.fromRel, see, designRel);
  if (to && from) return frame;
  if (to) {
    const { fromRel: _f, fromSlug: _s, ...rest } = p;
    return { ...frame, payload: { ...rest, action: 'added' } };
  }
  if (from) {
    return {
      ...frame,
      payload: { action: 'removed', rel: p.fromRel, ...(p.fromSlug ? { slug: p.fromSlug } : {}) },
    };
  }
  return null;
}

/** U4 — an accepted action touching an invisible canvas is relabelled from the visible ones. */
function projectActionFor(frame: Frame, see: Seer, designRel: string): Frame | null {
  const a = (frame.action ?? null) as Frame | null;
  if (!a) return null;
  const all = Array.isArray(a.canvases) ? (a.canvases as unknown[]).map(String) : [];
  const canvases = all.filter((c) => visibleRel(c, see, designRel));
  if (canvases.length === 0) return null;
  if (canvases.length === all.length) return frame;
  const boards = (a.artboards ?? {}) as Record<string, unknown>;
  const artboards = Object.fromEntries(
    Object.entries(boards).filter(([c]) => visibleRel(c, see, designRel))
  );
  const label = `Changed ${canvases.map(nameOf).join(', ')}`;
  return { ...frame, action: { ...a, canvases, artboards, label } };
}

/** L12 — the open snapshot: the inspector state and the activity map, visible paths only. */
export function snapshotFor(frame: Frame, see: Seer | null, designRel: string): Frame {
  if (see === null) return frame;
  const state = (frame.state ?? null) as Frame | null;
  const activity = (frame.activity ?? {}) as Record<string, unknown>;
  const out: Frame = {
    ...frame,
    activity: Object.fromEntries(
      Object.entries(activity).filter(([f]) => visibleRel(f, see, designRel))
    ),
  };
  if (state) {
    const selections = (state.selections ?? {}) as Record<string, unknown>;
    const comments = Array.isArray(state.active_comments) ? state.active_comments : undefined;
    out.state = {
      ...state,
      active: visibleRel(state.active, see, designRel) ? state.active : null,
      open_tabs: Array.isArray(state.open_tabs)
        ? state.open_tabs.filter((t) => visibleRel(t, see, designRel))
        : [],
      selected: filterSelected(state.selected, see, designRel),
      selections: Object.fromEntries(
        Object.entries(selections)
          .map(([k, v]) => [k, filterSelected(v, see, designRel)] as const)
          .filter(([, v]) => v !== null)
      ),
      ...(comments
        ? {
            active_comments: comments.filter((c) =>
              visibleRel((c as Frame | null)?.file, see, designRel)
            ),
          }
        : {}),
    };
  }
  return out;
}

/** What a socket carries for these filters (server.ts stamps `access` at the upgrade). */
type ScopedSocket = Pick<ServerWebSocket<unknown>, 'data'>;

const accessOfSocket = (ws: ScopedSocket): Access | undefined =>
  (ws.data as { access?: Access } | null | undefined)?.access;

export interface WsVisibilityDeps {
  designRel: string;
  /** The closure of a session's grants, computed on this child's disk (V2-1.7 G4). */
  closureOf: (access: Access) => Closure | null;
}

export interface WsVisibility {
  /** The socket's seer; null = identity (a project session, or a socket with no access). */
  seerFor(ws: ScopedSocket): Seer | null;
  /** V2-1.16 §5.2 — may this socket hear about `payload.file ?? payload.rel`? */
  visibleTo(ws: ScopedSocket, payload: { file?: string; rel?: string }): boolean;
  /** The frame this socket may receive, or null (see `frameFor`). */
  frameFor(ws: ScopedSocket, frame: Frame, audience?: FrameAudience): Frame | null;
  /** The granted canvas behind a collab slug, or null (a project session: null). */
  canvasOfSlug(access: Access, slug: string): string | null;
}

/**
 * The socket half of the filters. A socket without a stamped `access` (a test harness
 * opening a socket by hand) is the identity: server.ts stamps every upgrade it makes.
 */
export function createWsVisibility(deps: WsVisibilityDeps): WsVisibility {
  const seerFor = (ws: ScopedSocket): Seer | null => {
    const access = accessOfSocket(ws);
    if (!access) return null;
    return seerOf(access, () => deps.closureOf(access));
  };
  return {
    seerFor,
    visibleTo(ws, payload) {
      const see = seerFor(ws);
      if (see === null) return true;
      return visibleRel(payload.file ?? payload.rel, see, deps.designRel);
    },
    frameFor(ws, frame, audience) {
      return frameFor(frame, seerFor(ws), deps.designRel, audience);
    },
    canvasOfSlug: (access, slug) => canvasOfSlug(access, slug, deps.designRel),
  };
}

/** The contract's free function (V2-1.16 §5.2), for callers holding a `WsVisibility`. */
export function visibleTo(
  ws: ScopedSocket,
  payload: { file?: string; rel?: string },
  scope: WsVisibility
): boolean {
  return scope.visibleTo(ws, payload);
}

// ---------------------------------------------------------------------------
// L13 — the AI run registry's view (V2-1.15 §5.4) for a canvas-only session.

interface KeyLike {
  canvas: string;
  artboard?: string;
}

/** A lease key's canvas (`path:<repoRel>`, or a kernel entry we cannot place) → a seer test. */
function keyVisible(k: KeyLike | null | undefined, see: Seer, designRel: string): boolean {
  const c = str(k?.canvas);
  if (c === null || !c.startsWith('path:')) return false; // an entry id: unplaceable → invisible
  return visibleRel(c.slice('path:'.length), see, designRel);
}

type RunLike = Record<string, unknown> & {
  label?: unknown;
  artboards?: KeyLike[];
  waitingFor?: KeyLike[];
  objects?: KeyLike[];
  leases?: KeyLike[];
  waiting?: KeyLike[];
  touched?: Record<string, unknown>;
  scope?: { canvas?: unknown } | null;
  state?: unknown;
};

const keysOf = (r: RunLike): KeyLike[] => [
  ...(r.artboards ?? []),
  ...(r.waitingFor ?? []),
  ...(r.objects ?? []),
  ...(r.leases ?? []),
  ...(r.waiting ?? []),
];

/**
 * One run as a canvas-only session may see it: whole when everything it names is visible;
 * "AI is working here" (no label, no prompt text, visible keys only) when it spans an
 * invisible canvas; null when nothing of it is visible (U4).
 */
function runFor(r: RunLike, see: Seer, designRel: string): RunLike | null {
  const keys = keysOf(r);
  const touched = Object.keys(r.touched ?? {});
  const scopeCanvas = r.scope ? str(r.scope.canvas) : null;
  const visKeys = keys.filter((k) => keyVisible(k, see, designRel));
  const visTouched = touched.filter((c) => see(c));
  const scopeVisible = scopeCanvas !== null && see(scopeCanvas);
  const everything =
    visKeys.length === keys.length &&
    visTouched.length === touched.length &&
    (scopeCanvas === null || scopeVisible);
  const named = keys.length + touched.length + (scopeCanvas === null ? 0 : 1);
  if (everything && named > 0) return r;
  if (visKeys.length === 0 && visTouched.length === 0 && !scopeVisible) return null;
  const keep = (list: KeyLike[] | undefined) =>
    list === undefined ? undefined : list.filter((k) => keyVisible(k, see, designRel));
  const out: RunLike = { ...r, label: '' };
  for (const f of ['prompt', 'doing', 'question', 'chatId', 'sessionId'] as const) delete out[f];
  for (const f of ['artboards', 'waitingFor', 'objects', 'leases', 'waiting'] as const) {
    const kept = keep(r[f]);
    if (kept !== undefined) out[f] = kept;
  }
  if (r.waiting)
    out.waiting = (out.waiting as KeyLike[]).map((w) => ({ ...w, heldBy: null }) as KeyLike);
  if (r.touched)
    out.touched = Object.fromEntries(Object.entries(r.touched).filter(([c]) => see(c)));
  if (r.scope !== undefined) out.scope = scopeVisible ? r.scope : null;
  return out;
}

const LIVE_STATES = new Set(['waiting', 'starting', 'running', 'needs-you']);

/** L13 — `GET /_api/ai/runs` for a canvas-only session; identity for `see === null`. */
export function filterRunsView<
  V extends { mine: unknown[]; others: unknown[]; needsYou: number; live: number },
>(view: V, see: Seer | null, designRel: string): V {
  if (see === null || !aclCheckOn('runs')) return view;
  const mine = (view.mine as RunLike[])
    .map((r) => runFor(r, see, designRel))
    .filter((r): r is RunLike => r !== null);
  const others = (view.others as RunLike[])
    .map((r) => runFor(r, see, designRel))
    .filter((r): r is RunLike => r !== null);
  const liveMine = mine.filter((r) => LIVE_STATES.has(String(r.state)));
  return {
    ...view,
    mine,
    others,
    // U5 — aggregates count only what the session sees
    needsYou: liveMine.filter((r) => r.state === 'needs-you').length,
    live: liveMine.length,
  };
}

// ---------------------------------------------------------------------------
// L15 — the canvas origin's static lane.

/**
 * The designRoot-relative file a canvas-origin GET serves, judged on the PATH alone — the
 * static lane (`/<designRel>/…`) and its `/assets/<file>` alias. A query (`?file=`) never
 * redirects the judgement to another canvas. `undefined` = not a file of the design root.
 */
export function canvasOriginTarget(pathname: string, designRel: string): string | null | undefined {
  if (!aclCheckOn('pathFirst')) return undefined;
  const base = `/${designRel.replace(/^\/+|\/+$/g, '')}/`;
  if (pathname.startsWith(base)) return toDesignRel(pathname, designRel);
  if (pathname.startsWith('/assets/')) return toDesignRel(pathname.slice(1), designRel);
  return undefined;
}

// ===========================================================================
// S9.10 — listings (L6–L10)
// ===========================================================================

// ---------------------------------------------------------------------------
// Visibility.

export interface Visibility {
  /** A project-role session: every filter answers its input unchanged (U7). */
  readonly full: boolean;
  readonly access: Access;
  /** A canvas this session was granted (designRoot-relative). */
  seesCanvas(rel: string): boolean;
  /** A granted canvas or a file in its closure (designRoot-relative). */
  sees(rel: string): boolean;
  /** The closure of the session's grants (null without grants). */
  closure(): Closure | null;
}

/** One session's visibility. `closure` is called lazily, at most once. */
export function visibilityOf(access: Access, closure?: () => Closure | null): Visibility {
  const full = access.role !== null;
  let memo: Closure | null | undefined;
  const get = (): Closure | null => {
    if (memo === undefined) memo = access.grants.length > 0 && closure ? closure() : null;
    return memo;
  };
  return Object.freeze({
    full,
    access,
    seesCanvas: (rel: string) => full || (access.canvasOnly && access.seesCanvas(rel)),
    sees: (rel: string) => {
      if (full) return true;
      if (!access.canvasOnly) return false;
      return access.seesCanvas(rel) || (get()?.read.has(rel) ?? false);
    },
    closure: get,
  });
}

export interface ProjectVisibility {
  closureOf(access: Access): Closure | null;
  visibilityFor(access: Access): Visibility;
  /** This request's visibility (`currentAccess()`, AsyncLocalStorage set by server.ts). */
  current(): Visibility;
  /**
   * gate-b-c4j — of `canvases` (designRoot-relative), the ones that import another canvas → the
   * canvases each imports (closure.ts `canvasImportsReport`): a frame on one renders none of them,
   * so its module is refused and the shell says why. The same for every reader — the caller holds
   * the names to what its reader sees (`filterIndexData`). Memoized per tree generation.
   */
  canvasImports(canvases: readonly string[]): ReadonlyMap<string, string[]>;
}

const sources = new WeakMap<object, ProjectVisibility>();

/**
 * The closure source of one project: its disk reader, a closure cache keyed by (grants,
 * tree generation) and the generation bump on every file change. ONE per Context, so the
 * write gate (http.ts) and the read filters (api.ts) compute the same closure once.
 *
 * gate-b-c4j — judged with the studio's EFFECTIVE config (`ctx.cfg`, read per call: a config
 * reload swaps it), not `<designRoot>/config.json`, which a custom designRoot does not have.
 */
export function projectVisibility(
  ctx: Pick<Context, 'paths' | 'bus'> & { cfg?: Context['cfg'] }
): ProjectVisibility {
  const hit = sources.get(ctx);
  if (hit) return hit;
  let generation = 0;
  ctx.bus.on('fs:any', () => {
    generation++;
  });
  const cache: ClosureCache = createClosureCache();
  const reader = diskProjectReader(ctx.paths.designRoot, () => String(generation));
  // p8-c4b — plus the canvases the authority knows of (a stored grant), re-read per call.
  const config = () =>
    closureConfigFor(ctx) ?? projectClosureConfig(reader, knownCanvasesFor(undefined));
  const closureOf = (access: Access): Closure | null =>
    access.grants.length > 0 ? closureFor(access, reader, cache, config()) : null;
  const visibilityFor = (access: Access) => visibilityOf(access, () => closureOf(access));
  const reports = new Map<string, ReadonlyMap<string, string[]>>();
  const canvasImports = (canvases: readonly string[]) => {
    const cfg = config();
    const key = `${generation}\u0002${JSON.stringify(cfg)}\u0003${canvases.join('\u0001')}`;
    const hit = reports.get(key);
    if (hit) return hit;
    const report = canvasImportsReport(reader, canvases, cfg);
    reports.set(key, report);
    while (reports.size > 16) reports.delete(reports.keys().next().value as string);
    return report;
  };
  const src: ProjectVisibility = Object.freeze({
    closureOf,
    visibilityFor,
    current: () => visibilityFor(currentAccess()),
    canvasImports,
  });
  sources.set(ctx, src);
  return src;
}

/** A path as designRoot-relative (`ui/a.tsx`), whichever form it came in. */
const rel = (p: string, designRel: string): string | null => toDesignRel(p, designRel);

// ---------------------------------------------------------------------------
// L8 — the project tree, /_config, /_system-data.

interface IndexGroupShape {
  kind?: string;
  paths: string[];
  dirs?: string[];
  dsFolders?: Array<{ name: string; path: string; folder: string }>;
}

interface IndexDataShape {
  groups: IndexGroupShape[];
  canvasDesignSystems: Record<string, string>;
  canvasKinds: Record<string, string>;
  // S10.4 — present once a system is converted (api.ts buildIndexData)
  canvasDsRevs?: Record<string, string>;
  canvasDsKept?: Record<string, string>;
  systemHeads?: Record<string, string | null>;
  dsConverted?: Record<string, boolean>;
  dsRevGaps?: Record<string, string | null>;
  // gate-b-c4j — a canvas → the other canvases it imports (its frame is refused; api.ts buildIndexData)
  canvasImportsCanvases?: Record<string, string[]>;
}

/** Repo-relative `.design/ui/x/y.tsx` → every ancestor dir (`.design/ui`, `.design/ui/x`). */
function ancestorsOf(p: string): string[] {
  const parts = p.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

/**
 * GET /_index-data for a canvas-only session: only visible files; `dirs` only the ancestors
 * of a visible file (no folder-only names); a group with nothing visible is not listed (its
 * label names a folder of the project); the Project and Runtime groups are dropped; the DS
 * folders, `canvasDesignSystems` and `canvasKinds` only for what is visible.
 */
export function filterIndexData<T extends IndexDataShape>(
  data: T,
  vis: Visibility,
  designRel: string,
  designSystems: ReadonlyArray<{ name: string; path: string }> = []
): T {
  if (vis.full || !aclCheckOn('indexData')) return data;
  const seen = (p: string) => {
    const r = rel(p, designRel);
    return r !== null && vis.sees(r);
  };
  const dsNames = new Set(visibleDesignSystems(designSystems, vis).map((d) => d.name));
  const groups: IndexGroupShape[] = [];
  for (const g of data.groups) {
    if (g.kind !== 'canvas') continue;
    const paths = g.paths.filter(seen);
    if (!paths.length) continue;
    const next: IndexGroupShape = { ...g, paths };
    if (g.dirs) {
      const keep = new Set(paths.flatMap(ancestorsOf));
      next.dirs = g.dirs.filter((d) => keep.has(d));
    }
    if (g.dsFolders) {
      const folders = g.dsFolders.filter((f) => dsNames.has(f.name));
      next.dsFolders = folders.length ? folders : undefined;
    }
    groups.push(next);
  }
  const pick = (m: Record<string, string>) =>
    Object.fromEntries(Object.entries(m).filter(([k]) => seen(k)));
  const out: T = {
    ...data,
    groups,
    canvasDesignSystems: pick(data.canvasDesignSystems),
    canvasKinds: pick(data.canvasKinds),
  };
  // gate-b-c4j — a canvas this reader sees that imports another canvas, naming only the canvases it
  // sees. gate-b-c4k — an entry whose every name is hidden is dropped: it would tell the reader that
  // A imports SOME canvas it cannot see (a probe oracle: plant an import, watch the card). Its frame
  // is still refused; the shell shows the generic card there.
  if (data.canvasImportsCanvases) {
    out.canvasImportsCanvases = Object.fromEntries(
      Object.entries(data.canvasImportsCanvases)
        .filter(([k]) => seen(k))
        .map(([k, v]) => [k, v.filter((c) => vis.sees(c))] as const)
        .filter(([, v]) => v.length > 0)
    );
  }
  // S10.4 — the revision fields name systems and revisions: a session sees the ones it renders with.
  if (data.dsConverted) {
    const byName = <V>(m: Record<string, V> | undefined) =>
      Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => dsNames.has(k)));
    out.dsConverted = byName(data.dsConverted);
    out.systemHeads = byName(data.systemHeads);
    out.canvasDsRevs = pick(data.canvasDsRevs ?? {});
    out.canvasDsKept = pick(data.canvasDsKept ?? {});
    const referenced = new Set<string>(Object.values(out.canvasDsRevs));
    for (const h of Object.values(out.systemHeads)) if (h) referenced.add(h);
    out.dsRevGaps = Object.fromEntries(
      Object.entries(data.dsRevGaps ?? {}).filter(([id]) => referenced.has(id))
    );
  }
  return out;
}

/**
 * The design systems a session renders with: for a canvas-only session, a DS whose files
 * are in its closure (a granted canvas renders under it, G2). Everyone else: all of them.
 */
export function visibleDesignSystems<D extends { name: string; path: string }>(
  list: readonly D[],
  vis: Visibility
): D[] {
  if (vis.full) return [...list];
  const read = vis.closure()?.read;
  if (!read || !vis.access.canvasOnly) return [];
  return list.filter((d) => {
    const prefix = `${d.path.replace(/^\/+|\/+$/g, '')}/`;
    for (const r of read) if (r.startsWith(prefix)) return true;
    return false;
  });
}

/** Config keys that name the project's folders / link, never sent to a canvas-only session. */
const CONFIG_PROJECT_KEYS = ['newCanvasDir', 'newComponentDir', 'linkedHub'] as const;

/**
 * GET /_config for a canvas-only session: `canvasGroups: []`, `designSystems` = the visible
 * canvases' DS, no `newCanvasDir` / `newComponentDir` / `linkedHub`; a default DS it does not
 * render with is not named.
 */
export function filterConfig<T extends Record<string, unknown>>(
  json: T,
  vis: Visibility,
  designSystems: ReadonlyArray<{ name: string; path: string }>
): T {
  if (vis.full) return json;
  const visible = visibleDesignSystems(designSystems, vis);
  const names = new Set(visible.map((d) => d.name));
  const dropped = new Set<string>(CONFIG_PROJECT_KEYS);
  const d = json.defaultDesignSystem;
  const defaultDs = typeof d === 'string' && names.has(d) ? d : (visible[0]?.name ?? null);
  if (defaultDs === null) dropped.add('defaultDesignSystem');
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(json).filter(([k]) => !dropped.has(k))
  );
  out.canvasGroups = [];
  if (Array.isArray(json.designSystems)) {
    out.designSystems = (json.designSystems as Array<{ name?: unknown }>).filter(
      (x) => typeof x?.name === 'string' && names.has(x.name)
    );
  }
  if ('defaultDesignSystem' in json && defaultDs !== null) out.defaultDesignSystem = defaultDs;
  return out as T;
}

interface SystemDataShape {
  ds: { name: string } | null;
  availableDesignSystems: Array<{ name: string; path: string }>;
  defaultDesignSystem: string | null;
  readme: string | null;
  readmePath: string | null;
  tokens: unknown[];
  tokenGroups: Record<string, unknown>;
  tokensPath: string | null;
  previewGallery: Array<{ path: string }>;
  uiKitsGallery: Array<{ path: string }>;
}

/**
 * GET /_system-data for a canvas-only session: only the visible canvases' DS (an invisible
 * `?ds=` answers exactly like an unknown one — the caller's 404); the README dropped; the
 * galleries only for files it may read (specimens are outside every closure); tokens only
 * from a tokens file it may read.
 * Returns `null` when the named DS is not visible (the caller answers its unknown-DS 404).
 */
export function filterSystemData<T extends SystemDataShape>(
  data: T,
  vis: Visibility,
  designRel: string,
  designSystems: ReadonlyArray<{ name: string; path: string }>,
  /** The designRoot-relative tokens file `data.tokens` was read from. */
  tokensCssRel: string | null
): T | null {
  if (vis.full) return data;
  const visible = visibleDesignSystems(designSystems, vis);
  const names = new Set(visible.map((d) => d.name));
  if (data.ds && !names.has(data.ds.name)) return null;
  const seen = (p: string) => {
    const r = rel(p, designRel);
    return r !== null && vis.sees(r);
  };
  // `tokensPath` is repo-relative from the real path; judge the configured design-relative one.
  const tokensRel = tokensCssRel === null ? null : rel(tokensCssRel, designRel);
  const tokensOk = data.tokensPath !== null && tokensRel !== null && vis.sees(tokensRel);
  return {
    ...data,
    availableDesignSystems: data.availableDesignSystems.filter((d) => names.has(d.name)),
    defaultDesignSystem:
      data.defaultDesignSystem && names.has(data.defaultDesignSystem)
        ? data.defaultDesignSystem
        : (visible[0]?.name ?? null),
    readme: null,
    readmePath: null,
    tokens: tokensOk ? data.tokens : [],
    tokenGroups: tokensOk ? data.tokenGroups : {},
    tokensPath: tokensOk ? data.tokensPath : null,
    previewGallery: data.previewGallery.filter((g) => seen(g.path)),
    uiKitsGallery: data.uiKitsGallery.filter((g) => seen(g.path)),
  };
}

// ---------------------------------------------------------------------------
// L9 — usage: the V2-1.17 project index (⌘K, Canvases panel, "Update N canvases").

const canvasOfKey = (key: string): string => {
  const hash = key.indexOf('#');
  return hash < 0 ? key : key.slice(0, hash);
};

/** FNV-1a over a string — the derived freshness number of a filtered snapshot. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The project index for a canvas-only session: only its canvases; counts, byKind and the
 * stamp derived from those rows (U5); `access.scope: 'canvas'`; no hub link. `writer.seq` is
 * derived from the visible rows, so an edit on another canvas never moves it (the client's
 * `?since=` freshness probe is no activity oracle).
 */
export function filterIndexSnapshot(
  snap: ProjectIndexSnapshot,
  vis: Visibility
): ProjectIndexSnapshot {
  if (vis.full) return snap;
  const canvases = snap.canvases.filter((c) => vis.seesCanvas(c.rel));
  const byKind: ProjectIndexSnapshot['counts']['byKind'] = {};
  let artboards = 0;
  let maxMtimeMs = 0;
  const parts: string[] = [];
  for (const c of canvases) {
    artboards += c.artboards.length;
    for (const a of c.artboards) {
      const k = a.kind ?? 'digital';
      byKind[k] = (byKind[k] ?? 0) + 1;
    }
    if (c.mtimeMs > maxMtimeMs) maxMtimeMs = c.mtimeMs;
    parts.push(`${c.rel}\u0000${c.srcHash}\u0000${c.metaHash ?? ''}\u0000${c.artboardsFrom}`);
  }
  const digest = parts.join('\u0001');
  const hash = fnv(digest).toString(16).padStart(8, '0');
  return {
    ...snap,
    project: { ...snap.project, linkedHub: null },
    writer: { ...snap.writer, seq: fnv(`seq\u0002${digest}`) || 1 },
    stamp: { files: canvases.length, maxMtimeMs, hash },
    access: { ...snap.access, scope: 'canvas' },
    canvases,
    counts: { canvases: canvases.length, artboards, byKind },
  };
}

/** A project-index search for a canvas-only session: rows on its canvases only. */
export function filterIndexSearch(result: SearchResult, vis: Visibility): SearchResult {
  if (vis.full) return result;
  const rows = result.rows.filter((r) => vis.seesCanvas(canvasOfKey(r.key)));
  return { ...result, rows, closeOnly: rows.length > 0 && rows.every((r) => r.close) };
}

// ---------------------------------------------------------------------------
// L10 — comments.

/**
 * `{ file → Comment[] }` for a canvas-only session: only its granted canvases. Every id-based
 * mutation (reply / patch / delete) scans THIS map, so an invisible id is a missing id (U1).
 */
export function filterCommentsAll<C>(
  all: Record<string, C>,
  vis: Visibility,
  designRel: string
): Record<string, C> {
  if (vis.full || !aclCheckOn('commentsAll')) return all;
  const out: Record<string, C> = {};
  for (const [file, list] of Object.entries(all)) {
    const r = rel(file, designRel);
    if (r !== null && vis.seesCanvas(r)) out[file] = list;
  }
  return out;
}

// ---------------------------------------------------------------------------
// L6 — git and history.

/** `ui/2026/Combine-kampan.tsx` (or its sidecar) → `Combine-kampan`. */
export function canvasName(p: string): string {
  const base = p.split('/').pop() ?? p;
  const dot = base.indexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** The U4 subject: derived from the visible canvases only, never the author's free text. */
export function changedSubject(canvases: Iterable<string>): string {
  const names = [...new Set([...canvases].map(canvasName))].sort((a, b) => a.localeCompare(b));
  return names.length ? `Changed ${names.join(', ')}` : 'Changed';
}

/** At most this many paths are logged per canvas-only request (each one is a `git log`). */
export const MAX_LOG_PATHS = 128;

/**
 * The paths a canvas-only `/_api/git/log` runs over, repo-relative, each with the canvas it
 * counts as. `path` (already scope-checked) narrows to that one file; without it, every file
 * a granted canvas owns. A project-role session: null (the log is unchanged).
 */
export function canvasOnlyLogPaths(
  vis: Visibility,
  path: string | null,
  designRel: string
): Array<{ repoRel: string; canvas: string }> | null {
  if (vis.full) return null;
  const closure = vis.closure();
  const prefix = designRel.replace(/^\/+|\/+$/g, '');
  const repo = (r: string) => (prefix ? `${prefix}/${r}` : r);
  if (path) {
    const r = rel(path, designRel);
    if (r === null || !vis.sees(r)) return [];
    return [{ repoRel: repo(r), canvas: closure?.ownedBy.get(r) ?? r }];
  }
  if (!closure || !vis.access.canvasOnly) return [];
  const out: Array<{ repoRel: string; canvas: string }> = [];
  for (const g of vis.access.grants) {
    for (const [r, canvas] of closure.ownedBy) {
      if (canvas !== g.c || out.length >= MAX_LOG_PATHS) continue;
      out.push({ repoRel: repo(r), canvas });
    }
  }
  return out;
}

interface LogEntryShape {
  sha: string;
  message: string;
  author: string;
  email: string;
  date: string;
}

/**
 * Merge per-path logs into one canvas-only log: one row per commit, the subject rewritten
 * from the visible canvases it touched (U4 — no count, no body, no other canvas), the author
 * by name only, newest first (sha breaks ties, so the order never depends on which `git log`
 * finished first), at most `limit` rows.
 */
export function mergeCanvasOnlyLog<E extends LogEntryShape>(
  runs: Array<{ canvas: string; entries: readonly E[] }>,
  limit: number
): E[] {
  const bySha = new Map<string, { entry: E; canvases: Set<string> }>();
  for (const run of runs) {
    for (const e of run.entries) {
      const hit = bySha.get(e.sha);
      if (hit) hit.canvases.add(run.canvas);
      else bySha.set(e.sha, { entry: e, canvases: new Set([run.canvas]) });
    }
  }
  return [...bySha.values()]
    .sort((a, b) =>
      a.entry.date === b.entry.date
        ? a.entry.sha.localeCompare(b.entry.sha)
        : a.entry.date < b.entry.date
          ? 1
          : -1
    )
    .slice(0, Math.max(0, limit))
    .map(({ entry, canvases }) => ({
      ...entry,
      message: changedSubject(canvases),
      email: '',
    }));
}

/**
 * GET /_api/git/diff is raw source — the `export` class (V2-1.7 §5.2). `'capability'` when
 * the session holds export nowhere; null when it may diff (its file list is then filtered).
 */
export function diffRefusal(vis: Visibility): 'capability' | null {
  const a = vis.access;
  if (a.can('export', null)) return null;
  if (a.canvasOnly && a.grants.some((g) => a.can('export', g.c))) return null;
  return 'capability';
}

/** A canvas-only diff: only files a granted canvas owns, and only where it holds export. */
export function filterGitDiff<E extends { file: string }>(
  entries: readonly E[],
  vis: Visibility,
  designRel: string
): E[] {
  if (vis.full) return [...entries];
  const owned = vis.closure()?.ownedBy;
  if (!owned) return [];
  return entries.filter((e) => {
    const r = rel(e.file, designRel);
    const canvas = r === null ? undefined : owned.get(r);
    return canvas !== undefined && vis.access.can('export', canvas);
  });
}

/**
 * S9.12b (U1) — may a canvas-only session diff against a `?sha=` it named? Only when that
 * commit's OWN change (`files`, from `gitCommitFiles`: null = not a full id naming a commit)
 * touched a file it may diff. The diff runs against the working tree, so without this a
 * commit that touched only invisible canvases answered with the visible files changed since —
 * an existence oracle. A ref name or an abbreviation is null too: draft names are not its to
 * probe (U4). Every refusal answers exactly like a missing sha (`{ entries: [] }`).
 */
export function diffShaVisible(
  files: readonly string[] | null,
  vis: Visibility,
  designRel: string
): boolean {
  if (vis.full) return true;
  if (!files) return false;
  return (
    filterGitDiff(
      files.map((file) => ({ file })),
      vis,
      designRel
    ).length > 0
  );
}

interface HistoryRowShape {
  label?: unknown;
  canvases?: unknown;
}

/**
 * GET /_api/project/history for a canvas-only session: a row with no visible canvas is
 * dropped; `canvases` keeps only the visible ones; the label is rewritten from them (U4).
 */
export function filterAcceptedHistory<R>(
  rows: readonly R[],
  vis: Visibility,
  designRel: string
): R[] {
  if (vis.full) return [...rows];
  const out: R[] = [];
  for (const row of rows) {
    const list = (row as HistoryRowShape | null)?.canvases;
    const canvases = (Array.isArray(list) ? list : []).filter((p) => {
      const r = typeof p === 'string' ? rel(p, designRel) : null;
      return r !== null && vis.seesCanvas(r);
    }) as string[];
    if (!canvases.length) continue;
    out.push({ ...row, canvases, label: changedSubject(canvases) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// L7 — export targets (canvas-only rows).

/** Scopes that pack the project, not a canvas — `project`-class (V2-1.16 L7). */
export const PROJECT_EXPORT_SCOPES: ReadonlySet<string> = new Set(['project-raw']);

/**
 * May a session WITHOUT a project-level `export` export these resolved target files? A
 * project scope, or any target outside its grants, is `not-in-scope` (the same 403 a
 * missing canvas gets); a visible target it may not export is `capability`.
 */
export function exportTargetVerdict(
  vis: Visibility,
  scope: string,
  files: readonly string[],
  designRel: string
): 'ok' | 'not-in-scope' | 'capability' {
  const a = vis.access;
  if (a.can('export', null)) return 'ok';
  if (a.grants.length === 0) return 'capability';
  if (PROJECT_EXPORT_SCOPES.has(scope)) return a.canvasOnly ? 'not-in-scope' : 'capability';
  let verdict: 'ok' | 'capability' = 'ok';
  for (const f of files) {
    const r = rel(f, designRel);
    if (r === null) return 'not-in-scope';
    if (a.canvasOnly && !a.seesCanvas(r)) return 'not-in-scope';
    if (!a.can('export', r)) verdict = 'capability';
  }
  return verdict;
}

// ===========================================================================
// S9.12 — rows the gate sweep found unfiltered (V2-1.16 L6, L8)
// ===========================================================================

interface GitStatusShape {
  branch?: string | null;
  files?: Array<{ path: string }>;
  clean?: boolean;
  unpushed?: number;
  ahead?: number;
  behind?: number;
  remoteAhead?: boolean;
}

/**
 * GET /_api/git/status (L6). A canvas-only session's changed files are the ones it sees;
 * `clean` is derived from them (U5). The branch name is free text that can name another
 * canvas (U4) and the unpublished / remote counts are project aggregates (U5): dropped.
 */
export function filterGitStatus<T>(json: T, vis: Visibility, designRel: string): T {
  if (vis.full || !json || typeof json !== 'object') return json;
  const s = json as T & GitStatusShape;
  const files = (Array.isArray(s.files) ? s.files : []).filter((f) => {
    const r = typeof f?.path === 'string' ? rel(f.path, designRel) : null;
    return r !== null && vis.sees(r);
  });
  const { ahead: _a, behind: _b, remoteAhead: _r, ...rest } = s;
  return { ...rest, branch: null, files, clean: files.length === 0, unpushed: 0 } as T;
}

/** GET /_api/git/branches (L6). Draft names are free text (U4): a canvas-only session lists none. */
export function filterGitBranches<T>(json: T, vis: Visibility): T {
  if (vis.full || !json || typeof json !== 'object') return json;
  return { ...(json as object), branches: [] } as T;
}

/**
 * GET /_api/sync/trash (S9.12b). A canvas-only session lists only the parked copies whose
 * restore target it sees; an entry that does not say where it came from is not its to see.
 * The caller recomputes the totals from what is left (U5).
 */
export function filterTrashListing<E extends { sourceRel: string | null }>(
  entries: readonly E[],
  vis: Visibility
): E[] {
  if (vis.full) return [...entries];
  return entries.filter((e) => {
    const r = typeof e?.sourceRel === 'string' ? toDesignRel(e.sourceRel, '') : null;
    return r !== null && vis.sees(r);
  });
}

/** GET /_api/assets (L8). A canvas-only session lists the assets its canvases' closure reads. */
export function filterAssetListing<A extends { path: string }>(
  assets: readonly A[],
  vis: Visibility
): A[] {
  if (vis.full) return [...assets];
  return assets.filter((a) => {
    const r = typeof a?.path === 'string' ? toDesignRel(a.path, '') : null;
    return r !== null && vis.sees(r);
  });
}
