// edit-ops/ds-instance-update.ts — S10.8: `ds.instance-update` (13 · ds-edit-instance: "Update").
//
// An instance on a canvas that was left out of a design-system update gets the CURRENT look, and nothing else on
// the canvas moves: the instance carries `data-ds-rev="head"` (V2-1.6 §5.8 / §5.11 d — the same attribute a
// freshly placed ⇧I instance arrives with). The canvas keeps its `dsRev`; the shell's pins host loads the head
// sheets for just this element. Already current (the attribute already says `head`) is the same bytes: no write.
//
// Only a canvas that is really left out takes it — the SERVER reads that (`req.ctx.dsRev`, S2.16), never the
// request. On a canvas that follows head the instance is current already and there is nothing to pin.
//
// targets[0]  the instance.

import MagicString from 'magic-string';

import { CanvasEditError } from '../canvas-edit.ts';
import { DS_REV_HEAD } from './insert-component.ts';
import { dsPinOf, hostIdAttr, readInstance } from './instance-model.ts';
import type { EditOp, ResolvedEditOp } from './types.ts';

const fail = (req: ResolvedEditOp, message: string): never => {
  throw new CanvasEditError(message, { canvas: req.file, id: req.targets[0]?.element ?? '' });
};

export const dsInstanceUpdate: EditOp = {
  id: 'ds.instance-update',
  apply(source, req) {
    const target = req.targets[0];
    if (!target || req.targets.length !== 1) return fail(req, 'Select one instance to update.');
    if (!req.ctx?.dsRev) return fail(req, 'This canvas follows the design system already.');
    const f = readInstance(source, req.file, target.element);
    if (!f) return fail(req, 'This is not an instance of a component.');
    if (f.repeats) return fail(req, 'This one repeats; change it where it is written.');

    const pin = dsPinOf(f);
    if (pin?.value === DS_REV_HEAD) return { source };
    const s = new MagicString(source);
    if (pin) s.overwrite(pin.attr.start, pin.attr.end, `data-ds-rev="${DS_REV_HEAD}"`);
    else {
      // after the id: `data-cd-id="x"` becomes `data-cd-id="x" data-ds-rev="head"`
      const id = hostIdAttr(f);
      if (!id) return fail(req, 'This instance has no id yet.');
      s.appendLeft(id.end, ` data-ds-rev="${DS_REV_HEAD}"`);
    }
    return { source: s.toString() };
  },
};
