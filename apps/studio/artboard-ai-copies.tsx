/**
 * @file       artboard-ai-copies.tsx — V2-8.5 c7 (03 AI Chat `ai-copy`).
 * @scope      apps/studio/artboard-ai-copies.tsx
 * @purpose    "A copy starts from before the busy chat, so ideas never mix": beside the copy a "Run on a copy" made,
 *             the board draws a dashed link back to the artboard it was copied from and "Copied from <name>" under
 *             it. The shell says WHICH pairs (`ai-copies`: ids only, parent-gated, the bridge refuses anything else);
 *             the canvas reads the original's name off its own artboard — nothing the person asked, and not the busy
 *             chat's title, ever crosses to this untrusted side (DDR-054, v2-S5.11-neutral-ring-tags).
 *
 *             A screen-coordinate layer like the AI rings (`artboard-activity-overlay.tsx`): each mark follows its
 *             artboards' on-screen rectangles on an animation frame (pan and zoom need no maths here), the loop runs
 *             only while a pair exists, and everything is decoration — aria-hidden, pointer-events none, outside
 *             every artboard (so no exporter ever sees it).
 */

import { useEffect, useRef, useState } from 'react';

import { acceptFromShell } from './bridge/dgn-protocol.ts';

export interface AiCopyPair {
  from: string;
  to: string;
}

/** "Copied from Post 1:1" — the original's short name (its label before the first " · "). */
export function copyCaption(originalLabel: string): string {
  const name = originalLabel.split(' · ')[0]?.trim() || originalLabel.trim();
  return `Copied from ${name}`;
}

/**
 * Where the dashed link runs: between the facing edges of the two artboards, at the middle of what they share
 * (beside each other: the vertical overlap; above / below: the horizontal one). `null` = they share nothing to
 * join on (a diagonal neighbour) — the caption alone says it then.
 */
export function copyLinkGeometry(
  from: DOMRect,
  to: DOMRect
): { x: number; y: number; w: number; h: number } | null {
  const vLo = Math.max(from.top, to.top);
  const vHi = Math.min(from.bottom, to.bottom);
  if (vHi > vLo) {
    const y = Math.round((vLo + vHi) / 2);
    if (to.left >= from.right) return { x: from.right, y, w: to.left - from.right, h: 0 };
    if (from.left >= to.right) return { x: to.right, y, w: from.left - to.right, h: 0 };
  }
  const hLo = Math.max(from.left, to.left);
  const hHi = Math.min(from.right, to.right);
  if (hHi > hLo) {
    const x = Math.round((hLo + hHi) / 2);
    if (to.top >= from.bottom) return { x, y: from.bottom, w: 0, h: to.top - from.bottom };
    if (from.top >= to.bottom) return { x, y: to.bottom, w: 0, h: from.top - to.bottom };
  }
  return null;
}

const CAPTION_GAP = 16;

const CSS_TEXT = `
.dc-ai-copies { position: fixed; inset: 0; z-index: 6; pointer-events: none; }
.dc-ai-copy-link { position: fixed; display: none; box-sizing: border-box; pointer-events: none; }
.dc-ai-copy-link[data-axis="x"] { height: 0; border-top: 1.5px dashed var(--maude-chrome-border, currentColor); }
.dc-ai-copy-link[data-axis="y"] { width: 0; border-left: 1.5px dashed var(--maude-chrome-border, currentColor); }
.dc-ai-copy-from {
  position: fixed; display: none; align-items: center; gap: 4px; white-space: nowrap; pointer-events: none;
  font: 400 var(--maude-hud-type-xs, 11px)/16px var(--maude-chrome-font-body, system-ui, sans-serif);
  color: var(--maude-chrome-fg-1, currentColor);
}
.dc-ai-copy-from svg { flex: none; width: 12px; height: 12px; color: var(--maude-chrome-fg-2, currentColor); }
`.trim();

function artboardEl(id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const esc =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(id)
      : id.replace(/["\\]/g, '\\$&');
  return document.querySelector<HTMLElement>(`[data-dc-screen="${esc}"]`);
}

const labelOf = (id: string): string =>
  artboardEl(id)?.getAttribute('data-dc-label') || artboardEl(id)?.getAttribute('aria-label') || id;

export function AiCopyLinks(): React.JSX.Element | null {
  const [pairs, setPairs] = useState<AiCopyPair[]>([]);
  const links = useRef(new Map<string, HTMLDivElement>());
  const notes = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onMessage = (e: MessageEvent) => {
      // only the shell may say it, and the table parses the payload (ids only, capped)
      if (e.source !== window.parent) return;
      if ((e.data as { dgn?: unknown } | null)?.dgn !== 'ai-copies') return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'ai-copies') return;
      setPairs(m.copies as AiCopyPair[]);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (pairs.length === 0 || typeof document === 'undefined') return undefined;
    let raf: number | null = null;
    const tick = () => {
      for (const p of pairs) {
        const link = links.current.get(p.to);
        const note = notes.current.get(p.to);
        const a = artboardEl(p.from)?.getBoundingClientRect() ?? null;
        const b = artboardEl(p.to)?.getBoundingClientRect() ?? null;
        const live = (r: DOMRect | null): r is DOMRect => !!r && (r.width > 0 || r.height > 0);
        if (note) {
          if (live(b)) {
            note.style.display = 'inline-flex';
            note.style.left = `${Math.round(b.left)}px`;
            note.style.top = `${Math.round(b.bottom + CAPTION_GAP)}px`;
          } else note.style.display = 'none';
        }
        if (link) {
          const g = live(a) && live(b) ? copyLinkGeometry(a, b) : null;
          if (g) {
            link.style.display = 'block';
            link.style.left = `${Math.round(g.x)}px`;
            link.style.top = `${Math.round(g.y)}px`;
            link.style.width = `${Math.round(g.w)}px`;
            link.style.height = `${Math.round(g.h)}px`;
            link.dataset.axis = g.h === 0 ? 'x' : 'y';
          } else link.style.display = 'none';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [pairs]);

  if (pairs.length === 0) return null;
  return (
    <div className="dc-ai-copies" aria-hidden="true">
      <style>{CSS_TEXT}</style>
      {pairs.map((p) => (
        <div key={p.to}>
          <div
            ref={(el) => {
              if (el) links.current.set(p.to, el);
              else links.current.delete(p.to);
            }}
            className="dc-ai-copy-link"
            data-axis="x"
            data-testid="ai-copy-link"
          />
          <div
            ref={(el) => {
              if (el) notes.current.set(p.to, el);
              else notes.current.delete(p.to);
            }}
            className="dc-ai-copy-from"
            data-testid="ai-copy-caption"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              aria-hidden="true"
            >
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10H5" />
            </svg>
            {copyCaption(labelOf(p.from))}
          </div>
        </div>
      ))}
    </div>
  );
}
AiCopyLinks.displayName = 'AiCopyLinks';
