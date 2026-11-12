// client/v2/shell/served-routes.js — #204: the shell asks only what this server serves.
//
// In a workspace cell (`/_config.cloud` present — DDR-193 / DDR-209) the hub's door refuses the
// desktop-only routes (apps/hub/src/studio-manifest.mjs REFUSED → 404, "a cell should look like it
// never had the feature") or the studio prunes them (workspace-mode.ts FORBIDDEN_ROUTE_PREFIXES).
// The shell polled them anyway, every few seconds, forever: 318 requests in a few minutes against
// design.studyfi.com, every one a 404. Two rules:
//
//   1. A cell is told by `/_config` (the `cloud` block, the one cloud-only input the client takes):
//      the routes in CELL_UNSERVED are not asked at all.
//   2. Anywhere, a 404 from a POLLED route means "not here": that route is not asked again on this
//      page. A 404 cannot get better by asking every 8 s; a reload asks again.
//
// Task R adds the ONE-SHOT callers (a panel's mount, a tab's open — `fetchIfServed`: rule 1 only,
// since a one-shot 404 can be about the canvas it named) and the start-up race: the pollers mount
// before `/_config` answers, so at boot the shell says a config is coming (`expectServedFrom`) and the
// first asks wait for it — bounded — instead of going out blind.
//
// `test/served-routes.test.ts` holds CELL_UNSERVED to the hub manifest: every entry is refused there.

/** Routes a workspace cell never serves (the exact path, or a prefix when the entry ends in `/`). */
export const CELL_UNSERVED = Object.freeze([
  '/_api/outbox', // the outbox carries personal text and a cell is multi-user (C27)
  '/_api/sync/conflicts', // the conflict record lives on a Mac; a cell IS the copy
  '/_api/diagnostics/', // the process logs (V2-2.9) — pruned by the studio itself
  '/_api/ai/runs', // AI runs are this Mac's; a cell runs no agent (DDR-123)
  // task R — asked once per load or per open, not polled
  '/_api/index', // the project index has no per-canvas `sees` filter yet (V2-2.17)
  '/_api/thumbs/want', // cells render no pictures (V2-1.17 R7)
  '/_api/pins', // one member's pins would become everyone's
  '/_api/sync/trash', // the per-Mac quarantine list; a cell's checkout is the operator's
  '/_api/project/undo-stack', // personal undo is this Mac's
  '/_api/asset-state', // the per-Mac asset ledger
  '/_api/votes', // board votes are the hub's (S9.13)
  '/_api/agents', // which AI agents this Mac has (universal ACP B6); a cell runs no local AI
]);

/** How long a first ask waits for `/_config` before it goes out anyway. */
export const CONFIG_WAIT_MS = 4000;

let cell = false;
const gone = new Set();
/** While the shell's `/_config` is on its way: what the first asks wait on. */
let pending = null;
let settle = null;

const pathOf = (url) => {
  const s = String(url || '');
  const q = s.search(/[?#]/);
  return q === -1 ? s : s.slice(0, q);
};

/** The shell is about to read `/_config` (boot): asks made before it answers wait for it, bounded. */
export function expectServedFrom(waitMs = CONFIG_WAIT_MS) {
  if (pending) return;
  let timer = null;
  pending = new Promise((resolve) => {
    settle = resolve;
    timer = setTimeout(resolve, waitMs);
  }).then(() => {
    clearTimeout(timer);
    pending = null;
    settle = null;
  });
}

/** `/_config` arrived: is this a workspace cell? */
export function setServedFrom(cfg) {
  cell = !!(cfg && typeof cfg === 'object' && cfg.cloud);
  settle?.();
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
  if (pending) await pending;
  if (!served(url)) return UNSERVED;
  const res = await fetchImpl(url, init);
  noteServed(url, res?.status);
  return res;
}

/**
 * `fetch` for a ONE-SHOT route (a mount, an open): not asked when this server withholds it. The answer
 * is not remembered — a one-shot 404 can be about the canvas it named rather than the route.
 */
export async function fetchIfServed(url, init, fetchImpl = globalThis.fetch) {
  if (pending) await pending;
  if (!served(url)) return UNSERVED;
  return fetchImpl(url, init);
}

/** Tests only. */
export function resetServed() {
  settle?.();
  cell = false;
  gone.clear();
  pending = null;
  settle = null;
}
