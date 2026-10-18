// Version history rows — the rule G reducer (V2-1.9 §5.1), shared by the server (`history/versions.ts`,
// `GET /_api/project/versions`) and the panel (S1.14). Pure; no I/O, no clock.
//
//   reduceRows(versions, opts)   one canvas's visible versions, oldest → newest → VersionRow[], newest first
//   filterRows(rows, filter)     All · Named · Made by AI · People
//   isHardBreak(prev, x)         x starts a row in EVERY walk (paging starts a walk only at one)
//   nowRow(input)                "Now · <canvas> · <save word>" + "Name this version…" / "Saving…"
//   rowKindOf(kind)              kernel action kind → row kind (null = not a row: name, comment, trash.clear)
//
// Rows are DERIVED, never stored: the thresholds below are constants of this file, changeable without a
// migration (Q1). Words come in already computed (S1.10's attribution cache); titles come from S1.10's
// `rowTitle`, so a canvas-only session's AI rows read as their words (U4) on both sides.

import type { Change } from '../../../history/describe';
import { formatTime as formatDayTime, type RowKind, rowTitle } from '../../../history/titles';

/** ≤ 10 min between two versions of one row. */
export const ROW_GAP_MS = 10 * 60_000;
/** ≤ 60 min from a row's first version to its last. */
export const ROW_SPAN_MS = 60 * 60_000;

export type VersionRowKind =
  | 'edit'
  | 'ai'
  | 'restore'
  | 'undo'
  | 'outside'
  | 'trash'
  | 'baseline'
  | 'aside'
  | 'moved';

export type RowChip = 'Named' | 'Made by AI' | 'Restored' | 'Stopped' | 'Not kept';

export type RowFilter = 'all' | 'named' | 'ai' | 'people';
export const ROW_FILTERS: readonly RowFilter[] = ['all', 'named', 'ai', 'people'];

/** One accepted action as one canvas sees it (V2-1.9 §5.1 `Version`, plus what a row's words need). */
export interface RowVersion {
  rev: number;
  actionId: string;
  actor: string;
  /** Display name of the actor ("Jonas"); "You" is chosen from `mine`. */
  actorName?: string;
  mine: boolean;
  /** The kernel's action kind (`edit`, `ai`, `undo`, `history.restore`, `migration.import`, …). */
  kind: string;
  label: string | null;
  /** The person's clock (origin `madeAt`), else the commit time. */
  madeAt: number;
  partial?: boolean;
  runId?: string;
  chatId?: string;
  undoes?: string[];
  /** How an undo was asked for: ⌘Z (`keys`) folds into a row; the panel and a chat undo are rows. */
  undoVia?: 'keys' | 'panel' | 'chat';
  canvas: string;
  /** Changed artboards (V2-1.5 §5.7). */
  artboards: string[];
  /** The version's words (collapsed), [] when not known yet. */
  changes: Change[];
  /** `ai`: the prompt of the run. */
  prompt?: string;
  /** `restore`: what it restored. */
  restored?: { name?: string; at?: number; onlyArtboard?: string };
  /** `undo`: what it undid. */
  undid?: { title?: string; chat?: boolean; changes?: number };
  /** `trash`: the artboard's or canvas's label. */
  trashedLabel?: string;
  /** How many OTHER canvases the action changed (project scope only; U5). */
  alsoOn?: number;
}

/** A name on a revision of the canvas (store `names`, V2-1.9 §5.4). */
export interface RowName {
  rev: number;
  name: string;
  by: string;
  /** Display name of who named it. */
  byName?: string;
  at: number;
}

export interface RowWho {
  kind: 'person' | 'ai' | 'outside';
  actor: string;
  name: string;
  you: boolean;
}

export interface RowThumb {
  canvas: string;
  artboard: string | null;
  at: { rev: number };
  size: 'row';
}

