// Object-scoped history — "Version history · this object" (V2-1.9 §5.9, S1.16).
//
//   objectHistory(input) → the versions of ONE object, newest first, each row "<who> · <time>" + the value
//                          then, + Restore (the S1.13 object restore) where it can be trusted.
//
// Key: a canvas element (`<artboard>/<id>`, `data-cd-id`, V2-1.4 ElementRef) or an annotation element id
// (`.annotations.json` — a sticky, an arrow, a sticker). Derived on read from the same lanes and cached
// descriptions Version history uses; no second log (decision v2-V2-1.9-object-history-derived).
//
//   canvas element   a version is a row when its description (cached, `fillWords`) has a line whose
//                    `element.element` is the id: exact in every version that carries the id. Before the
//                    id was stamped the element is followed back by CHAINED MATCHING (describe-match's
//                    pairing, one version at a time) and the chain STOPS at the first step that is not
//                    a mutual best match with a clear margin — never a guess. Rows found that way are
//                    `matched: true` ("found by matching") and offer no Restore ("Restore the artboard
//                    instead.", restore-object.ts) because nobody authored an id to restore by.
//   annotation       exact by id: the element's record in the annotations lane before / after each
//                    version, worded by the annotations lane itself (describe-annotations.ts) over a
//                    board holding only that element — so the words are the Version history's.
//                    A version kept ASIDE in the same action (S9.24 Keep both: the loser's board rides
//                    inside the edit action as `@aside`) adds a "Your version, not kept" row when its
//                    record differs from the head's.
//
// Pure apart from the runtime / cache it is handed: no route, no access decision (routes/history.ts).
// Reading writes nothing — a Can view person gets the same answer an editor does.

import { type RowVersion, type RowWho, reduceRows } from '../client/v2/history/rows';
import type { AttributionCache } from '../index/extractors/attribution-cache';
import { type Change, type Lanes, parseModel, type TsxModel } from './describe';
import { describeAnnotations } from './describe-annotations';
import { type El, matchContainers, score, walkEls } from './describe-match';
import { quote } from './describe-words';
import { OBJECT_REFUSAL_LINE, type ObjectKey } from './restore-object';
import {
  fillWords,
  type HistoryRowLike,
  historyVersions,
  laneReader,
  type VersionsRuntime,
} from './versions';

/** The runtime Version history reads, plus the two reads object history adds (annotations, asides). */
export interface ObjectHistoryRuntime extends Omit<VersionsRuntime, 'acceptedVersion'> {
  acceptedVersion?(
    repoRel: string,
    revision: number,
    lane?: 'html' | 'css' | 'meta' | 'annotations',
    opts?: { aside?: boolean }
  ): Promise<string | null>;
}

export interface ObjectRow {
  /** `o<rev>` (+ `~aside` on a kept-aside row). */
  id: string;
  ref: `r${number}`;
  rev: number;
  actionId: string;
  who: RowWho;
  madeAt: number;
  /** The first line, in the Version history's words. */
  title: string;
  /** Every line this version said about the object. */
  lines: string[];
  /** "<who> · 18:40". */
  sub: string;
  what: 'added' | 'removed' | 'changed';
  /** The object's own text at this version, quoted ("“Číslo 25 cm — jinak…”"), when it has one. */
  value?: string;
  /** Followed back by matching, not by an authored id ("found by matching"). */
  matched: boolean;
  /** The version nobody kept (S9.24 Keep both / `history.aside`). */
  aside: boolean;
  /** `ok`: Restore works · `artboard`: only the artboard can be restored · `none`: no Restore here. */
  restore: 'ok' | 'artboard' | 'none';
  chips: string[];
}

export type ObjectStop =
  | { reason: 'start' } // the history's first version
  | { reason: 'created' } // added here: nothing earlier to find
  | { reason: 'ambiguous'; rev: number } // two candidates, no clear best
  | { reason: 'no-match'; rev: number }; // nothing in the earlier version pairs with it

