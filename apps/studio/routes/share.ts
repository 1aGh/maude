// Share — S9.19 (V2-1.7 §5.6 / §5.9, S9-slices Q13): the desktop's door to the linked hub's
// access API, for the Share sheet (client/v2/share/).
//
// THE HUB DECIDES EVERY PERMISSION. This file is a fixed map from the studio's own paths to the
// hub's `/api/access/*` (never a generic pass-through: a path the map does not name is not sent),
// carrying the ONE credential this Mac stored for that hub at sign-in — the caller's own. Nothing
// the browser sent rides along: no cookie, no Authorization, no header at all; a write's body is
// re-serialised from its parsed JSON. The hub's answer comes back with its status and its own words.
//
// The only thing said here before the hub is asked is a REFUSAL, never a grant (V2-1.7 rule 12,
// hidden ≠ refused): a change of who has access needs `invite` in this session's claim
// (`currentAccess()`, the claim the hub itself issued). A session that lacks it hears the local
// gate's 403 — the same body every refused write gets — and nothing leaves this Mac.
//
// MAIN ORIGIN ONLY (`origin: 'main'`): in neither canvas allowlist, so a planted canvas reaches no
// person's e-mail and changes no role. `guardTableRoute` gives every one the Origin + DNS-rebinding
// double gate (CSRF like every privileged write).
//
// An invite that cannot reach the hub (this Mac is offline, the hub is down) is not lost: it goes
// into the outbox (V2-1.14, kind `share.invite`) and `shareInviteSender` sends it once the hub
// answers — "Invites send when this Mac is online."

import { currentAccess } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import type { Sender } from '../outbox/drain.ts';
import { maskEmail, type Outbox } from '../outbox/index.ts';
import type { IntentPayload, Role as IntentRole, ShareScope } from '../outbox/types.ts';
import type { RouteSpec } from './table.ts';

/** The linked hub and THIS Mac's credential for it, or null (unlinked, or never signed in). */
export interface LinkedHub {
  url: string;
  token: string;
}

