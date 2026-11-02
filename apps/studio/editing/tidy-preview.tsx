// editing/tidy-preview.tsx — S2.9 (artboard ed-ab-tidy): the dashed outlines "Tidy up" shows before you press it.
//
// While the pointer (or focus) is on the bar's Tidy button, every selected artboard gets a dashed outline where it
// WOULD sit — one row, even gaps, on the lowest board's line. Nothing moves and nothing is written; leaving the
// button takes the outlines away. The bar (align-bar.tsx) sets the rects, this layer draws them: they live in a
// tiny module store so the two never have to know about each other's tree.
//
// Same mechanism as the other canvas chrome: `position: fixed` divs, world → screen by the live viewport.

import { type ReactElement, useSyncExternalStore } from 'react';

import { useArtboardsContext } from '../canvas-lib.tsx';
import type { BoardRect } from './arrange.ts';

type Listener = () => void;
let current: readonly BoardRect[] | null = null;
const listeners = new Set<Listener>();

/** The preview store: `set(rects)` shows the outlines, `set(null)` takes them away. */
export const tidyPreviewStore = {
  get: (): readonly BoardRect[] | null => current,
  set(next: readonly BoardRect[] | null): void {
    if (next === current) return;
    current = next && next.length > 0 ? next : null;
    for (const l of [...listeners]) l();
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export const TIDY_PREVIEW_CSS = `
.ed-tidy-ghost {
  position: fixed; z-index: 4; pointer-events: none; box-sizing: border-box; border-radius: var(--radius-xs, 2px);
  outline: 1.5px dashed var(--maude-hud-accent, currentColor); outline-offset: 0;
}
`.trim();

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** The outlines for `rects` under `vp` (presentational: no context, renders anywhere). */
export function TidyGhosts({
  rects,
  vp,
}: {
  rects: readonly BoardRect[];
  vp: Viewport;
}): ReactElement {
  return (
    <>
      <style>{TIDY_PREVIEW_CSS}</style>
      <div aria-hidden="true" data-testid="edit-tidy-preview">
        {rects.map((r) => (
          <span
            key={r.id}
            className="ed-tidy-ghost"
            data-testid="edit-tidy-ghost"
            data-id={r.id}
            style={{
              left: vp.x + r.x * vp.zoom,
              top: vp.y + r.y * vp.zoom,
              width: r.w * vp.zoom,
              height: r.h * vp.zoom,
            }}
          />
        ))}
      </div>
    </>
  );
}

export function TidyPreview(): ReactElement | null {
  const rects = useSyncExternalStore(tidyPreviewStore.subscribe, tidyPreviewStore.get, () => null);
  const world = useArtboardsContext();
  const vp = world?.viewport ?? null;
  if (!rects || !vp) return null;
  return <TidyGhosts rects={rects} vp={vp} />;
}
