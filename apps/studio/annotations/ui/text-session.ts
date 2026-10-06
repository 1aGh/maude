/**
 * @file       annotations/ui/text-session.ts — one text edit, as ops (Task 19)
 * @scope      apps/studio/annotations/ui/text-session.ts
 * @purpose    DDR-242 AD7 "draft persistence" + "remote changes while
 *             editing". Pure: builds the ops an edit session sends, React-free.
 *
 *             A session remembers two texts:
 *               base      — the slot's text when the editor opened. Undo goes
 *                           back here (issue #106 C3: never to a stale value).
 *               lastSent  — what this session last put on the board (a draft
 *                           or the base). Every text op EXPECTS it, so the
 *                           board merges a collaborator's concurrent typing
 *                           3-way against exactly what we last saw — expecting
 *                           the base instead would make our own drafts look
 *                           like a conflicting edit and drop theirs.
 *
 *             Drafts: after ~600 ms of idle typing the editor reports its text;
 *             `draftOp` patches it so peers see typing land in about a second
 *             and a crash loses less than a second. Drafts never reach undo.
 *             The final commit is one undo record: base → final.
 */

import type { Op } from '../ops.ts';
import type { AnnotationElement } from '../types.ts';

export type SlotKind = 'text' | 'label-record' | 'label-string';

export interface TextSession {
  id: string;
  kind: SlotKind;
  base: string;
  lastSent: string;
}

/** Where an element keeps its editable text, or null (no text slot). */
export function slotKindOf(el: Pick<AnnotationElement, 'type'>): SlotKind | null {
  if (el.type === 'sticky' || el.type === 'text') return 'text';
  if (el.type === 'shape') return 'label-record';
  if (el.type === 'section') return 'label-string';
  return null;
}

export function slotText(el: AnnotationElement, kind: SlotKind): string {
  if (kind === 'text') return typeof el.text === 'string' ? el.text : '';
  if (kind === 'label-string') return typeof el.label === 'string' ? el.label : '';
  const label = el.label as { text?: unknown } | undefined;
  return typeof label?.text === 'string' ? label.text : '';
}

export function openSession(el: AnnotationElement): TextSession | null {
  const kind = slotKindOf(el);
  if (!kind) return null;
  const t = slotText(el, kind);
  return { id: el.id, kind, base: t, lastSent: t };
}

function setOf(kind: SlotKind, current: AnnotationElement | undefined, text: string) {
  if (kind === 'text') return { text };
  if (kind === 'label-string') return { label: text };
  // Full record: other label fields (size, colour, style) are kept even where
  // the board resolves the patch without a merge.
  const cur = (current?.label ?? {}) as Record<string, unknown>;
  return { label: { ...cur, text } };
}

function expectOf(kind: SlotKind, text: string) {
  if (kind === 'text') return { text };
  if (kind === 'label-string') return { label: text };
  return { label: { text } };
}

/** The patch a draft sends, or null when nothing changed since the last send. */
export function draftOp(
  s: TextSession,
  current: AnnotationElement | undefined,
  text: string
): Op | null {
  if (text === s.lastSent || !current) return null;
  return {
    op: 'patch',
    id: s.id,
    set: setOf(s.kind, current, text),
    expect: expectOf(s.kind, s.lastSent),
  };
}

/** Record that `text` reached the board (after a draft or the commit was sent). */
export function markSent(s: TextSession, text: string): TextSession {
  return { ...s, lastSent: text };
}

/**
 * Re-aim the commit batch's text expectation at `lastSent`. The batch is a diff
 * of the UI state (which may already hold a collaborator's merged text); the
 * board must merge against what THIS session last sent.
 */
export function aimCommitOps(ops: readonly Op[], s: TextSession): Op[] {
  return ops.map((op) => {
    if (op.op !== 'patch' || op.id !== s.id) return op;
    const field = s.kind === 'text' ? 'text' : 'label';
    if (!op.set || !(field in op.set)) return op;
    const expect = { ...(op.expect ?? {}) } as Record<string, unknown>;
    if (s.kind === 'label-record') {
      const e = (expect.label ?? {}) as Record<string, unknown>;
      expect.label = { ...e, text: s.lastSent };
    } else {
      expect[field] = s.lastSent;
    }
    return { ...op, expect };
  });
}

/**
 * A collaborator deleted the element while it was being edited and the user
 * chose to keep their text: put it back, same id, with the typed text. A
 * parent that is gone too is dropped — `world` carries the element's last
 * world position for that case.
 */
export function restoreOp(
  s: TextSession,
  lastKnown: AnnotationElement,
  text: string,
  parentExists: boolean,
  world?: { x: number; y: number }
): Op {
  const el: Record<string, unknown> = { ...lastKnown, ...setOf(s.kind, lastKnown, text) };
  if (el.parent !== undefined && !parentExists) {
    delete el.parent;
    if (world) {
      el.x = world.x;
      el.y = world.y;
    }
  }
  return { op: 'put', el: el as AnnotationElement };
}

/** Did a board change move this session's text away from what it last sent? */
export function remotelyEdited(s: TextSession, current: AnnotationElement | undefined): boolean {
  return !!current && slotText(current, s.kind) !== s.lastSent;
}
