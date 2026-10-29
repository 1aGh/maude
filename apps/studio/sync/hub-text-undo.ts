/**
 * @file       sync/hub-text-undo.ts — ⌘Z of a text step on a hub-linked project, refused on collision
 * @scope      apps/studio/sync/hub-text-undo.ts
 * @purpose    Michal 2026-10-29 (kg maude/v2-michal-hub-undo-refuses-on-text-collision): on a
 *             hub-linked project, ⌘Z of an annotation text step is refused (`undo-conflict`, 409)
 *             only when the 3-way merge of the undo against the current text would COLLIDE. A
 *             merge that does not overlap goes on to the hub kernel, which rebases the undo as
 *             before and keeps the collaborator's text. Studio-only — no hub change, so a 1.x hub
 *             answers the same.
 *
 *             The step's text is what the hub ACCEPTED, never what this studio proposed (the
 *             kernel may have merged the proposal 3-way onto a peer's head): the action's own
 *             annotations effects (`history` rows carry `beforeHash`/`afterHash`) and their blobs.
 *             The current text is the hub's head of that lane — what the kernel's undo merges onto.
 *
 *             One target (⌘Z) only, like the local home's slot check: Undo history / Undo this
 *             chat names several steps of one batch, and the newer ones move the text the older
 *             ones are compared against. Anything unreadable answers "no conflict" (the kernel
 *             keeps its rule) — the route treats a thrown check the same way.
 */

// server-only: registers the character merge the collision check runs (ops.ts takes it by injection)
import '../annotations/ops-merge.ts';
import { textRevertCollides } from '../annotations/text-steps.ts';
import type { UndoTarget } from './undo-target.ts';

/** One effect of an action as the hub's history records it. */
export interface HubEffect {
  doc: string | null;
  lane: string;
  beforeHash?: string | null;
  afterHash?: string | null;
}

/** What the check reads from the hub. Every read answers null when it cannot tell. */
export interface HubTextUndoReads {
  /** The action's effects, as the hub recorded them; null = not found. */
  action(actionId: string): Promise<{ effects: HubEffect[] } | null>;
  /** A lane body by its hash; null = unavailable. */
  blob(hash: string): Promise<string | null>;
  /** The doc's annotations lane body at the hub head ('' = empty); null = unavailable. */
  head(doc: string): Promise<string | null>;
}

const HASH_RE = /^[0-9a-f]{64}$/;

/** A lane body by an effect's hash: none → '' (the lane's "no value"), a bad hash → null. */
async function bodyOf(hash: string | null | undefined, reads: HubTextUndoReads) {
  if (hash === null || hash === undefined || hash === '') return '';
  if (!HASH_RE.test(hash)) return null;
  return reads.blob(hash);
}

/** Would ⌘Z of `target` drop a collaborator's text (overlapping hunks)? */
export async function hubTextUndoConflict(
  target: UndoTarget,
  reads: HubTextUndoReads
): Promise<boolean> {
  if (!('actionId' in target)) return false;
  const action = await reads.action(target.actionId);
  if (!action) return false;
  const heads = new Map<string, string | null>();
  for (const e of action.effects) {
    if (e.lane !== 'annotations' || !e.doc) continue;
    const before = await bodyOf(e.beforeHash, reads);
    const after = await bodyOf(e.afterHash, reads);
    if (before === null || after === null) continue;
    if (!heads.has(e.doc)) heads.set(e.doc, await reads.head(e.doc));
    const now = heads.get(e.doc);
    if (now === null || now === undefined) continue;
    if (textRevertCollides(before, after, now)) return true;
  }
  return false;
}
