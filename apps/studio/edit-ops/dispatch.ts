// edit-ops/dispatch.ts — the one edit-op dispatcher (S2.1; contract S2-edit-ops.md §3).
//
// `dispatchEditOp` runs ONE request against ONE file: parse → resolve → expectRev → stamp every
// target (V2-1.4 rule 3) → AI holds (409 held-by-ai) → locks (409 locked) → the op's pure writer →
// one write. IO is the caller's (routes/edit.ts): `read` / `write` / `heldByAi` / `actionFor` are
// deps, so the order is testable without a server.
//
// The op table is APPEND-ONLY: each S2/S3 slice adds one `edit-ops/<op>.ts` and one line to
// `EDIT_OPS` below. An op id is the registry action id that runs it.

import { createHash } from 'node:crypto';

import { CanvasEditError, ensureStamped } from '../canvas-edit.ts';
import { walkIdElements } from '../element-ids.ts';
import { alignOps } from './align.ts';
import { artboardResize } from './artboard-resize.ts';
import { CLEAR_LINK_OP } from './clear-link.ts';
import { objectConstrain } from './constraints.ts';
import { distributeOps } from './distribute.ts';
import { artboardDuplicate, artboardDuplicateAtWidth } from './duplicate-at-width.ts';
import { objectFrame } from './frame.ts';
import { objectHide } from './hide.ts';
import { objectLock } from './lock.ts';
import { objectPlaceFreely } from './place-freely.ts';
import type { ReferenceLanes } from './references.ts';
import { reorderOps } from './reorder.ts';
import { revertSource, WRITE_ID_RE, type WriteLog } from './revert.ts';
import { objectRotate } from './rotate.ts';
import { layoutSetGap } from './set-gap.ts';
import { elementSetId } from './set-id.ts';
import { SET_LINK_OP } from './set-link.ts';
import {
  EDIT_OP_STATUS,
  type EditOp,
  type EditOpCode,
  type EditOpOutput,
  type EditOpResult,
  type ElementRef,
  type IdRename,
  type LayoutPatch,
  parseEditOpRequest,
  REVERT_OP,
} from './types.ts';
import { objectUnframe } from './unframe.ts';
import {
  objectBringForward,
  objectBringFront,
  objectSendBack,
  objectSendBackward,
} from './z-order.ts';

/** THE op table. Append one line per writer (S2.2 element.set-id, S2.6 object.frame, S3.0 links…). */
export const EDIT_OPS: readonly EditOp[] = [
  // S2.6 — the object menu: frame / unframe, z-order, lock, hide
  objectFrame,
  objectUnframe,
  objectBringFront,
  objectBringForward,
  objectSendBackward,
  objectSendBack,
  objectLock,
  objectHide,
  // S2.2b — the inspector's Element id field: renames the id and every durable reference to it
  elementSetId,
  // S2.7 — the align bar and the rotate handle
  ...alignOps,
  ...distributeOps,
  objectRotate,
  artboardResize, // S2.8 artboard.resize
  // S2.10 — ⌘D / ⌥-drag / the artboard menu: a copy beside its source, in one write
  artboardDuplicate,
  artboardDuplicateAtWidth,
  // S2.11 — Place freely, constraints, reorder (earlier / later / to a slot)
  objectPlaceFreely,
  objectConstrain,
  ...reorderOps,
  // S2.11c — ⌥ "every gap at once": one gap value over several auto layouts, one write
  layoutSetGap,
  // S3.10a — a click's destination: `data-cd-link` (S3-links-format §3)
  SET_LINK_OP,
  CLEAR_LINK_OP,
];

export interface AiHoldHit {
  /** a run of this Mac's person (Stop is in the AI chat) — else a member's */
  mine: boolean;
}

export interface DispatchDeps {
  /** designRoot-relative path of an existing canvas `.tsx` for `file`, or null */
  resolve(file: string): string | null;
  read(rel: string): string | null;
  /** one write: announce the base, write the bytes, snapshot `before` */
  write(rel: string, before: string, after: string, label: string): Promise<void>;
  /** V2-1.15 §4 #13 — a live AI run holds this element (S5.4's `heldByAi`) */
  heldByAi(rel: string, element: string): AiHoldHit | null;
  /** S2.10 — an op's positions into the layout lane (`meta.layout.artboards[]`); absent = not written */
  writeLayout?(rel: string, patch: LayoutPatch): Promise<void>;
  /** the kernel action a write became, when the runtime already knows it */
  actionFor?(rel: string, after: string): string | null;
  log: WriteLog;
  /** S2.2b — the comments + board of a canvas; an id rename moves its references here. Without
   *  it a rename that has references to move is refused (never a half-rename). */
  references?: ReferenceLanes;
  /** the op table (tests pass their own); default `EDIT_OPS` */
  ops?: readonly EditOp[];
}

