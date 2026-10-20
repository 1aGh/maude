/**
 * @file       safe-zones-overlay.tsx — S7.22 (08 ak-safe-zones).
 * @scope      apps/studio/safe-zones-overlay.tsx
 * @purpose    Draws where a platform's own interface covers an artboard: hatched bands with a tag
 *             ("Profile and progress bar", "Caption and audio", "Buttons"), the dimmed part a grid
 *             crop cuts off, and an amber "Under the caption" flag on text that lands in a band.
 *
 *             Mounted INSIDE `ArtboardGuidesOverlay`'s `.dc-artboard-guides` box — the one mount every
 *             exporter hides (exporters/capture-chrome.ts, `_shell.html #canvas-hide-chrome`) and
 *             Present never paints — so a safe zone is on the canvas only and no PNG / PDF / SVG /
 *             video carries it (decision v2-S7-safe-zones-prop; test/safe-zones-never-exported.test.ts).
 *             It sits OUTSIDE `.dc-artboard`, so it is never part of the exported subtree either.
 *
 *             Decorative: aria-hidden through its parent, pointer-events none. Colours are engine
 *             chrome constants, not DS tokens (same reasoning as the generic guides): they must read
 *             on any design.
 *
 *             Draws nothing for an unknown preset id (a newer peer's) or a zero-sized artboard.
 */

import { type ReactNode, useEffect, useMemo, useState } from 'react';

import {
  type BandRect,
  bandRects,
  cropRects,
  flagsUnderBands,
  type Rect,
  type SafeZonePreset,
  type UnderFlag,
} from './kinds/safe-zones.ts';

const BAND_FILL =
  'repeating-linear-gradient(135deg, color-mix(in oklab, oklch(60% 0.2 25) 30%, transparent) 0 6px, color-mix(in oklab, oklch(60% 0.2 25) 14%, transparent) 6px 12px)';
const BAND_EDGE = 'oklch(60% 0.2 25)';
const TAG_BG = 'oklch(60% 0.2 25)';
const TAG_FG = 'oklch(98% 0.01 25)';
const FLAG_BG = 'oklch(82% 0.15 85)';
const FLAG_FG = 'oklch(24% 0.04 85)';
const CUT_FILL = 'color-mix(in oklab, oklch(96% 0.01 90) 72%, transparent)';

/** Most text elements measured per pass — a safety bound on an artboard with thousands of nodes. */
const MAX_MEASURED = 400;

/** A label that stays readable at any artboard size (artboard px, not screen px). */
const tagSize = (w: number) => Math.round(Math.min(44, Math.max(12, w * 0.026)));

const tagStyle = (fs: number, bg: string, fg: string) =>
  ({
    padding: `${Math.round(fs * 0.1)}px ${Math.round(fs * 0.45)}px`,
    borderRadius: Math.round(fs * 0.25),
    background: bg,
    color: fg,
    fontFamily: 'var(--maude-chrome-font-body, system-ui, sans-serif)',
    fontSize: fs,
    fontWeight: 600,
    lineHeight: 1.25,
    whiteSpace: 'nowrap',
  }) as const;

function Band({ band, fs }: { band: BandRect; fs: number }) {
  const vertical = band.edge === 'left' || band.edge === 'right';
  return (
    <div
      data-testid="safe-zone-band"
      data-edge={band.edge}
      style={{
        position: 'absolute',
        left: band.x,
        top: band.y,
        width: band.w,
        height: band.h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: BAND_FILL,
        boxShadow: `inset 0 0 0 1px ${BAND_EDGE}`,
      }}
    >
      <span
        style={{
          ...tagStyle(fs, TAG_BG, TAG_FG),
          ...(vertical ? { writingMode: 'vertical-rl' as const } : {}),
        }}
      >
        {band.label}
      </span>
    </div>
  );
}