export type ObjectHistoryAnswer =
  | {
      ok: true;
      key: string;
      /** "this sticky" · "this object" — the header's tail. */
      header: 'this sticky' | 'this object';
      rows: ObjectRow[];
      /** Only for a canvas element followed back by matching: where the chain ended. */
      stoppedAt?: ObjectStop;
      ms: number;
    }
  | { ok: false; reason: 'legacy' | 'unreachable' | 'not-found' };

export interface ObjectHistoryInput {
  runtime: ObjectHistoryRuntime | null | undefined;
  repoRel: string;
  canvas: string;
  key: ObjectKey;
  cache?: AttributionCache | null;
  actorName?: (actor: string) => string | undefined;
  lookBack?: number;
  /** "18:40" (default local 24-hour). */
  clock?: (ms: number) => string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A match is trusted only when every rival scores at least this far below it (`score` max ≈ 14). */
const MARGIN = 1;

interface Ctx {
  runtime: ObjectHistoryRuntime;
  input: ObjectHistoryInput;
  versions: RowVersion[];
  clock: (ms: number) => string;
}

const whoOf = (v: RowVersion): RowWho | null => {
  const r = reduceRows([v], [])[0];
  return r ? r.who : null;
};

function rowFor(
  ctx: Ctx,
  v: RowVersion,
  o: {
    lines: string[];
    what: ObjectRow['what'];
    value?: string;
    matched: boolean;
    aside?: boolean;
    title?: string;
  }
): ObjectRow | null {
  const who = whoOf(v);
  if (!who) return null;
  const aside = o.aside === true;
  const restore: ObjectRow['restore'] =
    aside || o.what === 'removed' ? 'none' : o.matched ? 'artboard' : 'ok';
  const chips: string[] = [];
  if (o.matched) chips.push('Found by matching');
  if (aside) chips.push('Not kept');
  const asideTitle = `${who.you ? 'Your' : `${who.name}’s`} version, not kept`;
  return {
    id: `o${v.rev}${aside ? '~aside' : ''}`,
    ref: `r${v.rev}`,
    rev: v.rev,
    actionId: v.actionId,
    who,
    madeAt: v.madeAt,
    title: o.title ?? (aside ? asideTitle : (o.lines[0] ?? 'Changed')),
    lines: o.lines,
    sub: `${who.name} · ${ctx.clock(v.madeAt)}`,
    what: o.what,
    ...(o.value ? { value: o.value } : {}),
    matched: o.matched,
    aside,
    restore,
    chips,
  };
}

// ── annotation elements ────────────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function recOf(text: string | null | undefined, id: string): Rec | null {
  if (!text?.trim()) return null;
  try {
    const b = JSON.parse(text) as { elements?: unknown };
    if (!Array.isArray(b.elements)) return null;
    const hit = b.elements.find((e) => (e as Rec | null)?.id === id);
    return hit && typeof hit === 'object' ? (hit as Rec) : null;
  } catch {
    return null;
  }
}

const boardOf = (rec: Rec | null): string | null =>
  rec ? JSON.stringify({ format: 'maude.annotations', v: 2, elements: [rec] }) : null;

const TEXT_SLOT: Record<string, string> = {
  sticky: 'text',
  text: 'text',
  shape: 'label',
  section: 'label',
};

function textNow(rec: Rec | null): string | undefined {
  if (!rec) return undefined;
  const slot = TEXT_SLOT[String(rec.type)];
  const t = slot ? rec[slot] : undefined;
  return typeof t === 'string' && t.trim() ? quote(t, 60) : undefined;
}

/** The words the annotations lane says for one element going from `a` to `b`. */
function annotationWords(canvas: string, a: Rec | null, b: Rec | null): string[] {
  const out = describeAnnotations({
    canvas,
    before: { tsx: '', annotations: boardOf(a) },
    after: { tsx: '', annotations: boardOf(b) },
    modelBefore: null,
    modelAfter: null,
    opts: {},
  });
  return out.map((c) => c.words);
}

