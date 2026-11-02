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
// The map itself — which share path becomes which `/api/access/*` call, what body rides along, which
// session may send it — is `access/share-map.ts`, shared with a cloud cell's hub, which answers the
// same paths for a browser tab as the session it carries (routes-v2/share.mjs).
//
// An invite that cannot reach the hub (this Mac is offline, the hub is down) is not lost: it goes
// into the outbox (V2-1.14, kind `share.invite`) and `shareInviteSender` sends it once the hub
// answers — "Invites send when this Mac is online."

import { currentAccess } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import {
  parseShareBody,
  requestRows,
  type ShareRefusal,
  type ShareRoute,
  shareGateRefusal,
  shareId,
  shareRoute,
  type WireRole,
} from '../access/share-map.ts';
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

export const OFFLINE_INVITE_WORDS = 'Invites send when this Mac is online.';
/** S9.21 — Ask to edit, queued while the hub cannot hear it (V2-1.14 policy's own queued words). */
export const OFFLINE_ASK_WORDS = 'Queued — sends when this Mac is online.';
export {
  askBody,
  MAX_REQUEST_NAME,
  MISSING_ROUTE_WORDS,
  requestName,
  requestRows,
  validCanvas,
} from '../access/share-map.ts';

const NOT_LINKED = 'Share this project to the cloud first.';
const UNREACHABLE = 'Sharing is not available right now. Try again in a minute.';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

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

/**
 * The outbox's door for `share.ask-to-edit` (V2-1.14 §5.4): the queued request, sent to the hub this
 * project is linked to NOW, as `{ canvas? }` only (the record's `note` is never sent — see `askBody`).
 * "You already asked" and "you can already edit" are the request having landed (G16), not a failure.
 */
export function shareAskToEditSender(deps: ShareRouteDeps): Sender {
  return async (record) => {
    const p = record.payload as Extract<IntentPayload, { kind: 'share.ask-to-edit' }>;
    const hub = deps.hub();
    if (!hub) return { ok: false, status: 409, code: 'not-linked', message: NOT_LINKED };
    if (record.project.hub && record.project.hub !== hub.url)
      return { ok: false, status: 409, code: 'not-linked', message: NOT_LINKED };
    const canvas = typeof p.scope === 'object' ? p.scope.canvas : undefined;
    const a = await callHub(deps, hub, 'POST', '/api/access/requests', canvas ? { canvas } : {});
    if (!a.ok) return { ok: false, network: true };
    const body = (a.body ?? {}) as { id?: unknown; error?: unknown; reason?: unknown };
    if (a.status >= 200 && a.status < 300)
      return { ok: true, ...(typeof body.id === 'string' ? { ref: body.id } : {}) };
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    return {
      ok: false,
      status: a.status,
      ...(reason
        ? { code: reason === 'pending' || reason === 'already-can-edit' ? 'already' : reason }
        : {}),
      ...(typeof body.error === 'string' ? { message: body.error } : {}),
    };
  };
}

/** A refusal from the map, as this door answers it. */
const refusal = (r: ShareRefusal): Response =>
  r.text !== undefined ? new Response(r.text, { status: r.status }) : json(r.status, r.json ?? {});

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text().catch(() => null);
  return parseShareBody(text);
}

