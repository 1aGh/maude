// client/v2/inspector/layers-slot.jsx — S2.11b: Layers draws the same numbered slot as the canvas (ed-lay-reorder).
//
// While a card is lifted in the canvas, the canvas tells the shell where it would land (`dgn:'reorder-slot'`:
// 1-based `index` among `total` siblings of the frame `parentId`; index 0 = the drag ended). The shell keeps the
// last one here; the Layers tree opens an empty, numbered row among the frame's children at that place. The
// tree itself is never written to — the row is drawn from a copy and gone when the card is let go.

import { useSyncExternalStore } from 'react';

let current = null;
const subs = new Set();
const emit = () => {
  for (const f of subs) f();
};

/** The last slot the active canvas sent; `{ index: 0 }` (or null) clears it. */
export const layersSlot = {
  set(msg) {
    const next =
      msg && Number.isInteger(msg.index) && msg.index > 0 && typeof msg.parentId === 'string'
        ? { index: msg.index, total: msg.total, parentId: msg.parentId }
        : null;
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    emit();
  },
  get: () => current,
  subscribe(f) {
    subs.add(f);
    return () => subs.delete(f);
  },
};

export const useLayersSlot = () =>
  useSyncExternalStore(layersSlot.subscribe, layersSlot.get, layersSlot.get);

export const SLOT_NODE_ID = '__slot__';

/**
 * `nodes` with the slot's row inserted among the children of `slot.parentId`, at its place. The input is not
 * touched; with no slot, or a frame this tree does not have, the same array comes back.
 */
export function withSlot(nodes, slot) {
  if (!slot || !Array.isArray(nodes)) return nodes;
  let hit = false;
  const walk = (list) => {
    let changed = false;
    const out = list.map((n) => {
      if (hit) return n;
      if (n.id === slot.parentId && !n.slot) {
        hit = true;
        changed = true;
        const kids = Array.isArray(n.children) ? [...n.children] : [];
        const at = Math.min(Math.max(slot.index - 1, 0), kids.length);
        kids.splice(at, 0, {
          id: SLOT_NODE_ID,
          index: 0,
          slot: true,
          n: slot.index,
          label: String(slot.index),
          type: 'slot',
        });
        return { ...n, children: kids };
      }
      if (Array.isArray(n.children) && n.children.length) {
        const kids = walk(n.children);
        if (kids !== n.children) {
          changed = true;
          return { ...n, children: kids };
        }
      }
      return n;
    });
    return changed ? out : list;
  };
  return walk(nodes);
}

/** The empty place: dashed, numbered, indented like the rows it sits among. Not selectable, not draggable. */
export function LayerSlotRow({ node, depth }) {
  return (
    <div
      className="st-layer st-layer--row st-layer-slot"
      role="presentation"
      aria-hidden="true"
      style={{ paddingLeft: 6 + depth * 14 }}
      data-testid="layers-slot"
      data-n={node.n}
    >
      <span className="st-layer-slot-n">{node.n}</span>
    </div>
  );
}