/** Revisions whose action also kept a version aside for this canvas (S9.24 / `history.aside`). */
async function asideRevs(ctx: Ctx, lowest: number): Promise<Set<number>> {
  const { runtime, input } = ctx;
  const out = new Set<number>();
  let cursor: number | null = null;
  for (let page = 0; page < 20; page++) {
    const rows = (await runtime.acceptedHistory?.({
      path: input.repoRel,
      limit: 200,
      before: cursor,
    })) as HistoryRowLike[] | null | undefined;
    if (!rows?.length) break;
    for (const r of rows) {
      if (r.revision < lowest) return out;
      if (r.lanes?.[input.canvas]?.includes('@aside')) out.add(r.revision);
    }
    const last = rows[rows.length - 1] as HistoryRowLike;
    if (rows.length < 200 || (cursor !== null && last.revision >= cursor)) break;
    cursor = last.revision;
  }
  return out;
}

async function annotationRows(
  ctx: Ctx,
  id: string
): Promise<{ rows: ObjectRow[]; type: string | null }> {
  const { runtime, input, versions } = ctx;
  const read = (rev: number) =>
    rev < 1
      ? Promise.resolve(null)
      : (
          runtime.acceptedVersion?.(input.repoRel, rev, 'annotations') ?? Promise.resolve(null)
        ).catch(() => null);
  const memo = new Map<number, Promise<Rec | null>>();
  const at = (rev: number) => {
    let p = memo.get(rev);
    if (!p) {
      p = read(rev).then((t) => recOf(t, id));
      memo.set(rev, p);
    }
    return p;
  };
  const asides = await asideRevs(ctx, versions[0]?.rev ?? 0);
  const rows: ObjectRow[] = [];
  let type: string | null = null;
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i] as RowVersion;
    const [before, after] = await Promise.all([
      at(i > 0 ? (versions[i - 1] as RowVersion).rev : v.rev - 1),
      at(v.rev),
    ]);
    if (after?.type) type = String(after.type);
    else if (before?.type && !type) type = String(before.type);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      const lines = annotationWords(input.canvas, before, after);
      const what = !before ? 'added' : !after ? 'removed' : 'changed';
      const r = rowFor(ctx, v, {
        lines: lines.length
          ? lines
          : [what === 'added' ? 'Added' : what === 'removed' ? 'Removed' : 'Changed'],
        what,
        value: textNow(after ?? before),
        matched: false,
      });
      if (r) rows.push(r);
    }
    if (asides.has(v.rev) && runtime.acceptedVersion) {
      const body = await runtime
        .acceptedVersion(input.repoRel, v.rev, 'annotations', { aside: true })
        .catch(() => null);
      const kept = recOf(body, id);
      if (kept && JSON.stringify(kept) !== JSON.stringify(after)) {
        if (kept.type && !type) type = String(kept.type);
        const r = rowFor(ctx, v, {
          lines: annotationWords(input.canvas, after, kept),
          what: 'changed',
          value: textNow(kept),
          matched: false,
          aside: true,
        });
        if (r) rows.push(r);
      }
    }
  }
  return { rows, type };
}

// ── canvas elements ────────────────────────────────────────────────────────────────────────────

const printOf = (e: El): string => {
  const cls = e.classes.length ? `.${e.classes.join('.')}` : '';
  const text = e.text ? ` ${quote(e.text, 24)}` : '';
  return `${e.tag}${cls}${text}`;
};

