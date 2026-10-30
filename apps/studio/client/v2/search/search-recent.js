// client/v2/search/search-recent.js — S1.4: what ⌘K shows before anything is typed.
//
// Nothing typed lists the canvases opened lately ("Recent", newest first) and the shell's short list. On a
// Mac where nothing was opened yet it does not show an empty list: it says so in one line and lists where
// to start (05 · es-search-k / es-search-more — "Nothing opened yet." + "Start here"). PURE apart from the
// one fetch, which takes its `fetchImpl` so a test needs no network.
//
// "Opened" is `GET /_api/pins` → `opened` ({ <canvas>: ms }): the same per-Mac file Home and the panel's
// "Recently opened" order read. The list is "known empty" only when the server ANSWERED with an `opened`
// object — an offline server or an old build is "don't know", and ⌘K then shows the short list as before.

/** Recent rows on screen. */
export const RECENT_CAP = 5;

/** The words the empty Recent line says (05 · es-search-more). */
export const RECENT_EMPTY = Object.freeze({
  headline: 'Nothing opened yet.',
  next: 'Canvases you open show up here, newest first.',
});

/** Start here, in the drawn order — registry ids, so the label and the key stay the registry's. */
export const START_HERE = Object.freeze([
  'canvas.new',
  'project.open',
  'import.figma',
  'help.shortcuts',
]);

/** @returns {Promise<{ known: boolean, opened: Record<string, number> }>} */
export async function fetchRecents({ signal, fetchImpl = globalThis.fetch } = {}) {
  const none = { known: false, opened: {} };
  if (!fetchImpl) return none;
  try {
    const r = await fetchImpl('/_api/pins', { signal, cache: 'no-store' });
    if (!r.ok) return none;
    const raw = await r.json();
    if (!raw || typeof raw.opened !== 'object' || raw.opened === null || Array.isArray(raw.opened))
      return none;
    const opened = {};
    for (const [k, v] of Object.entries(raw.opened)) if (Number.isFinite(v)) opened[k] = Number(v);
    return { known: true, opened };
  } catch {
    return none; // aborted, or offline
  }
}

/** `{ rel: ms }` → the newest `cap` canvases as ⌘K rows (↵ opens the canvas). */
export function recentRows(opened, { designRel = '.design', cap = RECENT_CAP } = {}) {
  return Object.entries(opened ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([rel]) => {
      const slash = rel.lastIndexOf('/');
      return {
        group: 'canvases',
        id: `recent:${rel}`,
        name: rel.slice(slash + 1).replace(/\.tsx$/, ''),
        meta: slash > 0 ? rel.slice(0, slash) : '',
        icon: 'file',
        keys: '',
        heading: 'Recent',
        path: `${designRel}/${rel}`,
        artboardId: null,
      };
    });
}

/** The glyph each Start-here row wears (05 es-search-more: plus · folder · insert · help on neutral tiles) —
 *  a registry id without a kit glyph used to fall to the ">" chevron. */
const START_ICON = Object.freeze({
  'canvas.new': 'plus',
  'project.open': 'folder',
  'import.figma': 'insert',
  'help.shortcuts': 'help',
});

/** The Start here rows: the shell's rows for `START_HERE` that can run here, in that order. */
export function startRows(actions) {
  const out = [];
  for (const id of START_HERE) {
    const a = actions.find((x) => (x.actionId ?? x.id) === id && (x.runnable?.() ?? true));
    if (!a) continue;
    out.push({
      group: 'short',
      id: `start:${id}`,
      name: a.name ?? a.label,
      icon: START_ICON[id] ?? a.icon,
      keys: a.keys ?? a.kbd ?? '',
      heading: 'Start here',
      run: a.run,
    });
  }
  return out;
}
