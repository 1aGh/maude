// edit-ops/revert.ts — the undo of one edit-op on a legacy-hub link (contract S2-edit-ops.md §5).
//
// Op-log projects undo through S5 (`/_api/project/undo {actionIds}`). A project linked to a legacy
// hub (or not linked) records, per edit-op, `{ op: 'revert', params: { writeId } }`: a THREE-WAY
// revert of that one write — base = the bytes it wrote, ours = the file now, theirs = the bytes it
// replaced (`sync/source-merge.ts`) — so a teammate's later change elsewhere survives and a change
// that touches the same bytes is refused, never overwritten. No positional ids anywhere.

import { mergeSource } from '../sync/source-merge.ts';
import type { IdRename } from './types.ts';

export interface WriteRecord {
  writeId: string;
  /** designRoot-relative canvas path */
  file: string;
  before: string;
  after: string;
  /** S2.2b — this write renamed an element id; undoing it renames the references back */
  renamed?: IdRename;
}

export const WRITE_LOG_CAP = 200;
export const WRITE_ID_RE = /^w_[0-9a-f]{16}$/;

function newWriteId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return `w_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** In-memory, capped (oldest out). A restarted server forgets: revert then answers `stale`. */
export function createWriteLog(cap = WRITE_LOG_CAP) {
  const log = new Map<string, WriteRecord>();
  return {
    add(file: string, before: string, after: string, renamed?: IdRename): string {
      const writeId = newWriteId();
      log.set(
        writeId,
        renamed ? { writeId, file, before, after, renamed } : { writeId, file, before, after }
      );
      while (log.size > cap) {
        const oldest = log.keys().next().value;
        if (oldest === undefined) break;
        log.delete(oldest);
      }
      return writeId;
    },
    get(writeId: string): WriteRecord | null {
      return log.get(writeId) ?? null;
    },
    get size() {
      return log.size;
    },
  };
}
export type WriteLog = ReturnType<typeof createWriteLog>;

/** The file with `rec` undone, or null when a later change touches the same bytes. */
export function revertSource(rec: WriteRecord, current: string): string | null {
  if (current === rec.after) return rec.before;
  const m = mergeSource(rec.after, current, rec.before);
  return m.ok ? m.merged : null;
}
