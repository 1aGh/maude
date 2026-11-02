// The Share sheet's fixed map — S9.19 (desktop), P8 cloud-share (decision
// maude/v2-8.4-lead-cloud-share-via-cell-fixed-map): which `/_api/share/*` request becomes which
// `/api/access/*` call, and what may ride along. ONE map, two doors:
//
//   - the DESKTOP (`routes/share.ts`) sends the call to the linked hub with this Mac's stored
//     credential;
//   - a CLOUD CELL's hub (`apps/hub/src/routes-v2/share.mjs`) answers it itself, as the browser
//     session the request already carries, through its own access rows.
//
// Never a generic pass-through: a path or method this map does not name is not sent anywhere. Ids
// and canvas paths are validated before they become hub path segments; a body is rebuilt key by key
// from its parsed JSON (nothing else the caller sent rides along); DELETE is reached only as
// `POST …/revoke` and `POST …/remove`. The only thing decided here is a REFUSAL, never a grant: the
// hub's access API decides every permission.
//
// Pure and import-free on purpose: the hub image copies this one file (apps/hub/Dockerfile).

/** Only these ids ever reach a hub path segment (invite / person / request / link ids are opaque). */
export const SHARE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** A request body is read only this far, on both doors. */
export const MAX_SHARE_BODY = 64 * 1024;

/** The posture — answered by each door itself (the desktop asks its hub's `/health`). */
export const SHARE_POSTURE_PATH = '/_api/share/posture';

/** A designRoot-relative canvas path as the hub keys a grant — the same check the hub makes. */
export function validCanvas(c: unknown): c is string {
  if (typeof c !== 'string' || c.length === 0 || c.length > 512) return false;
  if (c.startsWith('/') || c.includes('\\') || c.includes('\0')) return false;
  return c.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

export const WIRE_ROLES = ['observer', 'viewer', 'member', 'owner'] as const;
export type WireRole = (typeof WIRE_ROLES)[number];

/** A share request body as both doors parse it: `{}` when empty, null when not a JSON object. */
export function parseShareBody(text: string | null): Record<string, unknown> | null {
  if (text === null || text.length > MAX_SHARE_BODY) return null;
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The invite body the hub reads: `{ email, role, canvas? }` — every other key dropped. */
export function inviteBody(b: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof b.email !== 'string' || b.email.length > 320) return null;
  const role = b.role ?? 'member';
  if (typeof role !== 'string' || !WIRE_ROLES.includes(role as WireRole)) return null;
  if (b.canvas !== undefined && b.canvas !== null && !validCanvas(b.canvas)) return null;
  return { email: b.email, role, ...(typeof b.canvas === 'string' ? { canvas: b.canvas } : {}) };
}

/**
 * S9.21 — the ONLY body an Ask to edit carries: `{ canvas? }`. A note, a message, any other key the
 * caller sent is dropped here, so no free text a requester typed ever reaches an owner (whose canvas
 * iframe is untrusted, DDR-054) — the owner reads who asked, for what, and when; nothing else.
 */
export function askBody(b: Record<string, unknown>): Record<string, unknown> | null {
  if (b.canvas !== undefined && b.canvas !== null && !validCanvas(b.canvas)) return null;
  return typeof b.canvas === 'string' ? { canvas: b.canvas } : {};
}

/** A requester's name as the owner reads it: one short line, no control characters. */
export const MAX_REQUEST_NAME = 80;

// \p{Cc} = C0 + C1 controls; the rest are line/paragraph separators and bidi overrides/isolates.
const CONTROL = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

/** A name for one line of the owner's toast: control and bidi characters gone, cut short. */
export function requestName(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(CONTROL, '').trim() : '';
  return s.length > MAX_REQUEST_NAME ? `${s.slice(0, MAX_REQUEST_NAME - 1)}…` : s;
}

/**
 * The open requests as the owner's Share sheet reads them, rebuilt key by key from the hub's answer:
 * `{ id, from: { name, email? }, canvas?, at }`. Whatever else a hub sent (a note, markup) is gone.
 */
export function requestRows(body: unknown): Array<Record<string, unknown>> {
  const list = (body as { requests?: unknown } | null)?.requests;
  if (!Array.isArray(list)) return [];
  const rows: Array<Record<string, unknown>> = [];
  for (const r of list.slice(0, 200)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || !SHARE_ID_RE.test(o.id)) continue;
    const from = (o.from && typeof o.from === 'object' ? o.from : {}) as Record<string, unknown>;
    const email =
      typeof from.email === 'string' &&
      from.email.length <= 320 &&
      /^[^\s@]+@[^\s@]+$/.test(from.email)
        ? from.email
        : null;
    rows.push({
      id: o.id,
      from: {
        name: requestName(from.name) || (email ? email.split('@')[0] : ''),
        ...(email ? { email } : {}),
      },
      ...(validCanvas(o.canvas) ? { canvas: o.canvas } : {}),
      at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : null,
    });
  }
  return rows;
}

