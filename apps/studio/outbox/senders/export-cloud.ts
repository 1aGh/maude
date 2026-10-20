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
//   401                      → the `signed-in` gate ("Sign in to send it.");
//   403 / `forbidden`        → G14 (Can view gets no downloads, A19);
//   any other final code     → G26 (`refused`, its code kept).
// The render runs minutes; the drain sends one record at a time, so this never waits for the file.

import type { CloudRenderDoor } from '../../exporters/remote.ts';
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
}

export function exportCloudSender(deps: ExportCloudSenderDeps): Sender {
  return async (record) => {
    if (record.payload.kind !== 'export.cloud')
      return { ok: false, status: 400, code: 'wrong-kind' };
    const door = deps.door();
    if (!door) return { ok: false, status: 409, code: 'no-cloud', message: NO_CLOUD_WORDS };
    const spec = record.payload.spec as unknown as ExportSpecV2;
    // the lane it was asked for travels with it; the cloud renders it as a cloud job
    const answer = await door.submit({ jobId: record.id, spec, label: record.label });
    if (answer.ok) {
      // a replay the cloud already had is the same job, not G16's "already a member": plain `sent`
      deps.accepted(record);
      return { ok: true, ref: record.id };
    }
    return answer;
  };
}
