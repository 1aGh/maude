// surface-requests.ts — the request each history / Trash registry action makes (S1.17).
//
// SURFACE = SUBSTRATE: a person's click and `maude design history|trash …` reach the SAME route with
// the SAME body, because both build it here. The history panel (S1.14/S1.15), the Trash view (S1.8)
// and the verbs import these; none of them spells a route or a body key itself. The contract test
// (test/surface-requests-parity.test.ts) pins each registry action to its builder, runs the verb
// against a recording studio and compares what it sent, and fails any client/v2 file that names one
// of these write routes without importing this module.
//
// Leaf module: no imports, erasable TypeScript only (the verbs are .mjs run by bun; the client bundle
// is built by bun).

export interface SurfaceRequest {
  route: string;
  method: 'GET' | 'POST';
  /** Absent on a POST. */
  query?: Record<string, string>;
  /** Absent on a GET. */
  body?: Record<string, unknown>;
}

/** The newest version this Mac drew without an error — `Go back` (V2-1.9 §5.8). */
export const LAST_GOOD = '@last-good';

export interface RestoreArgs {
  /** Repo-relative canvas path (`.design/ui/home.tsx`). */
  path: string;
  /** A version: `r<n>`, or `@last-good`. */
  at: string;
  /** Only this artboard (`history.restore-artboard`). */
  artboard?: string;
  /** Only this element, `<artboard>/<id>` (`history.restore-object`). */
  element?: string;
}

/**
 * `history.restore` keeps the v1 body `{ path, revision }`; the scoped restores
 * (artboard · object · Go back) name the version as `at`.
 */
export function restoreRequest(a: RestoreArgs): SurfaceRequest {
  const scoped = a.artboard !== undefined || a.element !== undefined || a.at === LAST_GOOD;
  if (!scoped) {
    const m = /^r?(\d{1,12})$/.exec(a.at);
    return {
      route: '/_api/project/restore',
      method: 'POST',
      body: { path: a.path, revision: Number(m?.[1]) },
    };
  }
  return {
    route: '/_api/project/restore',
    method: 'POST',
    body: {
      path: a.path,
      at: a.at,
      ...(a.artboard !== undefined ? { artboard: a.artboard } : {}),
      ...(a.element !== undefined ? { element: a.element } : {}),
    },
  };
}

/** `history.name` — `name: null` clears the name. `at` is `r<n>` or `now`. */
export function nameRequest(a: { path: string; at: string; name: string | null }): SurfaceRequest {
  return {
    route: '/_api/project/name',
    method: 'POST',
    body: { path: a.path, at: a.at, name: a.name },
  };
}

/**
 * `history.object` — "Version history · this object" (S1.16): one object's versions. `object` is
 * `<artboard>/<id>` for a canvas element, or the id of an annotation element (sticky, arrow, …).
 * A read: the server answers every role that can read the canvas, and the rows carry which of them
 * can be restored (that is judged again by `restoreRequest`'s route).
 */
export const objectHistoryRequest = (a: { path: string; object: string }): SurfaceRequest => ({
  route: '/_api/project/object-history',
  method: 'GET',
  query: { path: a.path, object: a.object },
});

/** `view.trash` — the Trash list (S1.7). */
export const trashListRequest = (): SurfaceRequest => ({ route: '/_api/trash', method: 'GET' });

/** `trash.restore` — one item, by its id (`canvas:<entry>` · `artboard:<actionId>/<id>`). */
export const trashRestoreRequest = (id: string): SurfaceRequest => ({
  route: '/_api/trash/restore',
  method: 'POST',
  body: { id },
});

/** `trash.clear` — every item, or just the named ones. Owner only; the route refuses the rest. */
export const trashClearRequest = (items?: readonly string[]): SurfaceRequest => ({
  route: '/_api/trash/clear',
  method: 'POST',
  body: items === undefined ? {} : { items: [...items] },
});

/**
 * A Trash item id — the same two shapes routes/trash.ts accepts (`CANVAS_ID` / `ARTBOARD_ID` in
 * history/trash.ts); the route stays the authority, this only spares a typo a round trip.
 */
const TRASH_ID =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  /^(?:canvas:[A-Za-z0-9_-]{1,128}|artboard:[^/]{1,128}\/[^/\u0000-\u001f\u007f-\u009f]{1,128})$/u;
export const isTrashId = (s: unknown): s is string => typeof s === 'string' && TRASH_ID.test(s);

/** The write routes above: a client/v2 file that names one must import this module. */
export const SURFACE_WRITE_ROUTES: readonly string[] = [
  '/_api/project/restore',
  '/_api/project/name',
  '/_api/trash/restore',
  '/_api/trash/clear',
];