/** The file's revision: the first 16 hex of SHA-256 of its bytes. */
export function revOf(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}

const refuse = (code: EditOpCode, message: string): EditOpResult => ({ ok: false, code, message });

/** A name for messages: the authored id when it reads as one, else "This object". */
const said = (id: string) =>
  /^[a-z][a-z0-9-]*$/.test(id) && !/^[0-9a-f]{8}$/.test(id) ? id : 'This object';

export const STALE_MESSAGE = 'The canvas changed underneath; try again.';
export const REVERT_STALE_MESSAGE = 'Someone changed this since — undo skipped.';

/** An op this build has no writer for. 404 (not 400): a client probing a newer op hears "not in this
 *  version" — S2.2's id field says exactly that until `element.set-id` lands. */
export const UNKNOWN_OP_MESSAGE = 'This edit is not available in this version.';

export function statusOf(r: EditOpResult): number {
  if (r.ok) return 200;
  return r.code === 'invalid' && r.message === UNKNOWN_OP_MESSAGE ? 404 : EDIT_OP_STATUS[r.code];
}

export async function dispatchEditOp(raw: unknown, deps: DispatchDeps): Promise<EditOpResult> {
  const parsed = parseEditOpRequest(raw);
  if (!parsed.ok) return refuse('invalid', parsed.message);
  const req = parsed.req;
  const isRevert = req.op === REVERT_OP;
  const op = isRevert ? null : (deps.ops ?? EDIT_OPS).find((o) => o.id === req.op);
  if (!isRevert && !op) return refuse('invalid', UNKNOWN_OP_MESSAGE);

  const rel = deps.resolve(req.file);
  if (!rel) return refuse('invalid', 'That canvas is not in this project.');
  const current = deps.read(rel);
  if (current === null) return refuse('invalid', 'That canvas is not in this project.');
  if (req.expectRev !== undefined && req.expectRev !== revOf(current))
    return refuse('stale', STALE_MESSAGE);

  if (isRevert) {
    const writeId = req.params?.writeId;
    if (typeof writeId !== 'string' || !WRITE_ID_RE.test(writeId))
      return refuse('invalid', 'Nothing to undo.');
    const rec = deps.log.get(writeId);
    // A forgotten write (restart, rotated) and a change on the same bytes are both "stale": the
    // honest answer is that this step can't be undone here any more.
    if (!rec) return refuse('stale', REVERT_STALE_MESSAGE);
    if (rec.file !== rel) return refuse('invalid', 'That undo belongs to another canvas.');
    const next = revertSource(rec, current);
    if (next === null) return refuse('stale', REVERT_STALE_MESSAGE);
    // Undoing an id rename renames its references back too — one step (S2.2b). The inverse is a
    // rename, not old bytes: a comment pinned to the new id since then moves with the element.
    const back = rec.renamed ? { from: rec.renamed.to, to: rec.renamed.from } : undefined;
    if (back) {
      const w = walkIdElements(next, rel);
      if (!w.ok || w.elements.filter((e) => e.id === back.to).length !== 1)
        return refuse('stale', REVERT_STALE_MESSAGE);
      const gate = await renameGate(rel, back, deps);
      if (gate)
        return !gate.ok && gate.code === 'invalid' ? refuse('stale', REVERT_STALE_MESSAGE) : gate;
    }
    return commit(rel, current, next, [], undefined, 'pre-edit-op-revert', deps, back);
  }

  // Stamp every target in this write (V2-1.4 rule 3): an op never sees a computed id.
  let source = current;
  const refs: ElementRef[] = [];
  try {
    for (const t of req.targets) {
      const st = ensureStamped(rel, source, t.element, t.occurrence);
      source = st.source;
      refs.push(t.occurrence ? { ...t, element: st.id } : { artboard: t.artboard, element: st.id });
    }
  } catch (e) {
    if (e instanceof CanvasEditError)
      return refuse('invalid', 'One of the objects is not on this canvas.');
    throw e;
  }
  const walk = walkIdElements(source, rel);
  if (!walk.ok) return refuse('invalid', 'This canvas does not parse; fix it before editing.');
  for (const r of refs) {
    const el = walk.elements.find((x) => x.id === r.element);
    if (!el || (el.artboard !== null && el.artboard !== r.artboard))
      return refuse('invalid', 'One of the objects is not on this canvas.');
  }
  // AI holds are enforced; a person's hold is advisory and never checked here (Q10, DDR-120).
  for (const r of refs) {
    const hold = deps.heldByAi(rel, r.element);
    if (hold)
      return refuse(
        'held-by-ai',
        `${said(r.element)} is AI's until it's done${hold.mine ? ' · Stop in the AI chat' : ''}`
      );
  }
  if ((op as EditOp).locked !== 'allow') {
    for (const r of refs) {
      if (walk.elements.find((x) => x.id === r.element)?.locked)
        return refuse('locked', `${said(r.element)} is locked · ⇧⌘L unlocks`);
    }
  }
  let out: EditOpOutput;
  try {
    out = (op as EditOp).apply(source, {
      file: rel,
      op: req.op,
      targets: refs,
      params: req.params ?? {},
    });
  } catch (e) {
    if (e instanceof CanvasEditError) return refuse('invalid', e.message);
    throw e;
  }
  if (out.renamed) {
    const gate = await renameGate(rel, out.renamed, deps);
    if (gate) return gate;
  }
  // S2.10 — the layout lane goes first: an entry for an artboard that never got written is inert, while a
  // written artboard with no entry would flash at its default-grid slot before it moved.
  if (out.layout && out.source !== current && deps.writeLayout)
    await deps.writeLayout(rel, out.layout);
  return commit(rel, current, out.source, refs, out.created, `pre-${req.op}`, deps, out.renamed);
}

