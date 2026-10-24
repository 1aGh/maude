/**
 * @file       annotations/ui/placement.tsx — a pick follows the pointer until you click (S4.13)
 * @scope      apps/studio/annotations/ui/placement.tsx
 * @purpose    Canvas 15 `an-stk-drop` / `an-stamps` / `an-templates`: after a pick in the gallery or the Templates
 *             panel, a translucent ghost trails the pointer; a click puts it down THERE, Esc (or a right click)
 *             lets go. A sticker and a template land once; a stamp stays armed, so voting is one click per spot.
 *             Listeners sit on `document` in the capture phase (not on an overlay) so the wheel and the
 *             pan/zoom controller keep working while the ghost is out; the click that places is swallowed, so it
 *             never also selects or draws what lies under it.
 *             Pure chrome: the layer decides what a click makes (sticker-drop.ts, stamps.ts, template-place.ts).
 */

import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { STICKER_DROP_SIZE } from '../../annotations-model.ts';
import { stampKindById } from '../stamp-kinds.ts';
import { STAMP_BOX } from './stamps.ts';
import { type Pending, sizeLabel } from './sticker-drop.ts';

export interface PlacementProps {
  pending: Pending | null;
  /** The live canvas zoom: the ghost is drawn at the size it will have. */
  zoom: number;
  resolveAsset: (path: string) => string;
  /** The template's size in world units (its ghost), or null. */
  templateSize: (id: string) => { w: number; h: number } | null;
  /** A click (client coordinates). The layer decides whether the pick is spent. */
  onPlace: (at: { x: number; y: number }, mods: { shift: boolean }) => void;
  onCancel: () => void;
}

const GHOST_Z = 2147483000;

export function PlacementGhost({
  pending,
  zoom,
  resolveAsset,
  templateSize,
  onPlace,
  onCancel,
}: PlacementProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const swallow = useRef(false);
  const cb = useRef({ onPlace, onCancel });
  cb.current = { onPlace, onCancel };

  useEffect(() => {
    if (!pending) {
      setPos(null);
      return;
    }
    const move = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      swallow.current = true;
      cb.current.onPlace({ x: e.clientX, y: e.clientY }, { shift: e.shiftKey });
    };
    const eat = (e: Event) => {
      if (!swallow.current) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.type === 'click') swallow.current = false;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      cb.current.onCancel();
    };
    const menu = (e: Event) => {
      e.preventDefault();
      cb.current.onCancel();
    };
    const opts = { capture: true } as const;
    document.addEventListener('pointermove', move, opts);
    document.addEventListener('pointerdown', down, opts);
    document.addEventListener('pointerup', eat, opts);
    document.addEventListener('mouseup', eat, opts);
    document.addEventListener('click', eat, opts);
    document.addEventListener('keydown', key, opts);
    document.addEventListener('contextmenu', menu, opts);
    return () => {
      document.removeEventListener('pointermove', move, opts);
      document.removeEventListener('pointerdown', down, opts);
      document.removeEventListener('pointerup', eat, opts);
      document.removeEventListener('mouseup', eat, opts);
      document.removeEventListener('click', eat, opts);
      document.removeEventListener('keydown', key, opts);
      document.removeEventListener('contextmenu', menu, opts);
      swallow.current = false;
    };
  }, [pending]);

  if (!pending || !pos) return null;
  const z = zoom || 1;
  const base: CSSProperties = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: GHOST_Z,
    opacity: 0.72,
  };
  if (pending.kind === 'sticker') {
    const s = STICKER_DROP_SIZE * z;
    const flip = pending.sticker?.flip === true;
    return (
      <img
        data-testid="annot-placing"
        data-placing="sticker"
        alt=""
        src={resolveAsset(pending.path)}
        style={{
          ...base,
          left: pos.x - s / 2,
          top: pos.y - s / 2,
          width: s,
          height: s,
          objectFit: 'contain',
          transform: flip ? 'scaleX(-1)' : undefined,
        }}
      />
    );
  }
  if (pending.kind === 'stamp') {
    const kind = stampKindById(pending.stampKind);
    const s = Math.max(24, STAMP_BOX * z);
    return (
      <span
        data-testid="annot-placing"
        data-placing="stamp"
        style={{
          ...base,
          left: pos.x - s / 2,
          top: pos.y - s / 2,
          width: s,
          height: s,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--object-yellow, #fce8a6)',
          color: 'var(--object-ink, #1f1f1f)',
        }}
      >
        <svg
          width={s * 0.56}
          height={s * 0.56}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={kind?.d ?? ''} transform={kind?.rotate ? 'rotate(180 8 8)' : undefined} />
        </svg>
      </span>
    );
  }
  const size = templateSize(pending.id);
  if (!size) return null;
  return (
    <span
      data-testid="annot-placing"
      data-placing="template"
      style={{
        ...base,
        left: pos.x,
        top: pos.y,
        width: size.w * z,
        height: size.h * z,
        border: '1.5px dashed var(--maude-hud-accent, oklch(0.53 0.175 238))',
        borderRadius: 8,
        background: 'color-mix(in oklab, var(--maude-hud-accent, oklch(0.53 0.175 238)) 8%, transparent)',
      }}
    />
  );
}

/**
 * The "160 x 160" chip under a selected sticker (canvas 15 `an-stk-drop`): accent paper, screen-constant,
 * centred under the box. SVG, for the layer's overlay (world units; `zoom` counter-scales it).
 */
export function StickerSizeChip({
  box,
  zoom,
}: {
  box: { x: number; y: number; w: number; h: number };
  zoom: number;
}) {
  const z = zoom || 1;
  const text = sizeLabel(box);
  const w = (text.length * 6.6 + 12) / z;
  const h = 18 / z;
  return (
    <g data-testid="annot-sticker-size" pointerEvents="none">
      <rect
        x={box.x + box.w / 2 - w / 2}
        y={box.y + box.h + 8 / z}
        width={w}
        height={h}
        rx={3 / z}
        fill="var(--maude-hud-accent, oklch(0.53 0.175 238))"
      />
      <text
        x={box.x + box.w / 2}
        y={box.y + box.h + 8 / z + h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11 / z}
        fontWeight={600}
        fill="var(--accent-fg, #fff)"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {text}
      </text>
    </g>
  );
}
