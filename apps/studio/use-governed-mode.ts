/**
 * @file       use-governed-mode.ts — S3.11
 * @scope      apps/studio/use-governed-mode.ts
 * @purpose    The shell's governed mode (`edit | viewing | preview | present`), reactive, or null on a canvas no
 *             shell governs (a standalone canvas, a DS specimen). One hook for every canvas surface that
 *             asks `modeShows(mode, item)` (bridge/mode-shows.ts) instead of comparing a mode itself.
 */

import { useSyncExternalStore } from 'react';
import { canvasModeStore } from './bridge/canvas-mode-store.ts';
import type { CanvasModeV2 } from './bridge/canvas-modes.ts';

const NO_SUBSCRIBE = () => () => {};
const NO_MODE = (): CanvasModeV2 | null => null;

export function useGovernedMode(): CanvasModeV2 | null {
  const store = typeof window === 'undefined' ? null : canvasModeStore(window);
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? () => store.get().mode : NO_MODE,
    NO_MODE
  );
}
