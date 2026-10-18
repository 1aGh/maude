// Row titles and collapsing for version history (V2-1.9 §5.5.3 / §5.5.4, S1.10).
//
//   collapseChanges(changes, …)   an artboard with more than 12 lines, or whose elements were more than half
//                                 added or removed, becomes ONE line "Reworked <label> — 624 changes"; the
//                                 originals are returned per artboard for Compare to expand.
//   wordsTitle(changes)           the edit row's title: the first W1 change of the primary artboard by
//                                 priority + " + N more".
//   rowTitle(row)                 every row kind (CONTRACT §4 voice: curly quotes, no "we", real nouns).
//
// Pure; no I/O. A canvas-only session (`scope: 'canvas-only'`) never shows an AI prompt (it may name another
// canvas): its `ai` rows read as their words title (U4).

import type { Change } from './describe';
import { collapseSpace, plural, quote } from './describe-words';

// ── collapsing ──────────────────────────────────────────────────────────────────────────────

export const COLLAPSE_LINES = 12;
/** An artboard of a handful of elements is never "reworked" by the half rule alone. */
export const COLLAPSE_MIN_CHURN = 4;

export interface CollapseOptions {
  labelOf: (artboard: string) => string;
  /** Elements the artboard holds now (asked only for artboards whose added/removed churn could qualify). */
  elementCount?: (artboard: string) => number;
}

export interface Collapsed {
  changes: Change[];
  /** The original lines of each collapsed artboard, for Compare. */
  detail: Map<string, Change[]>;
}

export function collapseChanges(changes: Change[], opts: CollapseOptions): Collapsed {
  const touching = new Map<string, number[]>();
  changes.forEach((c, i) => {
    for (const k of c.artboards) {
      const l = touching.get(k);
      if (l) l.push(i);
      else touching.set(k, [i]);
    }
  });
  const collapsed: string[] = [];
  for (const [k, idx] of touching) {
    if (idx.length > COLLAPSE_LINES) {
      collapsed.push(k);
      continue;
    }
    let added = 0;
    let removed = 0;
    for (const i of idx) {
      const c = changes[i] as Change;
      if (c.kind === 'added') added += c.weight ?? 1;
      else if (c.kind === 'removed') removed += c.weight ?? 1;
    }
    const churn = added + removed;
    if (churn < COLLAPSE_MIN_CHURN || !opts.elementCount) continue;
    if (churn / (opts.elementCount(k) + removed) > 0.5) collapsed.push(k);
  }
  if (!collapsed.length) return { changes, detail: new Map() };

  const set = new Set(collapsed);
  const detail = new Map<string, Change[]>();
  const firstDropped = new Map<number, string[]>();
  const dropped = new Set<number>();
  changes.forEach((c, i) => {
    if (c.artboards.length && c.artboards.every((k) => set.has(k))) dropped.add(i);
  });
  for (const k of collapsed) {
    const idx = touching.get(k) as number[];
    detail.set(
      k,
      idx.map((i) => changes[i] as Change)
    );
    const first = idx.find((i) => dropped.has(i));
    if (first === undefined) continue;
    const l = firstDropped.get(first);
    if (l) l.push(k);
    else firstDropped.set(first, [k]);
  }
  const out: Change[] = [];
  changes.forEach((c, i) => {
    for (const k of firstDropped.get(i) ?? [])
      out.push({
        artboards: [k],
        grade: 'W1',
        kind: 'layout',
        words: `Reworked ${opts.labelOf(k)} — ${plural((detail.get(k) as Change[]).length, 'change', 'changes')}`,
        prop: 'reworked',
      });
    if (!dropped.has(i)) out.push(c);
  });
  return { changes: out, detail };
}

// ── the words title ─────────────────────────────────────────────────────────────────────────

/** Lower is more important: artboard added/removed/renamed > element added/removed > text > style > data > other. */
function rank(c: Change): number {
  if (c.prop === 'reworked') return 0;
  switch (c.kind) {
    case 'artboard-added':
    case 'artboard-removed':
    case 'artboard-renamed':
      return 0;
    case 'added':
    case 'removed':
    case 'wrapped':
    case 'unwrapped':
    case 'section':
      return 1;
    case 'text':
    case 'canvas-text':
    case 'content':
      return 2;
    case 'style':
    case 'css':
    case 'attr':
    case 'class':
      return 3;
    case 'data':
      return 4;
    default:
      return 5;
  }
}