/** What Version history lists (V2-1.9 §5.1 `VersionRow`). */
export interface VersionRow {
  id: string;
  ref: `r${number}`;
  from: `r${number}` | null;
  canvas: string;
  who: RowWho;
  kind: VersionRowKind;
  title: string;
  sub: string;
  named?: { name: string; by: string; at: number };
  chips: RowChip[];
  artboards: string[];
  changes: number;
  actions: string[];
  thumb: RowThumb | null;
  /** Project scope only: how many other canvases the row's actions also changed. */
  alsoOn?: number;
  madeAt: number;
}

export interface ReduceOptions {
  /** A canvas-only session: AI rows read as their words, "also on N" is dropped. */
  scope?: 'canvas-only' | 'project';
  /** "14:32" in the sub line. Default local HH:MM. */
  clock?: (ms: number) => string;
  /** "5 Oct, 18:40" inside titles. Default S1.10's `formatTime`. */
  formatTime?: (ms: number) => string;
  /** Artboard id → label for the AI sub line. */
  artboardLabel?: (id: string) => string;
  /** Rows have pictures (false in a cloud browser tab, Q7). Default true. */
  pictures?: boolean;
}

const KIND: Record<string, VersionRowKind | null> = {
  edit: 'edit',
  ai: 'ai',
  undo: 'undo',
  redo: 'undo',
  restore: 'restore',
  'history.restore': 'restore',
  outside: 'outside',
  trash: 'trash',
  'canvas.delete': 'trash',
  'migration.import': 'baseline',
  aside: 'aside',
  'canvas.move': 'moved',
  move: 'moved',
  // decorations and comment traffic are never rows (§5.1 visible versions)
  name: null,
  comment: null,
  'trash.clear': null,
};

/** Kernel kind → row kind; any other kind is an edit. null = not a row. */
export function rowKindOf(kind: string): VersionRowKind | null {
  return Object.hasOwn(KIND, kind) ? (KIND[kind] as VersionRowKind | null) : 'edit';
}

