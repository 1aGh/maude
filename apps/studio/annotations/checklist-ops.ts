/**
 * @file       annotations/checklist-ops.ts — the checklist gestures as op batches (#113, contract
 *             113-checklist §5.3)
 * @scope      apps/studio/annotations/checklist-ops.ts
 * @purpose    Every gesture on a checklist (tick, add, reword, remove, reorder, turn into a checklist,
 *             delete / copy the sticky) is ONE op batch, so it is one action and one ⌘Z. Each function
 *             takes the committed board and returns `{ ok, ops, label }` — `label` is the undo / history
 *             line ("Ticked “Write the post”") — or a refusal `{ ok: false, reason, message }`.
 *
 *             Pure and DOM-free: the layer (slice 113-B) commits what these return through the op
 *             pipeline (never through the stroke diff — the stroke view carries items untouched), the AI
 *             write engine (`AiBatch`) reuses `guardLockedLists` and `withItemDeletes`, and the tests pin
 *             the batches.
 *
 *             The lock rule (DDR-246 is a UX guard, contract §4.5): a LOCKED list still ticks; adding,
 *             removing, rewording and reordering its entries are refused with the lock line.
 */

import { keyBetween, keysBetween } from './fractional-index.ts';
import {
  fromTaskLines,
  isChecklist,
  itemsByList,
  itemsOf,
  MAX_CHECK_ITEMS,
} from './elements/checkitem.model.ts';
import type { Op } from './ops.ts';
import { validateElement } from './registry.ts';
import { isLocked } from './lock.ts';
import type { AnnotationElement } from './types.ts';

export type Board = ReadonlyMap<string, AnnotationElement>;

export type RefusalReason =
  /** The entry / list is not on the board (a concurrent delete) or the entry is an orphan. */
  | 'gone'
  /** The target is not a sticky. */
  | 'not-a-list'
  /** The list is locked (and the gesture is not a tick). */
  | 'locked'
  /** The list already has entries. */
  | 'already'
  /** `MAX_CHECK_ITEMS` entries. */
  | 'limit'
  /** The ops could not be built (a record the registry refuses, or order keys with no room). */
  | 'invalid';

export interface ChecklistOps {
  ok: true;
  /** One batch = one action = one ⌘Z. Empty when the gesture changes nothing. */
  ops: Op[];
  /** The undo / history line. */
  label: string;
}

export interface ChecklistRefusal {
  ok: false;
  reason: RefusalReason;
  /** A plain sentence for a toast or an AI error. */
  message: string;
}

export type ChecklistResult = ChecklistOps | ChecklistRefusal;

const refuse = (reason: RefusalReason, message: string): ChecklistRefusal => ({
  ok: false,
  reason,
  message,
});

const isoNow = (now?: Date): string => (now ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z');

/** `“text”` cut to a readable length; null for an empty entry. */
function quoted(text: unknown, max = 40): string | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const t = text.trim();
  return `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`;
}

function titleOf(list: AnnotationElement): string {
  return quoted(list.text) ?? 'this note';
}