// ------------------------------------------------------------------- the map

export type HubMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** One call to the hub's access API: the method, a fixed `/api/access/…` path, the rebuilt body. */
export interface HubCall {
  method: HubMethod;
  path: string;
  body?: Record<string, unknown>;
}

/** A refusal said before the hub is asked: JSON, or (a route that is not here) plain text. */
export interface ShareRefusal {
  status: number;
  json?: Record<string, unknown>;
  text?: string;
}

/**
 * Who may send a route at all, judged on the session's claim before the hub hears anything:
 *  - `any`   — every session (the hub filters by role);
 *  - `owner` — a change of who has access needs `invite` at project scope;
 *  - `link`  — the owner's, and a canvas-only session sees no route (links are project business).
 */
export type ShareGate = 'any' | 'owner' | 'link';

export interface ShareRoute {
  method: 'GET' | 'POST' | 'PATCH';
  /** The studio path, `:id` for the one opaque segment. */
  path: string;
  gate: ShareGate;
  /** True when the route reads the request body (a route that does not never parses it). */
  body: boolean;
  /** The invite / Ask to edit the desktop queues while its hub cannot be reached (the outbox). */
  queue?: 'invite' | 'ask';
  /** The answer is rebuilt row by row before the sheet reads it (the open requests). */
  reshape?: 'requests';
  build(input: {
    id: string | null;
    query: URLSearchParams;
    body: Record<string, unknown> | null;
  }): HubCall | ShareRefusal;
}

/** The words a refusal of `invite` says — the local gate's 403 shape (http.ts). */
export const NOT_OWNER: ShareRefusal = {
  status: 403,
  json: { error: 'read-only', reason: 'not-allowed', message: 'Ask the owner to change this.' },
};

/** What the studio answers for a path it does not serve (http.ts's static fall-through). */
export const MISSING_ROUTE_WORDS = 'Not found';

const refuse = (status: number, error: string, reason: string): ShareRefusal => ({
  status,
  json: { error, reason },
});
const NOT_IN_SCOPE: ShareRefusal = {
  status: 403,
  json: { error: 'not-in-scope', reason: 'not-in-scope' },
};
const seg = (id: string) => encodeURIComponent(id);

/** The words a link's rules are refused with — checked before the hub is asked. */
function linkRuleError(
  b: Record<string, unknown>,
  { create }: { create: boolean }
): ShareRefusal | null {
  if (create || b.role !== undefined) {
    if (b.role !== 'observer' && b.role !== 'viewer')
      return refuse(422, 'A link can give Can view or Can comment, never more.', 'link-role');
  }
  if ((create || b.who !== undefined) && b.who !== 'team' && b.who !== 'anyone')
    return refuse(400, 'Who is this link for?', 'who');
  if (b.canvas !== undefined && b.canvas !== null && !validCanvas(b.canvas))
    return refuse(400, 'Not a canvas.', 'canvas');
  if (
    b.expiresAt !== undefined &&
    b.expiresAt !== null &&
    !(
      typeof b.expiresAt === 'string' &&
      b.expiresAt.length <= 40 &&
      !Number.isNaN(Date.parse(b.expiresAt))
    )
  )
    return refuse(400, 'Pick a date in the future.', 'expires');
  if (b.off !== undefined && b.off !== true) return refuse(400, 'That is not a link.', 'body');
  return null;
}

