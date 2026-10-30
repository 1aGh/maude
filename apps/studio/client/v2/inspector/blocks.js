// client/v2/inspector/blocks.js — S2.17: kind-owned blocks around the ten sections (14 Editing, ed-comp-instance).
//
// The ten sections are the same for every object (sections.js, FIXED). An instance of a design-system
// component also has things only it has — which component, which variant, what it changes, where its master
// is — and they are not one of the ten. A kind registers them here, from its own file, append-only, like
// slots.js:
//
//   registerBlock({
//     id: 'instance.component',       // unique
//     kinds: ['instance'],            // which kinds show it
//     at: 'top' | 'bottom',           // above the sections (after the header) or below them (before Advanced)
//     order: 10,                      // within that place; default 100
//     Body: ({ el, selection, kind, ctx }) => element,   // draws its own <section className="insp-sec">
//   })

/** @type {Array<any>} */
const blocks = [];
let seq = 0;
let version = 0;
const subs = new Set();
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};

/** @returns {() => void} unregister (tests, hot reload) */
export function registerBlock(entry) {
  if (!entry || typeof entry.id !== 'string' || !entry.id)
    throw new Error('registerBlock: id required');
  if (typeof entry.Body !== 'function')
    throw new Error(`registerBlock "${entry.id}": Body required`);
  if (blocks.some((b) => b.id === entry.id))
    throw new Error(`block "${entry.id}" already registered`);
  const stored = { order: 100, at: 'top', ...entry, seq: seq++ };
  blocks.push(stored);
  blocks.sort((a, b) => a.order - b.order || a.seq - b.seq);
  notify();
  return () => {
    const i = blocks.indexOf(stored);
    if (i >= 0) {
      blocks.splice(i, 1);
      notify();
    }
  };
}

/** The blocks that show for this kind at `at`, in order. */
export function blocksFor(kindId, at) {
  return blocks.filter((b) => b.at === at && (!Array.isArray(b.kinds) || b.kinds.includes(kindId)));
}

/** For `useSyncExternalStore`: the frame redraws when a kind registers late. */
export function subscribeBlocks(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export const blocksVersion = () => version;
