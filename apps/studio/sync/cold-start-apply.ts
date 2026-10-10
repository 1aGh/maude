// The ONE application body for the cold-start decision tables — Sync v2
// Increment 0 (DDR-226), closing the drift class DDR-102's own text warned
// about ("the decision table is a pure module consumed by BOTH sync paths" —
// the TABLE was shared, the APPLICATION was not).
//
// Before this module there were two appliers:
//
//   1. `agent.ts reconcile()`      — the desktop two-doc path
//   2. `migrate-seed.ts migrateSeed()` — the shared-doc / cell path
//
// Same table, two switches, and they had already drifted THREE times:
//
//   - the DDR-076 empty-hub guard had to be written twice,
//   - the DDR-223 annotations eraser had to be FIXED twice,
//   - and `migrateSeed`'s switch was missing a `recover-seed-dup` case *and*
//     a default, so that decision fell through to "hub-wins" and a duplicated
//     body was kept and materialized to disk. That one was LIVE when this
//     module landed.
//
// The fix is structural, not vigilance: this switch is exhaustive over
// `ColdStartAction` with a compile-time `never` default, so adding a row to
// the table without handling it here is a TYPE ERROR, not a silent
// fallthrough. Both callers import this function; `test/cold-start-apply.test.ts`
// pins that they do.
//
// What stays with the callers is only what genuinely differs between the two
// substrates, injected as three effects:
//
//   - `takeHub()`    — agent: write the doc body to disk + checkpoint.
//                      migrate-seed: nothing (the projection materializes).
//   - `takeLocal()`  — agent: seed the local body up into the doc.
//                      migrate-seed: rebuild body (+ css) inside ONE MIGRATION
//                      transaction.
//   - `checkpointIdentity()` — journal write for identical non-empty sides.
//
// Everything else — the order of the rows, the dual snapshot, the DDR-102
// fail-closed refusal, the conflict report, the resulting body winner — lives
// here exactly once.

import type { ColdStartAction, ColdStartDecision } from './cold-start.ts';

/** Why a cold-start snapshot was taken.
 *
 *  Deliberately NOT extended for the duplication collapse (issue #114). A
 *  collapse only ever fires on an exact integer repeat, so the discarded copies
 *  hold nothing the retained one doesn't — and `pruneSnapshots` evicts
 *  oldest-first per slug, so a valueless snapshot on a hub-triggerable path is
 *  an eviction lever against the copies that carry real bytes. */
export type ColdStartSnapshotReason = 'pre-sync-local' | 'pre-sync-hub' | 'pre-format-flip-local';

export interface ColdStartConflictInfo {
  slug: string;
  /** `format-flip-local-kept` — the V2-1.12 §5.9 first-sight row. */
  kind: 'cold-start-diverged' | 'format-flip-local-kept';
  winner?: 'local' | 'hub';
  snapshots?: { local?: string; hub?: string };
  /** DDR-102 fail-closed (F1) — local snapshot didn't land; hub-wins refused. */
  snapshotFailed?: boolean;
}

export interface ColdStartApplyInput {
  slug: string;
  /** The verdict from `decideColdStart`. */
  decision: ColdStartDecision;
  /** Local body file content, or null when absent. */
  localBody: string | null;
  /** Body currently held by the doc. */
  docBody: string;

  /** Make the HUB body the winner (materialize / fast-forward / conflict-hub). */
  takeHub: () => void | Promise<void>;
  /** Make LOCAL the winner — seed it up so the hub converges on our bytes. */
  takeLocal: (localBody: string) => void | Promise<void>;
  /** Both sides already identical: record the journal checkpoint so the NEXT
   *  boot fast-forwards instead of re-entering the conflict path. */
  checkpointIdentity?: (body: string) => void;

  /** DDR-102 dual snapshot. Absent ⇒ plain newest-wins (standalone/test wiring). */
  snapshot?: (content: string, reason: ColdStartSnapshotReason) => Promise<string | null>;
  onConflict?: (info: ColdStartConflictInfo) => void;

  /** Log prefix, so the two callers keep their distinguishable lines
   *  (`[sync/<slug>]` vs `[sync/<slug>] shared-doc`). */
  logLabel?: string;
  log?: { warn: (msg: string) => void; error: (msg: string) => void };
}

export interface ColdStartApplyResult {
  /** The action that was actually applied (echo of `decision.action`). */
  action: ColdStartAction;
  /** Which side owns the visually-coupled lanes (css; annotations' fallback). */
  bodyWinner: 'local' | 'hub';
  /** Set only when `action === 'conflict'`. */
  conflict?: {
    /** The winner AFTER the fail-closed guard — may differ from `decision.winner`. */
    winner: 'local' | 'hub';
    snapshots: { local?: string; hub?: string };
    /** True when a hub-wins verdict was REFUSED because the local snapshot
     *  didn't land (DDR-102 fail-closed). */
    snapshotFailed: boolean;
  };
}

