// edit-ops/types.ts — the edit-op contract (S2.1, frozen in client/v2/contracts/S2-edit-ops.md §2).
//
// One dispatch route `POST /_api/edit-op` (routes/edit.ts) over pure writers `edit-ops/<op>.ts`.
// `op` is the registry action id, so a menu row, a key and ⌘K run the same path. Leaf module: no
// IO, no React — the shell relay (client/hooks/use-canvas-bridge.jsx), the canvas (editing/) and the
// server all import it.

/** A durable pointer at a canvas element; the canvas is the request's `file` (V2-1.4 §7). */
export interface ElementRef {
  /** DCArtboard id. */
  artboard: string;
  /** Authored `data-cd-id` — or, in a REQUEST only, a computed 8-hex id the dispatcher stamps. */
  element: string;
  /** Index among same-id DOM nodes in that artboard (`.map()` rows); absent = the first. */
  occurrence?: number;
}

/** A registry action id that has an edit-op writer, or `revert` (the legacy-link undo, §5). */
export type EditOpId = string;

export interface EditOpRequest {
  /** canvas path: designRoot-relative (`ui/Foo.tsx`) or `.design/ui/Foo.tsx` */
  file: string;
  op: EditOpId;
  targets: ElementRef[];
  params?: Record<string, unknown>;
  /** `revOf(bytes)` the caller saw; a moved file refuses with `stale`. */
  expectRev?: string;
}

export type EditOpCode = 'held-by-ai' | 'locked' | 'stale' | 'invalid' | 'forbidden';

export type EditOpResult =
  | {
      ok: true;
      /** the kernel action this write became, when the runtime already knows it */
      actionId: string | null;
      /** this write's id — what a legacy-link undo record keeps (`revert {writeId}`) */
      writeId: string;
      /** the file's revision after the write */
      rev: string;
      /** the targets as written: same order, every `element` an authored id */
      refs: ElementRef[];
      created?: ElementRef[];
      /** S2.2b — `element.set-id`: the references that followed the new id, per lane */
      moved?: { comments: number; board: number };
      /** S2.10b — an op-log home took the write but has not answered yet (the outbox keeps it);
       *  `writeId` is then '' — an op-log write never gets a legacy revert record. */
      queued?: true;
      /** op-specific facts about the write (S7.6: a split's new clip id, a trim's new length) */
      detail?: Record<string, unknown>;
    }
  | { ok: false; code: EditOpCode; message: string };

/** S2.2b — an id rename an op made; the dispatcher moves every durable reference with it. */
export interface IdRename {
  from: string;
  to: string;
}

/** The request an op sees: designRoot-relative `file`, stamped `targets`. */
export interface ResolvedEditOp {
  file: string;
  op: EditOpId;
  targets: ElementRef[];
  params: Record<string, unknown>;
  /** Is there a regular file at this designRoot-relative path? Only ops that name a file (S8.19c `asset.relink`) ask. */
  exists?: (rel: string) => boolean;
}

/** One writer. Pure: bytes in, bytes out; throw `CanvasEditError` to refuse with `invalid`. */
export interface EditOp {
  id: EditOpId;
  /** 'refuse' (default): a locked target refuses the op. 'allow' only for the lock op itself. */
  locked?: 'refuse' | 'allow';
  /**
   * S2.10b — the artboards this op changes as a whole (resize, copy, trash): an AI run's lease on
   * any of them refuses the op with `held-by-ai`, like an element hold. Absent = none.
   */
  artboards?(req: ResolvedEditOp): string[];
  /**
   * S7.6 (additive): 'artboard' = the op edits a whole video artboard's comp, addressed by
   * `params.artboard` (every artboard of the file when absent) instead of `targets`. The dispatcher then
   * refuses an artboard that is not on the canvas, and a locked one. The AI lease on it is the
   * `artboards` check above — declare `artboards` too (v2-lead-artboard-hold-one-check). Default 'targets'.
   */
  scope?: 'targets' | 'artboard';
  apply(source: string, req: ResolvedEditOp): EditOpOutput;
}

