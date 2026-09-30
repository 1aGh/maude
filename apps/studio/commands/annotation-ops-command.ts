/**
 * @file       commands/annotation-ops-command.ts — undo entry for an annotation op batch
 * @scope      apps/studio/commands/annotation-ops-command.ts
 * @purpose    DDR-242 AD4 (Task 26): one user gesture is one op batch and one
 *             undo record; undo is the batch's INVERSE (from `applyOps`),
 *             which is peer-safe at field granularity — it reverts only the
 *             fields this action set and only while they still hold its value.
 *             Nothing here replays a snapshot of the whole board.
 *
 *             Rebuilt per iframe mount from a serializable record (DDR-050), so
 *             the stack survives canvas switches; the side effect (apply
 *             locally + send) is the layer's `annotationOpsFn` sink.
 */

import type { Op } from '../annotations/ops.ts';
import type { CommandRecord, EditCommand } from '../undo-stack.ts';
import { registerCommand } from '../undo-stack.ts';

export const ANNOTATION_OPS_KIND = 'annotation-ops';

export interface AnnotationOpsPayload {
  ops: readonly Op[];
  inverse: readonly Op[];
  /**
   * The canvas the batch belongs to. The stack's records live in origin-wide
   * sessionStorage, so the layer replays only its own canvas's (security
   * review A5 — another canvas must not steer this one's undo).
   */
  file?: string;
}

/** Applies a batch locally and sends it; returns the batch's own inverse. */
export type AnnotationOpsFn = (ops: readonly Op[], file?: string) => readonly Op[] | void;

export function buildAnnotationOpsRecord(opts: {
  ops: readonly Op[];
  inverse: readonly Op[];
  label: string;
  file?: string;
}): CommandRecord<AnnotationOpsPayload> {
  return {
    kind: ANNOTATION_OPS_KIND,
    label: opts.label,
    payload: {
      ops: structuredClone(opts.ops),
      inverse: structuredClone(opts.inverse),
      ...(opts.file ? { file: opts.file } : {}),
    },
  };
}

export function createAnnotationOpsCommand(
  record: CommandRecord<AnnotationOpsPayload>,
  fn: AnnotationOpsFn
): EditCommand {
  return {
    kind: ANNOTATION_OPS_KIND,
    label: record.label,
    async do() {
      fn(record.payload.ops, record.payload.file);
    },
    async undo() {
      fn(record.payload.inverse, record.payload.file);
    },
  };
}

registerCommand<AnnotationOpsPayload>(ANNOTATION_OPS_KIND, (record, sinks) => {
  const fn = sinks.annotationOpsFn as AnnotationOpsFn | undefined;
  if (!fn) return null;
  return createAnnotationOpsCommand(record, fn);
});
