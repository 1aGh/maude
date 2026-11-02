// edit-ops/unframe.ts — `object.unframe` (⇧⌘G): remove a frame, keep what is inside (S2.6).
//
// The frame's children take its place, in order, at the frame's indentation; the frame's own
// attributes (its style, class, id) go with it — that is what removing a frame means, and ⌘Z
// brings it back. Applicable to a plain element (a lowercase tag, not a component) that sits
// directly in a parent and holds only objects (no loose text, no `{expressions}`). Anything else is
// refused with "Remove frame works on a frame of objects." — the menu greys the row for the same
// cases, but the server is the authority. Frame then unframe is byte-identical.

import MagicString from 'magic-string';

import { CanvasEditError } from '../canvas-edit.ts';
import { walkIdElements } from '../element-ids.ts';
import { lineIndent, reindent, siblingModel } from './siblings.ts';
import type { EditOp } from './types.ts';

const NOT_FRAME = 'Remove frame works on a frame of objects.';

export const objectUnframe: EditOp = {
  id: 'object.unframe',
  apply(source, req) {
    const err = (message: string, id = '') =>
      new CanvasEditError(message, { canvas: req.file, id });
    const walk = walkIdElements(source, req.file);
    if (!walk.ok) throw err('This canvas does not parse.');
    if (req.targets.length === 0) throw err(NOT_FRAME);
    const model = siblingModel(source, req.file);
    const spans: Array<{ start: number; end: number; text: string }> = [];
    for (const t of req.targets) {
      const el = walk.elements.find((e) => e.id === t.element);
      if (!el || !/^[a-z][a-z0-9]*$/.test(el.tag) || !model.at.has(el.start))
        throw err(NOT_FRAME, t.element);
      const inside = model.byParent.get(el.start);
      if (!inside || inside.kids.length === 0 || !inside.pure) throw err(NOT_FRAME, t.element);
      const indent = lineIndent(source, el.start);
      const text = inside.kids
        .map((k) => {
          const kidIndent = lineIndent(source, k.start);
          const remove = kidIndent.startsWith(indent) ? kidIndent.slice(indent.length) : '';
          return reindent(source.slice(k.start, k.end), remove, '');
        })
        .join(`\n${indent}`);
      spans.push({ start: el.start, end: el.end, text });
    }
    spans.sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++)
      if ((spans[i] as { start: number }).start < (spans[i - 1] as { end: number }).end)
        throw err('Remove one frame at a time when they sit inside each other.');
    const s = new MagicString(source);
    for (const sp of spans) s.overwrite(sp.start, sp.end, sp.text);
    return { source: s.toString() };
  },
};
