// "What changed between A and B" — Compare's list and its blame (V2-1.9 §5.7, §5.11; S1.12b).
//
//   parseRef(v)              `r<n>` · `git:<sha>` · `now` → a ref, or null
//   describeBetween(input)   { changes, detail, blame } — the words between two versions of ONE canvas
//
// Blame: each line names the row that made it — the newest row in (A, B] whose own cached description
// has a change with the same key (artboard + element + kind + property). None found → no entry
// ("changed in between"). Rows come from the same hard-break walk the listing uses, so a blamed row id
// is the id the panel shows. Only revisions blame; a `git:` side has no rows to point at.

import type { RowVersion, VersionRow } from '../client/v2/history/rows';
import { reduceRows } from '../client/v2/history/rows';
import type { AttributionCache } from '../index/extractors/attribution-cache';
import type { Change, Lanes } from './describe';
import { describeVersion } from './describe-version';
import {
  breakPoints,
  collectNames,
  fillWords,
  historyVersions,
  laneReader,
  type VersionLane,
  type VersionsRuntime,
} from './versions';

export type ParsedRef =
  | { kind: 'rev'; rev: number }
  | { kind: 'git'; sha: string }
  | { kind: 'now' };

const REV = /^r([1-9]\d{0,11})$/;
const GIT = /^git:([0-9a-f]{7,40})$/i;

export function parseRef(v: unknown): ParsedRef | null {
  if (v === 'now') return { kind: 'now' };
  if (typeof v !== 'string') return null;
  const r = REV.exec(v);
  if (r) return { kind: 'rev', rev: Number(r[1]) };
  const g = GIT.exec(v);
  if (g) return { kind: 'git', sha: (g[1] as string).toLowerCase() };
  return null;
}

export interface ChangesInput {
  runtime: VersionsRuntime | null | undefined;
  repoRel: string;
  canvas: string;
  from: ParsedRef;
  to: ParsedRef;
  cache?: AttributionCache | null;
  /** A commit's lane of this canvas (legacy / Advanced `git:` refs). */
  gitLane?: (sha: string, lane: VersionLane) => Promise<string | null>;
  lookBack?: number;
}

export type ChangesAnswer =
  | {
      ok: true;
      from: string;
      to: string;
      changes: Change[];
      detail: Record<string, Change[]>;
      blame: Record<number, string>;
    }
  | { ok: false; reason: 'unreachable' | 'legacy' | 'not-found' };

/** The key two descriptions agree on for one line (§5.7). */
export function changeKey(c: Change): string {
  const el = c.element ? JSON.stringify(c.element) : '';
  return `${c.artboards.join(',')}|${el}|${c.kind}|${c.prop ?? ''}`;
}

const refString = (r: ParsedRef): string =>
  r.kind === 'rev' ? `r${r.rev}` : r.kind === 'git' ? `git:${r.sha}` : 'now';

/** The canvas's newest visible version, or null before the first. */
async function newestRev(runtime: VersionsRuntime, input: ChangesInput): Promise<number | null> {
  const walk = await historyVersions(runtime, {
    repoRel: input.repoRel,
    canvas: input.canvas,
    lookBack: 1,
    enough: (desc) => desc.length >= 1,
  });
  return walk?.versions[walk.versions.length - 1]?.rev ?? null;
}

