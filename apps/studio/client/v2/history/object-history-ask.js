// client/v2/history/object-history-ask.js — the canvas's "Version history of this object" ask, checked by the
// shell (p8-dead-reasons part 2, `history.object`). The object menu (editing/object-menu.tsx) and the sticky
// menu (annotations-layer.tsx) live in the canvas frame; their row posts `dgn:'object-history'` and the shell
// runs the registry action `history.object` with the target this returns.
//
// The frame is untrusted (DDR-054) and scoped to its own canvas (C4). So the shell never takes a path from the
// message: the canvas is the frame's own (the active one — the bridge's `active` gate), and the object must be
// one that canvas has already shown the shell through its validated lanes:
//   · an element — `<artboard>/<id>` in the frame's current selection, or in its current layers tree;
//   · an annotation — an id of the frame's current annotation selection (the sticky menu acts on that).
// Anything else (a malformed payload, another canvas's object, an id nobody showed) is ignored: null.

const ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,127}$/;
const ART = /^[A-Za-z0-9_-]{1,64}$/;

const list = (sel) => (Array.isArray(sel) ? sel : sel ? [sel] : []);

function inTree(nodes, id, depth = 0) {
  if (!Array.isArray(nodes) || depth > 64) return false;
  for (const n of nodes) {
    if (n && typeof n === 'object' && (n.id === id || inTree(n.children, id, depth + 1)))
      return true;
  }
  return false;
}

/**
 * @param {unknown} msg  the parsed `object-history` payload
 * @param {{ activePath: string|null,
 *           selection?: { file?: string|null, sel?: unknown } | null,
 *           layers?: { canvas?: string|null, artboardId?: string|null, tree?: unknown } | null,
 *           annotations?: { file?: string, ids?: string[] } | null }} known  what the frame has shown the shell
 * @returns {{ element: { artboard: string, element: string } } | { annotation: string, kind: 'sticky' } | null}
 */
export function objectHistoryTarget(msg, known) {
  const path = known?.activePath;
  if (!path || !msg || typeof msg !== 'object') return null;
  if (typeof msg.annotation === 'string') {
    if (msg.artboard !== undefined || msg.element !== undefined) return null;
    if (!ID.test(msg.annotation)) return null;
    const a = known.annotations;
    if (!a || a.file !== path || !Array.isArray(a.ids) || !a.ids.includes(msg.annotation))
      return null;
    return { annotation: msg.annotation, kind: 'sticky' };
  }
  const { artboard, element } = msg;
  if (typeof artboard !== 'string' || !ART.test(artboard)) return null;
  if (typeof element !== 'string' || !ID.test(element)) return null;
  const s = known.selection;
  const selected =
    !!s &&
    list(s.sel).some(
      (e) =>
        e &&
        (e.file ?? s.file) === path &&
        String(e.id ?? '') === element &&
        e.artboardId === artboard
    );
  const l = known.layers;
  const inLayers = !!l && l.canvas === path && l.artboardId === artboard && inTree(l.tree, element);
  return selected || inLayers ? { element: { artboard, element } } : null;
}
