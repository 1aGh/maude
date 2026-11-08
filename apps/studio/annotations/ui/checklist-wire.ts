/**
 * @file       annotations/ui/checklist-wire.ts — the layer's checklist seams (#113 slice B, contract 113-checklist)
 * @scope      apps/studio/annotations/ui/checklist-wire.ts
 * @purpose    What `annotations-layer.tsx` asks before a checklist batch reaches the board, kept pure so it is
 *             tested without the 6 k-line layer:
 *               - `checklistCommitOps` — the lock net (`guardLockedLists`: a locked list still ticks, nothing
 *                 else) and the sticky's growth (`fitSticky(cur, text, items)`) in the SAME batch, so a gesture
 *                 stays one ⌘Z;
 *               - `itemsForCopy` / `splitPasteItems` / `itemPutsFor` — entries travel with a copied, pasted or
 *                 duplicated sticky (fresh ids, `list` remapped — `cloneItems`); a stray entry is dropped;
 *               - `isChecklistTarget` — a press or key inside an interactive checklist is the checklist's.
 *             The stroke view never carries entries (they have no geometry): every entry write goes as ops.
 */

import { cloneItems, guardLockedLists } from '../checklist-ops.ts';
import { DEFAULT_FONT_SIZE } from '../constants.ts';
import { itemsOf } from '../elements/checkitem.model.ts';
import { fitSticky } from '../elements/sticky.model.ts';
import { isLocked } from '../lock.ts';
import { applyOps, type Op } from '../ops.ts';
import type { AnnotationElement } from '../types.ts';

type Board = ReadonlyMap<string, AnnotationElement>;

/** The list (sticky id) an op touches through an entry, or a sticky whose title it re-words. */
function listsTouched(board: Board, ops: readonly Op[]): Set<string> {
  const out = new Set<string>();
  for (const o of ops) {
    if (o.op === 'put') {
      if (o.el.type === 'checkitem' && typeof o.el.list === 'string') out.add(o.el.list);
      continue;
    }
    const cur = board.get(o.id);
    if (cur?.type === 'checkitem' && typeof cur.list === 'string') out.add(cur.list);
    else if (cur?.type === 'sticky' && o.op === 'patch' && o.set && 'text' in o.set) out.add(o.id);
  }
  return out;
}

const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

/**
 * The sticky patches that make room for its entries after `ops` (grows only; a locked sticky keeps its
 * size — the lock guards resize). Empty when nothing needs to grow.
 */
export function fitPatches(board: Board, ops: readonly Op[]): Op[] {
  const lists = listsTouched(board, ops);
  if (!lists.size) return [];
  const after = applyOps(board, ops).state;
  const out: Op[] = [];
  for (const id of lists) {
    const s = after.get(id);
    if (s?.type !== 'sticky' || isLocked(s)) continue;
    const items = itemsOf(after.values(), id);
    if (!items.length) continue;
    const cur = {
      w: num(s.w, 200),
      h: num(s.h, 200),
      fontSize: num(s.fontSize, DEFAULT_FONT_SIZE),
    };
    const rows = items.map((i) => ({ text: i.text }));
    const fit = fitSticky(cur, typeof s.text === 'string' ? s.text : '', rows);
    const set: Record<string, unknown> = {};
    if (fit.h > Math.abs(cur.h)) set.h = fit.h;
    if (fit.w > Math.abs(cur.w)) set.w = fit.w;
    if (fit.fontSize !== cur.fontSize) set.fontSize = fit.fontSize;
    if (Object.keys(set).length) out.push({ op: 'patch', id, set });
  }
  return out;
}

/**
 * A checklist gesture's batch as it is committed: entry ops of a LOCKED list are dropped (ticks pass), and the
 * sticky grows to fit its entries in the same batch (one action, one ⌘Z).
 */
export function checklistCommitOps(board: Board, ops: readonly Op[]): Op[] {
  const blocked = new Set(guardLockedLists(board, ops).ids);
  const kept = blocked.size
    ? ops.filter((o) => !blocked.has(o.op === 'put' ? o.el.id : o.id))
    : [...ops];
  if (!kept.length) return [];
  return [...kept, ...fitPatches(board, kept)];
}

/** The entries of the copied stickies (the `{"maudeElements":2}` payload carries them after the cards). */
export function itemsForCopy(board: Board, ids: Iterable<string>): AnnotationElement[] {
  const out: AnnotationElement[] = [];
  for (const id of ids) {
    if (board.get(id)?.type !== 'sticky') continue;
    for (const item of itemsOf(board.values(), id)) {
      const { locked: _l, groups: _g, ...rest } = item;
      out.push(rest as AnnotationElement);
    }
  }
  return out;
}

/** A pasted payload's entries apart from its drawable records (entries have no stroke form). */
export function splitPasteItems(elements: readonly AnnotationElement[]): {
  drawn: AnnotationElement[];
  items: AnnotationElement[];
} {
  const drawn: AnnotationElement[] = [];
  const items: AnnotationElement[] = [];
  for (const e of elements) (e.type === 'checkitem' ? items : drawn).push(e);
  return { drawn, items };
}

/**
 * Puts for copies of the entries of every list in `idMap` (old sticky id → its copy). `source` must hold
 * the old stickies and their entries (the board for a duplicate, the payload for a paste). An entry whose
 * list is not copied is dropped.
 */
export function itemPutsFor(
  source: Iterable<AnnotationElement>,
  idMap: ReadonlyMap<string, string>,
  mint?: () => string
): Op[] {
  return cloneItems(source, idMap, mint).map((el) => ({ op: 'put', el }) as Op);
}

/** The interactive checklist (rows, entry fields, "+ Add an item") marks its root with this attribute. */
export const CHECKLIST_ATTR = 'data-an-checklist';

/** Does this event target sit in an interactive checklist (its keys and presses are the checklist's)? */
export function isChecklistTarget(t: EventTarget | null): boolean {
  const el = t as Element | null;
  return !!(el && typeof el.closest === 'function' && el.closest(`[${CHECKLIST_ATTR}]`));
}
