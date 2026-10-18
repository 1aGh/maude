// The `annotations` rider on `PATCH /_api/canvas-meta` — contract
// `client/v2/contracts/S2-S4-artboard-motion-ids.md` §2 (S2.9b).
//
//   PATCH /_api/canvas-meta
//     { file, patch: { layout }, annotations: { ops, actionId, label? } }
//     → 200 { ok, meta, actionId? | queued? }
//
// An artboard move and the moves of the annotations that ride with it are ONE
// project action (S4 Q3, V2-1.5): one `proposeLanes` proposal carrying the
// `meta` and the `annotations` lane, one ⌘Z entry, one Version history row.
//
// The rider is THE MOVE DELTA, never a second board door (decision
// `v2-S2.9b-rider-is-the-move-delta`). This route is reachable from the
// untrusted canvas origin (DDR-054), and that is where canvas-lib's
// `commitPositions` runs, so the rule is the same on every origin: every op is
// a `patch` of an annotation that rides with an artboard the same PATCH moves —
//   - a member (`parentArtboard` = that artboard): only `x` / `y`, shifted by
//     exactly that artboard's delta (± {@link DELTA_TOLERANCE});
//   - an arrow bound to it (`startHost` / `endHost` `ab:` / `el:` ref): only its
//     cached free points (`start` / `end` stay free points) and the binds' `box`
//     (ref, label, magnet unchanged);
// and every field it sets carries `expect` = the value now on the board (so the
// legacy ⌘Z can invert it, and a concurrent change answers `stale`). Anything
// else — a put, a delete, an `unset`, a loose note, another field — refuses the
// whole PATCH (403 `not-a-move`, nothing written). Any other board change goes
// through `/_api/annotations/ops`.
//
// Roles: the layout lane's `edit` on the target canvas (S9.9, checked by the
// route before this) AND `annotate` there (S4-S9 §4). A read-only, Can comment
// or canvas-only session without both is refused before anything is read.

import { MAX_ELEMENTS } from '../annotations/constants.ts';
import { parseHostRef } from '../annotations/elements/_shared.ts';
import { jsonEq } from '../annotations/fields.ts';
import { type Op, parseOps } from '../annotations/ops.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import type { Api, LanesOutcome, LanesProposer } from '../api.ts';
import type { LanesRuntime } from './annotations.ts';

/** Same id grammar as an annotation write id (`validAnnotationWriteId`) and the bus's `undoGroup`. */
export const RIDER_ACTION_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;
/** World units a member's shift may differ from its artboard's (S4 rounds to 0.01). */
export const DELTA_TOLERANCE = 0.5;
const LABEL_MAX = 120;
/** How long a hub proposal is awaited before the answer says `queued` (as S4.7). */
const ANSWER_WAIT_MS = 8_000;

const ARROW_CACHE_KEYS = new Set(['start', 'end', 'startHost', 'endHost']);
const MEMBER_KEYS = new Set(['x', 'y']);

export interface ParsedRider {
  ops: Op[];
  actionId: string;
  label: string | null;
}

export type Refusal = { status: number; body: Record<string, unknown> };

const refuse = (status: number, reason: string, extra: Record<string, unknown> = {}): Refusal => ({
  status,
  body: { ok: false, reason, ...extra },
});

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The wire shape → typed ops, all or nothing (a dropped op refuses the batch, never half of it). */
export function parseRider(raw: unknown): ParsedRider | Refusal {
  if (!isRec(raw)) return refuse(400, 'annotations must be { ops, actionId }');
  if (typeof raw.actionId !== 'string' || !RIDER_ACTION_ID_RE.test(raw.actionId))
    return refuse(400, 'invalid actionId');
  if (!Array.isArray(raw.ops)) return refuse(400, 'annotations.ops must be an array');
  if (raw.ops.length > MAX_ELEMENTS) return refuse(413, 'too many ops in one batch');
  const { ops, dropped } = parseOps(raw.ops, MAX_ELEMENTS);
  if (dropped > 0) return refuse(400, 'invalid op');
  let label: string | null = null;
  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string') return refuse(400, 'invalid label');
    // Control characters become spaces; runs of white space collapse to one.
    const flat = Array.from(raw.label, (c) => {
      const code = c.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? ' ' : c;
    })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    label = flat ? flat.slice(0, LABEL_MAX) : null;
  }
  return { ops, actionId: raw.actionId, label };
}

