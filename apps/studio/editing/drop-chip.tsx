// editing/drop-chip.tsx — S7.9 (07 `ve-drop`): while footage is dragged over the window and a video artboard is
// followed by the timeline, that artboard wears a dashed rim and the chip "Or drop here — adds at the end".
//
// The canvas only DRAWS. The shell sends `timeline-drop-hint { artboardId, on }` and owns the drop itself (a catcher
// over the artboard's rect, client/v2/timeline/edit/drop.jsx), so no file ever reaches this untrusted document.
// The chip follows pan and zoom while it is up (a drag takes a few seconds, the camera can move under it).

import { type ReactElement, useEffect, useState } from 'react';

import { acceptFromShell } from '../bridge/dgn-protocol.ts';

/** The chip's words (07 · ve-drop). */
export const DROP_CHIP_TEXT = 'Or drop here — adds at the end';

/** What the hint says about this canvas: the artboard that wears the chip, or none. */
export function nextDropHint(
  prev: string | null,
  msg: { artboardId: string; on: boolean }
): string | null {
  if (msg.on) return msg.artboardId;
  // a late "off" for an artboard the chip already left must not take down the new one's chip
  return prev === msg.artboardId ? null : prev;
}

/** The artboard's design surface in the canvas window's own pixels, or null when it is not drawn. */
export function artboardBox(
  doc: Document,
  artboardId: string
): { left: number; top: number; width: number; height: number } | null {
  const el = doc.querySelector(`[data-dc-screen="${CSS.escape(artboardId)}"]`);
  if (!el) return null;
  const body = Array.from(el.children).find((c) => c.classList.contains('dc-artboard-body'));
  const r = ((body as HTMLElement | undefined) ?? (el as HTMLElement)).getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

const CSS_TEXT = `
.ed-drop-chip {
  position: fixed; z-index: 5; pointer-events: none; box-sizing: border-box;
  display: grid; place-items: center;
  border: 1.5px dashed var(--maude-hud-accent);
  background: color-mix(in oklab, var(--maude-hud-accent) 8%, transparent);
}
.ed-drop-chip-label {
  padding: 4px 10px; border-radius: 999px; white-space: nowrap;
  background: var(--maude-hud-accent); color: var(--maude-hud-accent-fg);
  font: 600 12px/16px var(--maude-chrome-font, system-ui, sans-serif);
}
`;

export function DropChip(): ReactElement | null {
  const [artboardId, setArtboardId] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (
        e.source !== window.parent ||
        (e.data as { dgn?: unknown } | null)?.dgn !== 'timeline-drop-hint'
      )
        return;
      const m = acceptFromShell(e, window);
      if (!m || m.dgn !== 'timeline-drop-hint') return;
      setArtboardId((prev) => nextDropHint(prev, m));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // follow the camera while the chip is up
  useEffect(() => {
    if (!artboardId) return undefined;
    let raf = 0;
    let key = '';
    const loop = () => {
      const b = artboardBox(document, artboardId);
      const k = b ? `${b.left}|${b.top}|${b.width}|${b.height}` : '';
      if (k !== key) {
        key = k;
        tick((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [artboardId]);

  if (!artboardId || typeof document === 'undefined') return null;
  const box = artboardBox(document, artboardId);
  if (!box) return null;
  return (
    <>
      <style>{CSS_TEXT}</style>
      <div
        className="ed-drop-chip"
        data-testid="edit-drop-chip"
        aria-hidden="true"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      >
        <span className="ed-drop-chip-label">{DROP_CHIP_TEXT}</span>
      </div>
    </>
  );
}
