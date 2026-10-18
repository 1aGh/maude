// edit-ops/set-link.ts — `element.set-link` on S2.1's `POST /_api/edit-op` (S3.10a; S3-links-format §3).
//
// Pure writer: bytes in, bytes out. One target (the dispatcher has already stamped it, so `element` is an
// authored id); `params.target` is the `data-cd-link` value. An invalid target throws LinkTargetError (a
// CanvasEditError → the dispatcher answers `invalid`). Shaped like S2.1's `EditOp` (edit-ops/types.ts) —
// structurally, so this file needs nothing from the dispatch branch; the lead lists it in `EDIT_OPS`.

import { applySetLink, CanvasEditError } from '../canvas-edit.ts';

/** S2.1's ResolvedEditOp / ElementRef, structurally (edit-ops/types.ts). */
export interface LinkOpRequest {
  file: string;
  op: string;
  targets: Array<{ artboard: string; element: string; occurrence?: number }>;
  params: Record<string, unknown>;
}

export function oneTarget(req: LinkOpRequest): LinkOpRequest['targets'][number] {
  if (req.targets.length !== 1) {
    throw new CanvasEditError('A link goes on one object at a time.', { canvas: req.file, id: '' });
  }
  return req.targets[0] as LinkOpRequest['targets'][number];
}

export const SET_LINK_OP = {
  id: 'element.set-link',
  locked: 'refuse' as const,
  apply(source: string, req: LinkOpRequest): { source: string } {
    const t = oneTarget(req);
    const target = req.params?.target;
    if (typeof target !== 'string' || !target) {
      throw new CanvasEditError('Say where the link goes.', { canvas: req.file, id: t.element });
    }
    return {
      source: applySetLink(req.file, source, t.element, target, { occurrence: t.occurrence })
        .source,
    };
  },
};