export interface ShareRouteDeps {
  /** The linked hub with its stored credential — corroborated (DDR: a committed config names it). */
  hub(): LinkedHub | null;
  /** This request's session (default `currentAccess()`). */
  access?: () => Access;
  /** Where an invite waits while the hub cannot be reached. Absent = the hub's error is answered. */
  outbox?: Pick<Outbox, 'enqueue'>;
  /** Who and which Mac queued it (the outbox record's `actor` / `device`). */
  actor?: () => string;
  device?: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** The hub's answer is read only this far (a cell is not trusted to respect its own limits). */
export const MAX_SHARE_RESPONSE = 1024 * 1024;
const MAX_BODY = 64 * 1024;

export const OFFLINE_INVITE_WORDS = 'Invites send when this Mac is online.';
const NOT_LINKED = 'Share this project to the cloud first.';
const UNREACHABLE = 'Sharing is not available right now. Try again in a minute.';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** The local gate's refusal (http.ts `readOnlyRefusalResponse` shape), in the access words. */
function notOwner(): Response {
  return json(403, {
    error: 'read-only',
    reason: 'not-allowed',
    message: 'Ask the owner to change this.',
  });
}

/** Only these ids ever reach a hub path segment (invite / person / request ids are opaque). */
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** A designRoot-relative canvas path as the hub keys a grant — the same check the hub makes. */
export function validCanvas(c: unknown): c is string {
  if (typeof c !== 'string' || c.length === 0 || c.length > 512) return false;
  if (c.startsWith('/') || c.includes('\\') || c.includes('\0')) return false;
  return c.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

type HubAnswer = { ok: true; status: number; body: unknown } | { ok: false; network: true };

async function readCapped(res: Response, max: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => null);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * One call to the hub. The ONLY headers are built here: the stored credential and, for a body, its
 * content type. The token never appears in an answer or a log line.
 */
async function callHub(
  deps: ShareRouteDeps,
  hub: LinkedHub,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: Record<string, unknown>
): Promise<HubAnswer> {
  const doFetch = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${hub.url.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${hub.token}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
  } catch {
    return { ok: false, network: true };
  }
  if (res.status === 204) return { ok: true, status: 204, body: null };
  // A redirect is not an answer (a captive portal, a moved hub): never followed with the token.
  if (res.status >= 300 && res.status < 400) return { ok: false, network: true };
  let text: string | null;
  try {
    text = await readCapped(res, MAX_SHARE_RESPONSE);
  } catch {
    return { ok: false, network: true };
  }
  if (text === null) return { ok: true, status: 502, body: { error: UNREACHABLE, reason: 'size' } };
  try {
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    return { ok: true, status: res.status, body: parsed };
  } catch {
    return { ok: true, status: 502, body: { error: UNREACHABLE, reason: 'control-plane' } };
  }
}

const relay = (a: HubAnswer): Response =>
  !a.ok
    ? json(503, { error: UNREACHABLE, reason: 'unreachable' })
    : a.status === 204
      ? new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
      : json(a.status, a.body);

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text().catch(() => null);
  if (text === null || text.length > MAX_BODY) return null;
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const WIRE_ROLES = ['observer', 'viewer', 'member', 'owner'] as const;
type WireRole = (typeof WIRE_ROLES)[number];
const TO_INTENT: Record<string, IntentRole> = {
  observer: 'view',
  viewer: 'comment',
  member: 'edit',
};
const ROLE_WORD: Record<IntentRole, string> = {
  view: 'Can view',
  comment: 'Can comment',
  edit: 'Can edit',
};
const FROM_INTENT: Record<IntentRole, WireRole> = {
  view: 'observer',
  comment: 'viewer',
  edit: 'member',
};

/** The invite body the hub reads: `{ email, role, canvas? }` — every other key dropped. */
function inviteBody(b: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof b.email !== 'string' || b.email.length > 320) return null;
  const role = b.role ?? 'member';
  if (typeof role !== 'string' || !WIRE_ROLES.includes(role as WireRole)) return null;
  if (b.canvas !== undefined && b.canvas !== null && !validCanvas(b.canvas)) return null;
  return { email: b.email, role, ...(typeof b.canvas === 'string' ? { canvas: b.canvas } : {}) };
}

/**
 * The outbox's door for `share.invite` (V2-1.14 §5.4): the queued invite, sent to the hub this
 * project is linked to NOW. A different or no linked hub is a final answer, never a guess.
 */
export function shareInviteSender(deps: ShareRouteDeps): Sender {
  return async (record) => {
    const p = record.payload as Extract<IntentPayload, { kind: 'share.invite' }>;
    const hub = deps.hub();
    if (!hub) return { ok: false, status: 409, code: 'not-linked', message: NOT_LINKED };
    if (record.project.hub && record.project.hub !== hub.url)
      return { ok: false, status: 409, code: 'not-linked', message: NOT_LINKED };
    const canvas = typeof p.scope === 'object' ? p.scope.canvas : undefined;
    const a = await callHub(deps, hub, 'POST', '/api/access/invites', {
      email: p.email,
      role: FROM_INTENT[p.role] ?? 'member',
      ...(canvas ? { canvas } : {}),
    });
    if (!a.ok) return { ok: false, network: true };
    const body = (a.body ?? {}) as { id?: unknown; error?: unknown; reason?: unknown };
    if (a.status >= 200 && a.status < 300)
      return { ok: true, ...(typeof body.id === 'string' ? { ref: body.id } : {}) };
    return {
      ok: false,
      status: a.status,
      ...(typeof body.reason === 'string' ? { code: body.reason } : {}),
      ...(typeof body.error === 'string' ? { message: body.error } : {}),
    };
  };
}

export function createShareRoutes(deps: ShareRouteDeps): RouteSpec[] {
  const access = () => (deps.access ?? currentAccess)();
  /** Every owner action: a session without `invite` is refused HERE, before the hub hears it. */
  const asOwner =
    (handle: (req: Request, params: Record<string, string>, hub: LinkedHub) => Promise<Response>) =>
    async (req: Request, params: Record<string, string>): Promise<Response> => {
      if (!access().can('invite', null)) return notOwner();
      const hub = deps.hub();
      if (!hub) return json(409, { error: NOT_LINKED, reason: 'not-linked' });
      return handle(req, params, hub);
    };
  const idOf = (params: Record<string, string>) =>
    ID_RE.test(params.id ?? '') ? encodeURIComponent(params.id as string) : null;

  return [
    // What this project's server can hold (§5.6 `/health.access`). Public on the hub; asked here so
    // the sheet never names a hub address itself. `linked: false` = a local project.
    {
      method: 'GET',
      path: '/_api/share/posture',
      origin: 'main',
      readOnly: 'allowed',
      handle: async () => {
        const hub = deps.hub();
        if (!hub) return json(200, { linked: false });
        // The claim this Mac holds (the hub issued it): lets the sheet draw Invite while the hub
        // cannot be asked, so an offline invite can queue. It only ever hides; it grants nothing.
        const you = { invite: access().can('invite', null) };
        const doFetch = deps.fetchImpl ?? fetch;
        try {
          const res = await doFetch(`${hub.url.replace(/\/+$/, '')}/health`, {
            headers: { accept: 'application/json' },
            redirect: 'manual',
            signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
          });
          const text = res.ok ? await readCapped(res, 64 * 1024) : null;
          const h = text ? (JSON.parse(text) as Record<string, unknown>) : null;
          if (!h) return json(200, { linked: true, reachable: false, you, hub: hub.url });
          const capabilities = Array.isArray(h.capabilities)
            ? h.capabilities.filter((c): c is string => typeof c === 'string')
            : [];
          return json(200, {
            linked: true,
            reachable: true,
            you,
            // S9.20 — Share › Advanced › Where it syncs (the address config.json already names)
            hub: hub.url,
            capabilities,
            access: h.access && typeof h.access === 'object' ? h.access : null,
          });
        } catch {
          return json(200, { linked: true, reachable: false, you, hub: hub.url });
        }
      },
    },
    {
      method: 'GET',
      path: '/_api/share/me',
      origin: 'main',
      readOnly: 'allowed',
      handle: async () => {
        const hub = deps.hub();
        if (!hub) return json(409, { error: NOT_LINKED, reason: 'not-linked' });
        return relay(await callHub(deps, hub, 'GET', '/api/access/me'));
      },
    },
    // People with access to the canvas (or the project). The hub filters by the caller's role:
    // e-mails, invitations and requests go only to `invite` holders (V2-1.16 L17).
    {
      method: 'GET',
      path: '/_api/share/people',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const hub = deps.hub();
        if (!hub) return json(409, { error: NOT_LINKED, reason: 'not-linked' });
        const canvas = new URL(req.url).searchParams.get('canvas');
        if (canvas !== null && !validCanvas(canvas))
          return json(403, { error: 'not-in-scope', reason: 'not-in-scope' });
        const q = canvas === null ? '' : `?canvas=${encodeURIComponent(canvas)}`;
        return relay(await callHub(deps, hub, 'GET', `/api/access/people${q}`));
      },
    },
    {
      method: 'POST',
      path: '/_api/share/invites',
      origin: 'main',
      readOnly: 'refused',
      handle: asOwner(async (req, _p, hub) => {
        const raw = await readBody(req);
        const body = raw && inviteBody(raw);
        if (!body) return json(400, { error: 'That is not an invitation.', reason: 'body' });
        const a = await callHub(deps, hub, 'POST', '/api/access/invites', body);
        if (a.ok || !deps.outbox) return relay(a);
        // The hub cannot be reached: the invite waits in the outbox (V2-1.14) and sends itself.
        const role = TO_INTENT[body.role as string];
        if (!role) return relay(a); // `owner` is never queued — the hub refuses it anyway
        const scope: ShareScope =
          typeof body.canvas === 'string' ? { canvas: body.canvas } : 'project';
        const r = deps.outbox.enqueue({
          kind: 'share.invite',
          actor: deps.actor?.() ?? 'you',
          device: deps.device?.() ?? 'studio',
          project: { id: null, hub: hub.url },
          label: `Invite ${maskEmail(String(body.email))} · ${ROLE_WORD[role]}`,
          payload: { kind: 'share.invite', email: String(body.email), role, scope },
          gates: ['hub'],
        });
        if (!r.ok) return json(503, { error: UNREACHABLE, reason: r.code });
        return json(202, { queued: true, id: r.record.id, words: OFFLINE_INVITE_WORDS });
      }),
    },
    {
      method: 'POST',
      path: '/_api/share/invites/:id/resend',
      origin: 'main',
      readOnly: 'refused',
      handle: asOwner(async (_req, params, hub) => {
        const id = idOf(params);
        if (!id) return json(404, { error: 'That invitation is no longer open.', reason: 'gone' });
        return relay(await callHub(deps, hub, 'POST', `/api/access/invites/${id}/resend`, {}));
      }),
    },
    // Taking back a pending invitation (the role menu's Remove on an invited row).
    {
      method: 'POST',
      path: '/_api/share/invites/:id/revoke',
      origin: 'main',
      readOnly: 'refused',
      handle: asOwner(async (_req, params, hub) => {
        const id = idOf(params);
        if (!id) return json(404, { error: 'That invitation is no longer open.', reason: 'gone' });
        return relay(await callHub(deps, hub, 'DELETE', `/api/access/invites/${id}`));
      }),
    },
    {
      method: 'PATCH',
      path: '/_api/share/people/:id',
      origin: 'main',
      readOnly: 'refused',
      handle: asOwner(async (req, params, hub) => {
        const id = idOf(params);
        if (!id) return json(404, { error: 'That person is not on this project.', reason: 'gone' });
        const b = await readBody(req);
        if (!b || typeof b.role !== 'string' || !WIRE_ROLES.includes(b.role as WireRole))
          return json(400, { error: 'That is not a role.', reason: 'body' });
        if (b.canvas !== undefined && b.canvas !== null && !validCanvas(b.canvas))
          return json(400, { error: 'Not a canvas.', reason: 'canvas' });
        return relay(
          await callHub(deps, hub, 'PATCH', `/api/access/people/${id}`, {
            role: b.role,
            ...(typeof b.canvas === 'string' ? { canvas: b.canvas } : {}),
          })
        );
      }),
    },
    // Remove a person from the canvas (`canvas`) or the project (none) — the hub revokes.
    {
      method: 'POST',
      path: '/_api/share/people/:id/remove',
      origin: 'main',
      readOnly: 'refused',
      handle: asOwner(async (req, params, hub) => {
        const id = idOf(params);
        if (!id) return json(404, { error: 'That person is not on this project.', reason: 'gone' });
        const b = (await readBody(req)) ?? {};
        if (b.canvas !== undefined && b.canvas !== null && !validCanvas(b.canvas))
          return json(400, { error: 'Not a canvas.', reason: 'canvas' });
        const q = typeof b.canvas === 'string' ? `?canvas=${encodeURIComponent(b.canvas)}` : '';
        return relay(await callHub(deps, hub, 'DELETE', `/api/access/people/${id}${q}`));
      }),
    },
    // S9.20 (10 co-share-advanced) — the project's link and its rules. The owner's: who can open
    // it (`team` = a location that grants nothing, `anyone` = a signed-in account holding the
    // link), the role it gives (Can view / Can comment, never more) and when it ends. A canvas-only
    // session hears what a route that is not here says (V2-1.16 U1): links are project business.
    {
      method: 'POST',
      path: '/_api/share/links',
      origin: 'main',
      readOnly: 'refused',
      handle: linkRoute(async (req, _p, hub) => {
        const raw = await readBody(req);
        if (!raw) return json(400, { error: 'That is not a link.', reason: 'body' });
        const bad = linkRuleError(raw, { create: true });
        if (bad) return bad;
        return relay(
          await callHub(deps, hub, 'POST', '/api/access/links', {
            ...(typeof raw.canvas === 'string' ? { canvas: raw.canvas } : {}),
            role: raw.role,
            who: raw.who,
            ...(raw.expiresAt !== undefined ? { expiresAt: raw.expiresAt } : {}),
          })
        );
      }),
    },
    {
      method: 'PATCH',
      path: '/_api/share/links/:id',
      origin: 'main',
      readOnly: 'refused',
      handle: linkRoute(async (req, params, hub) => {
        const id = idOf(params);
        if (!id) return json(404, { error: 'That link is no longer on.', reason: 'gone' });
        const raw = await readBody(req);
        if (!raw) return json(400, { error: 'That is not a link.', reason: 'body' });
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
        return relay(await callHub(deps, hub, 'PATCH', `/api/access/links/${id}`, body));
      }),
    },
  ];