export function createShareRoutes(deps: ShareRouteDeps): RouteSpec[] {
  const access = () => (deps.access ?? currentAccess)();

  /**
   * One route of the fixed map: the session's gate (a refusal said HERE, before the hub hears it),
   * the linked hub, the map's call, the hub's answer. The paths stay literal in the table below —
   * the writer-registry / CSRF / manifest scrapers read them from this file.
   */
  const mapped = (method: ShareRoute['method'], path: string) => {
    const route = shareRoute(method, path);
    return async (req: Request, params: Record<string, string>): Promise<Response> => {
      const gate = shareGateRefusal(route.gate, access());
      if (gate) return refusal(gate);
      // V2-8.9 round 2 R2-M2 — a share write runs with this Mac's hub credential (an invite, an
      // anyone-link, an approved request): the person's act in the Maude window, like Connect
      // (routes/sync.ts link confirm). The header stops cross-origin browser pages (a page cannot
      // forge it); any non-browser client on this Mac could send it, so against the AI the boundary
      // is the curl-local card (it refuses to forge the header) plus the bash guard (human-only).
      if (method !== 'GET' && req.headers.get('sec-fetch-site') !== 'same-origin') {
        return json(403, {
          ok: false,
          reason: 'window-only',
          detail: 'Share from the Share sheet in the Maude window.',
        });
      }
      const hub = deps.hub();
      if (!hub) return json(409, { error: NOT_LINKED, reason: 'not-linked' });
      const call = route.build({
        id: shareId(params.id),
        query: new URL(req.url).searchParams,
        body: route.body ? await readBody(req) : null,
      });
      if (!('method' in call)) return refusal(call);
      const a = await callHub(deps, hub, call.method, call.path, call.body);
      if (route.reshape === 'requests') {
        if (!a.ok) return relay(a);
        if (a.status !== 200) return json(a.status, a.body);
        return json(200, { requests: requestRows(a.body) });
      }
      if (a.ok || !deps.outbox || !route.queue) return relay(a);
      return queue(deps.outbox, route.queue, call.body ?? {}, hub, a);
    };
  };

  /** The hub cannot be reached: the invite / Ask to edit waits in the outbox (V2-1.14). */
  function queue(
    outbox: Pick<Outbox, 'enqueue'>,
    kind: 'invite' | 'ask',
    body: Record<string, unknown>,
    hub: LinkedHub,
    a: HubAnswer
  ): Response {
    const scope: ShareScope = typeof body.canvas === 'string' ? { canvas: body.canvas } : 'project';
    if (kind === 'invite') {
      const role = TO_INTENT[body.role as string];
      if (!role) return relay(a); // `owner` is never queued — the hub refuses it anyway
      const r = outbox.enqueue({
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
    }
    const r = outbox.enqueue({
      kind: 'share.ask-to-edit',
      actor: deps.actor?.() ?? 'you',
      device: deps.device?.() ?? 'studio',
      project: { id: null, hub: hub.url },
      label: 'Ask to edit',
      payload: { kind: 'share.ask-to-edit', scope },
      gates: ['hub'],
    });
    if (!r.ok) return json(503, { error: UNREACHABLE, reason: r.code });
    return json(202, { queued: true, id: r.record.id, words: OFFLINE_ASK_WORDS });
  }

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
      handle: mapped('GET', '/_api/share/me'),
    },
    // People with access to the canvas (or the project). The hub filters by the caller's role:
    // e-mails, invitations and requests go only to `invite` holders (V2-1.16 L17).
    {
      method: 'GET',
      path: '/_api/share/people',
      origin: 'main',
      readOnly: 'allowed',
      handle: mapped('GET', '/_api/share/people'),
    },
    // An invite the hub cannot hear yet waits in the outbox and sends itself.
    {
      method: 'POST',
      path: '/_api/share/invites',
      origin: 'main',
      readOnly: 'refused',
      handle: mapped('POST', '/_api/share/invites'),
    },
    {
      method: 'POST',
      path: '/_api/share/invites/:id/resend',
      origin: 'main',
      readOnly: 'refused',
      handle: mapped('POST', '/_api/share/invites/:id/resend'),
    },
    // Taking back a pending invitation (the role menu's Remove on an invited row).
    {
      method: 'POST',
      path: '/_api/share/invites/:id/revoke',
      origin: 'main',
      readOnly: 'refused',
      handle: mapped('POST', '/_api/share/invites/:id/revoke'),
    },
    {
      method: 'PATCH',
      path: '/_api/share/people/:id',
      origin: 'main',
      readOnly: 'refused',
      handle: mapped('PATCH', '/_api/share/people/:id'),
    },
    // Remove a person from the canvas (`canvas`) or the project (none) — the hub revokes.
    {
      method: 'POST',
      path: '/_api/share/people/:id/remove',
      origin: 'main',
      readOnly: 'refused',
      handle: mapped('POST', '/_api/share/people/:id/remove'),
    },
    // S9.20 (10 co-share-advanced) — the project's link and its rules. The owner's; a canvas-only
    // session hears what a route that is not here says (V2-1.16 U1): links are project business.
    {
      method: 'POST',
      path: '/_api/share/links',
      origin: 'main',
      readOnly: 'refused',
      handle: mapped('POST', '/_api/share/links'),
    },
    {
      method: 'PATCH',
      path: '/_api/share/links/:id',
      origin: 'main',
      readOnly: 'refused',
      handle: mapped('PATCH', '/_api/share/links/:id'),
    },
    // S9.21 — Ask to edit (10 co-ask-edit). ANY session may ask (a read-only one most of all — this
    // is the read-only person's one write); the hub decides whether it may. Only `{ canvas? }` is sent.
    {
      method: 'POST',
      path: '/_api/share/requests',
      origin: 'main',
      readOnly: 'allowed',
      handle: mapped('POST', '/_api/share/requests'),
    },
    // The open requests — the owner's (the request block at the top of Share). Rebuilt row by row.
    {
      method: 'GET',
      path: '/_api/share/requests',
      origin: 'main',
      readOnly: 'allowed',
      handle: mapped('GET', '/_api/share/requests'),
    },
    // Let Petra edit / Not now — the owner's; the hub re-checks `invite` and writes the grant.
    ...(['approve', 'decline'] as const).map(
      (verb): RouteSpec => ({
        method: 'POST',
        path: `/_api/share/requests/:id/${verb}`,
        origin: 'main',
        readOnly: 'refused',
        handle: mapped('POST', `/_api/share/requests/:id/${verb}`),
      })
    ),
  ];
}
