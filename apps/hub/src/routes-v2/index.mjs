// The hub's ONE route table — S9.3, decision v2-S9-hub-v2-route-table (S9-slices Q12).
//
// `server.mjs onRequest` is ~4,100 lines and five slices would otherwise each add
// a branch to it in parallel. Instead every hub route is a ROW here — the routes
// that predate v2 (`legacy.mjs`, still served by their `server.mjs` branches) and
// every new v2 route (one file per area: `access.mjs` S9.6, `comments.mjs` S9.7,
// `present.mjs` / `votes.mjs` S9.13), which carry their own `handler`.
//
// `onRequest` calls `runHubRoutes` ONCE. It classifies the request, runs the
// access gate (`../access-gate.mjs`) at the row's capability, and — when the row
// has a handler — answers it. A row:
//
//   { path | pattern, cap: { safe, unsafe }, scope, handler? }
//
//   path     exact ('/api/history'), or a prefix when it ends in '*'
//            ('/assets/*', '/api/file-uploads*'); `pattern` is a RegExp instead.
//   cap      the capability the access gate requires per method half — `safe` for
//            GET/HEAD/OPTIONS, `unsafe` for the rest; `null` = the gate checks
//            nothing (the route authenticates with something that is not a peer
//            token and answers for itself).
//   scope    V2-1.16 U3: 'none' | 'canvas' | 'filtered' | 'project'.
//   handler  async (ctx) => boolean — v2 routes only. A legacy row has none.
//   canvasDoor  true when the route's handler answers a canvas-only session
//            itself (filters or refuses per target, V2-1.16 U1); absent, the
//            access gate refuses every canvas-only session there (fail closed).
//
// A path no row names is the STUDIO's (the cell proxy and its own manifest,
// `studio-manifest.mjs`, classify it): `DEFAULT_ROW` keeps the pre-v2 peer gate
// there — a write needs `edit`.
//
// A v2 handler runs here, BEFORE `server.mjs`'s format gate. A v2 write door the
// project format must fence (V2-1.12 §5.4) asks the format itself.

import { hubAccessRefusal } from '../access-gate.mjs';
import { CAPABILITIES } from '../role-matrix.mjs';
import { LEGACY_ROWS } from './legacy.mjs';

/** V2-1.16 U3 — the four scope classes. Anything else is unclassified. */
export const SCOPES = Object.freeze(['none', 'canvas', 'filtered', 'project']);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Every v2 area's rows, in one list. Later slices append their area here. */
export const HUB_ROUTE_ROWS = Object.freeze([...LEGACY_ROWS]);

/** The studio's lane (and any path no row names): the pre-v2 write gate. */
export const DEFAULT_ROW = Object.freeze({
  path: '*',
  cap: Object.freeze({ safe: null, unsafe: 'edit' }),
  scope: 'project',
  delegate: 'studio-manifest',
});

/**
 * The canvas origin (DDR-054) is one lane whatever its path: it is authenticated by
 * a render capability in the URL (`studio-proxy.mjs handleCanvas`), never a peer
 * token. A peer token presented there still meets the pre-v2 write gate.
 */
export const CANVAS_ORIGIN_ROW = Object.freeze({
  path: '*',
  host: 'canvas',
  cap: Object.freeze({ safe: null, unsafe: 'edit' }),
  scope: 'canvas',
});

const isPrefix = (row) => typeof row.path === 'string' && row.path.endsWith('*');
const prefixOf = (row) => row.path.slice(0, -1);

/**
 * Validate a table: every row names a path or a pattern, a known scope, and only
 * capabilities the one matrix has (R6); no exact path or prefix appears twice.
 * Runs at import for the real table, so a typo is a boot failure, not a silent
 * allow or a silent deny.
 */
export function checkHubRouteTable(rows) {
  const seen = new Set();
  for (const row of rows) {
    const key = row.pattern ? `re:${row.pattern.source}` : row.path;
    if (typeof key !== 'string' || key === '' || key === '*') {
      throw new Error('routes-v2: a row needs a path or a pattern');
    }
    if (seen.has(key)) throw new Error(`routes-v2: '${key}' is classified twice`);
    seen.add(key);
    if (!SCOPES.includes(row.scope)) {
      throw new Error(`routes-v2: '${key}' has no scope class (V2-1.16 U3)`);
    }
    if (!row.cap || !('safe' in row.cap) || !('unsafe' in row.cap)) {
      throw new Error(`routes-v2: '${key}' must state cap.safe and cap.unsafe`);
    }
    for (const c of [row.cap.safe, row.cap.unsafe]) {
      if (c !== null && !CAPABILITIES.includes(c)) {
        throw new Error(`routes-v2: '${key}' names '${c}', not a capability in the matrix`);
      }
    }
    if (row.canvasDoor !== undefined && typeof row.canvasDoor !== 'boolean') {
      throw new Error(`routes-v2: '${key}' canvasDoor must be a boolean`);
    }
    if (row.handler !== undefined && typeof row.handler !== 'function') {
      throw new Error(`routes-v2: '${key}' has a handler that is not a function`);
    }
  }
  return rows;
}

/**
 * The row for one path: an exact path, then a pattern, then the longest prefix.
 * `null` when no row names it.
 */
export function rowFor(path, rows = HUB_ROUTE_ROWS) {
  let prefix = null;
  let pattern = null;
  for (const row of rows) {
    if (row.pattern) {
      if (!pattern && row.pattern.test(path)) pattern = row;
    } else if (isPrefix(row)) {
      if (path.startsWith(prefixOf(row)) && (!prefix || row.path.length > prefix.path.length)) {
        prefix = row;
      }
    } else if (row.path === path) {
      return row;
    }
  }
  return pattern ?? prefix;
}

/**
 * Classify one request.
 *
 * @returns {{ row: object, capability: string | null, scope: string }}
 */
export function classifyHubRequest(
  method,
  path,
  { canvasHost = false, rows = HUB_ROUTE_ROWS } = {}
) {
  const row = canvasHost ? CANVAS_ORIGIN_ROW : (rowFor(path, rows) ?? DEFAULT_ROW);
  const capability = SAFE_METHODS.has(method) ? row.cap.safe : row.cap.unsafe;
  return { row, capability, scope: row.scope };
}

/**
 * The one call `onRequest` makes. Returns true when it answered the request (a
 * refusal, or a v2 handler that handled it); false to let the legacy branches
 * below it run.
 *
 * @param {{
 *   request: object, response: object, method: string, path: string,
 *   canvasHost?: boolean,
 *   verify: (token: string) => object | null,
 *   respondJson: (status: number, body: object) => void,
 *   deps?: object,
 *   rows?: readonly object[],
 * }} ctx
 */
export async function runHubRoutes(ctx) {
  const { method, path, canvasHost = false, rows = HUB_ROUTE_ROWS } = ctx;
  const { row, capability, scope } = classifyHubRequest(method, path, { canvasHost, rows });
  const refusal = hubAccessRefusal({
    request: ctx.request,
    capability,
    scope,
    canvasDoor: row.canvasDoor === true,
    verify: ctx.verify,
  });
  if (refusal) {
    ctx.respondJson(refusal.status, refusal.body);
    return true;
  }
  if (typeof row.handler !== 'function') return false;
  return (await row.handler({ ...ctx, row, capability, scope })) === true;
}

checkHubRouteTable(HUB_ROUTE_ROWS);
