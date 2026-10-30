// The cloud tab's Share door — P8 cloud-share (decision maude/v2-8.4-lead-cloud-share-via-cell-fixed-map).
//
// The Share sheet and Ask to edit call `/_api/share/*` in every shell — one client path. On a
// desktop the studio answers it (routes/share.ts: the linked hub's `/api/access/*`, with this Mac's
// stored credential). In a cell the studio child is linked to nothing and refuses the family
// (studio-manifest.mjs, S9.19/S9.21), so the HUB answers it here, before the studio lane:
//
//   - by the SAME fixed map the desktop uses (`apps/studio/access/share-map.ts`, imported, never
//     forked): a path or method the map does not name answers 404; ids and canvas paths are
//     validated before they become access paths; the body is rebuilt key by key; DELETE is reached
//     only as `POST …/revoke` / `…/remove`;
//   - as the browser session the request already carries (`maude_studio` — a token in this hub's own
//     store, the one `browserSession` vouches for), judged by this hub's access rows (`./access.mjs`)
//     exactly as a bearer of that session's role is judged there: the same gate, the same handler,
//     the same per-role answers. Owner-only actions stay owner-only; a viewer may only ask. The map's
//     own owner gate refuses first, so nothing reaches the access API that the desktop would not send;
//   - only for the cell's own page: a cookie rides on every request a browser makes, so every method
//     needs `Sec-Fetch-Site: same-origin`, and an `Origin` that is present must be this hub's own
//     (`formOriginAllowed`, the rule the hub's cookie-setting forms use).
//
// No second auth mode: a bearer alone is not a session here (a desktop asks `/api/access/*`). The
// access call is built from scratch — the cookie, the caller's headers and the caller's query never
// reach it. The canvas origin never reaches this row (`CANVAS_ORIGIN_ROW` has no handler).

import { Readable } from 'node:stream';
import { resolveAccess } from '../../../studio/access/scope.ts';
import {
  matchShareRoute,
  parseShareBody,
  requestRows,
  SHARE_POSTURE_PATH,
  shareGateRefusal,
} from '../../../studio/access/share-map.ts';
import { claimForMatch, hubAccessRefusal } from '../access-gate.mjs';
import { BROWSER_SESSION_COOKIE, cookieValue, formOriginAllowed } from '../browser-auth.mjs';
import { ACCESS_ROWS, withRolesV2 } from './access.mjs';

export const SHARE_PREFIX = '/_api/share/';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_BODY = 64 * 1024;

const CROSS_SITE = Object.freeze({
  error: 'Open Share from this project’s own page.',
  reason: 'cross-site',
});

/** Only the cell's own page: `Sec-Fetch-Site: same-origin`, and an Origin (if any) of this hub. */
export function sameOriginShareRequest(request, publicUrl) {
  const h = request?.headers ?? {};
  const site = String(h['sec-fetch-site'] ?? '')
    .trim()
    .toLowerCase();
  if (site !== 'same-origin') return false;
  const origin = String(h.origin ?? '').trim();
  if (!origin) return true;
  return formOriginAllowed({ headers: { origin, host: h.host } }, publicUrl);
}

/** The request body as text, at most `MAX_BODY` bytes (null past it, or on a read error). */
function readText(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    request.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        finish(null);
        request.destroy?.();
        return;
      }
      chunks.push(c);
    });
    request.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => finish(null));
  });
}

/** The access row a mapped call lands on — only `/api/access/*` rows, never `/internal/*`. */
function accessRowFor(path) {
  let prefix = null;
  for (const row of ACCESS_ROWS) {
    if (!row.path.startsWith('/api/access/')) continue;
    if (row.path.endsWith('*')) {
      const p = row.path.slice(0, -1);
      if (path.startsWith(p) && (!prefix || row.path.length > prefix.path.length)) prefix = row;
    } else if (row.path === path) {
      return row;
    }
  }
  return prefix;
}

/**
 * The access call, as the session: a request built from scratch (the session's own token as the
 * bearer the access rows verify, the map's path and body, nothing else), through the row's gate and
 * handler — exactly the path a bearer of that session takes.
 */
