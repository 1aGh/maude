// client/v2/diagnostics/diagnostics-bus.js — V2-4.7b: "open Diagnostics at <view>" from outside the sheet
// (the project menu's rows, ⌘K), plus the last-known facts a row copies.
//
// The sheet may not be mounted when the request comes (the host mounts it lazily), so a request is
// remembered until the host takes it; a mounted host hears the event at once. Same shape as
// left-panel-bus.js (⌘K "Trash").

export const OPEN_DIAGNOSTICS_EVENT = 'maude:open-diagnostics';

/** The views the sheet shows. `sync` is today's Sync panel, whole. */
export const VIEWS = Object.freeze(['logs', 'server', 'ai', 'sync']);

let pending = null;

/** Ask the host to show the sheet at `view`. `recheck` re-probes AI setup on arrival. */
export function openDiagnostics(
  view = 'logs',
  { recheck = false } = {},
  target = globalThis.window
) {
  const v = VIEWS.includes(view) ? view : 'logs';
  pending = { view: v, recheck };
  target?.dispatchEvent?.(new CustomEvent(OPEN_DIAGNOSTICS_EVENT, { detail: pending }));
}

/** The host took the request. @returns the waiting request, or null. */
export function takeDiagnosticsRequest() {
  const was = pending;
  pending = null;
  return was;
}

// What the Advanced rows copy. Set by the menu hook each time the menu opens; read by the handlers.
let facts = { address: '', pid: null, version: '', folder: '' };

export function setDiagnosticsFacts(next) {
  facts = { ...facts, ...next };
}
export function diagnosticsFacts() {
  return facts;
}
