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
import { artboardResize } from './artboard-resize.ts';
import { revertSource, WRITE_ID_RE, type WriteLog } from './revert.ts';
import {
  EDIT_OP_STATUS,
  type EditOp,
  type EditOpCode,
  type EditOpResult,
  type ElementRef,
  parseEditOpRequest,
  REVERT_OP,
} from './types.ts';

/** THE op table. Append one line per writer (S2.2 element.set-id, S2.6 object.frame, S3.0 links…). */
export const EDIT_OPS: readonly EditOp[] = [
  artboardResize, // S2.8 artboard.resize
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
  /** the kernel action a write became, when the runtime already knows it */
  actionFor?(rel: string, after: string): string | null;
  log: WriteLog;
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
    return commit(rel, current, next, [], undefined, 'pre-edit-op-revert', deps);
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
  let out: { source: string; created?: ElementRef[] };
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
  return commit(rel, current, out.source, refs, out.created, `pre-${req.op}`, deps);
}

async function commit(
  rel: string,
  before: string,
  after: string,
  refs: ElementRef[],
  created: ElementRef[] | undefined,
  label: string,
  deps: DispatchDeps
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
  const writeId = deps.log.add(rel, before, after);
  const res: EditOpResult = {
    ok: true,
    actionId: deps.actionFor?.(rel, after) ?? null,
    writeId,
    rev: revOf(after),
    refs,
  };
  if (created?.length) res.created = created;
  return res;
}
