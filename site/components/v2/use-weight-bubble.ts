'use client';

// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
import { useEffect, useRef } from 'react';

/**
 * The weight bubble: letters near the pointer grow from semibold to heavy, a small lens that
 * follows the mouse. The radius is a multiple of the glyph height, so it reads the same at any
 * size. No pointer (touch, keyboard, a capture): the headline simply stays semibold. One rAF per
 * move, no re-render.
 */
export function useWeightBubble() {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const chars = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('.ps-ch') ?? []);
  const move = (e: { clientX: number; clientY: number; pointerType: string }) => {
    if (e.pointerType === 'touch') return;
    const { clientX: x, clientY: y } = e;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      for (const el of chars()) {
        const r = el.getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
        const k = Math.max(0, 1 - d / (r.height * 1.3));
        el.style.fontWeight = k ? String(Math.round(600 + 300 * k * k * (3 - 2 * k))) : '';
      }
    });
  };
  const leave = () => {
    cancelAnimationFrame(raf.current);
    for (const el of chars()) el.style.fontWeight = '';
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return { ref, onPointerMove: move, onPointerLeave: leave };
}