const defaultLog = {
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

/**
 * Apply a cold-start body decision. Total over `ColdStartAction`.
 *
 * Returns the resolved `bodyWinner` so callers can drive the per-lane
 * annotations table (DDR-223) and the visually-coupled css lane from one
 * answer instead of re-deriving it from a result string.
 */
export async function applyColdStart(input: ColdStartApplyInput): Promise<ColdStartApplyResult> {
  const { slug, decision, localBody, docBody, takeHub, takeLocal } = input;
  const log = input.log ?? defaultLog;
  const prefix = input.logLabel ? `[sync/${slug}] ${input.logLabel}` : `[sync/${slug}]`;

  switch (decision.action) {
    case 'noop': {
      // Identical non-empty sides: checkpoint identity so the next boot
      // fast-forwards even if the hub then moves ahead. (Both-empty falls in
      // here too and carries nothing to checkpoint.)
      if (localBody !== null && localBody === docBody && docBody !== '') {
        input.checkpointIdentity?.(docBody);
      }
      return { action: decision.action, bodyWinner: 'hub' };
    }

    case 'materialize-hub':
    case 'fast-forward-hub': {
      await takeHub();
      return { action: decision.action, bodyWinner: 'hub' };
    }

    case 'seed-local-up': {
      // The DDR-064/076 empty-hub guard as a named row: an empty hub doc means
      // the hub holds no body for this slug YET — never an authoritative blank.
      await takeLocal(localBody as string);
      return { action: decision.action, bodyWinner: 'local' };
    }

    case 'recover-seed-dup': {
      // Concurrent cold-seed collision: the hub body is our local body repeated
      // N≥2 times. Re-applying local makes the codec's diff delete the trailing
      // duplicate; the content equals local, so the coupled lanes follow local.
      // Idempotent across peers — concurrent recoveries converge.
      //
      // This case is why the module exists: migrate-seed used to have no row
      // for it and no default, so the duplicated body was kept.
      await takeLocal(localBody as string);
      return { action: decision.action, bodyWinner: 'local' };
    }

    case 'conflict': {
      // Divergence: snapshot BOTH versions BEFORE any write, then apply the
      // newest-wins winner. Even a wrong pick then costs one /design:rollback.
      const snapshots: { local?: string; hub?: string } = {};
      let snapshotAttempted = false;
      if (input.snapshot) {
        snapshotAttempted = true;
        try {
          const localTs = await input.snapshot(
            localBody as string,
            decision.firstSight ? 'pre-format-flip-local' : 'pre-sync-local'
          );
          if (localTs) snapshots.local = localTs;
          const hubTs = await input.snapshot(docBody, 'pre-sync-hub');
          if (hubTs) snapshots.hub = hubTs;
        } catch {
          /* swallowed — the missing snapshot ref drives the fail-closed guard */
        }
      }

      // DDR-102 fail-closed (security F1): the whole guarantee is "the loser is
      // recoverable from _history/". A hub-wins resolution overwrites local — so
      // if we ASKED for a snapshot and the local one did not land (full disk,
      // read-only `_history/`, a write error), refuse the destructive overwrite:
      // keep local and seed it up instead. Nothing is lost on either side.
      // `snapshotAttempted` gates this to production wiring, so a snapshot-less
      // standalone/test caller keeps plain newest-wins.
      const localSnapshotMissing = snapshotAttempted && !snapshots.local;
      let winner: 'local' | 'hub' = decision.winner ?? 'hub';
      if (winner === 'hub' && localSnapshotMissing && decision.firstSight) {
        // §5.9 + fail-closed: the local copy could not be kept aside, so it is
        // NOT overwritten — and nothing is pushed either. Disk and doc stay as
        // they are until the snapshot can land.
        log.error(
          `${prefix} format flip: the local snapshot FAILED — keeping local on disk untouched and pushing nothing (DDR-102 fail-closed).`
        );
        input.onConflict?.({
          slug,
          kind: 'format-flip-local-kept',
          winner: 'local',
          snapshotFailed: true,
        });
        // bodyWinner 'local': the coupled lanes keep their local bytes too
        // (under first sight their tables never push them).
        return {
          action: decision.action,
          bodyWinner: 'local',
          conflict: { winner: 'local', snapshots, snapshotFailed: true },
        };
      }
      if (winner === 'hub' && localSnapshotMissing) {
        winner = 'local';
        log.error(
          `${prefix} cold-start divergence: hub won newest-wins but the local snapshot FAILED — REFUSING to overwrite local (DDR-102 fail-closed). Keeping local + pushing it up; resolve the _history/ write failure (disk full / read-only?) to restore newest-wins.`
        );
      }

      if (winner === 'local') {
        await takeLocal(localBody as string);
      } else {
        await takeHub();
      }

      log.warn(`${prefix} cold-start divergence — ${decision.reason}`);
      input.onConflict?.({
        slug,
        kind: decision.firstSight ? 'format-flip-local-kept' : 'cold-start-diverged',
        winner,
        ...(snapshots.local || snapshots.hub ? { snapshots } : {}),
        ...(localSnapshotMissing ? { snapshotFailed: true } : {}),
      });

      return {
        action: decision.action,
        bodyWinner: winner,
        conflict: { winner, snapshots, snapshotFailed: localSnapshotMissing },
      };
    }

    default: {
      // Exhaustiveness: adding a `ColdStartAction` without a row above is a
      // compile error here, never a silent "hub keeps whatever it had".
      const never: never = decision.action;
      throw new Error(`cold-start: unhandled action ${String(never)}`);
    }
  }
}