const decide = (verb: 'approve' | 'decline'): ShareRoute => ({
  method: 'POST',
  path: `/_api/share/requests/:id/${verb}`,
  gate: 'owner',
  body: false,
  build: ({ id }) =>
    id
      ? { method: 'POST', path: `/api/access/requests/${seg(id)}/${verb}`, body: {} }
      : refuse(404, 'That request is no longer open.', 'gone'),
});

/** Every `/_api/share/*` route but the posture, and the one `/api/access/*` call each becomes. */
export const SHARE_ROUTES: readonly ShareRoute[] = Object.freeze([
  {
    method: 'GET',
    path: '/_api/share/me',
    gate: 'any',
    body: false,
    build: () => ({ method: 'GET', path: '/api/access/me' }),
  },
  // People with access to the canvas (or the project). The hub filters by the caller's role:
  // e-mails, invitations and requests go only to `invite` holders (V2-1.16 L17).
  {
    method: 'GET',
    path: '/_api/share/people',
    gate: 'any',
    body: false,
    build: ({ query }) => {
      const canvas = query.get('canvas');
      if (canvas !== null && !validCanvas(canvas)) return NOT_IN_SCOPE;
      const q = canvas === null ? '' : `?canvas=${encodeURIComponent(canvas)}`;
      return { method: 'GET', path: `/api/access/people${q}` };
    },
  },
  {
    method: 'POST',
    path: '/_api/share/invites',
    gate: 'owner',
    body: true,
    queue: 'invite',
    build: ({ body }) => {
      const b = body && inviteBody(body);
      if (!b) return refuse(400, 'That is not an invitation.', 'body');
      return { method: 'POST', path: '/api/access/invites', body: b };
    },
  },
  {
    method: 'POST',
    path: '/_api/share/invites/:id/resend',
    gate: 'owner',
    body: false,
    build: ({ id }) =>
      id
        ? { method: 'POST', path: `/api/access/invites/${seg(id)}/resend`, body: {} }
        : refuse(404, 'That invitation is no longer open.', 'gone'),
  },
  // Taking back a pending invitation (the role menu's Remove on an invited row).
  {
    method: 'POST',
    path: '/_api/share/invites/:id/revoke',
    gate: 'owner',
    body: false,
    build: ({ id }) =>
      id
        ? { method: 'DELETE', path: `/api/access/invites/${seg(id)}` }
        : refuse(404, 'That invitation is no longer open.', 'gone'),
  },
  {
    method: 'PATCH',
    path: '/_api/share/people/:id',
    gate: 'owner',
    body: true,
    build: ({ id, body: b }) => {
      if (!id) return refuse(404, 'That person is not on this project.', 'gone');
      if (!b || typeof b.role !== 'string' || !WIRE_ROLES.includes(b.role as WireRole))
        return refuse(400, 'That is not a role.', 'body');
      if (b.canvas !== undefined && b.canvas !== null && !validCanvas(b.canvas))
        return refuse(400, 'Not a canvas.', 'canvas');
      return {
        method: 'PATCH',
        path: `/api/access/people/${seg(id)}`,
        body: { role: b.role, ...(typeof b.canvas === 'string' ? { canvas: b.canvas } : {}) },
      };
    },
  },
  // Remove a person from the canvas (`canvas`) or the project (none) — the hub revokes.
  {
    method: 'POST',
    path: '/_api/share/people/:id/remove',
    gate: 'owner',
    body: true,
    build: ({ id, body }) => {
      if (!id) return refuse(404, 'That person is not on this project.', 'gone');
      const b = body ?? {};
      if (b.canvas !== undefined && b.canvas !== null && !validCanvas(b.canvas))
        return refuse(400, 'Not a canvas.', 'canvas');
      const q = typeof b.canvas === 'string' ? `?canvas=${encodeURIComponent(b.canvas)}` : '';
      return { method: 'DELETE', path: `/api/access/people/${seg(id)}${q}` };
    },
  },
  // S9.20 — the project's link and its rules (who can open it, the role it gives, when it ends).
  {
    method: 'POST',
    path: '/_api/share/links',
    gate: 'link',
    body: true,
    build: ({ body: raw }) => {
      if (!raw) return refuse(400, 'That is not a link.', 'body');
      const bad = linkRuleError(raw, { create: true });
      if (bad) return bad;
      return {
        method: 'POST',
        path: '/api/access/links',
        body: {
          ...(typeof raw.canvas === 'string' ? { canvas: raw.canvas } : {}),
          role: raw.role,
          who: raw.who,
          ...(raw.expiresAt !== undefined ? { expiresAt: raw.expiresAt } : {}),
        },
      };
    },
  },
  {
    method: 'PATCH',
    path: '/_api/share/links/:id',
    gate: 'link',
    body: true,
    build: ({ id, body: raw }) => {
      if (!id) return refuse(404, 'That link is no longer on.', 'gone');
      if (!raw) return refuse(400, 'That is not a link.', 'body');
      const bad = linkRuleError(raw, { create: false });
      if (bad) return bad;
      const body: Record<string, unknown> =
        raw.off === true
          ? { off: true }
          : {
              ...(raw.role !== undefined ? { role: raw.role } : {}),
              ...(raw.who !== undefined ? { who: raw.who } : {}),
              ...(raw.expiresAt !== undefined ? { expiresAt: raw.expiresAt } : {}),
            };
      return { method: 'PATCH', path: `/api/access/links/${seg(id)}`, body };
    },
  },
  // S9.21 — Ask to edit. ANY session may ask (a read-only one most of all — this is the read-only
  // person's one write); the hub decides whether it may. Only `{ canvas? }` is sent.
  {
    method: 'POST',
    path: '/_api/share/requests',
    gate: 'any',
    body: true,
    queue: 'ask',
    build: ({ body: raw }) => {
      const body = raw && askBody(raw);
      if (!body) return NOT_IN_SCOPE;
      return { method: 'POST', path: '/api/access/requests', body };
    },
  },
  // The open requests — the owner's (the request block at the top of Share). Rebuilt row by row.
  {
    method: 'GET',
    path: '/_api/share/requests',
    gate: 'owner',
    body: false,
    reshape: 'requests',
    build: () => ({ method: 'GET', path: '/api/access/requests' }),
  },
  // Let Petra edit / Not now — the owner's; the hub re-checks `invite` and writes the grant.
  decide('approve'),
  decide('decline'),
] satisfies ShareRoute[]);

