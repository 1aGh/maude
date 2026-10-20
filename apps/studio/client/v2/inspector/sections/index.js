// client/v2/inspector/sections/index.js — S2.3/S2.4: the section bodies that register themselves (append-only).
// One import per slice's section file; the registry (../slots.js) owns the order. Imported once, where the
// frame is wired (client/inspector/inspector-panel.jsx).

import { offConvert, offPlaceFreely } from '../kinds/frame.jsx';
import { offImage } from '../kinds/image.jsx';
import { offInspectorExport } from '../../export/inspector-export.jsx';
import { offInstance } from '../kinds/instance.jsx';
import { offMulti } from '../kinds/multi.jsx';
import { offPath } from '../kinds/path.jsx';
import { offShape } from '../kinds/shape.jsx';
import { offTextBody, offTextStyle } from '../kinds/text.jsx';
import { offArtboardSections } from '../kinds/artboard.jsx';
import { offMultiArtboard } from '../kinds/multi-artboard.jsx';
import { offBorder } from './border.jsx';
import { offCorners } from './corners.jsx';
import { offEffects } from './effects.jsx';
import { offExportSlot } from './export-slot.jsx';
import { offFill } from './fill.jsx';
import { offInteraction } from './interaction.jsx';
import { offLayout } from './layout.jsx';
import { offPosition } from './position.jsx';
import { offSafeZones } from './safe-zones.jsx';
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
  offTextStyle();
  offTextBody();
  offInteraction();
  offInspectorExport();
  offExportSlot();
  offSafeZones();
  offPlaceFreely();
  offConvert();
  offArtboardSections();
  offShape();
  offPath();
  offImage();
  offInstance();
}
