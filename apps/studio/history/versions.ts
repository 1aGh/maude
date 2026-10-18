// Version history — the rows of one canvas (V2-1.9 §5.1, §5.2, §5.14; S1.12b).
//
//   listVersions(input)   a home's history rows → rule G rows (client/v2/history/rows.ts), newest first,
//                         paged by `before`, words from S1.10's attribution cache, names from
//                         `origin.named`. A legacy hub answers git rows (`ref: git:<sha>`).
//   historyVersions(…)    the canvas's visible versions (§5.1) — shared with changes.ts' blame
//   collectNames(…)       the canvas's names, newest write wins, `null` clears
//
// Paging (rule G is a left-to-right walk): a page is a walk that starts at a HARD BREAK
// (`isHardBreak` — a point that starts a row in every walk), so a page and the full history agree on
// every row boundary. The walk reads back until it holds `limit + 1` hard breaks or hits the look-back
// cap; `next` is the first revision of the page's oldest row, so the next page ends exactly at a row
// boundary. Words are computed only for the rows a page returns.
//
// Pure apart from the runtime / cache it is handed: no route, no access decisions (routes/history.ts).

import {
  filterRows,
  isHardBreak,
  type ReduceOptions,
  type RowFilter,
  type RowName,
  type RowVersion,
  reduceRows,
  type VersionRow,
} from '../client/v2/history/rows';
import { type AttributionCache, attributionFor } from '../index/extractors/attribution-cache';
import type { Change, Lanes } from './describe';
import { describeVersion } from './describe-version';

/** One home's history row (sync/index.ts `AcceptedHistoryRow`, sync/local-kernel.ts `LocalHistoryRow`). */
export interface HistoryRowLike {
  revision: number;
  actionId: string;
  actor: string;
  mine: boolean;
  kind: string;
  label: string | null;
  committedAt: number;
  undoes: string | string[] | null;
  canvases: string[];
  lanes?: Record<string, string[]>;
  named?: { rev: number; name: string | null };
  runId?: string;
  chatId?: string;
  madeAt?: number;
  partial?: true;
}

export type VersionLane = 'html' | 'css' | 'meta';

/** The part of `ctx.syncControl.current()` Version history reads. Every method is optional. */
export interface VersionsRuntime {
  acceptedHistory?(q: {
    limit?: number;
    before?: number | null;
    path?: string | null;
    kind?: string | null;
  }): Promise<HistoryRowLike[] | null | unknown[]>;
  acceptedVersion?(repoRel: string, revision: number, lane?: VersionLane): Promise<string | null>;
}

/** A commit of the hub's git (`/api/history` via cloud/endpoints.ts `history`). */
export interface GitEntry {
  sha: string;
  message: string;
  author: string;
  date: string;
}

/** A legacy hub's row: one per commit, no AI / People split, no names (§5.14). */
export interface GitRow {
  id: `git:${string}`;
  ref: `git:${string}`;
  from: null;
  canvas: string;
  who: { kind: 'person'; actor: string; name: string; you: false };
  kind: 'edit';
  title: string;
  sub: string;
  chips: [];
  artboards: [];
  changes: 0;
  actions: [];
  thumb: { canvas: string; artboard: null; at: { sha: string }; size: 'row' } | null;
  madeAt: number;
}

export interface ListVersionsInput {
  runtime: VersionsRuntime | null | undefined;
  /** Repo-relative canvas path (`.design/ui/a.tsx`) — what the homes take. */
  repoRel: string;
  /** Design-root-relative (`ui/a.tsx`) — what history rows carry. */
  canvas: string;
  before?: number | null;
  /** ≤ 100. Default 50. */
  limit?: number;
  filter?: RowFilter;
  scope?: 'canvas-only' | 'project';
  cache?: AttributionCache | null;
  /** Actor id → a display name ("Jonas"). */
  actorName?: (actor: string) => string | undefined;
  /** How many visible versions one page may read back (default 2000). */
  lookBack?: number;
  /** A legacy hub's git history of this canvas; null / absent = none. */
  gitHistory?: (limit: number) => Promise<GitEntry[] | null | undefined>;
  reduce?: Pick<ReduceOptions, 'clock' | 'formatTime' | 'artboardLabel' | 'pictures'>;
}

