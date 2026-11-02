// apps/studio/toolbars/marker-tip.ts — which Marker tip M arms (V2-1.2 §9 Q4): the last one used in
// this session, Marker (`pen`) first. Window-level (`Symbol.for`) like the mode store, so it survives
// a soft HMR re-evaluation and is shared with the keys V2-4.5b binds.

import type { ToolId } from '../bridge/canvas-modes.ts';

export const MARKER_TIPS = ['pen', 'highlighter', 'eraser'] as const satisfies readonly ToolId[];
export type MarkerTip = (typeof MARKER_TIPS)[number];

const KEY = Symbol.for('maude.markerTip.v2');

export const isMarkerTip = (t: unknown): t is MarkerTip =>
  typeof t === 'string' && (MARKER_TIPS as readonly string[]).includes(t);

export function lastMarkerTip(): MarkerTip {
  const v = (globalThis as unknown as Record<symbol, unknown>)[KEY];
  return isMarkerTip(v) ? v : 'pen';
}

export function rememberMarkerTip(t: unknown): void {
  if (isMarkerTip(t)) (globalThis as unknown as Record<symbol, unknown>)[KEY] = t;
}
