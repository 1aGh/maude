/**
 * @file       annotations/text-steps.ts — which ⌘Z steps would drop a collaborator's text
 * @scope      apps/studio/annotations/text-steps.ts
 * @purpose    Michal 2026-10-29, option b2 (kg maude/v2-michal-undo-refuses-over-collaborator-text,
 *             lead maude/v2-p8-undo-collab-refuse-studio-route-not-kernel): ⌘Z on an annotation
 *             text field a collaborator changed in the meantime is refused, and their text stays.
 *
 *             On the op log one ⌘Z step is whatever the collab room projected in one flush, and a
 *             local project records every writer as "you", so the kernel cannot tell a peer's
 *             typing from yours. Two in-memory facts can:
 *               contest — the room saw a batch whose text patch was merged 3-way: its `expect`
 *                         (the text the author last saw) was not what the field held, so
 *                         somebody else had changed it DURING the step;
 *               ledger  — per recorded step (action id): the text each element's slot held when
 *                         the step was made. If the slot holds something else now, somebody
 *                         changed it AFTER the step.
 *             Either one refuses the undo (`undo-conflict`). Session scope, like the ⌘Z stack.
 *
 *             Text slots only — sticky / text `text`, shape `label.text`, section `label`
 *             (text-session.ts `slotKindOf`). Every other field keeps the kernel's rule.
 *             React-free and server-safe (no `diff`).
 */

import { type Op, textMergeCollides, textMergeResult } from './ops.ts';
import { parseBoard } from './schema.ts';
import type { AnnotationElement } from './types.ts';
import { type SlotKind, slotKindOf, slotText } from './ui/text-session.ts';

/** The element's text slot, or null when its type has none. */
export function textSlotOf(el: AnnotationElement): string | null {
  const kind = slotKindOf(el);
  return kind ? slotText(el, kind) : null;
}

/** id → text slot of every text-bearing element of a board text. */
export function boardTextSlots(text: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!text) return out;
  for (const el of parseBoard(text).elements) {
    const s = textSlotOf(el);
    if (s !== null) out.set(el.id, s);
  }
  return out;
}

/** The text slots a step changed, with what it left there (`null` = the element is gone). */
export function changedTextSlots(
  beforeText: string | null | undefined,
  afterText: string
): Map<string, string | null> {
  const before = boardTextSlots(beforeText);
  const after = boardTextSlots(afterText);
  const out = new Map<string, string | null>();
  for (const [id, s] of after) if (before.get(id) !== s) out.set(id, s);
  for (const id of before.keys()) if (!after.has(id)) out.set(id, null);
  return out;
}

/**
 * p8-hub-undo-collision (kg maude/v2-michal-hub-undo-refuses-on-text-collision) — would reverting a
 * step (its board before → after, as the hub ACCEPTED it) onto the board as it is now collide with
 * somebody's text? Per text slot the step changed, the 3-way merge the kernel's undo runs:
 * base = what the step left, ours = what it replaced ('' for an element the step created — undo
 * removes it, text and all), theirs = the slot now. Overlapping hunks → true. A slot that is gone
 * now, or that the step removed, loses nobody's text; a merge that cannot be judged does not refuse.
 */
export function textRevertCollides(
  stepBefore: string | null | undefined,
  stepAfter: string,
  current: string | null | undefined
): boolean {
  const before = boardTextSlots(stepBefore);
  const now = boardTextSlots(current);
  for (const [id, left] of changedTextSlots(stepBefore, stepAfter)) {
    if (left === null) continue;
    const cur = now.get(id);
    if (cur === undefined) continue;
    if (textMergeCollides(left, before.get(id) ?? '', cur) === true) return true;
  }
  return false;
}

/**
 * p8-fix-d F12 — the same question for several steps undone as ONE action (Undo history, Undo this
 * chat, an action with several effects on one board). `steps` newest first; each is reverted onto
 * what the newer reverts left, slot by slot, with the merge the board runs — so a collaborator's
 * text that landed BETWEEN two of the steps is judged against the step it actually overlaps, not
 * against a newer step that moved the text since. Any collision → true: the whole undo is refused,
 * never half applied. One step answers exactly as `textRevertCollides`.
 */
export function textRevertChainCollides(
  steps: ReadonlyArray<{ before: string | null | undefined; after: string }>,
  current: string | null | undefined
): boolean {
  const now = boardTextSlots(current);
  for (const step of steps) {
    const before = boardTextSlots(step.before);
    for (const [id, left] of changedTextSlots(step.before, step.after)) {
      const replaced = before.get(id);
      if (left === null) {
        // the step removed it: its undo brings it back with the text it had
        if (replaced !== undefined && !now.has(id)) now.set(id, replaced);
        continue;
      }
      const cur = now.get(id);
      if (cur === undefined) continue;
      const ours = replaced ?? '';
      if (textMergeCollides(left, ours, cur) === true) return true;
      if (replaced === undefined) now.delete(id);
      else now.set(id, textMergeResult(left, ours, cur));
    }
  }
  return false;
}