export type VersionsAnswer =
  | { ok: true; source: 'accepted'; rows: VersionRow[]; newest: number | null; next?: number }
  | { ok: true; source: 'git'; rows: GitRow[]; newest: null }
  | { ok: true; source: 'none'; rows: []; newest: null }
  | { ok: false; reason: 'unreachable' };

export const MAX_LIMIT = 100;
const PAGE = 200;
const VERSION_LANES = new Set(['html', 'css', 'meta', 'annotations', '@manifest']);
const NOT_A_VERSION = new Set(['name', 'comment']);

/**
 * §5.1 visible versions: a version lane or `@manifest` on the canvas, not `name` / `comment`;
 * an `aside` by its `@aside` body.
 */
export function isVisibleVersion(r: HistoryRowLike, canvas: string): boolean {
  if (NOT_A_VERSION.has(r.kind)) return false;
  if (!r.canvases.includes(canvas)) return false;
  const lanes = r.lanes?.[canvas];
  // A home without per-canvas lanes (an older runtime) cannot tell comments-only apart.
  if (!lanes) return true;
  // A version nobody kept is a row of its own ("Your version, not kept") with only its body.
  if (r.kind === 'aside') return lanes.includes('@aside');
  return lanes.some((l) => VERSION_LANES.has(l));
}

const QUOTED = /“([^”]+)”/;
const NAME_OF = (p: string) => (p.split('/').pop() ?? p).replace(/\.(tsx|html)$/i, '');

function undoVia(r: HistoryRowLike): RowVersion['undoVia'] {
  if (r.label === 'Undo' || r.label === 'Redo') return 'keys';
  if (r.label === 'Undo this chat') return 'chat';
  return 'panel';
}

/** A history row as the reducer's `RowVersion` (words filled in later). */
export function toRowVersion(
  r: HistoryRowLike,
  canvas: string,
  actorName?: (actor: string) => string | undefined
): RowVersion {
  const isUndo = r.kind === 'undo' || r.kind === 'redo';
  const name = actorName?.(r.actor);
  const quoted = r.label ? QUOTED.exec(r.label)?.[1] : undefined;
  return {
    rev: r.revision,
    actionId: r.actionId,
    actor: r.actor,
    ...(name ? { actorName: name } : {}),
    mine: r.mine,
    kind: r.kind,
    label: r.label,
    madeAt: r.madeAt ?? r.committedAt,
    ...(r.partial ? { partial: true } : {}),
    ...(r.runId ? { runId: r.runId } : {}),
    ...(r.chatId ? { chatId: r.chatId } : {}),
    ...(r.undoes ? { undoes: Array.isArray(r.undoes) ? r.undoes : [r.undoes] } : {}),
    ...(isUndo ? { undoVia: undoVia(r) } : {}),
    ...(isUndo && undoVia(r) === 'chat' ? { undid: { chat: true } } : {}),
    canvas,
    artboards: [],
    changes: [],
    ...(r.kind === 'ai' && r.label ? { prompt: r.label } : {}),
    ...(r.kind === 'trash' || r.kind === 'canvas.delete'
      ? { trashedLabel: quoted ?? NAME_OF(canvas) }
      : {}),
    ...(r.kind === 'restore' || r.kind === 'history.restore' ? { restored: {} } : {}),
    alsoOn: Math.max(0, r.canvases.length - 1),
  };
}

/**
 * The canvas's names (§5.4): the newest name write per target wins, `null` clears it. Read from
 * the `name` actions (`kind` filter; rows re-checked, so an older home that ignores it is fine).
 */
export async function collectNames(
  runtime: VersionsRuntime,
  repoRel: string,
  canvas: string,
  actorName?: (actor: string) => string | undefined
): Promise<RowName[]> {
  const rows = ((await runtime.acceptedHistory?.({ path: repoRel, kind: 'name', limit: PAGE })) ??
    []) as HistoryRowLike[];
  const byTarget = new Map<number, RowName>();
  for (const r of [...rows].sort((a, b) => a.revision - b.revision)) {
    if (r.kind !== 'name' || !r.named || !r.canvases.includes(canvas)) continue;
    if (r.named.name === null) {
      byTarget.delete(r.named.rev);
      continue;
    }
    const byName = r.mine ? 'You' : actorName?.(r.actor);
    byTarget.set(r.named.rev, {
      rev: r.named.rev,
      name: r.named.name,
      by: r.actor,
      ...(byName ? { byName } : {}),
      at: r.madeAt ?? r.committedAt,
    });
  }
  return [...byTarget.values()];
}

