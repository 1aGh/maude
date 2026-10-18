// client/v2/inspector/sections/index.js — S2.3/S2.4: the section bodies that register themselves (append-only).
// One import per slice's section file; the registry (../slots.js) owns the order. Imported once, where the
// frame is wired (client/inspector/inspector-panel.jsx).

import { offArtboardSections } from '../kinds/artboard.jsx';
import { offConvert, offPlaceFreely } from '../kinds/frame.jsx';
import { offMulti } from '../kinds/multi.jsx';
import { offMultiArtboard } from '../kinds/multi-artboard.jsx';
import { offBorder } from './border.jsx';
import { offCorners } from './corners.jsx';
import { offEffects } from './effects.jsx';
import { offExportSlot } from './export-slot.jsx';
import { offFill } from './fill.jsx';
import { offInteraction } from './interaction.jsx';
import { offLayout } from './layout.jsx';
import { offPosition } from './position.jsx';
import { offSize } from './size.jsx';
import { offType } from './type.jsx';

/** Tests only: take the bodies back out of the registry (it is process-wide). */
export function unregisterSections() {
  offPosition();
  offSize();
  offLayout();
  offFill();
  offMulti();
  offMultiArtboard();
  offCorners();
  offBorder();
  offEffects();
  offType();
  offInteraction();
  offExportSlot();
  offArtboardSections();
  offPlaceFreely();
  offConvert();
}
