// edit-ops/references.ts — the durable references to an element id beside a canvas's source
// (S2.2b, `element.set-id`; V2-1.4 §5.5 "rename `data-cd-id` AND every durable reference to it in
// the same action").
//
// What points at an element id of ONE canvas, outside its `.tsx`:
//   comments  `_comments/<slug>.json` (the canvas doc's comments lane) — an element comment's
//             `selector` holds `[data-cd-id="<id>"]`, optionally scoped `[data-dc-screen="<ab>"] …`
//             (dom-selection.ts `scopedCdSelector`). `dom_path`, `html_excerpt` are snapshots of
//             the DOM at pin time and stay as they were.
//   board     `<slug>.annotations.json` — every `el:<artboard>/<id>[#n]` host ref (V2-1.4 §4.8):
//             an arrow's `startHost.ref` / `endHost.ref`, a stamp's `target`, a vote's `targets[]`
//             and `tallies` keys, a ballot's `picks` keys.
// Nothing else does: `.meta.json` names artboards only (present order/skip, per-artboard notes), a
// lock is `data-cd-locked` in the source itself, and a running AI run's scope/objects is refused
// by the dispatcher (`held-by-ai`), never rewritten.
//
// An id is unique per canvas file (V2-1.4 §4.2), so every ref naming it on THIS canvas — whatever
// artboard it is scoped to — points at the same source element and follows the rename. Other
// canvases are never read or written.
//
// The rewriters below are pure. `createReferenceLanes` binds them to the studio's own comment and
// board write paths (room-aware: a live room is ahead of the file), so a rename reaches peers the
// way any comment or annotation edit does.

import { parseHostRef } from '../annotations/elements/_shared.ts';
import type { Op as AnnotationOp } from '../annotations/ops.ts';
import { parseBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import type { IdRename } from './types.ts';

// ── comments ──────────────────────────────────────────────────────────────────────────────

const cdToken = (id: string) => `[data-cd-id="${id}"]`;

/** Does this comment record point at element `id` (by its selector)? */
export function commentNames(c: unknown, id: string): boolean {
  const sel = (c as { selector?: unknown } | null)?.selector;
  return typeof sel === 'string' && sel.includes(cdToken(id));
}

/**
 * The comment list with every selector naming `from` renamed to `to`; `changed` = how many records.
 * Every other key of a record is kept verbatim (V2-1.12 §5.1: a Maude 1 reader keeps what it does
 * not know, and this writer invents nothing).
 */
export function renameInComments<C>(
  list: readonly C[],
  r: IdRename
): { list: C[]; changed: number } {
  let changed = 0;
  const out = list.map((c) => {
    if (!commentNames(c, r.from)) return c;
    changed++;
    const sel = (c as { selector: string }).selector;
    return { ...c, selector: sel.split(cdToken(r.from)).join(cdToken(r.to)) };
  });
  return { list: out, changed };
}

// ── the board ─────────────────────────────────────────────────────────────────────────────

/** `el:<ab>/<from>[#n]` → `el:<ab>/<to>[#n]`; any other value → null (not ours). */
export function renameHostRef(ref: unknown, r: IdRename): string | null {
  const p = parseHostRef(ref);
  if (!p || p.kind !== 'el' || p.element !== r.from) return null;
  return `el:${p.artboard}/${r.to}${p.occurrence === undefined ? '' : `#${p.occurrence}`}`;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** The fields of one board element that would change; empty when it names no `from`. */
function renamedFields(el: AnnotationElement, r: IdRename): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const key of ['startHost', 'endHost'] as const) {
    const h = el[key];
    if (!isRec(h)) continue;
    const ref = renameHostRef(h.ref, r);
    if (ref) set[key] = { ...h, ref };
  }
  const t = renameHostRef(el.target, r);
  if (t) set.target = t;
  if (Array.isArray(el.targets)) {
    let hit = false;
    const next = el.targets.map((v) => {
      const n = renameHostRef(v, r);
      if (n) hit = true;
      return n ?? v;
    });
    if (hit) set.targets = next;
  }
  for (const key of ['tallies', 'picks'] as const) {
    const m = el[key];
    if (!isRec(m)) continue;
    let hit = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(m)) {
      const n = renameHostRef(k, r);
      if (n) hit = true;
      const at = n ?? k;
      // Two keys can only meet if the board already named `to` — the caller refuses that first.
      next[at] = typeof next[at] === 'number' && typeof v === 'number' ? next[at] + v : v;
    }
    if (hit)
      set[key] = Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  return set;
}

