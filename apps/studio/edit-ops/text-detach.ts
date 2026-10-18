// edit-ops/text-detach.ts — S2.12: `text.detach-style`.
//
// "Detach keeps the look exactly and stops following the style — nothing else in the project changes."
// The canvas measured the style's values (editing/type-role.ts: a probe element wearing only the class)
// and sends them as `values`. Each property the element does not already override is inlined with the
// style's value; one it overrides keeps its own; the role class is dropped from the class list. After
// that the text looks the same and a change to the style no longer reaches it.

import { applyEdit, CanvasEditError, readAttributeState } from '../canvas-edit.ts';
import { isTypeProp, withoutRoleClasses } from './text-style.ts';
import { classOf, writeClass } from './text-style-ops.ts';
import type { EditOp } from './types.ts';

/** A CSS value the style computes to. Quoted names, commas and var()/calc() are fine; a brace, a
 *  semicolon or a line break is not a value. */
const VALUE_OK = /^[^;{}<>`$\\\n\r]{1,200}$/;

export const textDetachStyle: EditOp = {
  id: 'text.detach-style',
  apply(source, req) {
    const id0 = req.targets[0]?.element ?? '';
    const raw = req.params.values;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new CanvasEditError('The canvas did not say what the style looks like.', {
        canvas: req.file,
        id: id0,
      });
    const values: Array<[string, string]> = [];
    for (const [prop, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!isTypeProp(prop) || typeof v !== 'string' || !VALUE_OK.test(v.trim()))
        throw new CanvasEditError('That is not a value the style can have.', {
          canvas: req.file,
          id: id0,
        });
      values.push([prop, v.trim()]);
    }
    let out = source;
    for (const t of req.targets) {
      const cur = classOf(req, out, t.element, t.occurrence);
      for (const [prop, v] of values) {
        const st = readAttributeState(req.file, out, t.element, `style.${prop}`, t.occurrence);
        if (st.kind === 'expression')
          throw new CanvasEditError(`${t.element} sets its style in code; change it in the code.`, {
            canvas: req.file,
            id: t.element,
          });
        if (st.kind !== 'absent') continue; // already its own (an override keeps its value)
        out = applyEdit(
          req.file,
          out,
          t.element,
          `style.${prop}`,
          JSON.stringify(v),
          t.occurrence
        ).source;
      }
      out = writeClass(req, out, t.element, withoutRoleClasses(cur), t.occurrence);
    }
    return { source: out };
  },
};
