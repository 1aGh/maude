// editing/instance-actions.ts — S2.17: what the canvas runs for the instance actions (ed-comp-instance).
//
//   component.swap-variant / component.reset / component.detach
//                 the inspector's Component · Content · Main component blocks and ⌘K ask the canvas through
//                 `run-action`; each is ONE edit-op (one write, one undo step).
//
// The canvas is the one that can measure: Detach needs what the instance RENDERS to (a system may override
// a component in its own `_ds.tsx`, so the server cannot know the markup). `measureInstance` reads the
// subtree; the studio validates it (edit-ops/instance-tree.ts) and writes plain TSX. Nothing else here is
// measured — a swap or a reset is decided by the file alone.

import { showCanvasToast } from '../canvas-notifications.tsx';
import type { TreeNode } from '../edit-ops/instance-tree.ts';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import type { CommandRecord } from '../undo-stack.ts';
import type { Selection } from '../use-selection-set.tsx';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { refsOf, refusalLine } from './object-ops.ts';

export const INSTANCE_OPS = {
  'component.swap-variant': { op: 'component.swap-variant', label: 'Swap variant' },
  'component.reset': { op: 'component.reset', label: 'Reset to the main component' },
  'component.detach': { op: 'component.detach', label: 'Detach instance' },
  // the Content › Text row types the instance's words: the same edit-op the caret commits
  'text.set': { op: 'text.set', label: 'Edit text' },
} as const satisfies Record<string, { op: string; label: string }>;
export type InstanceAction = keyof typeof INSTANCE_OPS;
export const INSTANCE_ACTIONS = Object.keys(INSTANCE_OPS) as InstanceAction[];
export const isInstanceAction = (id: unknown): id is InstanceAction =>
  typeof id === 'string' && Object.hasOwn(INSTANCE_OPS, id);

export const NEEDS_INSTANCE_LINE = 'Select an instance first.';
export const ONE_INSTANCE_LINE = 'Select one instance.';

export interface InstanceOpDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: CommandRecord) => void;
}

/** The parameters a shell message may carry for an instance action — nothing else gets through. */
export function instanceParams(params: unknown): {
  refs: ElementRef[] | undefined;
  params: Record<string, unknown>;
} {
  const p = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  const refs = Array.isArray(p.targets)
    ? (p.targets as unknown[]).filter(
        (r): r is ElementRef =>
          !!r &&
          typeof (r as ElementRef).artboard === 'string' &&
          typeof (r as ElementRef).element === 'string'
      )
    : undefined;
  const out: Record<string, unknown> = {};
  if (Object.hasOwn(p, 'variant') && (p.variant === null || typeof p.variant === 'string'))
    out.variant = p.variant;
  if (typeof p.component === 'string') out.component = p.component;
  if (typeof p.text === 'string' && p.text.length <= 2000) out.text = p.text;
  if (Array.isArray(p.props)) out.props = p.props.filter((x) => typeof x === 'string');
  return { refs: refs && refs.length > 0 && refs.length <= 200 ? refs : undefined, params: out };
}

// ── what an instance renders to ─────────────────────────────────────────────────────────────

const MAX_NODES = 240;
/** Attributes the canvas itself adds to what it draws; they are not the instance's. */
const CANVAS_ATTR =
  /^(?:data-dc-|data-cd-(?!id$)|data-ds-rev$|data-edit|contenteditable$|draggable$)/;

/** The rendered subtree of `el` — tags, attributes, text — for Detach to write as plain markup. */
export function measureInstance(el: Element): TreeNode {
  let nodes = 0;
  const walk = (e: Element): TreeNode => {
    nodes += 1;
    const attrs: Record<string, string> = {};
    for (const a of Array.from(e.attributes))
      if (!CANVAS_ATTR.test(a.name)) attrs[a.name] = a.value;
    const kids: Array<TreeNode | string> = [];
    for (const n of Array.from(e.childNodes)) {
      if (nodes > MAX_NODES) break;
      if (n.nodeType === 3) kids.push(n.textContent ?? '');
      else if (n.nodeType === 1) kids.push(walk(n as Element));
    }
    return { tag: e.localName, attrs, kids };
  };
  return walk(el);
}

const elementOf = (ref: ElementRef, doc: Document): HTMLElement | null =>
  doc.querySelector(
    `[data-dc-screen="${CSS.escape(ref.artboard)}"] [data-cd-id="${CSS.escape(ref.element)}"]`
  ) as HTMLElement | null;

/** How many nodes in the artboard carry this id (a `.map()` renders one source element many times). */
const renderedCount = (ref: ElementRef, doc: Document): number =>
  doc.querySelectorAll(
    `[data-dc-screen="${CSS.escape(ref.artboard)}"] [data-cd-id="${CSS.escape(ref.element)}"]`
  ).length;

/**
 * Run one instance action over the one selected instance (or `refs`). Resolves to the result, or null when
 * there was nothing to act on.
 */
export async function runInstanceAction(
  action: InstanceAction,
  selected: readonly Selection[],
  refs: ElementRef[] | undefined,
  params: Record<string, unknown>,
  deps: InstanceOpDeps = {},
  doc: Document = document
): Promise<EditOpResult | null> {
  const spec = INSTANCE_OPS[action];
  const targets = refs ?? refsOf(selected);
  if (targets.length === 0) {
    deps.toast?.(NEEDS_INSTANCE_LINE, 'info');
    return null;
  }
  if (targets.length > 1) {
    deps.toast?.(ONE_INSTANCE_LINE, 'info');
    return null;
  }
  const ref = targets[0] as ElementRef;
  const ask: EditOpAsk = { op: spec.op, targets: [ref] };
  const p: Record<string, unknown> = { ...params };
  if (action === 'component.detach') {
    const el = elementOf(ref, doc);
    if (!el) {
      deps.toast?.(NEEDS_INSTANCE_LINE, 'info');
      return null;
    }
    p.tree = measureInstance(el);
    p.rendered = renderedCount(ref, doc);
  }
  if (Object.keys(p).length) ask.params = p;
  const run = deps.run ?? ((a: EditOpAsk) => runEditOp(a));
  const r = await run(ask);
  if (!r.ok) {
    deps.toast?.(refusalLine(r), 'error');
    return r;
  }
  if (r.actionId === null && r.writeId) {
    const rec = editOpRecord(r.writeId, spec.label);
    if (rec) deps.record?.(rec);
  }
  return r;
}

/** The toast + undo wiring the editing layer hands in (the same `record` the other ops use). */
export const instanceOpDeps: { current: InstanceOpDeps } = {
  current: { toast: (m, k) => showCanvasToast(m, k === 'error' ? 'error' : 'info') },
};
