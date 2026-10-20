// The outbox's door for `export.handoff` — S8.10 (V2-1.14 §5.1 lane `export`, 09 ex-handoff-edges).
//
// A Handoff to production asked while this Mac was offline, or before a Claude account was connected,
// waits in the outbox ("Queued — starts when this Mac is online") and starts by itself. The drain runs
// this once every gate is open (online + the AI gates, outbox/policy.ts `closedGates`). It re-reads the
// target and the last review NOW (`resolve`), names the run's write scope (the target file only) and
// starts the one drafting run — idempotent by the record id, so a replay after a crash finds the same
// run instead of starting a second:
//   started                   → done (`sent`); the run lands its file;
//   the canvas or target gone → final 404 `target-missing` (the row ends with words);
//   the registry not wired    → transient, backoff (§5.8).

import { createHandoffs, type HandoffsDeps } from '../../handoff/run.ts';
import type { Sender } from '../drain.ts';

export type ExportHandoffSenderDeps = HandoffsDeps;

/** The sender alone (http.ts builds the whole `createHandoffs` once and registers its `.sender`). */
export function exportHandoffSender(deps: ExportHandoffSenderDeps): Sender {
  return createHandoffs(deps).sender;
}
