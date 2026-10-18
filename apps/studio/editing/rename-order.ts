// editing/rename-order.ts — S2.10: the maths behind "rename in place" (14 Editing: ed-ab-menu, pane 3).
//
// ↵ saves, esc cancels, tab moves to the NEXT artboard's name — "rename a whole row without the mouse".
// Next means reading order: rows top to bottom, each row left to right (not the order the boards sit in
// the file, which a Tidy or a drag may have left anywhere). Pure and React-free: canvas-lib imports it
// (DCArtboard owns the field), so it must not import canvas-lib.

export interface RenameBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The window event that opens one artboard's name field (canvas-lib's DCArtboard listens). */
export const RENAME_EVENT = 'maude:rename-artboard';

/** The field is as wide as the whole name (in `ch`), never narrower than a short one. */
export const FIELD_MIN_CH = 8;
export const FIELD_MAX_CH = 82;
export const growCh = (text: string): number =>
  Math.min(FIELD_MAX_CH, Math.max(FIELD_MIN_CH, Array.from(text).length + 2));

/** Artboard ids in reading order: rows (boards that share a vertical band) top to bottom, left to right. */
export function renameOrder(boxes: readonly RenameBox[]): string[] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: RenameBox[][] = [];
  let bottom = Number.NEGATIVE_INFINITY;
  for (const b of sorted) {
    // joins the row when at least half of it sits inside the row's band
    if (rows.length && b.y < bottom - b.h * 0.5) {
      (rows[rows.length - 1] as RenameBox[]).push(b);
      bottom = Math.max(bottom, b.y + b.h);
    } else {
      rows.push([b]);
      bottom = b.y + b.h;
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x).map((b) => b.id));
}

/** The artboard whose name opens after `id` (⇧tab: before it), or null at either end. */
export function nextRenameId(
  boxes: readonly RenameBox[],
  id: string,
  reverse = false
): string | null {
  const order = renameOrder(boxes);
  const at = order.indexOf(id);
  if (at < 0) return null;
  return order[reverse ? at - 1 : at + 1] ?? null;
}

/** Ask artboard `id` to open its name field. */
export function requestRename(id: string, win: Window = window): void {
  win.dispatchEvent(new CustomEvent(RENAME_EVENT, { detail: { id } }));
}
