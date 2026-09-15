// UI source operations that survive a race — plan T23/T24 (DDR-241).
//
// A change the person makes in the inspector or on the canvas (a text, a
// style property, an attribute) is saved as a whole-canvas proposal with the
// base it was made from; the hub merges it three-way. Two people changing the
// SAME property touch the same characters, and a character merge can only
// call that a conflict — a dialog for "we both picked a colour", which is not
// what a design tool does. Figma-class tools resolve it by acceptance order:
// the later assignment wins, and nothing else of either person's is lost.
//
// So such an edit also records WHAT it was — the operation, the element's
// position-independent print, and the value — and when its proposal loses a
// race the studio re-applies exactly that operation onto the version that won
// and proposes again. What the other person changed elsewhere survives (it is
// in the version the edit is re-applied to); the same property takes the
// later value; the history keeps both actions in the order they were accepted.
//
// It re-applies only when it can find THE element (canvas-edit
// `relocateElement`); a deleted or ambiguous target is a genuine conflict and
// goes to the person, never to a guess.

import {
  applyDeleteElement,
  applyDuplicateElement,
  applyEdit,
  applyMove,
  applyRemove,
  applyRemoveClip,
  applyResizeArtboard,
  applyRetimeSequenceByClip,
  applySetArtboardGuides,
  applySetArtboardHug,
  applySetArtboardKind,
  applySetArtboardLabel,
  applySetArtboardStyle,
  applyTextEdit,
  type ElementPrint,
  elementPrint,
  relocateElement,
} from '../canvas-edit.ts';

/** An artboard is addressed by its authored id — stable by construction. */
export type ArtboardFn = 'resize' | 'hug' | 'style' | 'kind' | 'label' | 'guides';

export type SourceOp =
  | {
      kind: 'text';
      id: string;
      text: string;
      occurrence?: number;
      before?: string;
      print: ElementPrint;
    }
  | {
      kind: 'set';
      id: string;
      attr: string;
      value: string;
      occurrence?: number;
      print: ElementPrint;
    }
  | { kind: 'remove'; id: string; attr: string; occurrence?: number; print: ElementPrint }
  // T25 — structural element operations, re-found by print.
  | { kind: 'delete'; id: string; occurrence?: number; print: ElementPrint }
  | { kind: 'duplicate'; id: string; occurrence?: number; print: ElementPrint }
  | {
      kind: 'move';
      id: string;
      refId: string;
      position: string;
      idIndex?: number;
      refIndex?: number;
      print: ElementPrint;
      refPrint: ElementPrint;
    }
  // Artboards and clips carry stable ids already (authored id; stableId +
  // content hash) — no print needed; a changed clip fails its own hash check.
  | { kind: 'artboard'; fn: ArtboardFn; artboardId: string; args: unknown[]; print?: undefined }
  | {
      kind: 'clip-retime' | 'clip-remove';
      artboardId?: string;
      stableId: string;
      expectedHash?: string;
      patch?: unknown;
      print?: undefined;
    };

type Describable =
  | { kind: 'text'; id: string; text: string; occurrence?: number; before?: string }
  | { kind: 'set'; id: string; attr: string; value: string; occurrence?: number }
  | { kind: 'remove'; id: string; attr: string; occurrence?: number }
  | { kind: 'delete'; id: string; occurrence?: number }
  | { kind: 'duplicate'; id: string; occurrence?: number }
  | {
      kind: 'move';
      id: string;
      refId: string;
      position: string;
      idIndex?: number;
      refIndex?: number;
    }
  | { kind: 'artboard'; fn: ArtboardFn; artboardId: string; args: unknown[] }
  | {
      kind: 'clip-retime' | 'clip-remove';
      artboardId?: string;
      stableId: string;
      expectedHash?: string;
      patch?: unknown;
    };

type StableOp = Extract<SourceOp, { kind: 'artboard' | 'clip-retime' | 'clip-remove' }>;
type ElementOp = Exclude<SourceOp, StableOp>;
const STABLE = new Set(['artboard', 'clip-retime', 'clip-remove']);
function isStable<T extends { kind: string }>(op: T): boolean {
  return STABLE.has(op.kind);
}

/** The attribute a print must ignore for this op (it is the one changing). */
function editedAttr(op: { kind: string; attr?: string }): string | null {
  if (op.kind !== 'set' && op.kind !== 'remove') return null;
  const a = op.attr ?? '';
  return a.startsWith('style.') ? 'style' : a;
}

