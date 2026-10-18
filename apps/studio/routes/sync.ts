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
  return [
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
