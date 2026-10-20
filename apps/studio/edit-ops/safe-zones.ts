// edit-ops/safe-zones.ts — S7.22 `artboard.set-safe-zones`: name the platform whose own interface covers an artboard.
//
//   params { artboard: string, preset: string | null }
//
// `preset` is one id from `kinds/safe-zones.ts` ("instagram-reels"); `null` (or "") is "None" and removes the
// prop. The id goes into the JSX `safeZones` string prop — design intent, JSX-authoritative (DDR-181). Whether the
// bands are DRAWN is the person's own view state (`_canvas-state/<slug>.view.json` `overlays.safeZones`), written
// through the existing view lane, never here. The bands are canvas-only and no exporter paints them.
//
// Same result by hand: `canvas-tsx.md` § "Artboard props that Maude 2 adds". Registry action:
// `artboard.set-safe-zones`.

import { applySetArtboardSafeZones, CanvasEditError } from '../canvas-edit.ts';
import { isSafeZoneId } from '../kinds/safe-zones.ts';
import { ARTBOARD_ID_RE } from './artboard-resize.ts';
import type { EditOp } from './types.ts';

export const artboardSetSafeZones: EditOp = {
  id: 'artboard.set-safe-zones',
  // An AI run holding the artboard refuses the change, like a resize.
  artboards: (req) => (typeof req.params.artboard === 'string' ? [req.params.artboard] : []),
  apply(source, req) {
    const id = req.params.artboard;
    if (typeof id !== 'string' || !ARTBOARD_ID_RE.test(id))
      throw new CanvasEditError('That artboard is not on this canvas.', {
        canvas: req.file,
        id: '',
      });
    const raw = req.params.preset;
    const preset = raw === null || raw === undefined || raw === '' ? null : raw;
    if (preset !== null && !isSafeZoneId(preset))
      throw new CanvasEditError('That safe zone is not one Maude knows.', {
        canvas: req.file,
        id,
      });
    return { source: applySetArtboardSafeZones(req.file, source, id, preset).source };
  },
};
