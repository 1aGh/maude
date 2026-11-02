// edit-ops/hide.ts — `object.hide` (the object menu's Hide, the Layers eye).
//
// Hide keeps the object in the file and in Layers (greyed): `display: none` plus a `data-cd-hidden`
// marker that remembers the previous inline display, so Show restores it exactly (canvas-edit.ts
// `applySetHidden`). A hidden object never exports. A locked target refuses (default) — unlock first.
//
// params.hidden: true | false sets it; absent toggles (hide all first, show all only when every
// target is hidden).

import { applySetHidden } from '../canvas-edit.ts';
import { walkIdElements } from '../element-ids.ts';
import type { EditOp } from './types.ts';

export const objectHide: EditOp = {
  id: 'object.hide',
  apply(source, req) {
    let want: boolean;
    if (typeof req.params.hidden === 'boolean') want = req.params.hidden;
    else {
      const walk = walkIdElements(source, req.file);
      const els = walk.ok ? walk.elements : [];
      want = !req.targets.every(
        (t) => els.find((e) => e.id === t.element)?.hiddenPrevDisplay != null
      );
    }
    let out = source;
    for (const t of req.targets) out = applySetHidden(req.file, out, t.element, want).source;
    return { source: out };
  },
};