const idPresent = (tsx: string, id: string): boolean =>
  new RegExp(
    `data-cd-id\\s*=\\s*(?:\\{\\s*)?["'\`]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`]`
  ).test(tsx);

const elementLines = (
  e: { changes: Change[]; detail: Record<string, Change[]> } | undefined
): Change[] => (e ? [...e.changes, ...Object.values(e.detail).flat()] : []);

function allEls(root: El): El[] {
  const out: El[] = [];
  walkEls(root, (e) => out.push(e));
  return out;
}

/** The ONE element carrying `id` (and the artboard it sits in); more or none → null. */
function findCur(model: TsxModel, id: string, prefer: string): { el: El; ab: string } | null {
  const hits: Array<{ el: El; ab: string }> = [];
  const keys = [prefer, ...model.artboards.map((a) => a.key).filter((k) => k !== prefer)];
  for (const ab of keys) {
    const t = model.tree(ab);
    if (!t) continue;
    for (const e of allEls(t)) if (e.cdId === id) hits.push({ el: e, ab });
    if (hits.length) break;
  }
  return hits.length === 1 ? (hits[0] as { el: El; ab: string }) : null;
}

/** `partner` is `cur`'s best match by a clear margin, in both directions (never a guess). */
function mutualBest(cur: El, partner: El, before: El, after: El): boolean {
  const s = score(partner, cur);
  if (s <= 0) return false;
  for (const o of allEls(before))
    if (o !== partner && o.tag === cur.tag && score(o, cur) >= s - MARGIN) return false;
  for (const o of allEls(after))
    if (o !== cur && o.tag === partner.tag && score(partner, o) >= s - MARGIN) return false;
  return true;
}

async function elementRows(
  ctx: Ctx,
  key: Extract<ObjectKey, { kind: 'element' }>
): Promise<{ rows: ObjectRow[]; stoppedAt?: ObjectStop }> {
  const { runtime, input, versions } = ctx;
  const lanesAt = laneReader(runtime as VersionsRuntime, input.repoRel);
  const entries = await fillWords(versions, {
    runtime: runtime as VersionsRuntime,
    repoRel: input.repoRel,
    canvas: input.canvas,
    cache: input.cache,
    lanesAt,
  });
  const lanes: Lanes[] = await Promise.all(versions.map((v) => lanesAt(v.rev)));
  const present = lanes.map((l) => idPresent(l.tsx, key.id));
  const models = new Map<number, TsxModel | null>();
  const modelAt = (i: number): TsxModel | null => {
    if (!models.has(i)) models.set(i, parseModel((lanes[i] as Lanes).tsx));
    return models.get(i) ?? null;
  };
  const valueAt = (i: number): string | undefined => {
    const m = modelAt(i);
    const hit = m ? findCur(m, key.id, key.artboard) : null;
    return hit?.el.text ? quote(hit.el.text, 60) : undefined;
  };

  const rows: ObjectRow[] = [];
  // 1. exact: by the authored id
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i] as RowVersion;
    const mine = elementLines(entries.get(v.actionId)).filter(
      (c) => c.element && 'element' in c.element && c.element.element === key.id
    );
    const was = i > 0 && (present[i - 1] as boolean);
    const is = present[i] as boolean;
    let what: ObjectRow['what'] | null = null;
    if (mine.length)
      what = mine.some((c) => c.kind === 'added')
        ? 'added'
        : mine.some((c) => c.kind === 'removed')
          ? 'removed'
          : 'changed';
    else if (!is && was) what = 'removed'; // its parent went: the subtree's lines name the parent
    if (!what) continue;
    const lines = mine.map((c) => c.words);
    const r = rowFor(ctx, v, {
      lines: lines.length ? lines : [what === 'added' ? 'Added' : 'Removed'],
      what,
      value: what === 'removed' ? undefined : valueAt(i),
      matched: false,
    });
    if (r) rows.push(r);
  }

  // 2. before the id was stamped: chained matching, stopping at the first doubt
  let stoppedAt: ObjectStop | undefined;
  const first = present.indexOf(true);
  if (first >= 0) {
    const created =
      first === 0
        ? false
        : elementLines(entries.get((versions[first] as RowVersion).actionId)).some(
            (c) =>
              c.element &&
              'element' in c.element &&
              c.element.element === key.id &&
              c.kind === 'added'
          );
    if (first === 0) stoppedAt = { reason: 'start' };
    else if (created) stoppedAt = { reason: 'created' };
    else {
      const stop = (reason: 'ambiguous' | 'no-match', at: number): void => {
        stoppedAt = { reason, rev: (versions[at] as RowVersion).rev };
      };
      const m0 = modelAt(first);
      const start = m0 ? findCur(m0, key.id, key.artboard) : null;
      if (!start) stop('no-match', first);
      else {
        let cur = start.el;
        const ab = start.ab;
        for (let j = first; j > 0; j--) {
          const mb = modelAt(j);
          const ma = modelAt(j - 1);
          const ta = ma?.tree(ab) ?? null;
          const tb = mb?.tree(ab) ?? null;
          if (!ta || !tb) {
            stop('no-match', j - 1);
            break;
          }
          const partner = matchContainers([[ta, tb]]).b2a.get(cur);
          if (!partner) {
            stop('no-match', j - 1);
            break;
          }
          if (!mutualBest(cur, partner, ta, tb)) {
            stop('ambiguous', j - 1);
            break;
          }
          // the lines of version j about this element: its print on either side — and only when
          // no other element of the artboard shares it (a shared print names nobody)
          if (cur.cdId === null) {
            const pa = printOf(partner);
            const pb = printOf(cur);
            const clash = (root: El, p: string) =>
              allEls(root).filter((e) => printOf(e) === p).length > 1;
            if (clash(tb, pb) || clash(ta, pa)) {
              stop('ambiguous', j - 1);
              break;
            }
            const v = versions[j] as RowVersion;
            const mine = elementLines(entries.get(v.actionId)).filter(
              (c) =>
                c.element &&
                'print' in c.element &&
                c.element.artboard === ab &&
                (c.element.print === pb || c.element.print === pa)
            );
            if (mine.length) {
              const r = rowFor(ctx, v, {
                lines: mine.map((c) => c.words),
                what: mine.some((c) => c.kind === 'added')
                  ? 'added'
                  : mine.some((c) => c.kind === 'removed')
                    ? 'removed'
                    : 'changed',
                value: cur.text ? quote(cur.text, 60) : undefined,
                matched: true,
              });
              if (r) rows.push(r);
            }
          }
          cur = partner;
          if (j === 1) stoppedAt = { reason: 'start' };
        }
      }
    }
  }
  return { rows, stoppedAt };
}

// ── entry ──────────────────────────────────────────────────────────────────────────────────────

export async function objectHistory(input: ObjectHistoryInput): Promise<ObjectHistoryAnswer> {
  const t0 = performance.now();
  const runtime = input.runtime;
  if (!runtime?.acceptedHistory) return { ok: false, reason: 'legacy' };
  try {
    const walk = await historyVersions(runtime as VersionsRuntime, {
      repoRel: input.repoRel,
      canvas: input.canvas,
      actorName: input.actorName,
      lookBack: input.lookBack ?? 2000,
      enough: () => false,
    });
    if (!walk) return { ok: false, reason: 'legacy' };
    const ctx: Ctx = { runtime, input, versions: walk.versions, clock: input.clock ?? hhmm };
    const key = input.key;
    let rows: ObjectRow[];
    let stoppedAt: ObjectStop | undefined;
    let header: 'this sticky' | 'this object' = 'this object';
    if (key.kind === 'annotation') {
      const r = await annotationRows(ctx, key.id);
      rows = r.rows;
      if (r.type === 'sticky') header = 'this sticky';
    } else {
      const r = await elementRows(ctx, key);
      rows = r.rows;
      stoppedAt = r.stoppedAt;
    }
    if (!rows.length) return { ok: false, reason: 'not-found' };
    rows.sort((a, b) => b.rev - a.rev || Number(a.aside) - Number(b.aside));
    return {
      ok: true,
      key: key.kind === 'annotation' ? key.id : `${key.artboard}/${key.id}`,
      header,
      rows,
      ...(stoppedAt ? { stoppedAt } : {}),
      ms: performance.now() - t0,
    };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

export { OBJECT_REFUSAL_LINE };