/** `layout.artboards` → id → position (malformed entries are skipped). */
export function positionsOf(layout: unknown): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const list = isRec(layout) && Array.isArray(layout.artboards) ? layout.artboards : [];
  for (const r of list) {
    if (!isRec(r) || typeof r.id !== 'string') continue;
    if (typeof r.x !== 'number' || typeof r.y !== 'number') continue;
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
    out.set(r.id, { x: r.x, y: r.y });
  }
  return out;
}

/** The artboard an arrow end's canvas host names, or null. */
function hostArtboard(bind: unknown): string | null {
  if (!isRec(bind)) return null;
  const parsed = parseHostRef(bind.ref);
  return parsed ? parsed.artboard : null;
}

const isFreePoint = (v: unknown): boolean =>
  isRec(v) &&
  Object.keys(v).every((k) => k === 'x' || k === 'y') &&
  typeof v.x === 'number' &&
  typeof v.y === 'number' &&
  Number.isFinite(v.x) &&
  Number.isFinite(v.y);

/** A bind may change only its cached `box` (and nothing else). */
function onlyBoxChanged(before: unknown, after: unknown): boolean {
  if (!isRec(before) || !isRec(after)) return false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === 'box') continue;
    if (!jsonEq(before[k], after[k])) return false;
  }
  const box = after.box;
  return (
    box === undefined ||
    (isRec(box) && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(box[k] as number)))
  );
}

/**
 * The move-delta rule (header). `before` / `after` are the layout positions the
 * meta holds now and the PATCH sends. An artboard is MOVED when its position
 * changes; one with no position in the meta yet (JSX-placed) counts as moved,
 * and its delta is the one its members agree on.
 */
export function riderRefusal(
  board: readonly AnnotationElement[],
  ops: readonly Op[],
  before: ReadonlyMap<string, { x: number; y: number }>,
  after: ReadonlyMap<string, { x: number; y: number }>
): Refusal | null {
  const byId = new Map(board.map((e) => [e.id, e]));
  const delta = new Map<string, { dx: number; dy: number } | null>();
  for (const [id, p] of after) {
    const b = before.get(id);
    if (!b) delta.set(id, null);
    else if (b.x !== p.x || b.y !== p.y) delta.set(id, { dx: p.x - b.x, dy: p.y - b.y });
  }
  const agreed = new Map<string, { dx: number; dy: number }>();
  const near = (a: number, b: number) => Math.abs(a - b) <= DELTA_TOLERANCE;
  const seen = new Set<string>();
  for (const op of ops) {
    if (op.op !== 'patch') return refuse(403, 'not-a-move', { op: op.op });
    if (seen.has(op.id)) return refuse(403, 'not-a-move', { id: op.id });
    seen.add(op.id);
    const el = byId.get(op.id);
    if (!el) return refuse(409, 'gone', { id: op.id });
    const set = op.set ?? {};
    const keys = Object.keys(set);
    if (op.unset?.length || keys.length === 0) return refuse(403, 'not-a-move', { id: op.id });
    // Every field carries what the author saw; a concurrent change since is stale.
    for (const k of keys) {
      if (!op.expect || !(k in op.expect)) return refuse(403, 'not-a-move', { id: op.id });
      if (!jsonEq(el[k], op.expect[k])) return refuse(409, 'stale', { id: op.id });
    }
    const parent = typeof el.parentArtboard === 'string' ? el.parentArtboard : null;
    const member = parent !== null && delta.has(parent) && el.parent === undefined;
    const arrowHosts =
      el.type === 'arrow'
        ? [hostArtboard(el.startHost), hostArtboard(el.endHost)].filter(
            (a): a is string => a !== null && delta.has(a)
          )
        : [];
    for (const k of keys) {
      if (MEMBER_KEYS.has(k) && member) continue;
      if (ARROW_CACHE_KEYS.has(k) && (arrowHosts.length > 0 || (member && el.type === 'arrow')))
        continue;
      return refuse(403, 'not-a-move', { id: op.id, field: k });
    }
    for (const k of ['start', 'end'] as const) {
      if (k in set && !(isFreePoint(el[k]) && isFreePoint(set[k])))
        return refuse(403, 'not-a-move', { id: op.id, field: k });
    }
    for (const k of ['startHost', 'endHost'] as const) {
      if (k in set && !onlyBoxChanged(el[k], set[k]))
        return refuse(403, 'not-a-move', { id: op.id, field: k });
    }
    if (member && ('x' in set || 'y' in set)) {
      const dx = 'x' in set ? num(set.x) - num(el.x) : 0;
      const dy = 'y' in set ? num(set.y) - num(el.y) : 0;
      if ('x' in set && typeof set.x !== 'number') return refuse(403, 'not-a-move', { id: op.id });
      if ('y' in set && typeof set.y !== 'number') return refuse(403, 'not-a-move', { id: op.id });
      const want = delta.get(parent as string) ?? agreed.get(parent as string) ?? null;
      if (want === null) {
        // A JSX-placed artboard: its members must all move by one rigid delta.
        if (!('x' in set && 'y' in set)) return refuse(403, 'not-a-move', { id: op.id });
        agreed.set(parent as string, { dx, dy });
      } else if (!near(dx, 'x' in set ? want.dx : 0) || !near(dy, 'y' in set ? want.dy : 0)) {
        return refuse(403, 'not-a-move', { id: op.id, field: 'x' in set ? 'x' : 'y' });
      }
    }
  }
  return null;
}

