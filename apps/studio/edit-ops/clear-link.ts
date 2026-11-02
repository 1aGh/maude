// edit-ops/clear-link.ts — `element.clear-link` on S2.1's `POST /_api/edit-op` (S3.10a; S3-links-format §3).
// Removes `data-cd-link`; the id stays. No-op when the element has no link. See set-link.ts for the shape.

import { applyClearLink } from '../canvas-edit.ts';
import { type LinkOpRequest, oneTarget } from './set-link.ts';

export const CLEAR_LINK_OP = {
  id: 'element.clear-link',
  locked: 'refuse' as const,
  apply(source: string, req: LinkOpRequest): { source: string } {
    const t = oneTarget(req);
    return {
      source: applyClearLink(req.file, source, t.element, { occurrence: t.occurrence }).source,
    };
  },
};
