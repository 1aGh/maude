// edit-ops/siblings.ts — the JSX sibling model the structural edit-ops share (S2.6).
//
// Frame, unframe and z-order all work on "children of one JSX parent as written": a child that sits
// inside `{cond && <A/>}` or a `.map()` is NOT a sibling you can reorder or wrap, so the walker's
// `kids` (which follows the JSX stack through expression containers) is not enough. This reads the
// AST once and answers per direct JSXElement child: which parent node holds it, at which index, and
// whether that parent holds nothing but elements and whitespace.
//
// Pure: bytes in, facts out. Throws nothing (an unparsable source yields an empty model).

import { parseSync } from 'oxc-parser';

type AnyNode = any; // oxc-parser's ESTree nodes, untyped here exactly like canvas-edit.ts

export interface SiblingGroup {
  /** Start offset of the JSXElement / JSXFragment that holds these children. */
  parentStart: number;
  /** True for a `<>…</>` parent (it has no attributes to lose, but cannot be framed into). */
  fragment: boolean;
  /** Direct JSXElement children, in source order. */
  kids: Array<{ start: number; end: number }>;
  /** Every child is an element or whitespace-only text (no `{expr}`, no words). */
  pure: boolean;
}

export interface SiblingModel {
  /** child start offset → its group and index in `group.kids` */
  at: Map<number, { group: SiblingGroup; index: number }>;
  /** parent node start offset → the group of its direct element children */
  byParent: Map<number, SiblingGroup>;
}

export function siblingModel(source: string, file: string): SiblingModel {
  const at: SiblingModel['at'] = new Map();
  const byParent: SiblingModel['byParent'] = new Map();
  let program: AnyNode;
  try {
    const parsed = parseSync(file.endsWith('.tsx') ? file : `${file}.tsx`, source, {
      sourceType: 'module',
    });
    if (parsed.errors?.length) return { at, byParent };
    program = parsed.program;
  } catch {
    return { at, byParent };
  }
  const visit = (node: AnyNode): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
      const group: SiblingGroup = {
        parentStart: node.start,
        fragment: node.type === 'JSXFragment',
        kids: [],
        pure: true,
      };
      byParent.set(node.start, group);
      for (const c of Array.isArray(node.children) ? node.children : []) {
        if (c?.type === 'JSXElement') {
          at.set(c.start, { group, index: group.kids.length });
          group.kids.push({ start: c.start, end: c.end });
        } else if (c?.type === 'JSXText') {
          if (String(c.value).trim() !== '') group.pure = false;
        } else {
          group.pure = false;
        }
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }
  };
  visit(program);
  return { at, byParent };
}

/** The indentation of the line `pos` sits on (leading spaces / tabs). */
export function indentAt(source: string, pos: number): string {
  let i = pos;
  while (i > 0 && (source[i - 1] === ' ' || source[i - 1] === '\t')) i--;
  return source.slice(i, pos);
}

/** The line-leading whitespace of the line CONTAINING `pos` (not only the run right before it). */
export function lineIndent(source: string, pos: number): string {
  const ls = source.lastIndexOf('\n', pos - 1) + 1;
  const m = /^[ \t]*/.exec(source.slice(ls, pos));
  return m ? m[0] : '';
}

/** `text`'s continuation lines shifted: `remove` leading chars stripped (if present), `add` prepended. */
export function reindent(text: string, remove: string, add: string): string {
  return text
    .split('\n')
    .map((line, i) => {
      if (i === 0 || line === '') return line;
      const stripped = remove && line.startsWith(remove) ? line.slice(remove.length) : line;
      return add + stripped;
    })
    .join('\n');
}