async function callAccess(ctx, token, call, respondJson) {
  const pathOnly = call.path.split('?')[0];
  const row = accessRowFor(pathOnly);
  if (!row) {
    respondJson(404, { error: 'not found' });
    return true;
  }
  const text = call.body ? JSON.stringify(call.body) : '';
  const inner = Readable.from(text ? [Buffer.from(text)] : []);
  inner.method = call.method;
  inner.url = call.path;
  inner.headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    ...(text ? { 'content-type': 'application/json' } : {}),
  };
  const capability = SAFE_METHODS.has(call.method) ? row.cap.safe : row.cap.unsafe;
  const refusal = hubAccessRefusal({
    request: inner,
    capability,
    scope: row.scope,
    canvasDoor: row.canvasDoor === true,
    verify: ctx.verify,
  });
  if (refusal) {
    respondJson(refusal.status, refusal.body);
    return true;
  }
  await row.handler({
    ...ctx,
    request: inner,
    method: call.method,
    path: pathOnly,
    row,
    capability,
    scope: row.scope,
    respondJson,
  });
  return true;
}

/**
 * `/_api/share/*` on a hub that serves a studio. Returns false (the request falls through, as on a
 * hub without this door) when this hub runs no studio.
 */
export async function handleShareDoor(ctx) {
  const door = ctx.deps?.share;
  if (!door || !ctx.deps?.access) return false;
  const respond = ctx.respondJson;

  if (!sameOriginShareRequest(ctx.request, door.publicUrl ?? null)) {
    respond(403, { ...CROSS_SITE });
    return true;
  }
  // The session the request carries — before the route, so a stranger learns nothing of the map.
  const session = ctx.deps.browserSession?.(ctx.request) ?? null;
  const token = cookieValue(ctx.request, BROWSER_SESSION_COOKIE);
  let match = null;
  try {
    match = session && token ? ctx.verify(token) : null;
  } catch {
    match = null;
  }
  if (!session || !match) {
    respond(401, { error: 'sign in to open this project' });
    return true;
  }
  const access = resolveAccess(claimForMatch(match));

  // The posture: what this hub holds (its `/health.access`), and whether this session may invite.
  if (ctx.path === SHARE_POSTURE_PATH) {
    if (ctx.method !== 'GET') {
      respond(404, { error: 'not found' });
      return true;
    }
    const svc = ctx.deps.access;
    respond(200, {
      linked: true,
      reachable: true,
      you: { invite: access.can('invite', null) },
      hub: door.publicUrl ?? null,
      capabilities: withRolesV2([], svc.rolesV2Options),
      access: svc.posture(),
    });
    return true;
  }

  const found = matchShareRoute(ctx.method, ctx.path);
  if (!found) {
    respond(404, { error: 'not found' });
    return true;
  }
  const { route, id } = found;
  const gate = shareGateRefusal(route.gate, access);
  if (gate) {
    if (gate.text !== undefined) {
      ctx.response.writeHead(gate.status, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      ctx.response.end(gate.text);
    } else {
      respond(gate.status, gate.json ?? {});
    }
    return true;
  }
  const url = new URL(ctx.request.url ?? ctx.path, 'http://hub.invalid');
  const call = route.build({
    id,
    query: url.searchParams,
    body: route.body ? parseShareBody(await readText(ctx.request)) : null,
  });
  if (!('method' in call)) {
    respond(call.status, call.json ?? {});
    return true;
  }
  // The open requests are rebuilt row by row before the sheet reads them (as on the desktop).
  const respondAs =
    route.reshape === 'requests'
      ? (status, body) => respond(status, status === 200 ? { requests: requestRows(body) } : body)
      : respond;
  return callAccess(ctx, token, call, respondAs);
}

/**
 * The row. `cap: null` — the gate checks nothing here: the door authenticates with the browser
 * session, not a peer token, and answers for itself (the access rows judge the call it makes).
 * `canvasDoor`: a canvas-only session is answered per target by the access rows.
 */
export const SHARE_ROWS = Object.freeze([
  Object.freeze({
    path: '/_api/share/*',
    cap: Object.freeze({ safe: null, unsafe: null }),
    scope: 'filtered',
    handler: handleShareDoor,
    canvasDoor: true,
  }),
]);