function best(cs: Change[], grade: Change['grade']): Change | undefined {
  let pick: Change | undefined;
  for (const c of cs) if (c.grade === grade && (!pick || rank(c) < rank(pick))) pick = c;
  return pick;
}

export function wordsTitle(changes: Change[]): string {
  if (!changes.length) return 'No visible change';
  const per = new Map<string, number>();
  for (const c of changes) for (const k of c.artboards) per.set(k, (per.get(k) ?? 0) + 1);
  let primary: string | null = null;
  let most = 0;
  for (const [k, n] of per)
    if (n > most) {
      most = n;
      primary = k;
    }
  const local =
    primary === null
      ? changes.filter((c) => !c.artboards.length)
      : changes.filter((c) => c.artboards.includes(primary as string));
  const pick =
    best(local, 'W1') ??
    best(local, 'W2') ??
    best(changes, 'W1') ??
    best(changes, 'W2') ??
    changes.find((c) => c.grade === 'F') ??
    (changes[0] as Change);
  const more = changes.length - 1;
  return more > 0 ? `${pick.words} + ${more} more` : pick.words;
}

// ── row titles ──────────────────────────────────────────────────────────────────────────────

export type RowKind =
  | 'edit'
  | 'named'
  | 'ai'
  | 'restore'
  | 'undo'
  | 'outside'
  | 'trash'
  | 'baseline'
  | 'aside';

export interface RowSpec {
  kind: RowKind;
  /** The words of the row (after collapsing). */
  changes: Change[];
  /** `named`. */
  name?: string;
  /** `ai`: the prompt of the run. */
  prompt?: string;
  /** `ai`: a canvas-only session never shows a prompt (it may name another canvas). */
  scope?: 'canvas-only' | 'project';
  restored?: { name?: string; at?: number; onlyArtboard?: string };
  undid?: { title?: string; chat?: boolean; changes?: number };
  /** `trash`: the canvas or artboard label. */
  label?: string;
  /** `aside`: "You" or the person's first name. */
  actor?: string;
  /** `restore`: the action's own label, when `restored` carries nothing (S1.14). */
  actionLabel?: string;
}

export interface RowTitle {
  title: string;
  sub?: string;
}

export interface TitleOptions {
  /** "6 Oct, 14:05". Default: local time, 24-hour. */
  formatTime?: (ms: number) => string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const PROMPT_TITLE_MAX = 60;

function shorten(s: string, max: number): string {
  const t = collapseSpace(s);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function rowTitle(row: RowSpec, opts: TitleOptions = {}): RowTitle {
  const fmt = opts.formatTime ?? formatTime;
  const words = (): string => wordsTitle(row.changes);
  switch (row.kind) {
    case 'named':
      return { title: row.name?.trim() ? shorten(row.name, 80) : words() };
    case 'ai': {
      const p = row.prompt ? collapseSpace(row.prompt) : '';
      if (!p || row.scope === 'canvas-only') return { title: words() };
      return { title: shorten(p, PROMPT_TITLE_MAX) };
    }
    case 'restore': {
      const r = row.restored ?? {};
      // The kernel keeps only the action's label ("Restored “<name>”", "Restored <label> to 5 Oct, 18:40",
      // "Went back to 14:05"); with nothing structured to say it better, the row says that (S1.14).
      if (!r.name && r.at === undefined && !r.onlyArtboard && row.actionLabel?.trim())
        return { title: shorten(row.actionLabel, 80) };
      const what = r.name ? quote(r.name, 40) : r.at !== undefined ? fmt(r.at) : 'a version';
      return { title: `Restored ${what}${r.onlyArtboard ? ` — only ${r.onlyArtboard}` : ''}` };
    }
    case 'undo': {
      const u = row.undid ?? {};
      if (u.chat)
        return {
          title: `Undid a chat${u.changes !== undefined ? ` — ${plural(u.changes, 'change', 'changes')}` : ''}`,
        };
      return { title: u.title ? `Undid ${quote(u.title, 40)}` : 'Undid a change' };
    }
    case 'outside':
      return { title: words(), sub: '· changed outside Maude' };
    case 'trash':
      return { title: `Moved ${quote(row.label ?? 'canvas', 40)} to the trash` };
    case 'baseline':
      return { title: 'Version history starts here' };
    case 'aside': {
      const who = row.actor && row.actor !== 'You' ? `${row.actor}'s` : 'Your';
      return { title: `${who} version, not kept` };
    }
    default:
      return { title: words() };
  }
}