function mintItemId(): string {
  return `ck_${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
}

/** A genuine entry: a `checkitem` whose `list` is a sticky on this board. */
function entryOf(
  board: Board,
  itemId: string
): { item: AnnotationElement; list: AnnotationElement } | null {
  const item = board.get(itemId);
  if (!item || item.type !== 'checkitem' || typeof item.list !== 'string') return null;
  const list = board.get(item.list);
  return list?.type === 'sticky' ? { item, list } : null;
}

const lockedMessage = (list: AnnotationElement, verb: string): string =>
  `${titleOf(list)} is locked — unlock it to ${verb}`;

const gone = (what: string): ChecklistRefusal =>
  refuse('gone', `That ${what} is gone — someone else removed it`);

// ─────────────────────────────────────────────────────────────────────────────
// Tick

/**
 * Tick (`done: true`) or untick an entry. Allowed on a locked list. Already in that state → an empty
 * batch (nothing to undo).
 */
export function tickItem(
  board: Board,
  itemId: string,
  done: boolean,
  who: { by: string; now?: Date }
): ChecklistResult {
  const e = entryOf(board, itemId);
  if (!e) return gone('item');
  const was = e.item.done !== undefined;
  const name = quoted(e.item.text) ?? 'an item';
  if (was === done) return { ok: true, ops: [], label: `${done ? 'Ticked' : 'Unticked'} ${name}` };
  const op: Op = done
    ? {
        op: 'patch',
        id: itemId,
        set: { done: { by: who.by, at: isoNow(who.now) } },
        expect: { done: e.item.done },
      }
    : { op: 'patch', id: itemId, unset: ['done'], expect: { done: e.item.done } };
  return { ok: true, ops: [op], label: `${done ? 'Ticked' : 'Unticked'} ${name}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Add / reword / remove / reorder

/**
 * Add an entry. `after` = an entry id to insert after it (↵ in the middle of the list), `null` = first,
 * omitted = last. `id` is for tests and for callers that need to focus the new row.
 */
export function addItem(
  board: Board,
  listId: string,
  opts: { text?: string; id?: string; after?: string | null } = {}
): ChecklistResult {
  const list = board.get(listId);
  if (!list) return gone('note');
  if (list.type !== 'sticky') return refuse('not-a-list', 'Only a sticky can hold a checklist');
  if (isLocked(list)) return refuse('locked', lockedMessage(list, 'add an item'));
  const items = itemsOf(board.values(), listId);
  if (items.length >= MAX_CHECK_ITEMS) {
    return refuse('limit', `A checklist holds ${MAX_CHECK_ITEMS} items at most`);
  }
  let lo: string | null;
  let hi: string | null;
  if (opts.after === undefined) {
    lo = items[items.length - 1]?.index ?? null;
    hi = null;
  } else if (opts.after === null) {
    lo = null;
    hi = items[0]?.index ?? null;
  } else {
    const at = items.findIndex((i) => i.id === opts.after);
    if (at < 0) return gone('item');
    lo = (items[at] as AnnotationElement).index;
    hi = items[at + 1]?.index ?? null;
  }
  let index: string;
  try {
    index = keyBetween(lo, hi);
  } catch {
    return refuse('invalid', 'There is no room to add an item there');
  }
  const id = opts.id ?? mintItemId();
  const v = validateElement({
    id,
    type: 'checkitem',
    index,
    list: listId,
    ...(opts.text ? { text: opts.text } : {}),
  });
  if (!v.ok) return refuse('invalid', `Could not add that item (${v.reason})`);
  return { ok: true, ops: [{ op: 'put', el: v.el }], label: `Added an item to ${titleOf(list)}` };
}

/** Reword an entry — one text patch carrying its merge base (concurrent rewords merge by character). */
export function rewordItem(board: Board, itemId: string, text: string): ChecklistResult {
  const e = entryOf(board, itemId);
  if (!e) return gone('item');
  if (isLocked(e.list)) return refuse('locked', lockedMessage(e.list, 'edit its items'));
  return {
    ok: true,
    ops: [{ op: 'patch', id: itemId, set: { text }, expect: { text: e.item.text ?? '' } }],
    label: 'Edited an item',
  };
}

/** Remove an entry. Removing the last one makes the sticky a plain sticky again (it has no entry left). */
export function removeItem(board: Board, itemId: string): ChecklistResult {
  const e = entryOf(board, itemId);
  if (!e) return gone('item');
  if (isLocked(e.list)) return refuse('locked', lockedMessage(e.list, 'remove its items'));
  return { ok: true, ops: [{ op: 'delete', id: itemId }], label: 'Removed an item' };
}

export type MoveTarget = 'up' | 'down' | 'first' | 'last' | { before: string } | { after: string };

/** Reorder an entry: one patch of its `index` between its new neighbours. */
export function moveItem(board: Board, itemId: string, to: MoveTarget): ChecklistResult {
  const e = entryOf(board, itemId);
  if (!e) return gone('item');
  if (isLocked(e.list)) return refuse('locked', lockedMessage(e.list, 'reorder its items'));
  const items = itemsOf(board.values(), e.list.id);
  const at = items.findIndex((i) => i.id === itemId);
  if (at < 0) return gone('item');
  const rest = items.filter((i) => i.id !== itemId);
  let pos: number; // insert position in `rest`
  if (to === 'up') pos = Math.max(0, at - 1);
  else if (to === 'down') pos = Math.min(rest.length, at + 1);
  else if (to === 'first') pos = 0;
  else if (to === 'last') pos = rest.length;
  else {
    const ref = 'before' in to ? to.before : to.after;
    const i = rest.findIndex((x) => x.id === ref);
    if (i < 0) return gone('item');
    pos = 'before' in to ? i : i + 1;
  }
  const label = `Reordered ${titleOf(e.list)}`;
  if (pos === at) return { ok: true, ops: [], label };
  let index: string;
  try {
    index = keyBetween(rest[pos - 1]?.index ?? null, rest[pos]?.index ?? null);
  } catch {
    return refuse('invalid', 'Those items share one place in the order');
  }
  return {
    ok: true,
    ops: [{ op: 'patch', id: itemId, set: { index }, expect: { index: e.item.index } }],
    label,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn into checklist

/**
 * "Turn into checklist": the sticky's task lines (`☐ ☑ - [ ] - [x]`) become entries and what is left is
 * its title (one patch + N puts). A sticky without task lines gets one empty entry so it is a checklist.
 */
export function makeChecklist(
  board: Board,
  stickyId: string,
  opts: { mint?: () => string; by?: string; now?: Date } = {}
): ChecklistResult {
  const s = board.get(stickyId);
  if (!s) return gone('note');
  if (s.type !== 'sticky') return refuse('not-a-list', 'Only a sticky can hold a checklist');
  if (isChecklist(board.values(), stickyId)) {
    return refuse('already', `${titleOf(s)} is already a checklist`);
  }
  if (isLocked(s)) return refuse('locked', lockedMessage(s, 'turn it into a checklist'));
  const text = typeof s.text === 'string' ? s.text : '';
  const parsed = fromTaskLines(text);
  const entries = parsed.items.length
    ? parsed.items.slice(0, MAX_CHECK_ITEMS)
    : [{ text: '', done: false }];
  const mint = opts.mint ?? mintItemId;
  const at = isoNow(opts.now);
  const keys = keysBetween(null, null, entries.length);
  const ops: Op[] = [];
  if (parsed.items.length) {
    ops.push({ op: 'patch', id: stickyId, set: { text: parsed.title }, expect: { text } });
  }
  for (const [i, entry] of entries.entries()) {
    const v = validateElement({
      id: mint(),
      type: 'checkitem',
      index: keys[i],
      list: stickyId,
      ...(entry.text ? { text: entry.text } : {}),
      ...(entry.done ? { done: { by: opts.by ?? 'Someone', at } } : {}),
    });
    if (!v.ok) return refuse('invalid', `Could not turn that into a checklist (${v.reason})`);
    ops.push({ op: 'put', el: v.el });
  }
  return {
    ok: true,
    ops,
    label: `Turned ${titleOf({ ...s, text: parsed.title || text })} into a checklist`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete / copy the sticky, and the lock net

/**
 * A batch that deletes a sticky also deletes its entries (same batch = same ⌘Z). Entries already named
 * in the batch are not repeated. A LOCKED sticky's entries are left alone: the lock guard drops the
 * sticky's delete, and a list must never lose its entries while the sticky stays.
 */
export function withItemDeletes(board: Board, ops: readonly Op[]): Op[] {
  const deleting = new Set<string>();
  for (const o of ops) if (o.op === 'delete') deleting.add(o.id);
  const byList = new Map<string, AnnotationElement[]>();
  for (const e of board.values()) {
    if (e.type !== 'checkitem' || typeof e.list !== 'string') continue;
    const l = byList.get(e.list);
    if (l) l.push(e);
    else byList.set(e.list, [e]);
  }
  const extra: Op[] = [];
  for (const id of [...deleting]) {
    const s = board.get(id);
    if (s?.type !== 'sticky' || isLocked(s)) continue;
    for (const item of byList.get(id) ?? []) {
      if (deleting.has(item.id)) continue;
      deleting.add(item.id);
      extra.push({ op: 'delete', id: item.id });
    }
  }
  return extra.length ? [...ops, ...extra] : [...ops];
}

/**
 * Copies of the entries of the lists in `listMap` (old sticky id → the copy's id): fresh ids, `list`
 * remapped, ticks kept, order kept. An entry whose list is not in the map is not copied (a stray in a
 * pasted payload is dropped).
 */
export function cloneItems(
  elements: Iterable<AnnotationElement>,
  listMap: ReadonlyMap<string, string>,
  mint: () => string = mintItemId
): AnnotationElement[] {
  const byList = itemsByList(elements);
  const out: AnnotationElement[] = [];
  for (const [oldId, newId] of listMap) {
    for (const item of byList.get(oldId) ?? []) {
      const { locked: _l, groups: _g, ...rest } = item;
      out.push({ ...rest, id: mint(), list: newId } as AnnotationElement);
    }
  }
  return out;
}

/** Fields of an entry a locked list still allows to change. */
const LOCKED_LIST_EXEMPT: ReadonlySet<string> = new Set(['done']);

/**
 * The lock net for entries: ops that add, remove, reword or reorder an entry of a LOCKED list. The
 * board's own guard (`guardLockedOps`) only sees the locked sticky, and the entries are other records, so
 * every commit path (UI and the AI engine) also asks this. Ticks pass. Returns the offending entry ids.
 */
export function guardLockedLists(
  board: Board,
  ops: readonly Op[]
): { blocked: number; ids: string[] } {
  const ids: string[] = [];
  for (const o of ops) {
    let listId: string | undefined;
    if (o.op === 'put') {
      if (o.el.type === 'checkitem' && typeof o.el.list === 'string') listId = o.el.list;
    } else {
      const cur = board.get(o.id);
      if (cur?.type === 'checkitem' && typeof cur.list === 'string') listId = cur.list;
    }
    if (!listId || !isLocked(board.get(listId))) continue;
    if (o.op === 'patch') {
      const keys = [...Object.keys(o.set ?? {}), ...(o.unset ?? [])];
      if (keys.every((k) => LOCKED_LIST_EXEMPT.has(k))) continue;
    }
    ids.push(o.op === 'put' ? o.el.id : o.id);
  }
  return { blocked: ids.length, ids };
}
