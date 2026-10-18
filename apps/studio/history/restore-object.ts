// "Restore" on an object-history row — one object back to a version (V2-1.9 §5.8 / §5.9, S1.13).
//
//   annotation element (`.annotations.json`, by element id): the annotations lane with that element's
//     record replaced by its record at A (re-added when it was deleted since);
//   canvas element with an authored id (`data-cd-id`, V2-1.4 ElementRef) in A: its source range in Now
//     replaced by A's; gone since → re-inserted after its old previous sibling that still exists, else as
//     the first child of its old parent.
//   An element with no authored id at A (a "found by matching" row) is refused: "Restore the artboard
//   instead." — Maude never guesses which element a person meant.
//
// Pure: no I/O. The route proposes the result as ONE `kind: 'restore'` action (one undo step).

import { parseBoard } from '../annotations/schema';
import { type AnyNode, forEachChild, isNode, parseCanvas } from './describe-match';
import { nameInWords } from './describe-words';
import type { SpliceLane, SpliceSide } from './restore-artboard';

export type ObjectRefusal = 'not-in-version' | 'invalid-result';

export type ObjectAnswer =
  | { ok: true; lanes: Partial<Record<SpliceLane, string>>; label: string }
  | { ok: false; reason: ObjectRefusal; label: string; line: string };

export const OBJECT_REFUSAL_LINE = 'Restore the artboard instead.';

/** `<artboard>/<id>` → a canvas element; a bare id → an annotation element. */
export type ObjectKey =
  | { kind: 'element'; artboard: string; id: string }
  | { kind: 'annotation'; id: string };

const ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,127}$/;

export function parseObjectKey(v: unknown): ObjectKey | null {
  if (typeof v !== 'string' || v.length > 260) return null;
  const i = v.indexOf('/');
  if (i < 0) return ID.test(v) ? { kind: 'annotation', id: v } : null;
  const artboard = v.slice(0, i);
  const id = v.slice(i + 1);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  if (!artboard || /[/\u0000-\u001f]/.test(artboard) || !ID.test(id)) return null;
  return { kind: 'element', artboard, id };
}

const refuse = (reason: ObjectRefusal, label: string): ObjectAnswer => ({
  ok: false,
  reason,
  label,
  line: OBJECT_REFUSAL_LINE,
});

function attrOf(el: AnyNode, name: string): string | null {
  for (const a of el.openingElement?.attributes ?? []) {
    if (a?.type !== 'JSXAttribute' || a.name?.name !== name) continue;
    const v = a.value?.type === 'JSXExpressionContainer' ? a.value.expression : a.value;
    if (v && (v.type === 'Literal' || v.type === 'StringLiteral') && typeof v.value === 'string')
      return v.value;
    if (v?.type === 'TemplateLiteral' && !v.expressions?.length)
      return String(v.quasis?.[0]?.value?.cooked ?? '');
  }
  return null;
}

interface Found {
  node: AnyNode;
  parent: AnyNode | null;
  /** The element children of its parent, in order. */
  siblings: AnyNode[];
}

/** Every JSX element with `data-cd-id` = id (with its parent element). */
function findById(root: AnyNode, id: string): Found[] {
  const out: Found[] = [];
  const walk = (n: AnyNode, parent: AnyNode | null) => {
    if (!isNode(n)) return;
    if (n.type === 'JSXElement') {
      if (attrOf(n, 'data-cd-id') === id) {
        const siblings = parent
          ? (parent.children ?? []).filter((c: AnyNode) => c?.type === 'JSXElement')
          : [];
        out.push({ node: n, parent, siblings });
      }
      forEachChild(n, (c) => walk(c, n));
      return;
    }
    forEachChild(n, (c) => walk(c, parent));
  };
  walk(root, null);
  return out;
}

function restoreAnnotation(now: SpliceSide, old: SpliceSide, id: string): ObjectAnswer {
  const label = 'This object';
  const parse = (t: string | null | undefined) => {
    if (!t?.trim()) return null;
    try {
      const v = JSON.parse(t) as Record<string, unknown>;
      return v && typeof v === 'object' && Array.isArray(v.elements) ? v : null;
    } catch {
      return null;
    }
  };
  const o = parse(old.annotations);
  const rec = (o?.elements as Record<string, unknown>[] | undefined)?.find((e) => e?.id === id);
  if (!rec) return refuse('not-in-version', label);
  const n = parse(now.annotations) ?? { format: 'maude.annotations', v: 2, elements: [] };
  if (
    now.annotations?.trim() &&
    !parseBoard(now.annotations).elements.length &&
    (n.elements as unknown[]).length
  )
    return refuse('invalid-result', label); // a board this client cannot read stays as it is
  const els = n.elements as Record<string, unknown>[];
  let placed = false;
  const out = els.map((e) => {
    if (e?.id !== id) return e;
    placed = true;
    return rec;
  });
  if (!placed) out.push(rec);
  if (JSON.stringify(out) === JSON.stringify(els)) return { ok: true, lanes: {}, label };
  const { elements: _drop, ...head } = n;
  const prefix = JSON.stringify(head).slice(0, -1);
  const lines = out.map((e) => JSON.stringify(e));
  const text = `${prefix}${Object.keys(head).length ? ',' : ''}"elements":[${lines.length ? `\n${lines.join(',\n')}\n` : ''}]}\n`;
  if (!parseBoard(text).elements.some((e) => e.id === id)) return refuse('invalid-result', label);
  return { ok: true, lanes: { annotations: text }, label };
}

export function restoreObject(now: SpliceSide, old: SpliceSide, key: ObjectKey): ObjectAnswer {
  if (key.kind === 'annotation') return restoreAnnotation(now, old, key.id);
  const label = nameInWords(key.id) || 'This object';
  const po = parseCanvas(old.html);
  const pn = parseCanvas(now.html);
  if (!po || !pn) return refuse('invalid-result', label);
  const inOld = findById(po.program, key.id);
  // No authored id at that version (or two of them): never guess.
  if (inOld.length !== 1) return refuse('not-in-version', label);
  const [was] = inOld as [Found];
  const text = old.html.slice(was.node.start, was.node.end);
  const inNow = findById(pn.program, key.id);
  if (inNow.length > 1) return refuse('invalid-result', label);
  let html: string;
  if (inNow.length === 1) {
    const [is] = inNow as [Found];
    if (now.html.slice(is.node.start, is.node.end) === text) return { ok: true, lanes: {}, label };
    html = now.html.slice(0, is.node.start) + text + now.html.slice(is.node.end);
  } else {
    // Gone since: after its old previous sibling that still exists, else first in its old parent.
    let at: number | null = null;
    const idx = was.siblings.indexOf(was.node);
    for (let i = idx - 1; i >= 0 && at === null; i--) {
      const sid = attrOf(was.siblings[i], 'data-cd-id');
      const hit = sid ? findById(pn.program, sid) : [];
      if (hit.length === 1) at = (hit[0] as Found).node.end;
    }
    if (at === null && was.parent) {
      const pid = attrOf(was.parent, 'data-cd-id');
      const hit = pid ? findById(pn.program, pid) : [];
      if (hit.length === 1) at = (hit[0] as Found).node.openingElement.end;
    }
    if (at === null) return refuse('invalid-result', label);
    html = `${now.html.slice(0, at)}${text}${now.html.slice(at)}`;
  }
  const check = parseCanvas(html);
  if (!check || findById(check.program, key.id).length !== 1)
    return refuse('invalid-result', label);
  return { ok: true, lanes: { html }, label };
}
