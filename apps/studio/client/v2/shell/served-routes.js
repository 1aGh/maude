// client/v2/shell/served-routes.js — #204: the shell polls only what this server serves.
//
// In a workspace cell (`/_config.cloud` present — DDR-193 / DDR-209) the hub's door refuses the
// desktop-only routes (apps/hub/src/studio-manifest.mjs REFUSED → 404, "a cell should look like it
// never had the feature") or the studio prunes them (workspace-mode.ts FORBIDDEN_ROUTE_PREFIXES).
// The shell polled them anyway, every few seconds, forever: 318 requests in a few minutes against
// design.studyfi.com, every one a 404. Two rules:
//
//   1. A cell is told by `/_config` (the `cloud` block, the one cloud-only input the client takes):
//      the routes in CELL_UNSERVED are not asked at all.
//   2. Anywhere, a 404 from a polled route means "not here": that route is not asked again on this
//      page. A 404 cannot get better by asking every 8 s; a reload asks again.
//
// `test/served-routes.test.ts` holds CELL_UNSERVED to the hub manifest: every entry is refused there.

/** Polled routes a workspace cell never serves (prefix match on the path). */
export const CELL_UNSERVED = Object.freeze([
  '/_api/outbox', // the outbox carries personal text and a cell is multi-user (C27)
  '/_api/sync/conflicts', // the conflict record lives on a Mac; a cell IS the copy
  '/_api/diagnostics/', // the process logs (V2-2.9) — pruned by the studio itself
  '/_api/ai/runs', // AI runs are this Mac's; a cell runs no agent (DDR-123)
]);

let cell = false;
const gone = new Set();

const pathOf = (url) => {
  const s = String(url || '');
  const q = s.search(/[?#]/);
  return q === -1 ? s : s.slice(0, q);
};

/** `/_config` arrived: is this a workspace cell? */
export function setServedFrom(cfg) {
  cell = !!(cfg && typeof cfg === 'object' && cfg.cloud);
}

/** Should the shell ask this route at all? */
export function served(url) {
  const path = pathOf(url);
  if (gone.has(path)) return false;
  if (cell && CELL_UNSERVED.some((p) => path === p || (p.endsWith('/') && path.startsWith(p))))
    return false;
  return true;
}

/** What the route answered. A 404 means it is not here: it is not polled again on this page. */
export function noteServed(url, status) {
  if (status === 404) gone.add(pathOf(url));
}

/** The answer an unserved route gets without a request: a 404, like the server's own. */
const UNSERVED = Object.freeze({
  ok: false,
  status: 404,
  json: async () => null,
  text: async () => '',
});

/** `fetch` for a POLLED route: unserved routes are not asked, and a 404 is remembered. */
export async function servedFetch(url, init, fetchImpl = globalThis.fetch) {
  if (!served(url)) return UNSERVED;
  const res = await fetchImpl(url, init);
  noteServed(url, res?.status);
  return res;
}

/** Tests only. */
export function resetServed() {
  cell = false;
  gone.clear();
}