  /** The link routes: a canvas-only session sees no route; any other non-owner is refused. */
  function linkRoute(
    handle: (req: Request, params: Record<string, string>, hub: LinkedHub) => Promise<Response>
  ) {
    const owner = asOwner(handle);
    return async (req: Request, params: Record<string, string>): Promise<Response> =>
      access().canvasOnly ? missingRoute() : owner(req, params);
  }
}

/** What the studio answers for a path it does not serve (http.ts's static fall-through). */
export const MISSING_ROUTE_WORDS = 'Not found';
const missingRoute = () => new Response(MISSING_ROUTE_WORDS, { status: 404 });

/** The words a link's rules are refused with — checked before the hub is asked. */
function linkRuleError(b: Record<string, unknown>, { create }: { create: boolean }) {
  if (create || b.role !== undefined) {
    if (b.role !== 'observer' && b.role !== 'viewer')
      return json(422, {
        error: 'A link can give Can view or Can comment, never more.',
        reason: 'link-role',
      });
  }
  if ((create || b.who !== undefined) && b.who !== 'team' && b.who !== 'anyone')
    return json(400, { error: 'Who is this link for?', reason: 'who' });
  if (b.canvas !== undefined && b.canvas !== null && !validCanvas(b.canvas))
    return json(400, { error: 'Not a canvas.', reason: 'canvas' });
  if (
    b.expiresAt !== undefined &&
    b.expiresAt !== null &&
    !(
      typeof b.expiresAt === 'string' &&
      b.expiresAt.length <= 40 &&
      !Number.isNaN(Date.parse(b.expiresAt))
    )
  )
    return json(400, { error: 'Pick a date in the future.', reason: 'expires' });
  if (b.off !== undefined && b.off !== true)
    return json(400, { error: 'That is not a link.', reason: 'body' });
  return null;
}
