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
//     canAdd: ({ el, selection, kind, ctx }) => boolean,  // optional (S8.8): the "+" is drawn only when true
//     aside: ReactNode | ({ el, ctx }) => ReactNode,   // optional: replaces the quiet word beside the title ('' = none)
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

/**
 * The entries of a section that show for this kind, in order. An entry may also carry `when({ selection, kind })`
 * (S2.4: Type shows for several objects only when every one is text); absent = always. `ctx` (the frame's) is
 * there for a role gate (S8.8: Can view sees no Export); callers without one pass nothing.
 */
export function slotsFor(sectionId, kindId, selection, ctx) {
  return (bySection.get(sectionId) ?? []).filter(
    (e) =>
      (!Array.isArray(e.kinds) || e.kinds.includes(kindId)) &&
      (typeof e.when !== 'function' || e.when({ selection, kind: kindId, ctx }))
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

/**
 * Tests only: set every registered body aside and hand back the way to put them back. A test that asserts on an
 * EMPTY registry ("a section with no registered body is not drawn") would otherwise depend on which other test
 * files ran first in the same process: `bun test` shares one module registry, so any file that imported a
 * section module earlier leaves its bodies registered.
 * @returns {() => void} restore
 */
export function stashSlots() {
  const saved = new Map([...bySection].map(([k, v]) => [k, [...v]]));
  bySection.clear();
  notify();
  return () => {
    bySection.clear();
    for (const [k, v] of saved) bySection.set(k, v);
    notify();
  };
}
