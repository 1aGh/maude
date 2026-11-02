// editing/object-ops.ts — the canvas half of the S2.6 object ops (frame, unframe, z-order, lock,
// hide): one function every entry runs — the object menu, the keys, ⌘K (`run-action`) — so they
// share a refusal line, an undo record and a re-selection. The first real caller of `runEditOp`.
//
//   refs      the selection as ElementRefs (a computed id is fine — the dispatcher stamps it);
//   runEditOp the dgn round trip (shell pins `file`, `POST /_api/edit-op`);
//   refusal   one plain toast with the server's own words ("Logo is locked · ⇧⌘L unlocks");
//   undo      on a legacy link / unlinked project (the write has no kernel action id) the write
//             pushes ONE revert record (S2-edit-ops.md §5); with an `actionId` S5's projection owns
//             the undo and nothing is pushed here;
//   created   a new frame is selected once the canvas has re-rendered it.

import type { ActionId } from '../actions/types.ts';
import { type EditOpResult, type ElementRef, parseRef } from '../edit-ops/types.ts';
import type { CommandRecord } from '../undo-stack.ts';
import type { Selection } from '../use-selection-set.tsx';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';

/** The registry actions this slice runs, each as the edit-op it posts. */
export const OBJECT_OPS = {
  'object.frame': { op: 'object.frame', label: 'Frame selection' },
  'object.unframe': { op: 'object.unframe', label: 'Remove frame' },
  'object.bring-front': { op: 'object.bring-front', label: 'Bring to front' },
  'object.bring-forward': { op: 'object.bring-forward', label: 'Bring forward' },
  'object.send-backward': { op: 'object.send-backward', label: 'Send backward' },
  'object.send-back': { op: 'object.send-back', label: 'Send to back' },
  'object.lock': { op: 'object.lock', label: 'Lock' },
  'object.hide': { op: 'object.hide', label: 'Hide' },
} as const satisfies Record<string, { op: string; label: string }>;

export type ObjectOpAction = keyof typeof OBJECT_OPS;
export const OBJECT_OP_ACTIONS = Object.keys(OBJECT_OPS) as ObjectOpAction[];

export const isObjectOpAction = (id: unknown): id is ObjectOpAction =>
  typeof id === 'string' && Object.hasOwn(OBJECT_OPS, id);

export interface ObjectOpDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: CommandRecord) => void;
  /** select the objects a write created (the new frame), once they exist in the DOM */
  select?: (refs: ElementRef[]) => void;
}

/** The selection as refs. A selection without a stamped id (a bare artboard) is not an object. */
export function refsOf(selected: readonly Selection[]): ElementRef[] {
  const out: ElementRef[] = [];
  for (const s of selected) {
    if (!s.id || !s.artboardId) continue;
    out.push(
      s.index
        ? { artboard: s.artboardId, element: s.id, occurrence: s.index }
        : { artboard: s.artboardId, element: s.id }
    );
  }
  return out;
}

/** What a refusal says, in one line a person can act on. */
export function refusalLine(r: Extract<EditOpResult, { ok: false }>): string {
  return r.message || 'That did not go through.';
}

export async function runObjectOp(
  action: ObjectOpAction,
  refs: readonly ElementRef[],
  deps: ObjectOpDeps = {},
  params?: Record<string, unknown>
): Promise<EditOpResult | null> {
  const spec = OBJECT_OPS[action];
  if (refs.length === 0) return null;
  const run = deps.run ?? ((ask: EditOpAsk) => runEditOp(ask));
  const result = await run({
    op: spec.op,
    targets: [...refs],
    ...(params ? { params } : {}),
  });
  if (!result.ok) {
    deps.toast?.(refusalLine(result), 'error');
    return result;
  }
  if (result.actionId === null && result.writeId) {
    const rec = editOpRecord(result.writeId, spec.label);
    if (rec) deps.record?.(rec);
  }
  if (result.created?.length) deps.select?.(result.created);
  return result;
}

/** Is `id` an action the canvas runs for the shell's `run-action` lane? */
export function objectOpFor(id: ActionId): ObjectOpAction | null {
  return isObjectOpAction(id) ? id : null;
}

/**
 * The target and value a Layers row sends with `run-action` (client/v2/inspector/layers-row-tools.jsx):
 * `params.targets` (≤ 200 well-formed refs) and one boolean `locked` / `hidden`. Anything else is
 * ignored; absent targets mean "the selection".
 */
export function layerParams(params: unknown): {
  refs: ElementRef[] | undefined;
  params: Record<string, unknown> | undefined;
} {
  const p = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  let refs: ElementRef[] | undefined;
  if (Array.isArray(p.targets) && p.targets.length > 0 && p.targets.length <= 200) {
    const parsed = p.targets.map(parseRef);
    if (parsed.every((r): r is ElementRef => r !== null)) refs = parsed;
  }
  const out: Record<string, unknown> = {};
  if (typeof p.locked === 'boolean') out.locked = p.locked;
  if (typeof p.hidden === 'boolean') out.hidden = p.hidden;
  return { refs, params: Object.keys(out).length ? out : undefined };
}