function whoKind(v: RowVersion): RowWho['kind'] {
  const k = rowKindOf(v.kind);
  if (k === 'ai') return 'ai';
  if (k === 'outside') return 'outside';
  return 'person';
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Could `v` fold into an open edit row at all? (the version-local half of rule G) */
function folds(v: RowVersion): boolean {
  const k = rowKindOf(v.kind);
  if (k === 'edit') return true;
  return k === 'undo' && v.undoVia === 'keys';
}

/**
 * True when `x` starts a row in every walk, whatever version the walk began at: the gap rule, an actor or
 * kind change, or `prev` carrying a name. Paging (versions.ts) only ever starts a walk at a hard break, so a
 * page and the full history agree on every boundary.
 */
export function isHardBreak(
  prev: RowVersion | null,
  x: RowVersion,
  namedRevs: ReadonlySet<number> = new Set()
): boolean {
  if (!prev) return true;
  if (namedRevs.has(prev.rev)) return true;
  if (!folds(x)) return true;
  const pk = rowKindOf(prev.kind);
  // a ⌘Z undo may have folded into an edit row (or not): only certain breaks count
  if (pk !== 'edit' && !(pk === 'undo' && prev.undoVia === 'keys')) return true;
  if (prev.actor !== x.actor || whoKind(prev) !== whoKind(x)) return true;
  return x.madeAt - prev.madeAt > ROW_GAP_MS;
}

/** The revision each name decorates: the newest version at or before its target (§5.4 snap, again). */
function namesByRev(
  versions: readonly RowVersion[],
  names: readonly RowName[]
): Map<number, RowName> {
  const out = new Map<number, RowName>();
  if (!names.length || !versions.length) return out;
  const revs = versions.map((v) => v.rev); // ascending
  for (const n of names) {
    let lo = 0;
    let hi = revs.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((revs[mid] as number) <= n.rev) {
        hit = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (hit < 0) continue;
    const rev = revs[hit] as number;
    const prev = out.get(rev);
    if (!prev || n.at >= prev.at) out.set(rev, n); // newest write wins
  }
  return out;
}

interface OpenRow {
  kind: VersionRowKind;
  versions: RowVersion[];
}

/**
 * Rule G over one canvas's visible versions (ascending by `rev`). Returns rows newest first.
 * Versions of kinds that are not rows (`name`, `comment`, …) are skipped without ending a row.
 */
export function reduceRows(
  versions: readonly RowVersion[],
  names: readonly RowName[] = [],
  opts: ReduceOptions = {}
): VersionRow[] {
  const visible = versions.filter((v) => rowKindOf(v.kind) !== null);
  const named = namesByRev(visible, names);
  const groups: OpenRow[] = [];
  let open: OpenRow | null = null;
  for (const x of visible) {
    const kind = rowKindOf(x.kind) as VersionRowKind;
    if (open && joins(open, x, named)) {
      open.versions.push(x);
    } else {
      open = { kind, versions: [x] };
      groups.push(open);
    }
    if (named.has(x.rev))
      open = null; // a name ends its row there
    else if (open.kind !== 'edit') open = null; // every non-edit row is a row of its own
  }
  const rows = groups.map((g) => assemble(g, named, opts));
  return rows.reverse();
}

function joins(R: OpenRow, x: RowVersion, named: Map<number, RowName>): boolean {
  if (R.kind !== 'edit') return false;
  const first = R.versions[0] as RowVersion;
  const last = R.versions[R.versions.length - 1] as RowVersion;
  if (named.has(last.rev)) return false;
  const k = rowKindOf(x.kind);
  if (k === 'undo') {
    if (x.undoVia !== 'keys') return false;
    const inside = new Set(R.versions.map((v) => v.actionId));
    if (!x.undoes?.length || !x.undoes.every((id) => inside.has(id))) return false;
  } else if (k !== 'edit') return false;
  if (x.actor !== first.actor || whoKind(x) !== whoKind(first)) return false;
  if (x.madeAt - last.madeAt > ROW_GAP_MS) return false;
  return x.madeAt - first.madeAt <= ROW_SPAN_MS;
}

function orderArtboards(versions: readonly RowVersion[]): string[] {
  const count = new Map<string, number>();
  const seen: string[] = [];
  const bump = (id: string, n: number) => {
    if (!count.has(id)) seen.push(id);
    count.set(id, (count.get(id) ?? 0) + n);
  };
  for (const v of versions) {
    for (const c of v.changes) for (const a of c.artboards) bump(a, 1);
    for (const a of v.artboards) bump(a, 0);
  }
  return seen
    .map((id, i) => ({ id, i, n: count.get(id) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.id);
}

function assemble(g: OpenRow, named: Map<number, RowName>, opts: ReduceOptions): VersionRow {
  const first = g.versions[0] as RowVersion;
  const last = g.versions[g.versions.length - 1] as RowVersion;
  const clock = opts.clock ?? hhmm;
  const fmt = opts.formatTime ?? formatDayTime;
  const scope = opts.scope ?? 'project';
  const name = named.get(last.rev);
  const changes = g.versions.flatMap((v) => v.changes);
  const artboards = orderArtboards(g.versions);
  const wk = whoKind(first);
  const who: RowWho = {
    kind: wk,
    actor: first.actor,
    name: first.mine ? 'You' : (first.actorName ?? 'Someone'),
    you: first.mine,
  };
  const titleKind: RowKind = name ? 'named' : g.kind === 'moved' ? 'edit' : g.kind;
  const t = rowTitle(
    {
      kind: titleKind,
      changes,
      name: name?.name,
      prompt: first.prompt,
      scope,
      restored: first.restored,
      undid: first.undid,
      label: first.trashedLabel,
      actor: who.name,
      ...(g.kind === 'restore' && first.label ? { actionLabel: first.label } : {}),
    },
    { formatTime: fmt }
  );
  const title = g.kind === 'moved' && !name ? (first.label ?? 'Moved this canvas') : t.title;
  let sub: string;
  if (name)
    sub = `${clock(name.at)} · ${name.by === first.actor && first.mine ? 'You' : (name.byName ?? 'Someone')}`;
  else if (wk === 'ai') {
    const label = artboards[0] ? (opts.artboardLabel?.(artboards[0]) ?? artboards[0]) : who.name;
    sub = `${clock(last.madeAt)} · ${label}`;
  } else sub = `${clock(last.madeAt)} · ${who.name}`;
  if (t.sub && !name) sub = `${sub} ${t.sub}`;
  const chips: RowChip[] = [];
  if (name) chips.push('Named');
  if (g.kind === 'ai') chips.push('Made by AI');
  if (g.kind === 'restore') chips.push('Restored');
  if (g.versions.some((v) => v.partial)) chips.push('Stopped');
  if (g.kind === 'aside') chips.push('Not kept');
  const alsoOn = scope === 'project' ? Math.max(0, ...g.versions.map((v) => v.alsoOn ?? 0)) : 0;
  const createdHere = g.kind === 'baseline' || first.kind === 'canvas.create';
  return {
    id: first.actionId,
    ref: `r${last.rev}`,
    from: createdHere ? null : `r${first.rev - 1}`,
    canvas: last.canvas,
    who,
    kind: g.kind,
    title,
    sub,
    ...(name ? { named: { name: name.name, by: name.by, at: name.at } } : {}),
    chips,
    artboards,
    changes: changes.length,
    actions: g.versions.map((v) => v.actionId),
    thumb:
      opts.pictures === false || g.kind === 'trash'
        ? null
        : {
            canvas: last.canvas,
            artboard: artboards[0] ?? null,
            at: { rev: last.rev },
            size: 'row',
          },
    ...(alsoOn > 0 ? { alsoOn } : {}),
    madeAt: last.madeAt,
  };
}

/** All · Named · Made by AI · People (§5.1). `outside`, `baseline`, `aside` show under All only. */
export function filterRows(rows: readonly VersionRow[], filter: RowFilter): VersionRow[] {
  switch (filter) {
    case 'named':
      return rows.filter((r) => !!r.named);
    case 'ai':
      return rows.filter((r) => r.kind === 'ai');
    case 'people':
      return rows.filter((r) => r.who.kind === 'person' && !['baseline', 'aside'].includes(r.kind));
    default:
      return rows.slice();
  }
}

export function parseFilter(v: unknown): RowFilter | null {
  if (v === undefined || v === null || v === '') return 'all';
  return typeof v === 'string' && (ROW_FILTERS as readonly string[]).includes(v)
    ? (v as RowFilter)
    : null;
}

/** The save words the Now row may show (CONTRACT §6, C2). */
export type SaveWord = 'Saved' | 'Saving…' | 'Not sent yet' | 'Offline';

export interface NowRow {
  canvas: string;
  /** "Now · Pozvánka · Saved" */
  title: string;
  status: SaveWord;
  /** The newest accepted version the name would land on; null before the first version. */
  ref: `r${number}` | null;
  /** "Name this version…", or "Saving…" (disabled) while the canvas has unsent changes. */
  nameButton: { label: 'Name this version…' | 'Saving…'; enabled: boolean };
}

export function nowRow(input: {
  canvas: string;
  canvasLabel: string;
  status: SaveWord;
  newestRev: number | null;
  /** The person may name versions here (`edit` on the canvas). */
  canEdit: boolean;
}): NowRow {
  const unsent = input.status === 'Saving…' || input.status === 'Not sent yet';
  return {
    canvas: input.canvas,
    title: `Now · ${input.canvasLabel} · ${input.status}`,
    status: input.status,
    ref: input.newestRev === null ? null : `r${input.newestRev}`,
    nameButton: unsent
      ? { label: 'Saving…', enabled: false }
      : {
          label: 'Name this version…',
          enabled: input.canEdit && input.newestRev !== null && input.status !== 'Offline',
        },
  };
}

/** "Offline — showing versions up to 14:05" (§5.14, rows from the last fetch). */
export function offlineLine(lastFetchedAt: number, clock: (ms: number) => string = hhmm): string {
  return `Offline — showing versions up to ${clock(lastFetchedAt)}`;
}