/** Describe an operation against the source it is about to be applied to. */
export function describeSourceOp(
  canvasAbsPath: string,
  source: string,
  op: Describable
): SourceOp | null {
  try {
    if (isStable(op)) return op as SourceOp;
    const el = op as Exclude<Describable, { kind: 'artboard' | 'clip-retime' | 'clip-remove' }>;
    // A text edit's own text is what changes, so it is not part of the print.
    const print = elementPrint(canvasAbsPath, source, el.id, editedAttr(el), el.kind !== 'text');
    if (!print) return null;
    if (el.kind === 'move') {
      const refPrint = elementPrint(canvasAbsPath, source, el.refId, null);
      return refPrint ? { ...el, print, refPrint } : null;
    }
    return { ...el, print } as SourceOp;
  } catch {
    return null;
  }
}

export type ReplayResult =
  | { ok: true; source: string }
  | { ok: false; reason: 'target-missing' | 'failed' };

/** Re-apply `op` onto `head` — the version that won. Pure. */
export function replaySourceOp(canvasAbsPath: string, anyOp: SourceOp, head: string): ReplayResult {
  if (isStable(anyOp)) return replayStable(canvasAbsPath, anyOp as StableOp, head);
  return replayElement(canvasAbsPath, anyOp as ElementOp, head);
}

function replayStable(canvasAbsPath: string, op: StableOp, head: string): ReplayResult {
  try {
    if (op.kind === 'artboard')
      return { ok: true, source: replayArtboard(canvasAbsPath, op, head) };
    if (op.kind === 'clip-retime') {
      return {
        ok: true,
        source: applyRetimeSequenceByClip(
          canvasAbsPath,
          head,
          op.artboardId,
          op.stableId,
          op.expectedHash,
          op.patch as Parameters<typeof applyRetimeSequenceByClip>[5]
        ).source,
      };
    }
    if (op.kind === 'clip-remove') {
      return {
        ok: true,
        source: applyRemoveClip(canvasAbsPath, head, op.artboardId, op.stableId, op.expectedHash)
          .source,
      };
    }
  } catch {
    return { ok: false, reason: 'failed' };
  }
  return { ok: false, reason: 'failed' };
}

function replayElement(canvasAbsPath: string, op: ElementOp, head: string): ReplayResult {
  let id: string | null;
  try {
    id = relocateElement(canvasAbsPath, head, op.id, op.print, editedAttr(op));
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (!id) return { ok: false, reason: 'target-missing' };
  try {
    switch (op.kind) {
      case 'text':
        return {
          ok: true,
          source: applyTextEdit(canvasAbsPath, head, id, op.text, {
            ...(op.occurrence !== undefined ? { occurrence: op.occurrence } : {}),
          }).source,
        };
      case 'set':
        return {
          ok: true,
          source: applyEdit(canvasAbsPath, head, id, op.attr, op.value, op.occurrence).source,
        };
      case 'remove':
        return {
          ok: true,
          source: applyRemove(canvasAbsPath, head, id, op.attr, op.occurrence).source,
        };
      case 'delete':
        return {
          ok: true,
          source: applyDeleteElement(canvasAbsPath, head, id, op.occurrence).source,
        };
      case 'duplicate':
        return {
          ok: true,
          source: applyDuplicateElement(canvasAbsPath, head, id, op.occurrence).source,
        };
      case 'move': {
        const refId = relocateElement(canvasAbsPath, head, op.refId, op.refPrint, null);
        if (!refId) return { ok: false, reason: 'target-missing' };
        return {
          ok: true,
          source: applyMove(
            canvasAbsPath,
            head,
            id,
            refId,
            op.position as Parameters<typeof applyMove>[4],
            op.idIndex,
            op.refIndex
          ).source,
        };
      }
    }
  } catch {
    return { ok: false, reason: 'failed' };
  }
  return { ok: false, reason: 'failed' };
}

function replayArtboard(
  abs: string,
  op: Extract<SourceOp, { kind: 'artboard' }>,
  head: string
): string {
  const a = op.args;
  switch (op.fn) {
    case 'resize':
      return applyResizeArtboard(
        abs,
        head,
        op.artboardId,
        a[0] as number | undefined,
        a[1] as number | undefined
      ).source;
    case 'hug':
      return applySetArtboardHug(
        abs,
        head,
        op.artboardId,
        a[0] === true,
        a[1] as number | undefined
      ).source;
    case 'style':
      return applySetArtboardStyle(
        abs,
        head,
        op.artboardId,
        a[0] as Parameters<typeof applySetArtboardStyle>[3]
      ).source;
    case 'kind':
      return applySetArtboardKind(abs, head, op.artboardId, (a[0] as string | null) ?? null).source;
    case 'label':
      return applySetArtboardLabel(abs, head, op.artboardId, String(a[0] ?? '')).source;
    case 'guides':
      return applySetArtboardGuides(
        abs,
        head,
        op.artboardId,
        (a[0] as Record<string, unknown> | null) ?? null
      ).source;
  }
}