interface Walk {
  /** Visible versions, oldest → newest. */
  versions: RowVersion[];
  /** True when the walk reached the canvas's first version. */
  exhausted: boolean;
}

/** Read back from `before` until `enough(versions)` or the look-back cap. null = no history here. */
export async function historyVersions(
  runtime: VersionsRuntime,
  input: Pick<ListVersionsInput, 'repoRel' | 'canvas' | 'actorName'> & {
    before?: number | null;
    lookBack: number;
    enough: (descending: RowVersion[]) => boolean;
  }
): Promise<Walk | null> {
  const desc: RowVersion[] = [];
  let cursor = input.before ?? null;
  let exhausted = false;
  for (;;) {
    const page = (await runtime.acceptedHistory?.({
      path: input.repoRel,
      limit: PAGE,
      before: cursor,
    })) as HistoryRowLike[] | null | undefined;
    if (page === null || page === undefined) {
      if (cursor === (input.before ?? null)) return null;
      exhausted = true;
      break;
    }
    for (const r of page) {
      if (cursor !== null && r.revision >= cursor) continue; // an older home ignoring `before`
      if (isVisibleVersion(r, input.canvas))
        desc.push(toRowVersion(r, input.canvas, input.actorName));
    }
    if (page.length < PAGE) {
      exhausted = true;
      break;
    }
    const last = page[page.length - 1] as HistoryRowLike;
    if (cursor !== null && last.revision >= cursor) {
      exhausted = true; // no progress: stop rather than loop
      break;
    }
    cursor = last.revision;
    if (desc.length >= input.lookBack || input.enough(desc)) break;
  }
  return { versions: desc.reverse(), exhausted };
}

/** Indices (ascending) where a walk may start: hard breaks, plus 0 when it is the canvas's start. */
export function breakPoints(
  versions: readonly RowVersion[],
  namedRevs: ReadonlySet<number>,
  exhausted: boolean
): number[] {
  const out: number[] = [];
  for (let i = 0; i < versions.length; i++) {
    if (i === 0) {
      if (exhausted) out.push(0);
      continue;
    }
    if (isHardBreak(versions[i - 1] as RowVersion, versions[i] as RowVersion, namedRevs))
      out.push(i);
  }
  return out;
}

// ── words ──────────────────────────────────────────────────────────────────────────────────────

/** Reads a canvas's lanes at a revision, memoized for one request. */
export function laneReader(runtime: VersionsRuntime, repoRel: string) {
  const memo = new Map<number, Promise<Lanes>>();
  const read = (lane: VersionLane, rev: number) =>
    rev < 1
      ? Promise.resolve(null)
      : (runtime.acceptedVersion?.(repoRel, rev, lane) ?? Promise.resolve(null)).catch(() => null);
  return (rev: number): Promise<Lanes> => {
    let hit = memo.get(rev);
    if (!hit) {
      hit = Promise.all([read('html', rev), read('css', rev), read('meta', rev)]).then(
        ([tsx, css, meta]) => ({ tsx: tsx ?? '', css, meta, annotations: null })
      );
      memo.set(rev, hit);
    }
    return hit;
  };
}

/**
 * Fill each version's words: the cache, else computed from the lanes before / after it. Returns
 * each version's entry (with `detail`, the collapsed artboards' own lines) by action id.
 */
export async function fillWords(
  versions: RowVersion[],
  o: {
    runtime: VersionsRuntime;
    repoRel: string;
    canvas: string;
    cache?: AttributionCache | null;
    lanesAt?: (rev: number) => Promise<Lanes>;
  }
): Promise<Map<string, { changes: Change[]; detail: Record<string, Change[]> }>> {
  const lanesAt = o.lanesAt ?? laneReader(o.runtime, o.repoRel);
  const out = new Map<string, { changes: Change[]; detail: Record<string, Change[]> }>();
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i] as RowVersion;
    const hit = o.cache?.get(v.actionId, o.canvas);
    if (hit) {
      v.changes = hit.changes;
      out.set(v.actionId, hit);
      continue;
    }
    // Between two visible versions nothing else changed this canvas's lanes, so the version
    // before `v` is the previous one's after — one read per version, not two.
    const prev = versions[i - 1];
    const [before, after] = await Promise.all([
      lanesAt(prev ? prev.rev : v.rev - 1),
      lanesAt(v.rev),
    ]);
    const entry = o.cache
      ? attributionFor(o.cache, v.actionId, o.canvas, before, after)
      : describeVersion(o.canvas, before, after);
    v.changes = entry.changes as Change[];
    out.set(v.actionId, { changes: entry.changes, detail: entry.detail });
  }
  return out;
}

