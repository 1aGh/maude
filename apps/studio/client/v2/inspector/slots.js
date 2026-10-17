// client/v2/inspector/slots.js — S2.2: the append-only registry the inspector's sections are filled from.
//
// Each slice registers its own bodies from its own file, so S2.3, S2.4, S2.5 and S8 never edit each
// other's code (decision v2-S2-editing-mount):
//
//   registerSlot('size', {
//     id: 'size.words',            // unique, '<section>.<what>' — a duplicate throws
//     order: 10,                   // within the section; default 100
//     kinds: ['frame', 'text'],    // which kinds show it; absent = every kind
//     Body: SizeBody,              // ({ el, selection, kind, ctx }) => element — the section's rows
//     add: ({ el, ctx }) => void,  // optional: the "+" in the header (only sections with an adder draw it)
//     aside: ReactNode | ({ el, ctx }) => ReactNode,   // optional: replaces the quiet word beside the title
//   })
//
// `ctx` is what the panel gives every body: { canvasFile, cfg, editable, onOptimistic, onRecordEdit,
// onUndoRedo, onReplaceMedia }. A section with no entry for the selected kind is not drawn.

import { sectionById } from './sections.js';

/** @type {Map<string, Array<any>>} */
const bySection = new Map();
let seq = 0;
let version = 0;
const subs = new Set();
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};

/** @returns {() => void} unregister (tests, hot reload) */
export function registerSlot(sectionId, entry) {
  if (!sectionById(sectionId)) throw new Error(`registerSlot: unknown section "${sectionId}"`);
  if (!entry || typeof entry.id !== 'string' || !entry.id)
    throw new Error('registerSlot: id required');
  if (typeof entry.Body !== 'function' && typeof entry.Body !== 'object')
    throw new Error(`registerSlot "${entry.id}": Body required`);
  for (const list of bySection.values()) {
    if (list.some((e) => e.id === entry.id))
      throw new Error(`slot "${entry.id}" already registered`);
  }
  const stored = { order: 100, ...entry, seq: seq++ };
  const list = bySection.get(sectionId) ?? [];
  list.push(stored);
  list.sort((a, b) => a.order - b.order || a.seq - b.seq);
  bySection.set(sectionId, list);
  notify();
  return () => {
    const l = bySection.get(sectionId);
    const i = l ? l.indexOf(stored) : -1;
    if (i >= 0) {
      l.splice(i, 1);
      notify();
    }
  };
}

/** The entries of a section that show for this kind, in order. */
export function slotsFor(sectionId, kindId) {
  return (bySection.get(sectionId) ?? []).filter(
    (e) => !Array.isArray(e.kinds) || e.kinds.includes(kindId)
  );
}

/** Is any body registered at all? (Until the first slice lands, Advanced is the editor and starts open.) */
export function hasAnySlot() {
  for (const l of bySection.values()) if (l.length) return true;
  return false;
}

/** For `useSyncExternalStore`: the frame re-renders when a slice registers late (hot reload, tests). */
export function subscribeSlots(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export const slotsVersion = () => version;