/** The map's route for a studio path + method, by its `:id` spelling (the desktop table's key). */
export function shareRoute(method: string, path: string): ShareRoute {
  const r = SHARE_ROUTES.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`share-map: ${method} ${path} is not in the fixed map`);
  return r;
}

/**
 * Match a concrete request path. The `:id` segment matches one segment of any shape — an id the
 * map would not send is the route's own 404 (`build` gets `id: null`), never another route's.
 */
export function matchShareRoute(
  method: string,
  pathname: string
): { route: ShareRoute; id: string | null } | null {
  const parts = pathname.split('/');
  for (const route of SHARE_ROUTES) {
    if (route.method !== method) continue;
    const want = route.path.split('/');
    if (want.length !== parts.length) continue;
    let raw: string | null = null;
    let ok = true;
    for (let i = 0; i < want.length; i += 1) {
      if (want[i] === ':id') {
        if (!parts[i]) {
          ok = false;
          break;
        }
        try {
          // decoded once, as the studio's route table decodes a param (`routes/table.ts`)
          raw = decodeURIComponent(parts[i] as string);
        } catch {
          raw = null;
        }
      } else if (want[i] !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    return { route, id: shareId(raw) };
  }
  return null;
}

/** A path segment as an id the map sends, or null. Never decoded: an escaped id is not an id. */
export function shareId(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && SHARE_ID_RE.test(raw) ? raw : null;
}

/**
 * The refusal a route's gate says before the hub is asked, or null. `access` is the session's claim
 * as the one predicate module resolves it (`scope.ts` `resolveAccess`). Hiding, never granting.
 */
export function shareGateRefusal(
  gate: ShareGate,
  access: { can(cap: string, canvas: string | null): boolean; canvasOnly?: boolean }
): ShareRefusal | null {
  if (gate === 'any') return null;
  if (gate === 'link' && access.canvasOnly) return { status: 404, text: MISSING_ROUTE_WORDS };
  return access.can('invite', null) ? null : NOT_OWNER;
}
