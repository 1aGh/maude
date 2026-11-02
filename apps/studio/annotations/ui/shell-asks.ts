/**
 * @file       annotations/ui/shell-asks.ts — what the annotation layer asks the shell for (S4.12)
 * @scope      apps/studio/annotations/ui/shell-asks.ts
 * @purpose    The canvas is untrusted (DDR-054): it cannot call a privileged route or show a toast with a
 *             button. It asks the shell, in words from the dgn table (bridge/dgn-protocol.ts):
 *               · `annotation-to-comment {id}`        → the shell calls POST /_api/annotations/to-comment (S4.7)
 *                                                       with the active canvas as `file`, then toasts with Undo;
 *               · `annotation-selection {ids,kinds,artboards}` → what the AI chat's scope chip reads (S4-S5 §1);
 *               · `annotation-toast {message,undo}`   → a toast the shell owns, because a canvas notice can't
 *                                                       carry an Undo button (decision v2-S4.9-shell-owns-hidden-toast).
 *            Pure builders + one `post` that does nothing outside an iframe.
 */

import type { Stroke } from '../../annotations-model.ts';

export interface SelectionScope {
  ids: string[];
  /** A count per type: `{ sticky: 3 }`. */
  kinds: Record<string, number>;
  /** The artboards the selection rides with. */
  artboards: string[];
}

/** The most ids one scope message carries (the dgn parser caps the array the same). */
export const SCOPE_MAX_IDS = 500;

/** `annotation-selection` for the selected strokes; `ids: []` clears the scope. */
export function selectionScope(
  strokes: readonly Stroke[],
  ids: readonly string[],
  artboardOf: (id: string) => string | undefined
): SelectionScope {
  const want = new Set(ids);
  const kinds: Record<string, number> = {};
  const out: string[] = [];
  const boards = new Set<string>();
  for (const s of strokes) {
    if (!want.has(s.id) || (s.tool === 'text' && s.anchorId)) continue;
    if (out.length >= SCOPE_MAX_IDS) break;
    out.push(s.id);
    kinds[s.tool] = (kinds[s.tool] ?? 0) + 1;
    const ab = artboardOf(s.id);
    if (ab) boards.add(ab);
  }
  return { ids: out, kinds, artboards: [...boards].sort() };
}

/** Same selection, same message: the layer sends only on a change. */
export function scopeKey(s: SelectionScope): string {
  return `${s.ids.join(',')}|${s.artboards.join(',')}`;
}

/** Post one dgn message to the shell. False when there is no shell (a standalone canvas). */
export function postToShell(msg: { dgn: string } & Record<string, unknown>): boolean {
  if (typeof window === 'undefined' || window.parent === window) return false;
  try {
    window.parent.postMessage(msg, '*');
    return true;
  } catch {
    return false;
  }
}
