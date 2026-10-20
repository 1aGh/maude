// client/v2/kinds/KindDimHost.jsx — S7.24b: keeps the open canvases told which artboards the kind filter dims.
//
// Renders nothing. It holds the index's artboard kinds (the same `indexMeta` the Canvases panel and the Layers
// chips count from) and runs the relay (kind-dim-relay.js) for as long as the shell is up, so the dimming follows
// the filter whichever panel moved it — and the Layers tab being closed does not undim the canvas.

import { useEffect, useMemo, useRef } from 'react';
import { useCanvasIndex } from '../canvases/use-canvas-index.js';
import { indexMeta } from '../canvases/tree-model.js';
import { createKindDimLane } from './kind-dim-relay.js';

/** @param {{ designRel?: string }} props */
export default function KindDimHost({ designRel = '' }) {
  const snapshot = useCanvasIndex({});
  const meta = useMemo(() => indexMeta(snapshot, designRel), [snapshot, designRel]);
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const lane = useRef(null);

  useEffect(() => {
    lane.current = createKindDimLane({ boardsOf: (file) => metaRef.current.get(file)?.boards });
    return () => {
      lane.current?.();
      lane.current = null;
    };
  }, []);

  // the index learned a canvas's artboards (or they changed): tell the frames again
  // biome-ignore lint/correctness/useExhaustiveDependencies: `meta` IS the signal
  useEffect(() => {
    lane.current?.refresh();
  }, [meta]);

  return null;
}
