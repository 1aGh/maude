// client/v2/inspector/sections/index.js — S2.3: the section bodies that register themselves (append-only).
// One import per slice's section file; the registry (../slots.js) owns the order. Imported once, where the
// frame is wired (client/inspector/inspector-panel.jsx).

import { offLayout } from './layout.jsx';
import { offPosition } from './position.jsx';
import { offSize } from './size.jsx';

/** Tests only: take the bodies back out of the registry (it is process-wide). */
export function unregisterSections() {
  offPosition();
  offSize();
  offLayout();
}
