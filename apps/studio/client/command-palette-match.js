// command-palette-match.js — which ⌘K command a query names.
//
// Kept out of app.jsx so the one decision that matters — what Enter runs —
// can be tested on its own.

/** The commands a query matches, in list order (label or group substring). */
export function matchCommands(actions, query) {
  const needle = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!needle) return actions;
  return actions.filter(
    (a) => a.label.toLowerCase().includes(needle) || (a.group && a.group.toLowerCase().includes(needle))
  );
}

/**
 * The command Enter runs.
 *
 * WHAT IS IN THE BOX, not what the last render saw. A query typed or pasted
 * and confirmed at once can reach Enter before the list re-rendered for it;
 * the rendered list is then the unfiltered one and its first row — "New brief
 * board" — ran instead of the command that was asked for (surface run
 * 2026-09-16, "New video" on the hub). When the box and the rendered query
 * disagree, the box wins and its first match runs; when they agree, the
 * highlighted row does.
 */
export function commandForEnter(actions, renderedQuery, liveQuery, activeIndex) {
  const norm = (s) =>
    String(s ?? '')
      .trim()
      .toLowerCase();
  if (norm(liveQuery) !== norm(renderedQuery)) return matchCommands(actions, liveQuery)[0] ?? null;
  return matchCommands(actions, renderedQuery)[activeIndex] ?? null;
}
