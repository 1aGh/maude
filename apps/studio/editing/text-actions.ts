// editing/text-actions.ts — S2.12: what the canvas runs for the text actions (ed-text-edit, ed-text-style).
//
//   text.set-language / text.set-case / text.use-style / text.reset-style / text.detach-style
//                            the inspector's Type section and ⌘K ask the canvas through `run-action`;
//                            each is ONE edit-op (one write, one undo step)
//   text.set                 the typed copy, committed by the caret (commitTextInPlace) — also one edit-op
//
// The canvas is the one that can measure: Detach needs the style's own computed values and "As typed"
// under a style that sets the case needs to know it does. Both are read here (editing/type-role.ts) and
// sent as params; the server writes plain TSX from them and never guesses.

import { showCanvasToast } from '../canvas-notifications.tsx';
import { resolveSelectionEl } from '../dom-selection.ts';
import { TYPE_PROPS } from '../edit-ops/text-style.ts';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import type { CommandRecord } from '../undo-stack.ts';
import type { Selection } from '../use-selection-set.tsx';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { refOfElement } from './object-actions.ts';
import { refsOf, refusalLine } from './object-ops.ts';
import { declaredTypeValues, langIn, probeTextInfo } from './type-role.ts';

export const TEXT_OPS = {
  'text.set-language': { op: 'text.set-language', label: 'Set language' },
  'text.set-case': { op: 'text.set-case', label: 'Set case' },
  'text.use-style': { op: 'text.use-style', label: 'Use a style' },
  'text.reset-style': { op: 'text.reset-style', label: 'Reset text style' },
  'text.detach-style': { op: 'text.detach-style', label: 'Detach text style' },
} as const satisfies Record<string, { op: string; label: string }>;
export type TextAction = keyof typeof TEXT_OPS;
export const TEXT_ACTIONS = Object.keys(TEXT_OPS) as TextAction[];
export const isTextAction = (id: unknown): id is TextAction =>
  typeof id === 'string' && Object.hasOwn(TEXT_OPS, id);

export interface TextOpDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: CommandRecord) => void;
}

/** What a server with no `text.set` answers (edit-ops/dispatch.ts UNKNOWN_OP_MESSAGE; not imported — that
 *  module carries the source parser, which the canvas bundle must not). */
export const UNKNOWN_OP_MESSAGE = 'This edit is not available in this version.';

export const NEEDS_TEXT_LINE = 'Select some text first.';
export const NO_STYLE_LINE = 'This text has no style.';

/** The parameters a shell message may carry for a text action — nothing else gets through. */
export function textParams(params: unknown): {
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
  if (typeof p.role === 'string') out.role = p.role;
  if (typeof p.lang === 'string') out.lang = p.lang;
  if (p.case === 'typed' || p.case === 'upper') out.case = p.case;
  if (Array.isArray(p.props)) out.props = p.props.filter((x) => typeof x === 'string');
  return { refs: refs && refs.length > 0 && refs.length <= 200 ? refs : undefined, params: out };
}

const elementOf = (ref: ElementRef, doc: Document): HTMLElement | null =>
  doc.querySelector(
    `[data-dc-screen="${CSS.escape(ref.artboard)}"] [data-cd-id="${CSS.escape(ref.element)}"]`
  ) as HTMLElement | null;

/**
 * Run one text action over `refs` (default: the selection). Resolves to the last result, or null when
 * there was nothing to act on. Targets that wear different styles are detached one request each (a style's
 * values are one set), everything else is one request.
 */