export async function describeBetween(input: ChangesInput): Promise<ChangesAnswer> {
  const runtime = input.runtime;
  const needsStore = input.from.kind !== 'git' || input.to.kind !== 'git';
  if (needsStore && !runtime?.acceptedHistory) return { ok: false, reason: 'legacy' };
  const lanesAt = runtime ? laneReader(runtime, input.repoRel) : null;
  const gitLanes = async (sha: string): Promise<Lanes | null> => {
    if (!input.gitLane) return null;
    const [tsx, css, meta] = await Promise.all([
      input.gitLane(sha, 'html'),
      input.gitLane(sha, 'css'),
      input.gitLane(sha, 'meta'),
    ]);
    return tsx === null ? null : { tsx, css, meta, annotations: null };
  };
  try {
    let to = input.to;
    if (to.kind === 'now') {
      const rev = await newestRev(runtime as VersionsRuntime, input);
      if (rev === null) return { ok: false, reason: 'not-found' };
      to = { kind: 'rev', rev };
    }
    const sideOf = async (r: ParsedRef): Promise<Lanes | null> => {
      if (r.kind === 'git') return gitLanes(r.sha);
      if (r.kind === 'rev') return (lanesAt as (rev: number) => Promise<Lanes>)(r.rev);
      return null;
    };
    const [a, b] = await Promise.all([sideOf(input.from), sideOf(to)]);
    if (!a || !b) return { ok: false, reason: 'not-found' };
    const words = describeVersion(input.canvas, a, b);
    const blame =
      input.from.kind === 'rev' && to.kind === 'rev' && runtime
        ? await blameLines(runtime, input, input.from.rev, to.rev, words.changes, lanesAt)
        : {};
    return {
      ok: true,
      from: refString(input.from),
      to: refString(to),
      changes: words.changes,
      detail: words.detail,
      blame,
    };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/** change index → the id of the newest row in (from, to] that made a line with the same key. */
async function blameLines(
  runtime: VersionsRuntime,
  input: ChangesInput,
  fromRev: number,
  toRev: number,
  changes: readonly Change[],
  lanesAt: ((rev: number) => Promise<Lanes>) | null
): Promise<Record<number, string>> {
  const lo = Math.min(fromRev, toRev);
  const hi = Math.max(fromRev, toRev);
  if (lo === hi || !changes.length) return {};
  const names = await collectNames(runtime, input.repoRel, input.canvas);
  const namedRevs = new Set(names.map((n) => n.rev));
  const firstAfter = (asc: RowVersion[]) => asc.findIndex((v) => v.rev > lo);
  const walk = await historyVersions(runtime, {
    repoRel: input.repoRel,
    canvas: input.canvas,
    before: hi + 1,
    lookBack: input.lookBack ?? 2000,
    // read back past `lo` far enough to hold a hard break at or before (lo, hi]'s first version
    enough: (desc) => {
      const asc = [...desc].reverse();
      const idx = firstAfter(asc);
      if (idx <= 0) return false;
      return breakPoints(asc, namedRevs, false).some((b) => b <= idx);
    },
  });
  if (!walk) return {};
  const { versions, exhausted } = walk;
  const idx = firstAfter(versions);
  if (idx < 0) return {};
  const breaks = breakPoints(versions, namedRevs, exhausted).filter((b) => b <= idx);
  const start = breaks.length ? (breaks[breaks.length - 1] as number) : 0;
  const inRange = versions.slice(idx).filter((v) => v.rev <= hi);
  const entries = await fillWords(inRange, {
    runtime,
    repoRel: input.repoRel,
    canvas: input.canvas,
    cache: input.cache,
    ...(lanesAt ? { lanesAt } : {}),
  });
  const rows: VersionRow[] = reduceRows(versions.slice(start), names);
  const rowOf = new Map<string, string>();
  for (const r of rows) for (const a of r.actions) rowOf.set(a, r.id);
  // newest version first: the first key match is the newest maker
  const maker = new Map<string, string>();
  for (const v of [...inRange].reverse()) {
    const e = entries.get(v.actionId);
    if (!e) continue;
    const lines = [...e.changes, ...Object.values(e.detail).flat()];
    for (const c of lines) {
      const k = changeKey(c);
      if (!maker.has(k)) maker.set(k, v.actionId);
    }
  }
  const out: Record<number, string> = {};
  changes.forEach((c, i) => {
    const actionId = maker.get(changeKey(c));
    const rowId = actionId ? rowOf.get(actionId) : undefined;
    if (rowId) out[i] = rowId;
  });
  return out;
}
