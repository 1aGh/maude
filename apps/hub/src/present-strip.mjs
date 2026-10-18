// The hub's relay strip for Present — S3.7b, S3-present-session §2 (D11).
//
// `beforeHandleAwareness` runs every incoming awareness frame through a scratch
// map and re-encodes what is left, so deleting a key here is what every other
// peer receives. A connection WITHOUT `edit` on this document (the context's
// `readOnly`, which `onAuthenticate` sets per document from `docDoor`:
// `!can('edit', canvas)`) cannot broadcast a presentation:
//   - `present` — the presenter's position; a forged one would steer followers;
//   - `pointer` — the presenter's laser dot (S3.2b), a presenter-only tool.
// `watching` is NEVER stripped: any role may watch, and the presenter's
// "N watching" count is made of exactly those states.
//
// Server-internal updates (no context) and the permissive dev hub (`anon`)
// are untouched, like `stripSummon`. The studio's own room does the same for a
// read-only collab socket (`apps/studio/present/relay-strip.ts`).

/** The awareness keys only an editor of the document may publish. */
export const PRESENTER_ONLY_FIELDS = Object.freeze(['present', 'pointer']);

/**
 * @param {{ states?: Map<number, object>, context?: { user?: object } }} payload
 * @returns {number} how many states lost a field
 */
export function stripPresent({ states, context }) {
  const user = context?.user;
  if (!user || user.anon || user.readOnly !== true || !states) return 0;
  let stripped = 0;
  for (const state of states.values()) {
    if (!state || typeof state !== 'object') continue;
    let hit = false;
    for (const key of PRESENTER_ONLY_FIELDS) {
      if (key in state) {
        delete state[key];
        hit = true;
      }
    }
    if (hit) stripped += 1;
  }
  return stripped;
}
