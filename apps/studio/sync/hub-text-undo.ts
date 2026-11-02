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
 *             Every target (p8-fix-d F12): Undo history / Undo this chat names several steps, and
 *             the newer ones move the text the older ones are compared against — so the steps are
 *             reverted in turn, newest first, onto the head (textRevertChainCollides). A collision
 *             anywhere refuses the whole undo; it is never half applied. Anything unreadable
 *             answers "no conflict" (the kernel keeps its rule) — the route treats a thrown check
 *             the same way. So does every
 *             bound (one 2 s deadline, 64 effects, the board size limit — p8-secfix-studio I2/D5).
 */

// server-only: registers the character merge the collision check runs (ops.ts takes it by injection)
import '../annotations/ops-merge.ts';
import { MAX_BOARD_BYTES } from '../annotations/constants.ts';
import { textRevertChainCollides } from '../annotations/text-steps.ts';
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
  /** The action's effects and revision (the chain's order), as the hub recorded them; null = not found. */
  action(actionId: string): Promise<{ effects: HubEffect[]; revision?: number } | null>;
  /** p8-fix-d F12 — "Undo this chat": the ids the route will undo (the person's own `ai` runs). */
  chat?(chatId: string): Promise<string[] | null>;
  /** A lane body by its hash; null = unavailable. */
  blob(hash: string): Promise<string | null>;
  /** The doc's annotations lane body at the hub head ('' = empty); null = unavailable. */
  head(doc: string): Promise<string | null>;
}

const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Bounds on the check (p8-secfix-studio, V2-8.9 I2/D5): the reads come from the
 * hub, and a slow or hostile one must not stall ⌘Z. ONE overall deadline for
 * every read and merge together (each read alone has a 20 s transport timeout,
 * and a hub can list any number of effects); at most HUB_UNDO_MAX_EFFECTS
 * annotations effects examined (a text step's ⌘Z is one effect; a batch rarely
 * reaches double figures); no body over the board size limit is merged. Every
 * limit answers "no conflict" — fail open, exactly like an unreadable read: the
 * hub kernel still rebases the undo and keeps the collaborator's text by its own
 * rule. A refusal found before a limit is hit stands.
 */
export const HUB_UNDO_CHECK_DEADLINE_MS = 2000;
export const HUB_UNDO_MAX_EFFECTS = 64;
export const HUB_UNDO_MAX_BODY_BYTES = MAX_BOARD_BYTES;

export interface HubTextUndoLimits {
  deadlineMs?: number;
  maxEffects?: number;
  maxBodyBytes?: number;
}

/** A lane body by an effect's hash: none → '' (the lane's "no value"), a bad hash → null. */
async function bodyOf(hash: string | null | undefined, reads: HubTextUndoReads) {
  if (hash === null || hash === undefined || hash === '') return '';
  if (!HASH_RE.test(hash)) return null;
  return reads.blob(hash);
}

/** Over the byte cap → unreadable (null). `length` first: UTF-8 is never shorter. */
function capped(body: string | null | undefined, maxBytes: number): string | null {
  if (typeof body !== 'string') return null;
  if (body.length > maxBytes) return null;
  return Buffer.byteLength(body, 'utf8') > maxBytes ? null : body;
}

/** Would ⌘Z of `target` drop a collaborator's text (overlapping hunks)? */
export async function hubTextUndoConflict(
  target: UndoTarget,
  reads: HubTextUndoReads,
  limits: HubTextUndoLimits = {}
): Promise<boolean> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve(false);
    }, limits.deadlineMs ?? HUB_UNDO_CHECK_DEADLINE_MS);
  });
  try {
    return await Promise.race([
      check(target, reads, {
        maxEffects: limits.maxEffects ?? HUB_UNDO_MAX_EFFECTS,
        maxBodyBytes: limits.maxBodyBytes ?? HUB_UNDO_MAX_BODY_BYTES,
        expired: () => expired,
      }),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The ids a target names (a chat resolved through `reads.chat`); null = cannot tell. */
async function targetIds(target: UndoTarget, reads: HubTextUndoReads): Promise<string[] | null> {
  if ('actionId' in target) return [target.actionId];
  if ('actionIds' in target) return target.actionIds;
  const ids = reads.chat ? await reads.chat(target.chatId) : null;
  return ids?.length ? ids : null;
}

/**
 * The check itself; stops issuing reads once the deadline has passed. p8-fix-d F12: every target
 * of the undo is judged, newest first, as the ONE action the kernel makes of them — per board the
 * steps are reverted in turn onto the hub head (textRevertChainCollides), so any collision refuses
 * the whole undo. A target, blob or head that cannot be read leaves that judgement to the kernel's
 * rule (fail open, as before) — never a partial refusal.
 */
async function check(
  target: UndoTarget,
  reads: HubTextUndoReads,
  o: { maxEffects: number; maxBodyBytes: number; expired: () => boolean }
): Promise<boolean> {
  const ids = await targetIds(target, reads);
  if (!ids) return false;
  const actions: { effects: HubEffect[]; order: number }[] = [];
  for (const [i, id] of ids.entries()) {
    if (o.expired()) return false;
    const action = await reads.action(id);
    // a target the hub does not show cannot be placed in the chain: the kernel's rule decides
    if (!action || !Array.isArray(action.effects)) return false;
    const order = typeof action.revision === 'number' ? action.revision : i;
    actions.push({ effects: action.effects, order });
  }
  actions.sort((a, b) => b.order - a.order);
  const chains = new Map<string, { before: string; after: string }[]>();
  const blind = new Set<string>();
  let examined = 0;
  for (const a of actions) {
    for (const e of [...a.effects].reverse()) {
      if (o.expired()) return false;
      if (e?.lane !== 'annotations' || !e.doc || blind.has(e.doc)) continue;
      if (++examined > o.maxEffects) return false;
      const before = capped(await bodyOf(e.beforeHash, reads), o.maxBodyBytes);
      const after =
        before === null || o.expired()
          ? null
          : capped(await bodyOf(e.afterHash, reads), o.maxBodyBytes);
      if (before === null || after === null) {
        blind.add(e.doc);
        chains.delete(e.doc);
        continue;
      }
      const chain = chains.get(e.doc) ?? [];
      chain.push({ before, after });
      chains.set(e.doc, chain);
    }
  }
  for (const [doc, steps] of chains) {
    if (o.expired()) return false;
    const now = capped(await reads.head(doc), o.maxBodyBytes);
    if (now === null || o.expired()) continue;
    if (textRevertChainCollides(steps, now)) return true;
  }
  return false;
}