/** Board elements that point at element `id` (any field above). */
export function boardNames(elements: readonly AnnotationElement[], id: string): number {
  const probe = { from: id, to: id };
  return elements.filter((el) => Object.keys(renamedFields(el, probe)).length > 0).length;
}

/**
 * One `patch` op per board element naming `from`. `expect` carries what was there, so the board's
 * one merge rule (annotations/ops.ts) treats it like any other field edit: a peer's later change
 * to another field of that element survives.
 */
export function boardRenameOps(
  elements: readonly AnnotationElement[],
  r: IdRename
): AnnotationOp[] {
  const ops: AnnotationOp[] = [];
  for (const el of elements) {
    const set = renamedFields(el, r);
    const keys = Object.keys(set);
    if (!keys.length) continue;
    ops.push({
      op: 'patch',
      id: el.id,
      set,
      expect: Object.fromEntries(keys.map((k) => [k, el[k]])),
    });
  }
  return ops;
}

// ── the lanes, bound to the studio's write paths ──────────────────────────────────────────

/** How many references each lane holds to one id. */
export interface RefCount {
  comments: number;
  board: number;
}

export type RefCountResult = ({ ok: true } & RefCount) | { ok: false; message: string };

/** What the dispatcher asks of the reference lanes (`DispatchDeps.references`). */
export interface ReferenceLanes {
  /** References to `id` on canvas `rel` (designRoot-relative). A lane that can't be read is `ok:false`. */
  count(rel: string, id: string): Promise<RefCountResult>;
  /**
   * May a rename that moves references be ONE undo step here? False while the project is in
   * accepted-revisions mode: the kernel would take the source, the comments and the board as three
   * actions, and ⌘Z would undo one of them (decision v2-S2.2b-refuse-split-undo).
   */
  oneStep(): boolean;
  /** Move every reference of `rel` from `r.from` to `r.to`. Throws when a lane could not be written. */
  rename(rel: string, r: IdRename): Promise<RefCount>;
}

type BoardRead = { ok: true; text: string | null } | { ok: false; error: string };

export interface ReferenceIo {
  /** the comment list of a canvas (`api.loadCommentsForFile`) */
  loadComments(file: string): Promise<unknown[]>;
  /** load → `fn` → publish when `fn` returns a list (`api.rewriteComments`); null = no change */
  rewriteComments(file: string, fn: (list: unknown[]) => unknown[] | null): Promise<void>;
  /** the strict board read (`api.readBoard`) */
  readBoard(file: string): Promise<BoardRead>;
  /** the board's op path (`api.applyAnnotationOps`), live-room aware */
  applyBoardOps(
    file: string,
    ops: readonly AnnotationOp[]
  ): Promise<{ ok: boolean; changed?: boolean; error?: string }>;
  /** the linked project is in accepted-revisions mode right now */
  acceptedMode(): boolean;
  /** `.design` — api.ts keys comments and boards by the repo-relative canvas path */
  designRel: string;
}

export const UNREADABLE_REFS =
  'Not renamed: the comments or the board of this canvas can’t be read right now.';

export function createReferenceLanes(io: ReferenceIo): ReferenceLanes {
  const fileOf = (rel: string) => `${io.designRel.replace(/^\.\/|\/+$/g, '')}/${rel}`;
  const boardElements = async (rel: string): Promise<AnnotationElement[] | null> => {
    const read = await io.readBoard(fileOf(rel));
    if (!read.ok) return null;
    if (read.text === null) return [];
    const parsed = parseBoard(read.text);
    return parsed.elements;
  };
  return {
    async count(rel, id) {
      let list: unknown[];
      try {
        list = await io.loadComments(fileOf(rel));
      } catch {
        return { ok: false, message: UNREADABLE_REFS };
      }
      const els = await boardElements(rel);
      if (!els) return { ok: false, message: UNREADABLE_REFS };
      return {
        ok: true,
        comments: list.filter((c) => commentNames(c, id)).length,
        board: boardNames(els, id),
      };
    },
    oneStep: () => !io.acceptedMode(),
    async rename(rel, r) {
      const file = fileOf(rel);
      let comments = 0;
      await io.rewriteComments(file, (list) => {
        const out = renameInComments(list, r);
        comments = out.changed;
        return out.changed ? out.list : null;
      });
      const els = await boardElements(rel);
      if (!els) throw new Error(UNREADABLE_REFS);
      const ops = boardRenameOps(els, r);
      if (ops.length) {
        const res = await io.applyBoardOps(file, ops);
        if (!res.ok) throw new Error(res.error ?? UNREADABLE_REFS);
      }
      return { comments, board: ops.length };
    },
  };
}