function expectedSlot(kind: SlotKind, expect: Record<string, unknown>): string | undefined {
  if (kind === 'text') return typeof expect.text === 'string' ? expect.text : undefined;
  if (kind === 'label-string') return typeof expect.label === 'string' ? expect.label : undefined;
  const label = expect.label as { text?: unknown } | undefined;
  return typeof label?.text === 'string' ? label.text : undefined;
}

/**
 * Ids whose text a batch merged 3-way: a non-strict patch that sets the slot and expects a text
 * the element no longer held (`state` = the board the batch applied to).
 */
export function mergedTextSlots(
  state: ReadonlyMap<string, AnnotationElement>,
  ops: readonly Op[]
): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.op !== 'patch' || op.strict || !op.expect || !op.set) continue;
    const cur = state.get(op.id);
    const kind = cur ? slotKindOf(cur) : null;
    if (!cur || !kind) continue;
    const field = kind === 'text' ? 'text' : 'label';
    if (!Object.hasOwn(op.set, field) || !Object.hasOwn(op.expect, field)) continue;
    const expected = expectedSlot(kind, op.expect);
    if (expected !== undefined && expected !== slotText(cur, kind)) out.push(op.id);
  }
  return out;
}

/** The room's half: contested ids per board since its last projection. */
export function createTextContest() {
  const pending = new Map<string, Set<string>>();
  return {
    record(slug: string, state: ReadonlyMap<string, AnnotationElement>, ops: readonly Op[]) {
      const ids = mergedTextSlots(state, ops);
      if (!ids.length) return;
      const set = pending.get(slug) ?? new Set<string>();
      for (const id of ids) set.add(id);
      pending.set(slug, set);
    },
    /** What the projection about to land carries; clears it. */
    take(slug: string): string[] {
      const set = pending.get(slug);
      pending.delete(slug);
      return set ? [...set].sort() : [];
    },
  };
}

export interface TextStep {
  /** the board (`<slug>.annotations.json`) the step changed */
  slug: string;
  /** text slots the step changed → what it left there */
  slots: Map<string, string | null>;
  /** ids a collaborator changed during the step */
  contested: string[];
}

/** How many recorded steps are kept (the ⌘Z stack reads at most 200 rows). */
export const MAX_TEXT_STEPS = 500;

/**
 * How much text the ledger holds in all (p8-secfix-studio, V2-8.9 D6). The step
 * count alone let 500 steps of a 4 MiB board pin ~2 GiB. 32 MiB is a few
 * board-sized steps, and thousands of ordinary ones (a typing step is tens of
 * bytes), so the cap is never felt in normal use. Measured as JS strings are
 * held (2 bytes per UTF-16 unit). The oldest steps go first; an evicted step
 * answers "no conflict" and the kernel keeps its rule, exactly like a step past
 * MAX_TEXT_STEPS. The newest step is always kept, so the worst case is the cap
 * plus one board.
 */
export const MAX_TEXT_STEP_BYTES = 32 * 1024 * 1024;

/** The in-memory size of one step's strings (UTF-16: 2 bytes a unit). */
function stepBytes(step: TextStep): number {
  let units = step.slug.length;
  for (const [id, left] of step.slots) units += id.length + (left?.length ?? 0);
  for (const id of step.contested) units += id.length;
  return units * 2;
}

/** The home's half: what each recorded step left in the text slots it touched. */
export function createTextStepLedger(max = MAX_TEXT_STEPS, maxBytes = MAX_TEXT_STEP_BYTES) {
  const steps = new Map<string, { step: TextStep; bytes: number }>();
  let total = 0;
  const drop = (actionId: string) => {
    const had = steps.get(actionId);
    if (!had) return;
    total -= had.bytes;
    steps.delete(actionId);
  };
  return {
    note(actionId: string, step: TextStep): void {
      if (!step.slots.size && !step.contested.length) return;
      drop(actionId);
      const bytes = stepBytes(step);
      steps.set(actionId, { step, bytes });
      total += bytes;
      while (steps.size > 1 && (steps.size > max || total > maxBytes)) {
        const oldest = steps.keys().next().value;
        if (oldest === undefined) break;
        drop(oldest);
      }
    },
    get(actionId: string): TextStep | undefined {
      return steps.get(actionId)?.step;
    },
    /** The strings held, in bytes (what `maxBytes` caps). */
    bytes(): number {
      return total;
    },
    /**
     * Would undoing `ids` drop a collaborator's text? One target (⌘Z): contested, or a slot that no
     * longer holds what the step left (`current(slug)` — the board as it is now; null = unknown,
     * not checked). Several targets (Undo history / Undo this chat): only contested — the newer
     * targets of the same batch move the slots the older ones are compared against.
     */
    conflict(
      ids: readonly string[],
      current: (slug: string) => Map<string, string> | null
    ): boolean {
      const boards = new Map<string, Map<string, string> | null>();
      for (const id of ids) {
        const step = steps.get(id)?.step;
        if (!step) continue;
        if (step.contested.length) return true;
        if (ids.length > 1) continue;
        if (!boards.has(step.slug)) boards.set(step.slug, current(step.slug));
        const now = boards.get(step.slug);
        if (!now) continue;
        for (const [elId, left] of step.slots) {
          if ((now.get(elId) ?? null) !== left) return true;
        }
      }
      return false;
    },
  };
}