/** One two-lane proposal (meta + annotations) through the home, as S4.7's `proposerFor`. */
export function riderProposer(
  rt: LanesRuntime | null | undefined,
  slug: string,
  o: { label: string; writeId: string }
): LanesProposer | null {
  if (!rt?.proposeLanes) return null;
  const accepted = rt.acceptedMode?.() === true;
  const propose = rt.proposeLanes.bind(rt);
  return {
    accepted,
    send: (lanes) => {
      const p = propose(slug, lanes, { kind: 'edit', label: o.label, writeId: o.writeId });
      if (!p) return Promise.resolve({ status: 'rejected', code: 'no-home' } as LanesOutcome);
      if (!accepted) return p;
      return Promise.race([
        p,
        new Promise<LanesOutcome>((resolve) =>
          setTimeout(() => resolve({ status: 'accepted', queued: true }), ANSWER_WAIT_MS)
        ),
      ]);
    },
  };
}

/** The history row when the client sent no label (canvas-lib always sends one). */
export const MOVE_LABEL_FALLBACK = 'Moved artboards';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface RiderPatchDeps {
  api: Pick<Api, 'fileSlug' | 'moveArtboardsWithRider'>;
  /** `ctx.syncControl.current()` — the hub runtime, the local home, or null. */
  control: () => LanesRuntime | null | undefined;
}

/**
 * The rider half of the canvas-meta PATCH. The route has already established
 * the layout lane's `edit` and this session's `annotate` on the target.
 */
export async function riderPatch(
  deps: RiderPatchDeps,
  body: { file: string; patch: Record<string, unknown>; annotations: unknown }
): Promise<Response> {
  const keys = Object.keys(body.patch);
  if (keys.length !== 1 || keys[0] !== 'layout')
    return json(400, { ok: false, reason: 'a rider rides a layout-only patch' });
  const rider = parseRider(body.annotations);
  if ('status' in rider) return json(rider.status, rider.body);
  const before = (layoutBefore: unknown) => positionsOf(layoutBefore);
  const after = positionsOf(body.patch.layout);
  const proposer = riderProposer(deps.control(), deps.api.fileSlug(body.file), {
    label: rider.label ?? MOVE_LABEL_FALLBACK,
    writeId: rider.actionId,
  });
  const r = await deps.api.moveArtboardsWithRider(
    body.file,
    body.patch.layout,
    {
      ops: rider.ops,
      actionId: rider.actionId,
      check: (board, layoutBefore) => riderRefusal(board, rider.ops, before(layoutBefore), after),
    },
    proposer
  );
  if (!r.ok) return json(r.status, r.body);
  return json(200, {
    ok: true,
    meta: r.meta,
    ...(r.actionId ? { actionId: r.actionId } : {}),
    ...(r.queued ? { queued: true } : {}),
  });
}