// ── the listing ────────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A legacy hub's commits as rows (§5.2 last line, §5.14 "rows per commit"). */
export function gitRows(
  entries: readonly GitEntry[],
  canvas: string,
  o: { clock?: (ms: number) => string; pictures?: boolean } = {}
): GitRow[] {
  const clock = o.clock ?? hhmm;
  const out: GitRow[] = [];
  for (const e of entries) {
    if (!/^[0-9a-f]{7,40}$/i.test(e.sha)) continue;
    const at = Date.parse(e.date);
    const madeAt = Number.isFinite(at) ? at : 0;
    const first = (e.message.split('\n')[0] ?? '').trim();
    const title = first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first || 'Saved version';
    const author = e.author || 'Someone';
    out.push({
      id: `git:${e.sha}`,
      ref: `git:${e.sha}`,
      from: null,
      canvas,
      who: { kind: 'person', actor: author, name: author, you: false },
      kind: 'edit',
      title,
      sub: `${clock(madeAt)} · ${author}`,
      chips: [],
      artboards: [],
      changes: 0,
      actions: [],
      thumb:
        o.pictures === false ? null : { canvas, artboard: null, at: { sha: e.sha }, size: 'row' },
      madeAt,
    });
  }
  return out;
}

export async function listVersions(input: ListVersionsInput): Promise<VersionsAnswer> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50) || 50, 1), MAX_LIMIT);
  const filter = input.filter ?? 'all';
  const runtime = input.runtime;
  const legacy = async (): Promise<VersionsAnswer> => {
    const entries = input.gitHistory ? await input.gitHistory(limit).catch(() => undefined) : null;
    if (entries === undefined) return { ok: false, reason: 'unreachable' };
    if (!entries) return { ok: true, source: 'none', rows: [], newest: null };
    // No names and no AI split on a legacy hub (§5.14): those filters list nothing.
    const rows =
      filter === 'named' || filter === 'ai' ? [] : gitRows(entries, input.canvas, input.reduce);
    return { ok: true, source: 'git', rows, newest: null };
  };
  if (!runtime?.acceptedHistory) return legacy();

  let names: RowName[];
  let walk: Walk | null;
  try {
    names = await collectNames(runtime, input.repoRel, input.canvas, input.actorName);
    const namedRevs = new Set(names.map((n) => n.rev));
    walk = await historyVersions(runtime, {
      repoRel: input.repoRel,
      canvas: input.canvas,
      actorName: input.actorName,
      before: input.before ?? null,
      lookBack: input.lookBack ?? 2000,
      enough: (desc) => {
        // limit + 1 hard breaks among what was read: the page's rows are then settled
        const asc = [...desc].reverse();
        return breakPoints(asc, namedRevs, false).length >= limit + 1;
      },
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (walk === null) return legacy();

  const namedRevs = new Set(names.map((n) => n.rev));
  const { versions, exhausted } = walk;
  const newest = input.before ? null : (versions[versions.length - 1]?.rev ?? null);
  if (!versions.length) return { ok: true, source: 'accepted', rows: [], newest };

  const breaks = breakPoints(versions, namedRevs, exhausted);
  // The walk starts at the (limit+1)-th hard break from the newest, else the oldest one known.
  const start =
    breaks.length >= limit + 1 ? (breaks[breaks.length - (limit + 1)] as number) : (breaks[0] ?? 0);
  const opts: ReduceOptions = { ...input.reduce, scope: input.scope ?? 'project' };
  const draft = reduceRows(versions.slice(start), names, opts).slice(0, limit);
  const oldest = draft[draft.length - 1] as VersionRow;
  const firstId = oldest.actions[0];
  const from = versions.findIndex((v) => v.actionId === firstId);
  const page = versions.slice(from);
  try {
    await fillWords(page, {
      runtime,
      repoRel: input.repoRel,
      canvas: input.canvas,
      cache: input.cache,
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  const rows = reduceRows(page, names, opts);
  const more = from > 0 || !exhausted;
  return {
    ok: true,
    source: 'accepted',
    rows: filterRows(rows, filter),
    newest,
    ...(more ? { next: (page[0] as RowVersion).rev } : {}),
  };
}
