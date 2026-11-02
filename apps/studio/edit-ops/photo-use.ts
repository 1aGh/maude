// S8.15 — `photo.use-edit`: point ONE use of a picture at its own edit, or back at every use.
//
// A per-use edit is the content-addressed file `assets/<img8>.<edit8>.photo.json` (contract
// S8-asset-sidecars §5.1), written first through `PUT /_api/photo-edit?perUse=1`, which answers
// the name. This op is the second half, one undo step: it writes `data-photo-edit="<edit8>"` on
// the `<img>` (or the `<image>` / tiled picture) — or, with `edit: null`, removes it so the use
// shows the every-use look again. Nothing else on the element changes, and the file stays (it is
// tiny, and Version history may point at it).

import { applyEdit, applyRemove, readAttributeState } from '../canvas-edit.ts';
import { refuse } from './constraints.ts';
import { elementOf, isPicture, walkOrRefuse } from './image-fit.ts';
import type { EditOp } from './types.ts';

/** The name a per-use edit may have (the photo store's `EDIT8_RE`, repeated: no server import here). */
const EDIT_NAME_RE = /^[0-9a-f]{8,16}$/;
const ATTR = 'data-photo-edit';

export const photoUseEdit: EditOp = {
  id: 'photo.use-edit',
  apply(source, req) {
    const t = req.targets[0];
    if (!t) return refuse(req, 'Select a picture first.');
    const edit = req.params.edit;
    if (edit !== null && (typeof edit !== 'string' || !EDIT_NAME_RE.test(edit)))
      return refuse(req, 'That edit is not one this project keeps.', t.element);
    const el = elementOf(walkOrRefuse(source, req), t);
    if (!el || !(isPicture(el) || el.tag === 'image'))
      return refuse(req, 'That is not a picture.', t.element);
    const state = readAttributeState(req.file, source, t.element, ATTR);
    if (state.kind === 'expression')
      return refuse(req, 'This picture’s edit is chosen by the code; change it there.', t.element);
    if (edit === null)
      return {
        source:
          state.kind === 'absent' ? source : applyRemove(req.file, source, t.element, ATTR).source,
      };
    if (state.kind === 'literal' && state.value === edit) return { source };
    return { source: applyEdit(req.file, source, t.element, ATTR, edit).source };
  },
};