/**
 * Positions an op wants in the layout lane (`<canvas>.meta.json` `layout.artboards[]`, DDR-027: an artboard's
 * x/y live there, never in the TSX). `set` always lands; `pin` only fills an id that has no entry yet (so a
 * copy spliced into the JSX order cannot shift a board that was placed by the default grid). S2.10.
 */
export interface LayoutPatch {
  set?: Array<{ id: string; x: number; y: number }>;
  pin?: Array<{ id: string; x: number; y: number }>;
  /**
   * S2.10b — entries an op takes out (an artboard moved to the trash). Only on an op-log home, where
   * the removal is in the same action as the source: on a legacy link the entry stays (an orphan entry
   * is inert, and the source revert then brings the board back at its own place).
   */
  remove?: string[];
}

export interface EditOpOutput {
  source: string;
  created?: ElementRef[];
  /** op-specific facts about the write (S7.6: a split's new clip id, a trim's new length) */
  detail?: Record<string, unknown>;
  /** written to the layout lane in the same request, BEFORE the source (an orphan entry is harmless) */
  layout?: LayoutPatch;
  /** S2.2b — `element.set-id`: the id it renamed (its references move in the same request) */
  renamed?: IdRename;
  /**
   * S2.10b — the project action this write is on an op-log home. Absent: `kind: 'edit'` with the
   * op's `label`. `trashed` is the artboard-trash action's `origin.trashed` (S1-trash.md §2).
   */
  action?: {
    kind: 'edit' | 'trash';
    label: string;
    trashed?: Array<{ artboard: string; label?: string }>;
  };
}

/** HTTP status per refusal code (contract §2). */
export const EDIT_OP_STATUS: Readonly<Record<EditOpCode, number>> = {
  invalid: 400,
  forbidden: 403,
  'held-by-ai': 409,
  locked: 409,
  stale: 409,
};

export const MAX_TARGETS = 200;
export const MAX_BODY = 64 * 1024;

/** The undo of one edit-op on a legacy link (contract §5). Not a registry action. */
export const REVERT_OP = 'revert';

const REF_PART = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** A clean ElementRef, or null. Unknown keys are dropped. */
export function parseRef(v: unknown): ElementRef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { artboard, element, occurrence } = v as Record<string, unknown>;
  if (typeof artboard !== 'string' || !REF_PART.test(artboard)) return null;
  if (typeof element !== 'string' || !REF_PART.test(element)) return null;
  if (
    occurrence !== undefined &&
    !(Number.isSafeInteger(occurrence) && (occurrence as number) >= 0)
  )
    return null;
  return occurrence === undefined || occurrence === 0
    ? { artboard, element }
    : { artboard, element, occurrence: occurrence as number };
}

/** A clean EditOpRequest, or the reason it is not one. */
export function parseEditOpRequest(
  raw: unknown
): { ok: true; req: EditOpRequest } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, message: 'The edit has no body.' };
  const b = raw as Record<string, unknown>;
  if (typeof b.file !== 'string' || !b.file || b.file.length > 1024)
    return { ok: false, message: 'The edit names no canvas.' };
  if (typeof b.op !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(b.op))
    return { ok: false, message: 'Unknown edit.' };
  const rawTargets = b.targets ?? [];
  if (!Array.isArray(rawTargets) || rawTargets.length > MAX_TARGETS)
    return { ok: false, message: 'Too many objects for one edit.' };
  const targets: ElementRef[] = [];
  for (const t of rawTargets) {
    const r = parseRef(t);
    if (!r) return { ok: false, message: 'One of the objects is not addressable.' };
    targets.push(r);
  }
  let params: Record<string, unknown> | undefined;
  if (b.params !== undefined) {
    if (!b.params || typeof b.params !== 'object' || Array.isArray(b.params))
      return { ok: false, message: 'The edit’s settings are not readable.' };
    params = b.params as Record<string, unknown>;
  }
  if (
    b.expectRev !== undefined &&
    (typeof b.expectRev !== 'string' || !/^[0-9a-f]{16}$/.test(b.expectRev))
  )
    return { ok: false, message: 'The edit’s revision is not readable.' };
  const req: EditOpRequest = { file: b.file, op: b.op, targets };
  if (params) req.params = params;
  if (typeof b.expectRev === 'string') req.expectRev = b.expectRev;
  return { ok: true, req };
}