export const ID_HELD_BY_REFERENCE_MESSAGE =
  'Not renamed: a comment or an arrow of a removed object still uses that id; pick another.';
export const RENAME_SPLIT_MESSAGE =
  'Not renamed: comments or arrows point at this object, and this project can’t move them in one undo step yet.';

/**
 * S2.2b — may this rename go ahead? The new id must not be held by an AI run or by a durable
 * reference (a detached comment / arrow of a removed element would land on this one — V2-1.4
 * §4.2); the old id's references must be movable as ONE undo step. Null = go.
 */
async function renameGate(
  rel: string,
  r: IdRename,
  deps: DispatchDeps
): Promise<EditOpResult | null> {
  const ai = deps.heldByAi(rel, r.to);
  if (ai)
    return refuse(
      'held-by-ai',
      `${said(r.to)} is AI's until it's done${ai.mine ? ' · Stop in the AI chat' : ''}`
    );
  const lanes = deps.references;
  if (!lanes) return refuse('invalid', RENAME_SPLIT_MESSAGE);
  const taken = await lanes.count(rel, r.to);
  if (!taken.ok) return refuse('invalid', taken.message);
  if (taken.comments + taken.board > 0) return refuse('invalid', ID_HELD_BY_REFERENCE_MESSAGE);
  const held = await lanes.count(rel, r.from);
  if (!held.ok) return refuse('invalid', held.message);
  if (held.comments + held.board > 0 && !lanes.oneStep())
    return refuse('invalid', RENAME_SPLIT_MESSAGE);
  return null;
}

async function commit(
  rel: string,
  before: string,
  after: string,
  refs: ElementRef[],
  created: ElementRef[] | undefined,
  label: string,
  deps: DispatchDeps,
  renamed?: IdRename
): Promise<EditOpResult> {
  if (after === before)
    return {
      ok: true,
      actionId: null,
      writeId: deps.log.add(rel, before, after),
      rev: revOf(after),
      refs,
    };
  await deps.write(rel, before, after, label);
  let moved: { comments: number; board: number } | undefined;
  if (renamed && deps.references) {
    try {
      moved = await deps.references.rename(rel, renamed);
    } catch {
      // Never a half-rename: put back what moved, then the source (only if nobody wrote since).
      try {
        await deps.references.rename(rel, { from: renamed.to, to: renamed.from });
      } catch {
        /* the lanes refused twice — the source still goes back; refs left on the new id detach */
      }
      if (deps.read(rel) === after) await deps.write(rel, after, before, `${label}-rollback`);
      return refuse(
        'invalid',
        'Not renamed: the comments or the board could not be updated; nothing changed.'
      );
    }
  }
  const writeId = deps.log.add(rel, before, after, renamed);
  const res: EditOpResult = {
    ok: true,
    actionId: deps.actionFor?.(rel, after) ?? null,
    writeId,
    rev: revOf(after),
    refs,
  };
  if (created?.length) res.created = created;
  if (moved && res.ok) res.moved = moved;
  return res;
}
