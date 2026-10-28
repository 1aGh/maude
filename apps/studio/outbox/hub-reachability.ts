// P8 test round (G1b, 01 cf-offline-create) — the `hub` gate's one fact: does the project's hub answer?
//
// V2-1.14 §5.4: an intent of a hub-linked project waits on `hub` while the hub is unreachable, with the
// same words as `online` ("Queued — sends when this Mac is online.") because the status word machine
// calls an unreachable hub "Offline — kept on this Mac" (save-status.js). Until this module the studio
// hard-coded `hubReachable: true` and bound every chat prompt to `{ hub: null }`, so the gate never
// closed: a prompt sent while the Share cluster said Offline went straight to the AI and the queued card
// was unreachable.
//
// The fact is read from the sync runtime's own connection state — the `sync:status` payloads it already
// broadcasts on the bus (sync/connection-state.ts: online · connecting · offline · offline-long). Only
// `offline` / `offline-long` close the gate: `connecting` is the reconnect grace window, where the cluster
// says Syncing… and a prompt should not wait. A project with no hub link never closes it.

/** The connection states that mean the hub is not answering (past the grace window). */
const UNREACHABLE = new Set(['offline', 'offline-long']);

export interface HubReachability {
  /** Feed one `sync:status` payload (anything with a `state`); malformed payloads are ignored. */
  note(payload: unknown): void;
  /** false only while a linked project's hub is past the grace window. */
  reachable(): boolean;
  /** The project an intent binds at enqueue (V2-1.14 §5.2): `hub` is the linked hub's URL or null. */
  project(): { id: string | null; hub: string | null };
}

export function createHubReachability(deps: {
  /** The linked hub's URL right now, or null for a local project. */
  linkedHub: () => string | null | undefined;
  /** Called once each time the hub becomes reachable again — the drain's gate event. */
  onReachable?: () => void;
}): HubReachability {
  let unreachable = false;
  const hubUrl = () => {
    try {
      const url = deps.linkedHub();
      return typeof url === 'string' && url.length > 0 ? url : null;
    } catch {
      return null;
    }
  };
  return {
    note(payload) {
      const state = (payload as { state?: unknown } | null)?.state;
      if (typeof state !== 'string') return;
      const next = UNREACHABLE.has(state);
      const back = unreachable && !next;
      unreachable = next;
      if (back) deps.onReachable?.();
    },
    reachable() {
      return hubUrl() === null || !unreachable;
    },
    project() {
      return { id: null, hub: hubUrl() };
    },
  };
}
