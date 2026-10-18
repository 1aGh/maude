// access/filters.ts — the canvas-only filters (V2-1.16 §5.3). Every filter is the IDENTITY
// for a project-level session (`access.role !== null`, U7): today's bytes, untouched.
//
// Sections are owned by slice, so parallel slices merge as a union:
//   • S9.11 — socket frames (L11 presence, L12 broadcasts, L13 AI runs) and the canvas
//     origin's static lane (L15). Exports: `seerOf`, `seesSlug`, `WS_FRAME_CLASSES`,
//     `frameFor`, `snapshotFor`, `visibleTo`, `createWsVisibility`, `filterRunsView`,
//     `canvasOriginTarget`.
//   • S9.10 — listings (L6–L10), below its own banner.

import type { ServerWebSocket } from 'bun';

import { canvasSlugFromRel } from '../canvas-slug.ts';
import type { Closure } from './closure.ts';
import { toDesignRel } from './request.ts';
import { type Access, sees } from './scope.ts';

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
  if (see === null) return frame;
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
  if (see === null) return view;
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
  const base = `/${designRel.replace(/^\/+|\/+$/g, '')}/`;
  if (pathname.startsWith(base)) return toDesignRel(pathname, designRel);
  if (pathname.startsWith('/assets/')) return toDesignRel(pathname.slice(1), designRel);
  return undefined;
}
