/**
 * @file       artboard-ghosts-overlay.tsx — S11.5 (05 Empty States › es-all-trashed).
 * @scope      apps/studio/artboard-ghosts-overlay.tsx
 * @purpose    The outlines an all-trashed canvas keeps: a dashed rectangle and a name where each artboard stood,
 *             so "nothing is deleted" is something you can see and Restore has somewhere to put them back.
 *
 * Data flow, one direction only: the shell (client/v2/empty/all-trashed-relay.js) reads the shared Trash itself and
 * posts `{ dgn: 'trashed-artboards', canvas, items: [{ id, label, rect|null }] }` into the iframe; the bridge parses
 * it (bridge/dgn-protocol.ts `trashed-artboards`: parent-gated, strings capped) and this layer draws it. The canvas
 * (the untrusted side, DDR-054) never says what is in the Trash — it is told what to draw, and an artboard whose
 * place is unknown (`rect: null`) is left out.
 *
 * Geometry: a WORLD-coordinate layer, mounted inside `.dc-world` (one line in canvas-lib.tsx's DesignCanvasInner),
 * so pan and zoom carry the outlines with no maths here. Decorative: `aria-hidden`, `pointer-events: none` — no hit
 * area, they never take a click, a selection or a drag. Reduced motion needs nothing (nothing animates).
 */

import { useEffect, useState } from 'react';

import { acceptFromShell } from './bridge/dgn-protocol.ts';

export interface GhostItem {
  id: string;
  label: string;
  rect: { x: number; y: number; w: number; h: number } | null;
}

/** The shell caps the list; so does the layer. */
export const GHOSTS_DRAWN_MAX = 200;

const GHOSTS_CSS = `
.dc-ghosts {
  --dc-ghost-line: oklch(0.55 0.012 250);
  --dc-ghost-name: oklch(0.45 0.012 250);
  --dc-ghost-fill: oklch(0.99 0.004 250 / 0.55);
  position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none;
}
:root[data-maude-theme="dark"] .dc-ghosts {
  --dc-ghost-line: oklch(0.7 0.012 250);
  --dc-ghost-name: oklch(0.74 0.012 250);
  --dc-ghost-fill: oklch(0.2 0.01 250 / 0.55);
}
.dc-ghost {
  position: absolute; pointer-events: none; box-sizing: border-box;
  border-radius: 3px; background: var(--dc-ghost-fill);
  outline: 1.5px dashed var(--dc-ghost-line); outline-offset: -1.5px;
}
.dc-ghost-name {
  position: absolute; left: 0; bottom: calc(100% + 6px); white-space: nowrap;
  font: 500 11px/1.2 system-ui, sans-serif; color: var(--dc-ghost-name);
}
`.trim();

function ensureGhostStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-ghosts-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-ghosts-css';
  s.textContent = GHOSTS_CSS;
  document.head.appendChild(s);
}

export function ArtboardGhostsLayer() {
  ensureGhostStyles();
  const [items, setItems] = useState<GhostItem[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      // Only the shell may say it (DDR-054). The table then parses the payload — ids, labels and rects only.
      if (e.source !== window.parent) return;
      if ((e.data as { dgn?: string } | null)?.dgn !== 'trashed-artboards') return;
      const m = acceptFromShell(e, window);
      if (m && m.dgn === 'trashed-artboards') {
        setItems(
          (m.items as GhostItem[]).filter((g) => g.rect !== null).slice(0, GHOSTS_DRAWN_MAX)
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="dc-ghosts" aria-hidden="true" data-testid="artboard-ghosts">
      {items.map((g) => (
        <div
          key={g.id}
          className="dc-ghost"
          data-testid={`artboard-ghost-${g.id}`}
          data-artboard={g.id}
          style={{
            left: (g.rect as NonNullable<GhostItem['rect']>).x,
            top: (g.rect as NonNullable<GhostItem['rect']>).y,
            width: (g.rect as NonNullable<GhostItem['rect']>).w,
            height: (g.rect as NonNullable<GhostItem['rect']>).h,
          }}
        >
          <span className="dc-ghost-name">{g.label}</span>
        </div>
      ))}
    </div>
  );
}
ArtboardGhostsLayer.displayName = 'ArtboardGhostsLayer';
