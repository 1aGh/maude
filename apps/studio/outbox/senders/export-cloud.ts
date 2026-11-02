// The outbox's door for `export.cloud` — S8.5 (V2-1.14 §5.1 lane `export`, 09 ex-offline).
//
// A cloud render asked while this Mac could not reach the cloud waits in the outbox and starts by
// itself. The drain runs this when every gate is open and the target still stands (the canvas or its
// artboards not in the trash, your role not lowered to Can view — exporters/remote.ts
// `cloudTargetFacts`). It ONLY hands the job over: the record id is the job id (§5.6, the render
// side's idempotency key), so a crash mid-send replays the same id and gets the first answer. The
// answer comes back in the drain's vocabulary (`TargetAnswer`) and the replay table decides the rest:
//   accepted / already had it → done (`sent`), and the tracker follows the job to the file;
//   no answer, 5xx, 429      → transient, backoff until the day is up (§5.8);
//   425 not-synced           → transient too, but only for 10 minutes online (S8.5b §6): past that the
//                              cell is still missing a file this Mac has, and the answer is final
//                              (G26, "Render it on this Mac");
//   401                      → the `signed-in` gate ("Sign in to send it.");
//   403 / `forbidden`        → G14 (Can view gets no downloads, A19);
//   any other final code     → G26 (`refused`, its code kept).
// The render runs minutes; the drain sends one record at a time, so this never waits for the file.
//
// The freshness fingerprint (S8.5b §6) is taken HERE, at send time, after the outbox's O4 watermark
// gate: what this Mac holds of the canvas's files at the moment the ask actually goes up.

import {
  CLOUD_NOT_SYNCED_AFTER_MS,
  CLOUD_TOO_BIG_WORDS,
  type CloudFingerprintEntry,
  type CloudRenderDoor,
  cloudNotSyncedWords,
} from '../../exporters/remote.ts';
import type { ExportSpecV2 } from '../../exporters/spec-v2.ts';
import type { Sender } from '../drain.ts';
import type { IntentRecord } from '../types.ts';

/** The sentence a Mac without a cloud door answers with (never sent; final, not retried). */
export const NO_CLOUD_WORDS =
  'Rendering in the cloud isn’t set up for this project — render it on this Mac.';

export interface ExportCloudSenderDeps {
  /** the door now (null = no cloud on this Mac: a final answer, never a silent wait) */
  door: () => CloudRenderDoor | null;
  /** the cloud took it: follow the job to the finished file (exporters/remote.ts tracker) */
  accepted: (record: IntentRecord) => void;
  /**
   * What this Mac holds of the canvas's files, taken NOW (at send time, never at ask time — a person
   * who keeps editing would otherwise never match, S8.5b §6). Absent = the ask carries no fingerprint.
   * Throws or returns null when it cannot be read: the send waits (transient) rather than going out
   * unchecked. 'too-big' = past CLOUD_FINGERPRINT_MAX files: the render stays on this Mac (final).
   */
  fingerprint?: (spec: ExportSpecV2) => CloudFingerprintEntry[] | 'too-big' | null;
  /**
   * Wait until the door's presence can be told (the hub's capability list). true = known; false = the
   * hub could not be asked (offline): the record then waits instead of being refused as "no cloud".
   */
  settle?: () => Promise<boolean>;
  now?: () => number;
}

export function exportCloudSender(deps: ExportCloudSenderDeps): Sender {
  const now = deps.now ?? Date.now;
  /** when each record first heard `not-synced` (in memory: "online" time restarts with the process) */
  const firstNotSynced = new Map<string, number>();
  return async (record) => {
    if (record.payload.kind !== 'export.cloud')
      return { ok: false, status: 400, code: 'wrong-kind' };
    let door = deps.door();
    if (!door && deps.settle) {
      const known = await deps.settle();
      door = deps.door();
      if (!door && !known) return { ok: false, network: true };
    }
    if (!door) return { ok: false, status: 409, code: 'no-cloud', message: NO_CLOUD_WORDS };
    const spec = record.payload.spec as unknown as ExportSpecV2;
    let expect: CloudFingerprintEntry[] | undefined;
    if (deps.fingerprint) {
      let fp: CloudFingerprintEntry[] | 'too-big' | null = null;
      try {
        fp = deps.fingerprint(spec);
      } catch {
        fp = null;
      }
      if (!fp) return { ok: false, status: 503, code: 'retryable' };
      if (fp === 'too-big')
        return { ok: false, status: 409, code: 'too-big', message: CLOUD_TOO_BIG_WORDS };
      expect = fp;
    }
    // the lane it was asked for travels with it; the cloud renders it as a cloud job
    const answer = await door.submit({
      jobId: record.id,
      spec,
      label: record.label,
      ...(expect ? { expect } : {}),
    });
    if (answer.ok) {
      firstNotSynced.delete(record.id);
      // a replay the cloud already had is the same job, not G16's "already a member": plain `sent`
      deps.accepted(record);
      return { ok: true, ref: record.id };
    }
    if ('network' in answer) return answer; // offline says nothing about freshness
    if (answer.code === 'not-synced') {
      const words = answer.message ?? cloudNotSyncedWords(null);
      if (answer.status === 409) {
        firstNotSynced.delete(record.id);
        return { ...answer, message: words };
      }
      const first = firstNotSynced.get(record.id) ?? now();
      firstNotSynced.set(record.id, first);
      if (now() - first > CLOUD_NOT_SYNCED_AFTER_MS) {
        firstNotSynced.delete(record.id);
        return { ok: false, status: 409, code: 'not-synced', message: words };
      }
      return answer; // 425 is transient: retried after `retryAfterMs`
    }
    firstNotSynced.delete(record.id);
    return answer;
  };
}
