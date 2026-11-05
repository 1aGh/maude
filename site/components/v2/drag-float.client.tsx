'use client';

// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
import { type CSSProperties, type ReactNode, useRef, useState } from 'react';

/**
 * A sticky the visitor can drag around the hero, like on a real canvas. Decorative, so mouse and
 * pen only: a finger on a sticky still scrolls the page.
 */
export function DragFloat({ style, children }: { style: CSSProperties; children: ReactNode }) {
  const [p, setP] = useState({ x: 0, y: 0 });
  const from = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const end = () => {
    from.current = null;
  };
  return (
    <div
      className="ps-float ps-drag"
      style={{ ...style, translate: `${p.x}px ${p.y}px` }}
      aria-hidden="true"
      onPointerDown={(e) => {
        if (e.pointerType === 'touch') return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        from.current = { x: e.clientX, y: e.clientY, px: p.x, py: p.y };
      }}
      onPointerMove={(e) => {
        const f = from.current;
        if (f) setP({ x: f.px + e.clientX - f.x, y: f.py + e.clientY - f.y });
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      {children}
    </div>
  );
}
