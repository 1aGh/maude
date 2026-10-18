// client/v2/shell/present-from-label.js — S3.2a: the words on the first Present menu row,
// Present from “<artboard label>”. PURE. It follows the same choice `presentSpecFor` makes when Present
// starts (the selected artboard, else the one in view), so the row names the artboard the click will use.

/**
 * @param selected the shell's selection: one element, a set, or null (use-shell-core `selected`)
 * @param inView the artboard nearest the viewport centre (`canvasActiveArtboard`)
 * @param boards the open canvas's artboards, `[{ id, label }]` (the canvas index)
 * @returns the label, or null when the artboard is unknown (the row then reads its default)
 */
export function presentFromLabel({ selected, inView, boards }) {
  const one = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
  const own = one && typeof one.artboardId === 'string' ? one.artboardId : null;
  const id = own || (typeof inView === 'string' ? inView : null);
  if (!id || !Array.isArray(boards)) return null;
  const hit = boards.find((b) => b && b.id === id);
  const label = hit && typeof hit.label === 'string' ? hit.label.trim() : '';
  return label || null;
}
