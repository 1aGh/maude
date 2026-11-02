// Render seconds per tenant — Michal 2026-10-21 on S8.5b M2
// (decision:maude/v2-michal-render-seconds-in-studio; contract S8.5b §10).
//
// A studio serves exactly one tenant (the cell's checkout), so "per tenant" is one counter per
// process. It counts the seconds export jobs spent RENDERING on a cloud lane — from the moment a
// job took a render slot to the moment it settled (done, failed, or aborted by its timeout), never
// the time it sat queued and never a job that was refused before it ran. That is the load a
// tenant puts on the shared maude-render fleet, which is what M2 wanted metered.
//
// RESET. A running total SINCE BOOT, with the boot time beside it. A restart zeroes the counter
// and moves `renderSecondsSince`, so a reader that sees `renderSecondsSince` change (or the total go down) knows a
// reset happened rather than that the tenant stopped rendering. Nothing is persisted: this is
// usage telemetry, not a ledger, and a crash must not be able to double-count a replay.
//
// Reported through `/_health` as `render.renderSeconds` / `renderJobs` / `renderSecondsSince` (http.ts), which the hub's studio child
// already forwards as `/health.render` to the control plane. Counts and durations ONLY — never a
// canvas name, a path or a person (same rule as buildStats()).

/**
 * FLAT numeric fields, spread into `/_health` `render` beside buildStats(): the control plane
 * reads that block through a flat whitelist of numbers (apps/cloud/operator.mjs `pickNumbers`),
 * so a future ingest is one more key, not a new shape.
 */
export interface RenderSecondsStats {
  /** Seconds spent rendering since `renderSecondsSince`, 3 decimals. */
  renderSeconds: number;
  /** Jobs (finished or not) that contributed to `renderSeconds`. */
  renderJobs: number;
  /** Epoch ms this counter started — a change means the studio restarted. */
  renderSecondsSince: number;
}

let totalMs = 0;
let jobs = 0;
let bootedAt = Date.now();

/** Add one job's rendering time. A non-finite or negative span adds nothing. */
export function noteRenderMs(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  totalMs += ms;
  jobs += 1;
}

export function renderSecondsStats(): RenderSecondsStats {
  return {
    renderSeconds: Math.round(totalMs) / 1000,
    renderJobs: jobs,
    renderSecondsSince: bootedAt,
  };
}

/** Test seam — what a process restart does. */
export function _resetRenderSeconds(now = Date.now()): void {
  totalMs = 0;
  jobs = 0;
  bootedAt = now;
}
