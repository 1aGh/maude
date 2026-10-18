// edit-ops/text-style-ops.ts — S2.12: `text.use-style`, `text.reset-style`, `text.set-case`.
//
// All three write plain TSX a v1 peer reads: a `t-<role>` class and ordinary inline declarations. The
// words (which properties a style owns, what a role class looks like) are in text-style.ts.
//
//   text.use-style {role: 't-heading'}   the role's class replaces any other role class; the inline
//                                        declarations of the style's properties go (the style wins)
//   text.reset-style {props?}            takes the style's inline overrides out (default: all of them)
//   text.set-case {case, explicit?}      AA = text-transform: uppercase; As typed removes it, or writes
//                                        `none` when the style itself sets a case (`explicit`)

import { applyEdit, applyRemove, CanvasEditError, readAttributeState } from '../canvas-edit.ts';
import {
  isTypeProp,
  ROLE_CLASS_RE,
  TYPE_PROPS,
  type TypeProp,
  withRoleClass,
} from './text-style.ts';
import type { EditOp, ResolvedEditOp } from './types.ts';

const refuse = (req: ResolvedEditOp, message: string, id?: string): never => {
  throw new CanvasEditError(message, { canvas: req.file, id: id ?? req.targets[0]?.element ?? '' });
};

/** Take `prop` out of the element's inline style when it is a literal there. */
export function removeInline(
  req: ResolvedEditOp,
  source: string,
  id: string,
  prop: TypeProp,
  occurrence?: number
): string {
  const st = readAttributeState(req.file, source, id, `style.${prop}`, occurrence);
  if (st.kind === 'absent') return source;
  if (st.kind === 'expression')
    return refuse(req, `${id} sets its style in code; change it in the code.`, id);
  return applyRemove(req.file, source, id, `style.${prop}`, occurrence).source;
}

/** The element's class list as a literal, or '' when it has none; a computed one is refused. */
export function classOf(
  req: ResolvedEditOp,
  source: string,
  id: string,
  occurrence?: number
): string | null {
  const st = readAttributeState(req.file, source, id, 'className', occurrence);
  if (st.kind === 'expression')
    return refuse(req, `${id} gets its classes from code; change it in the code.`, id);
  return st.kind === 'literal' ? st.value : null;
}

export function writeClass(
  req: ResolvedEditOp,
  source: string,
  id: string,
  next: string,
  occurrence?: number
): string {
  if (next === '') return applyRemove(req.file, source, id, 'className', occurrence).source;
  return applyEdit(req.file, source, id, 'className', next, occurrence).source;
}

export const textUseStyle: EditOp = {
  id: 'text.use-style',
  apply(source, req) {
    const role = req.params.role;
    if (typeof role !== 'string' || !ROLE_CLASS_RE.test(role))
      return refuse(req, 'Pick a style from the design system.');
    let out = source;
    for (const t of req.targets) {
      const cur = classOf(req, out, t.element, t.occurrence);
      // the declarations a style owns go first, so the style is what shows
      for (const p of TYPE_PROPS) out = removeInline(req, out, t.element, p, t.occurrence);
      out = writeClass(req, out, t.element, withRoleClass(cur, role), t.occurrence);
    }
    return { source: out };
  },
};

export const textResetStyle: EditOp = {
  id: 'text.reset-style',
  apply(source, req) {
    const asked = req.params.props;
    const props: TypeProp[] = Array.isArray(asked) ? asked.filter(isTypeProp) : [...TYPE_PROPS];
    if (Array.isArray(asked) && props.length !== asked.length)
      return refuse(
        req,
        'Reset a font, size, weight, line height, letter spacing, case or italic.'
      );
    let out = source;
    for (const t of req.targets)
      for (const p of props) out = removeInline(req, out, t.element, p, t.occurrence);
    return { source: out };
  },
};

export const textSetCase: EditOp = {
  id: 'text.set-case',
  apply(source, req) {
    const { case: want, explicit } = req.params;
    if (want !== 'typed' && want !== 'upper') return refuse(req, 'Case is As typed or AA.');
    let out = source;
    for (const t of req.targets) {
      if (want === 'upper') {
        out = applyEdit(
          req.file,
          out,
          t.element,
          'style.text-transform',
          JSON.stringify('uppercase'),
          t.occurrence
        ).source;
      } else if (explicit === true) {
        // the style sets a case: only an explicit `none` puts the text back as typed
        out = applyEdit(
          req.file,
          out,
          t.element,
          'style.text-transform',
          JSON.stringify('none'),
          t.occurrence
        ).source;
      } else {
        out = removeInline(req, out, t.element, 'text-transform', t.occurrence);
      }
    }
    return { source: out };
  },
};