const escapeId = (id: string) =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(id)
    : id.replace(/["\\]/g, '\\$&');

/**
 * The text of the artboard that sits under a band, in artboard px. Reads the sibling article's body from
 * the live DOM — the overlay is a world-coordinate sibling of the artboard, not its parent.
 */
function measureText(artboardId: string, w: number): Rect[] {
  if (typeof document === 'undefined') return [];
  const body = document.querySelector(
    `[data-dc-screen="${escapeId(artboardId)}"] .dc-artboard-body`
  );
  if (!(body instanceof HTMLElement)) return [];
  const box = body.getBoundingClientRect();
  const laid = body.offsetWidth || w;
  const scale = laid > 0 && box.width > 0 ? box.width / laid : 1;
  if (!(scale > 0)) return [];
  const out: Rect[] = [];
  const all = body.querySelectorAll('*');
  for (let i = 0; i < all.length && out.length < MAX_MEASURED; i++) {
    const el = all[i] as Element;
    let own = false;
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && (n.textContent ?? '').trim()) {
        own = true;
        break;
      }
    }
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    out.push({
      x: (r.left - box.left) / scale,
      y: (r.top - box.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
    });
  }
  return out;
}

/** Re-measure when the artboard's content changes; coalesced to one pass per frame. */
function useUnderFlags(artboardId: string | undefined, bands: BandRect[], w: number): UnderFlag[] {
  const [flags, setFlags] = useState<UnderFlag[]>([]);
  useEffect(() => {
    if (!artboardId || bands.length === 0 || typeof document === 'undefined') {
      setFlags([]);
      return;
    }
    let frame = 0;
    const run = () => {
      frame = 0;
      const next = flagsUnderBands(bands, measureText(artboardId, w));
      setFlags((prev) =>
        prev.length === next.length &&
        prev.every((f, i) => f.band.edge === next[i]?.band.edge && same(f.item, next[i]?.item))
          ? prev
          : next
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    schedule();
    const body = document.querySelector(`[data-dc-screen="${escapeId(artboardId)}"]`);
    let mo: MutationObserver | null = null;
    if (body && typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(schedule);
      mo.observe(body, { subtree: true, childList: true, characterData: true, attributes: true });
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mo?.disconnect();
    };
  }, [artboardId, bands, w]);
  return flags;
}

const same = (a: Rect | undefined, b: Rect | undefined) =>
  !!a &&
  !!b &&
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.w - b.w) < 0.5 &&
  Math.abs(a.h - b.h) < 0.5;

export function SafeZonesOverlay({
  preset,
  w,
  h,
  artboardId,
}: {
  preset: SafeZonePreset | null;
  /** The artboard's own size, px. */
  w: number;
  h: number;
  /** DCArtboard id — how the text under a band is found. */
  artboardId?: string;
}): ReactNode {
  const bands = useMemo(() => bandRects(preset, w, h), [preset, w, h]);
  const crop = useMemo(() => cropRects(preset, w, h), [preset, w, h]);
  const flags = useUnderFlags(artboardId, bands, w);
  if (!preset || (bands.length === 0 && !crop)) return null;
  const fs = tagSize(w);
  return (
    <div
      data-testid="safe-zones"
      data-preset={preset.id}
      style={{ position: 'absolute', inset: 0 }}
    >
      {crop ? (
        <>
          {crop.cut.map((r) => (
            <div
              key={`${r.x}:${r.y}:${r.w}:${r.h}`}
              data-testid="safe-zone-cut"
              style={{
                position: 'absolute',
                left: r.x,
                top: r.y,
                width: r.w,
                height: r.h,
                background: CUT_FILL,
              }}
            />
          ))}
          <div
            style={{
              position: 'absolute',
              left: crop.frame.x,
              top: crop.frame.y,
              width: crop.frame.w,
              height: crop.frame.h,
              boxSizing: 'border-box',
              border: `${Math.max(1.5, w * 0.004)}px dashed ${BAND_EDGE}`,
            }}
          />
          <span
            style={{
              ...tagStyle(fs, TAG_BG, TAG_FG),
              position: 'absolute',
              left: crop.frame.x + fs * 0.5,
              top: crop.frame.y + fs * 0.5,
            }}
          >
            {crop.label}
          </span>
        </>
      ) : null}
      {bands.map((b) => (
        <Band key={b.edge} band={b} fs={fs} />
      ))}
      {flags.map((f) => (
        <span
          key={f.band.edge}
          data-testid="safe-zone-flag"
          data-edge={f.band.edge}
          style={{
            ...tagStyle(Math.round(fs * 0.9), FLAG_BG, FLAG_FG),
            position: 'absolute',
            left: Math.max(0, Math.min(f.item.x, w - 8)),
            top: Math.max(0, f.item.y - fs * 1.4),
            zIndex: 1,
          }}
        >
          {f.band.under}
        </span>
      ))}
    </div>
  );
}
SafeZonesOverlay.displayName = 'SafeZonesOverlay';
