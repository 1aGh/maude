// client/v2/inspector/advanced-rows.js — S11.8 (contract S11-slices §2.3): the append-only registry the
// inspector's › Advanced rows are filled from. Same shape as `slots.js`, so S2.8 (artboard Theme, Reset
// position, Convert to absolute, Body layout, Grid tracks), S7 (08 ak-advanced: print bleed and trim) and
// S8 (Exports at 2×) register from their own files without editing S11's:
//
//   registerAdvancedRow('artboard', {
//     id: 'artboard.theme',            // unique across every group — a duplicate THROWS
//     order: 10,                       // within the group; default 100
//     kinds: ['artboard'],             // 'element' | 'artboard'; absent = both
//     when: ({ el, kind, ctx }) => …,  // optional extra gate
//     Body: ({ el, kind, ctx }) => …,  // the row(s)
//     aside: node | ({ el, kind, ctx }) => node,   // optional: beside the group's title (CSS: "Edit as text")
//   })
//
// `ctx` is what the fold gives every row: { canvasFile, cfg, role, readOnly, canEdit, canCode, editScope,
// onDetachInstance, edit, css, cssText, runAction, toast }.
//
// Groups, in the order the fold draws them:
//   element  · used-in · tokens · css · artboard · in-code

/** @type {readonly string[]} */
export const ADVANCED_GROUPS = Object.freeze([
  'element',
  'used-in',
  'tokens',
  'css',
  'artboard',
  'in-code',
]);

/** The words above each group's rows (CONTRACT §3; 06 · ad-inspector). `in-code` has no title. */
export const GROUP_TITLES = Object.freeze({
  element: 'Element',
  'used-in': 'Used in',
  tokens: 'Tokens it uses',
  css: 'CSS',
  artboard: null,
  'in-code': null,
});

/** @type {Map<string, Array<any>>} */
const byGroup = new Map();
let seq = 0;
let version = 0;
const subs = new Set();
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};

/** @returns {() => void} unregister (tests, hot reload) */
export function registerAdvancedRow(group, entry) {
  if (!ADVANCED_GROUPS.includes(group))
    throw new Error(`registerAdvancedRow: unknown group "${group}"`);
  if (!entry || typeof entry.id !== 'string' || !entry.id)
    throw new Error('registerAdvancedRow: id required');
  if (typeof entry.Body !== 'function' && typeof entry.Body !== 'object')
    throw new Error(`registerAdvancedRow "${entry.id}": Body required`);
  for (const list of byGroup.values()) {
    if (list.some((e) => e.id === entry.id))
      throw new Error(`advanced row "${entry.id}" already registered`);
  }
  const stored = { order: 100, ...entry, seq: seq++ };
  const list = byGroup.get(group) ?? [];
  list.push(stored);
  list.sort((a, b) => a.order - b.order || a.seq - b.seq);
  byGroup.set(group, list);
  notify();
  return () => {
    const l = byGroup.get(group);
    const i = l ? l.indexOf(stored) : -1;
    if (i >= 0) {
      l.splice(i, 1);
      notify();
    }
  };
}

/**
 * The rows of a group that show for this selection, in order.
 * @param {string} group
 * @param {{ el?: any, kind: 'element' | 'artboard', ctx?: any }} q
 */
export function advancedRowsFor(group, q) {
  return (byGroup.get(group) ?? []).filter(
    (e) =>
      (!Array.isArray(e.kinds) || e.kinds.includes(q.kind)) &&
      (typeof e.when !== 'function' || e.when(q))
  );
}

/** Every registered id in draw order (group order, then row order) — the golden the tests pin. */
export function advancedRowIds(kind) {
  const out = [];
  for (const g of ADVANCED_GROUPS)
    for (const e of byGroup.get(g) ?? [])
      if (!Array.isArray(e.kinds) || e.kinds.includes(kind)) out.push(e.id);
  return out;
}

/** For `useSyncExternalStore`: the fold redraws when a package registers late. */
export function subscribeAdvancedRows(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export const advancedRowsVersion = () => version;
