// Sync control routes — S11.11 (moved out of http.ts's legacy literal).
//
//   POST /_api/sync/resync   → { ok, sync, resync? } · 409 busy · 200 { ok:false, reason } when there
//                              is nothing to restart · 403 { ok:false, reason, detail } at the gates
//
// MAIN ORIGIN ONLY (never `origin: 'canvas'`): resync re-handshakes every document against the
// person's own hub and re-runs a whole-project comparison — an amplification primitive a canvas must
// not hold (DDR-054/088; test/sync-resync-routes.test.ts). The cloud cell refuses it too
// (hub studio-manifest), so a member never reaches it.
//
// What changed in the move: the route also STARTS the trace (sync/resync-trace.ts) that watches the
// restarted runtime and answers "1 204 of 1 318" and, at the end, { checked, sent, fetched,
// conflicts }. The trace rides `GET /_sync-status` as `resync` (http.ts merges `trace.view()`), so
// the toast, the Diagnostics card and `maude design sync status` read one place.
//
// What did NOT change, on purpose: `restart()` is called with NO argument — only an explicit `null`
// unlinks, and this route must never be able to (test/sync-resync-routes.test.ts pins the call).
// A cycle already in flight is refused (409), not queued — a second press must not buy a second
// full re-link. Refusals answer in JSON with a reason (`refuse` below), because the panel renders
// `detail` and a causeless "Resync could not start." sent people to a terminal they do not have.

import { currentAccess, notInScopeResponse } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import type { LinkGate } from '../sync/link-consent.ts';
import type { ResyncTrace } from '../sync/resync-trace.ts';
import type { RouteSpec } from './table.ts';

/** The slice of `ctx.syncControl` (sync/supervisor.ts SyncSupervisor) this route calls. */
export interface SyncControlLike {
  busy?(): boolean;
  restart(): Promise<{ syncing: boolean; canvases?: number; reason?: string; detail?: string }>;
}

export interface SyncRouteDeps {
  /** `ctx.syncControl` — a LIVE view: server.ts attaches it after the table is built. */
  control: () => SyncControlLike | null | undefined;
  trace: ResyncTrace;
  warn?: (message: string) => void;
  /**
   * gate-b-sec4 — the parked committed link (sync/link-consent.ts `createLinkGate`). Absent = the
   * link routes answer "nothing waiting".
   */
  link?: LinkGate;
  /** This request's session (default `currentAccess()`). */
  access?: () => Access;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * A gate refusal in the shape the Sync panel can render: `{ ok:false, reason, detail }`. The GATES
 * are unchanged (`guardTableRoute` runs them); what a refusal SAYS is not a security property.
 * Names nothing the caller sent (the presented Origin/Host belongs in the log, not the answer).
 */
export function resyncRefusal(
  reason: 'cross-origin' | 'untrusted-host',
  warn: (m: string) => void = (m) => console.warn(m)
): Response {
  warn(`[sync] ${reason} request to a sync control route — refused.`);
  const what = 'Resync must be started';
  const detail =
    reason === 'cross-origin'
      ? `${what} from Maude itself, not from inside a canvas.`
      : `${what} from the Maude app or this machine's own browser tab.`;
  return json(403, { ok: false, reason, detail });
}

export function createSyncRoutes(deps: SyncRouteDeps): RouteSpec[] {
  const access = () => (deps.access ?? currentAccess)();
  return [
    // gate-b-sec4 (M1) — a committed `linkedHub` this Mac never linked waits here; the Share sheet
    // asks "This project says it syncs with <host>. Connect?". MAIN ORIGIN ONLY: a canvas never
    // learns the address and never presses Connect. The answer is the host, nothing else.
    {
      method: 'GET',
      path: '/_api/sync/link',
      origin: 'main',
      readOnly: 'allowed',
      // A project-class answer: a canvas-only session hears the missing-scope refusal (U3).
      handle: async () =>
        access().can('read', null)
          ? json(200, { pending: deps.link?.pending() ?? null })
          : notInScopeResponse(),
    },
    // Connect: record on THIS Mac that the folder's hub may receive this Mac's credential, then
    // start syncing with exactly the parked value. Can edit and up (like Resync); a person's
    // consent, so no agent path (human 'hub-link').
    {
      method: 'POST',
      path: '/_api/sync/link/confirm',
      origin: 'main',
      readOnly: 'refused',
      refuse: (reason) => {
        (deps.warn ?? ((m: string) => console.warn(m)))(
          `[sync] ${reason} request to the link Connect route — refused.`
        );
        return json(403, {
          ok: false,
          reason,
          detail:
            reason === 'cross-origin'
              ? 'Connect from Maude itself, not from inside a canvas.'
              : "Connect from the Maude app or this machine's own browser tab.",
        });
      },
      async handle(req) {
        // V2-8.9 defender M1 (decision maude/v2-8.9-sync-link-confirm-needs-fetch-metadata): Connect
        // hands this Mac's hub credential to the folder's hub, so it is the person's act in the
        // Maude window — the cloud/move gate (routes/cloud-move.ts). Only a browser's own
        // same-origin fetch carries `Sec-Fetch-Site: same-origin` (a page cannot set it); the
        // loopback helper an AI session reaches does not (cli/lib/bash-guard.mjs `human-only`).
        // Checked before access, the gate or the hub.
        if (req.headers.get('sec-fetch-site') !== 'same-origin') {
          return json(403, {
            ok: false,
            reason: 'window-only',
            detail: 'Connect from the Share sheet in the Maude window.',
          });
        }
        if (!access().can('edit', null)) {
          return json(403, {
            error: 'read-only',
            reason: 'not-allowed',
            message: 'Ask the owner to change this.',
          });
        }
        if (!deps.link) {
          return json(409, {
            ok: false,
            reason: 'nothing-pending',
            detail: 'This project has no link waiting.',
          });
        }
        const r = await deps.link.confirm();
        return json(r.ok ? 200 : r.reason === 'nothing-pending' ? 409 : 500, r);
      },
    },
    {
      method: 'POST',
      path: '/_api/sync/resync',
      origin: 'main',
      readOnly: 'refused',
      refuse: (reason) => resyncRefusal(reason, deps.warn),
      async handle() {
        const control = deps.control();
        if (!control) {
          return json(200, {
            ok: false,
            reason: 'no-supervisor',
            detail: 'Restart Maude to start syncing.',
          });
        }
        // REFUSED, not queued — see `SyncSupervisor.busy`.
        if (control.busy?.()) {
          return json(409, {
            ok: false,
            reason: 'busy',
            detail: 'Syncing is already restarting.',
          });
        }
        // No argument: KEEP the configured hub. Only an explicit `null` unlinks.
        const sync = await control.restart();
        // Only a restart that actually began syncing has anything to trace.
        if (sync.syncing) deps.trace.begin();
        return json(200, { ok: true, sync });
      },
    },
  ];
}
