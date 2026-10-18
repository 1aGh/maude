// editing/lock-badge.tsx — a locked object says so (S2.6, artboard ed-obj-order).
//
// A locked object can't be picked: the click goes to its parent (editing/selection.tsx
// `lockedClickSelection`). So the pointer needs to know why — pointing at a locked object draws a
// thin hover outline, a lock badge with its name ("Logo") and the line "Logo is locked · ⇧⌘L unlocks".
// Lock is SHARED (`data-cd-locked` in the TSX), so every collaborator sees the same badge.
//
// Read-only on purpose: the badge never writes and never captures the pointer.

import { useEffect, useRef, useState } from 'react';

import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { type CrumbNode, crumbLabel } from './crumbs.ts';

const LOCKED = '[data-cd-locked]';

/** The copy of the tooltip; CONTRACT §3 words. */
export const lockLine = (name: string): string => `${name} is locked · ⇧⌘L unlocks`;

function ownText(el: Element): string {
  let t = '';
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.textContent ?? '';
  return t.replace(/\s+/g, ' ').trim();
}

/** The locked object under `target` (the nearest locked ancestor-or-self in its artboard body). */
export function lockedUnder(target: Element | null): Element | null {
  const hit = target?.closest(LOCKED) ?? null;
  if (!hit || !hit.closest('.dc-artboard-body')) return null;
  return hit;
}

/** What the badge calls a locked object: its layer name, label, own text, else its id / tag. */
export function lockedName(el: Element): string {
  const node: CrumbNode = {
    id: el.getAttribute('data-cd-id'),
    name: el.getAttribute('data-dc-element'),
    aria: el.getAttribute('aria-label') ?? el.getAttribute('alt'),
    text: ownText(el),
    tag: el.tagName.toLowerCase(),
  };
  return crumbLabel(node);
}

const CSS_TEXT = `
.ed-lock-outline {
  position: fixed;
  pointer-events: none;
  z-index: 4;
  box-sizing: border-box;
  border: 1px solid var(--maude-hud-accent);
  border-radius: 2px;
  opacity: 0.6;
}
.ed-lockbadge {
  position: fixed;
  pointer-events: none;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--maude-hud-accent);
  color: var(--maude-hud-accent-fg);
  font: 500 11px/16px var(--maude-chrome-font-mono);
  white-space: nowrap;
  transform: translateY(calc(-100% - 4px));
}
.ed-locktip {
  position: fixed;
  pointer-events: none;
  z-index: 7;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--maude-chrome-bg-0);
  color: var(--maude-chrome-fg-0);
  border: 1px solid var(--maude-chrome-border);
  font: 400 11px/16px var(--maude-chrome-font-mono);
  white-space: nowrap;
}
`;

interface Hover {
  rect: { left: number; top: number; width: number; height: number };
  name: string;
  x: number;
  y: number;
}

/** In Edit mode only (Preview and Present never show edit chrome). */
function editing(): boolean {
  const mode = canvasModeStore(window).get().mode;
  return mode === null || mode === 'edit';
}

export function LockBadge({ readOnly = false }: { readOnly?: boolean }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined' || readOnly) return;
    const onMove = (e: PointerEvent) => {
      if (raf.current != null) return;
      const { clientX, clientY, target } = e;
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        const el = editing() && target instanceof Element ? lockedUnder(target) : null;
        if (!el) {
          setHover((h) => (h ? null : h));
          return;
        }
        const r = el.getBoundingClientRect();
        setHover({
          rect: { left: r.left, top: r.top, width: r.width, height: r.height },
          name: lockedName(el),
          x: clientX,
          y: clientY,
        });
      });
    };
    const onLeave = () => setHover(null);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerleave', onLeave, true);
    window.addEventListener('blur', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerleave', onLeave, true);
      window.removeEventListener('blur', onLeave);
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [readOnly]);

  if (!hover || readOnly) return null;
  return (
    <>
      <style>{CSS_TEXT}</style>
      <div
        className="ed-lock-outline"
        aria-hidden="true"
        style={{
          left: hover.rect.left,
          top: hover.rect.top,
          width: hover.rect.width,
          height: hover.rect.height,
        }}
      />
      <span
        className="ed-lockbadge"
        data-testid="edit-lock-badge"
        aria-hidden="true"
        style={{ left: hover.rect.left, top: hover.rect.top }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        {hover.name}
      </span>
      <span
        className="ed-locktip"
        data-testid="edit-lock-tip"
        role="status"
        style={{ left: hover.x + 12, top: hover.y + 14 }}
      >
        {lockLine(hover.name)}
      </span>
    </>
  );
}
