// edit-ops/text-copy.ts — S2.12: the copy of a text element, read from the source and written back through
// the one text writer (`applyTextEdit`, canvas-edit.ts — the same one /_api/edit-text and v1 use).
//
// `text.set` is the typed copy of "edit in place": one request = one write = one undo step. When the
// element is Czech (its own `lang`, or the `lang` the canvas saw on an ancestor and sent along) the copy
// is tied on the way in, so the canvas and the file never disagree about where a line may break.

import { parseSync } from 'oxc-parser';

import { applyEdit, applyTextEdit, CanvasEditError, readAttributeState } from '../canvas-edit.ts';
import { walkIdElements } from '../element-ids.ts';
import { isCzech, tieCzech } from './czech-ties.ts';
import type { EditOp } from './types.ts';

type AnyNode = { type?: string; start?: number; end?: number; [k: string]: unknown };

/** The JSX element that starts at `start`, found by walking the parsed program. */
function elementAt(node: unknown, start: number): AnyNode | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as AnyNode;
  if (n.type === 'JSXElement' && n.start === start) return n;
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) {
      for (const c of v) {
        const hit = elementAt(c, start);
        if (hit) return hit;
      }
    } else if (v && typeof v === 'object') {
      const hit = elementAt(v, start);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * The copy a text element shows — a single JSX text, or a single `{'string literal'}` — as the person
 * would read it (JSX line breaks collapsed). null for anything else: a `{variable}`, mixed content, an
 * element with no text.
 */
export function readTextOf(
  file: string,
  source: string,
  id: string,
  _occurrence?: number
): string | null {
  const walk = walkIdElements(source, file);
  if (!walk.ok) return null;
  const el = walk.elements.find((e) => e.id === id);
  if (!el) return null;
  const parsed = parseSync(file, source, { sourceType: 'module' });
  if (parsed.errors?.length) return null;
  const node = elementAt(parsed.program, el.start);
  const kids = (Array.isArray(node?.children) ? node?.children : []) as AnyNode[];
  const real = kids.filter(
    (c) => !(c.type === 'JSXText' && typeof c.value === 'string' && c.value.trim() === '')
  );
  const only = real[0];
  if (real.length !== 1 || !only) return null;
  if (only.type === 'JSXText' && typeof only.value === 'string') {
    return only.value
      .split(/\r\n|\n|\r/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ');
  }
  if (only.type === 'JSXExpressionContainer') {
    const ex = only.expression as AnyNode | undefined;
    if ((ex?.type === 'Literal' || ex?.type === 'StringLiteral') && typeof ex.value === 'string')
      return ex.value;
  }
  return null;
}

/** Write `tied` as the copy of `id`; `before` is what the source showed (for a `.map()`ed text). */
export function tiedTextOp(
  file: string,
  source: string,
  id: string,
  tied: string,
  before: string,
  occurrence?: number
): string {
  return applyTextEdit(file, source, id, tied, {
    ...(occurrence !== undefined ? { occurrence } : {}),
    before,
  }).source;
}

/** The effective language: the one the canvas saw (an ancestor's counts), else the element's own `lang`. */
function langOf(file: string, source: string, id: string, hint: unknown, occ?: number): string {
  if (typeof hint === 'string' && hint.trim()) return hint.trim();
  const own = readAttributeState(file, source, id, 'lang', occ);
  return own.kind === 'literal' ? own.value : '';
}

export const textSet: EditOp = {
  id: 'text.set',
  apply(source, req) {
    const text = req.params.text;
    if (typeof text !== 'string' || text.length > 20_000)
      throw new CanvasEditError('There is no text to write.', {
        canvas: req.file,
        id: req.targets[0]?.element ?? '',
      });
    const before = typeof req.params.before === 'string' ? req.params.before : undefined;
    let out = source;
    for (const t of req.targets) {
      const lang = langOf(req.file, out, t.element, req.params.lang, t.occurrence);
      const next = isCzech(lang) ? tieCzech(text) : text;
      out = applyTextEdit(req.file, out, t.element, next, {
        ...(t.occurrence !== undefined ? { occurrence: t.occurrence } : {}),
        ...(before !== undefined ? { before } : {}),
      }).source;
    }
    return { source: out };
  },
};

const LANG_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

/** `text.set-language {lang}`: writes `lang`; for Czech it also ties the copy and turns the quotes, in
 *  the same write. Any other language writes `lang` only — nothing is un-tied. */
export const textSetLanguage: EditOp = {
  id: 'text.set-language',
  apply(source, req) {
    const lang = req.params.lang;
    if (typeof lang !== 'string' || !LANG_TAG.test(lang.trim()))
      throw new CanvasEditError('Pick a language.', {
        canvas: req.file,
        id: req.targets[0]?.element ?? '',
      });
    const tag = lang.trim();
    let out = source;
    for (const t of req.targets) {
      out = applyEdit(req.file, out, t.element, 'lang', tag, t.occurrence).source;
      if (!isCzech(tag)) continue;
      // a `{variable}` or mixed copy: the language is set, the copy is the code's
      const own = readTextOf(req.file, out, t.element, t.occurrence);
      if (own === null) continue;
      const tied = tieCzech(own);
      if (tied !== own) out = tiedTextOp(req.file, out, t.element, tied, own, t.occurrence);
    }
    return { source: out };
  },
};
