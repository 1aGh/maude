// edit-ops/set-id.ts — `element.set-id` (the inspector's Element id field, ⌘K "Edit element id…").
//
// Renames ONE element's authored `data-cd-id` (V2-1.4 §5.5): the new id must fit the id grammar
// (§4.2) and be free on this canvas, else `invalid`. The writer is pure and touches only the
// attribute; it reports the rename (`renamed`) so the dispatcher moves every durable reference to
// the old id — comments, the board's element hosts — in the same request, and refuses the whole
// rename when it can't (edit-ops/references.ts). A locked element refuses (default `locked`), an
// AI-held one refuses (`held-by-ai`, the dispatcher's step 5). The name (`data-dc-element`) is not
// the id and is left alone.

import { CanvasEditError } from '../canvas-edit.ts';
import { isValidElementId, walkIdElements } from '../element-ids.ts';
import type { EditOp } from './types.ts';

export const SET_ID_OP = 'element.set-id';

export const ID_FORMAT_MESSAGE =
  'Not renamed: an id is lower-case letters and digits joined by single dashes, starts with a letter, at most 48 characters.';
export const ID_TAKEN_MESSAGE = 'Not renamed: another object on this canvas already has that id.';

export const elementSetId: EditOp = {
  id: SET_ID_OP,
  apply(source, req) {
    const target = req.targets[0];
    const at = { canvas: req.file, id: target?.element ?? '' };
    if (req.targets.length !== 1 || !target)
      throw new CanvasEditError('Rename one object at a time.', at);
    const to = req.params.id;
    if (typeof to !== 'string' || !isValidElementId(to))
      throw new CanvasEditError(ID_FORMAT_MESSAGE, at);
    const from = target.element;
    if (to === from) return { source };
    const walk = walkIdElements(source, req.file);
    if (!walk.ok)
      throw new CanvasEditError('This canvas does not parse; fix it before editing.', at);
    if (walk.elements.some((e) => e.id === to)) throw new CanvasEditError(ID_TAKEN_MESSAGE, at);
    const el = walk.elements.find((e) => e.id === from && e.idKind === 'literal');
    if (!el?.idAttr) throw new CanvasEditError('One of the objects is not on this canvas.', at);
    const out = `${source.slice(0, el.idAttr.start)}data-cd-id="${to}"${source.slice(el.idAttr.end)}`;
    return { source: out, renamed: { from, to } };
  },
};
