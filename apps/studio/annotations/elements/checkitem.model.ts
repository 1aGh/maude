/**
 * Check item (#113, contract 113-checklist §5.1) — one entry of a checklist. A checklist IS a sticky that
 * has at least one genuine `checkitem`; the sticky's own text is the title, the entries sit under it.
 *
 * A format-2 element TYPE (V2-1.12 R4): a format-1 peer keeps it verbatim as an unknown type and still
 * shows the sticky with its title. One element per entry (not an array on the sticky) because the board
 * syncs per element and per field — two people ticking two entries at once must both land, and an array
 * field is one last-writer-wins value (the same class of loss `ballot` was built to avoid).
 *
 * No geometry: `list` names the sticky it belongs to (not `parent`, which would make x/y relative and turn
 * the sticky into a container); `index` is the order within the list. `caps.metadata` makes the stroke-view
 * UI carry the record untouched, so a stroke-diff write never deletes what it does not draw.
 *
 * Orphans (an entry whose list is gone, or is not a sticky — a concurrent delete) are inert: `itemsOf`
 * never returns them, every reader keeps them.
 */

import { id, str } from '../fields.ts';
import { compareOrder } from '../fractional-index.ts';
import type { AnnotationElement, ElementDef } from '../types.ts';
import { resolvedField } from './_shared.ts';

/** Genuine entries per list that are drawn / accepted by the verb. */
export const MAX_CHECK_ITEMS = 200;
/** Characters of one entry (one line: ↵ makes the next entry). */
export const MAX_CHECK_TEXT = 2_000;

export const checkitem: ElementDef = {
  type: 'checkitem',
  fields: {
    /** The sticky this entry belongs to. */
    list: id(true),
    /** '' is valid (drawn as the placeholder "To do"); stored without the key. */
    text: { ...str({ max: MAX_CHECK_TEXT, plain: true, allowEmpty: true }), def: '' },
    /** `{ by: <person | 'AI'>, at: ISO }` — absent = open. */
    done: resolvedField(),
  },
  sortedKeys: true, // a format-2 type (R5: a format-1 reader sorts an unknown type's keys)
  caps: {
    box: false,
    rotatable: false,
    resizable: false,
    bindable: false,
    container: false,
    textSlot: 'text',
    metadata: true,
  },
  bounds: () => null,
  hitTest: () => false,
  translate: () => ({}),
  resize: () => ({}),
  meaningful: () => true,
};

type Board = Iterable<AnnotationElement>;

/**
 * Every list's genuine entries in one pass: `list` names an existing STICKY, sorted by `compareOrder`,
 * capped at `MAX_CHECK_ITEMS`. Lists with no genuine entry are absent from the map.
 */
export function itemsByList(elements: Board): Map<string, AnnotationElement[]> {
  const all = [...elements];
  const stickies = new Set<string>();
  for (const e of all) if (e.type === 'sticky') stickies.add(e.id);
  const out = new Map<string, AnnotationElement[]>();
  for (const e of all) {
    if (e.type !== 'checkitem' || typeof e.list !== 'string' || !stickies.has(e.list)) continue;
    const list = out.get(e.list);
    if (list) list.push(e);
    else out.set(e.list, [e]);
  }
  for (const [k, list] of out) out.set(k, list.sort(compareOrder).slice(0, MAX_CHECK_ITEMS));
  return out;
}

/** The genuine entries of `listId`, in order (empty when it is not a sticky or has none). */
export function itemsOf(elements: Board, listId: string): AnnotationElement[] {
  return itemsByList(elements).get(listId) ?? [];
}

/** A sticky with at least one genuine entry draws as a checklist. */
export function isChecklist(elements: Board, stickyId: string): boolean {
  return itemsOf(elements, stickyId).length > 0;
}

/** Ticked / total (the chip "3/5"). */
export function progressOf(items: readonly AnnotationElement[]): { done: number; total: number } {
  let done = 0;
  for (const i of items) if (i.done !== undefined) done++;
  return { done, total: items.length };
}

export interface TaskLines {
  title: string;
  items: Array<{ text: string; done: boolean }>;
}

/** `☐ ☑ ✓ ✔`, or a Markdown task marker `- [ ]` / `- [x]` / `* [ ]` (any case, optional bullet). */
const TASK_LINE = /^\s*(?:(☐|☑|✓|✔)|[-*]\s*\[( |x|X)\])\s*(.*)$/u;

/**
 * Split a sticky's text into its title (the lines that are not task lines) and its entries (the task
 * lines, in order) — the "Turn into checklist" import path, and what the old `☐` template wrote.
 */
export function fromTaskLines(text: string): TaskLines {
  const title: string[] = [];
  const items: TaskLines['items'] = [];
  for (const line of text.split('\n')) {
    const m = TASK_LINE.exec(line);
    if (!m) {
      title.push(line);
      continue;
    }
    const glyph = m[1];
    const box = m[2];
    const done = glyph ? glyph !== '☐' : box !== ' ';
    items.push({ text: (m[3] ?? '').trim(), done });
  }
  return { title: title.join('\n').trim(), items };
}

/** The Markdown task-list form (text exports, the comment conversion, `read-annotations` text mode). */
export function toTaskLines(
  title: string,
  items: ReadonlyArray<{ text: string; done: boolean }>
): string {
  const lines = items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`.trimEnd());
  return (title ? [title, ...lines] : lines).join('\n');
}
