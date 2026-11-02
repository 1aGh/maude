// client/v2/empty/layers-empty.jsx — S11.2 (05 es-artboard-new, the Layers tab): "No layers on Tablet yet."
//
// The Layers tab's empty branch for an artboard that has nothing on it: what will appear there, in the kit's
// panel block with the layers glyph. Mounted by inspector-panel.jsx when the canvas's layers tree for the
// selected artboard is empty (the S2.6-coordinated mount point; one small hunk there).

import { copy } from './empty-copy.js';
import { Empty } from './empty.jsx';

/** @param {{ artboard: string }} props the artboard's name as the person sees it ("Tablet") */
export function LayersEmpty({ artboard }) {
  const words = copy('es-artboard-new.layers-none', { artboard });
  return (
    <Empty
      glyph="layers"
      title={words.title}
      next={words.next}
      className="es-e--inpanel"
      testid="layers-empty"
    />
  );
}