export async function runTextAction(
  action: TextAction,
  selected: readonly Selection[],
  refs: ElementRef[] | undefined,
  params: Record<string, unknown>,
  deps: TextOpDeps = {},
  doc: Document = document
): Promise<EditOpResult | null> {
  const spec = TEXT_OPS[action];
  const targets = refs ?? refsOf(selected);
  if (targets.length === 0) {
    deps.toast?.(NEEDS_TEXT_LINE, 'info');
    return null;
  }
  const run = deps.run ?? ((ask: EditOpAsk) => runEditOp(ask));
  // [targets, params] groups: one request each
  let groups: Array<[ElementRef[], Record<string, unknown>]> = [[targets, params]];
  if (action === 'text.detach-style') {
    const byValues = new Map<string, [ElementRef[], Record<string, unknown>]>();
    for (const ref of targets) {
      const el = elementOf(ref, doc);
      const info = el ? probeTextInfo(el) : null;
      if (!info?.role) continue;
      // The style's values as the system wrote them (`var(--type-xl)`); a property its rule does not
      // declare is the computed value, never an empty one.
      const declared = declaredTypeValues(doc, info.role);
      const values: Record<string, string> = {};
      for (const p of TYPE_PROPS) {
        const v = declared[p] ?? info.values[p];
        if (v) values[p] = v;
      }
      const key = JSON.stringify(values);
      const g: [ElementRef[], Record<string, unknown>] = byValues.get(key) ?? [[], { values }];
      g[0].push(ref);
      byValues.set(key, g);
    }
    groups = [...byValues.values()];
    if (groups.length === 0) {
      deps.toast?.(NO_STYLE_LINE, 'info');
      return null;
    }
  } else if (action === 'text.set-case' && params.case === 'typed') {
    // under a style that sets the case, only an explicit `none` puts the text back as typed
    const explicitFor = (list: ElementRef[]) =>
      list.some((r) => {
        const el = elementOf(r, doc);
        const info = el ? probeTextInfo(el) : null;
        return !!info?.role && info.values['text-transform'] === 'uppercase';
      });
    groups = [[targets, { ...params, ...(explicitFor(targets) ? { explicit: true } : {}) }]];
  }
  let last: EditOpResult | null = null;
  for (const [list, p] of groups) {
    last = await run({
      op: spec.op,
      targets: list,
      ...(Object.keys(p).length ? { params: p } : {}),
    });
    if (!last.ok) {
      deps.toast?.(refusalLine(last), 'error');
      return last;
    }
    if (last.actionId === null && last.writeId) {
      const rec = editOpRecord(last.writeId, spec.label);
      if (rec) deps.record?.(rec);
    }
  }
  return last;
}

/** The toast + undo wiring the editing layer hands in (the same `record` the object ops use). */
export const textOpDeps: { current: TextOpDeps } = {
  current: { toast: (m, k) => showCanvasToast(m, k === 'error' ? 'error' : 'info') },
};

// ── the caret's commit ────────────────────────────────────────────────────────────────────

export interface TextCommit {
  el: HTMLElement;
  text: string;
  /** what the element showed before the edit (a `.map()`ed text needs it to find its item) */
  before: string;
}

/**
 * The typed copy as ONE edit-op. true = handled (written, or refused with a line — the caller's text
 * reverts); false = the studio has no `text.set` (an older build): the caller takes the legacy path.
 */
export async function commitTextInPlace(
  c: TextCommit,
  deps: TextOpDeps & { revert?: () => void } = {}
): Promise<boolean> {
  const ref = refOfElement(c.el);
  if (!ref) return false;
  const run = deps.run ?? ((ask: EditOpAsk) => runEditOp(ask));
  const lang = langIn(c.el);
  const r = await run({
    op: 'text.set',
    targets: [ref],
    params: { text: c.text, before: c.before, ...(lang ? { lang } : {}) },
  });
  if (!r.ok) {
    if (r.code === 'invalid' && r.message === UNKNOWN_OP_MESSAGE) return false;
    deps.toast?.(refusalLine(r), 'error');
    deps.revert?.();
    return true;
  }
  if (r.actionId === null && r.writeId) {
    const rec = editOpRecord(r.writeId, 'Edit text');
    if (rec) deps.record?.(rec);
  }
  return true;
}

/** The element a one-object selection stands for (the inspector's Type section asks the canvas about it). */
export const selectedTextEl = (
  selected: readonly Selection[],
  doc: Document = document
): HTMLElement | null => {
  const one = selected.length === 1 ? selected[0] : null;
  return one?.id ? (resolveSelectionEl(doc, one) as HTMLElement | null) : null;
};
