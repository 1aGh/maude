// client/v2/timeline/loop-handle.jsx — P8 C9 (07 · .ve-inout, ve-play): the loop range's two ends on the ruler are "I" and
// "O" badges, not plain brackets. Drag one along the ruler, or step it with ← → (⇧ = one second); the I / O keys still set
// the ends at the playhead (`playhead.js` `loopAt`). The band stays at least one frame long and inside the cut.

import { useRef } from 'react';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Where an end goes: `frame` clamped so the band keeps ≥ 1 frame and stays inside `0…total`. Pure (the test pins it). */
export function moveLoopEnd(band, end, frame, total) {
  const last = Math.max(1, Math.round(total ?? 1));
  if (end === 'in') return { in: clamp(Math.round(frame), 0, band.out - 1), out: band.out };
  return { in: band.in, out: clamp(Math.round(frame), band.in + 1, last) };
}

const WORD = { in: 'Loop start', out: 'Loop end' };

export function LoopHandle({ end, band, fps, total, left, frameAt, onChange, valueText }) {
  const drag = useRef(false);
  const label = end === 'in' ? 'I' : 'O';
  const set = (frame) => {
    if (!Number.isFinite(frame)) return;
    const next = moveLoopEnd(band, end, frame, total);
    if (next.in !== band.in || next.out !== band.out) onChange?.(next);
  };
  return (
    <span
      className={`tl-loop-handle tl-loop-handle--${end}`}
      data-testid={`timeline-loop-${end}`}
      role="slider"
      tabIndex={0}
      aria-label={WORD[end]}
      aria-orientation="horizontal"
      aria-valuemin={end === 'in' ? 0 : band.in + 1}
      aria-valuemax={end === 'in' ? band.out - 1 : Math.max(1, Math.round(total ?? 1))}
      aria-valuenow={band[end]}
      aria-valuetext={valueText}
      title={`${WORD[end]} ${valueText ?? ''} · drag, or ← → · ${label} sets it at the playhead`}
      style={{ left }}
      onPointerDown={(e) => {
        // the ruler under it scrubs; a press on the badge only drags the badge
        e.stopPropagation();
        e.preventDefault();
        drag.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.currentTarget.focus?.();
      }}
      onPointerMove={(e) => {
        if (drag.current) set(frameAt(e.clientX));
      }}
      onPointerUp={(e) => {
        drag.current = false;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = false;
      }}
      onKeyDown={(e) => {
        const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        if (!dir) return;
        e.preventDefault();
        e.stopPropagation(); // ← → on a focused handle moves the handle, not the playhead
        const by = e.shiftKey ? Math.max(1, Math.round(fps || 30)) : 1;
        set(band[end] + dir * by);
      }}
    >
      {label}
    </span>
  );
}
