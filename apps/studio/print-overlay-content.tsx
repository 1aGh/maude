/**
 * @file       print-overlay-content.tsx — feature-2-print-artboards T3.
 * @scope      apps/studio/print-overlay-content.tsx
 * @purpose    Registers the 'print' kind's on-canvas guide chrome into the
 *             foundation's kindOverlayRegistry (artboard-guides-overlay.tsx):
 *             bleed zone (red tint), trim line (solid), safe-margin line
 *             (magenta dashed) — the Adobe-convention colors Design
 *             Decision 3 specifies. Decorative — aria-hidden, pointer-events
 *             none, flat divs/borders only (no filters/blends — WKWebView
 *             doesn't GPU-accelerate those; same constraint the foundation
 *             overlay itself documents).
 *
 *             Geometry reads print/units.ts ONLY (never a local mm→px copy —
 *             the T1 single-source invariant: bleedPx here must match the
 *             PDF post-pass's bleedPx (T5) exactly, or the on-canvas guide
 *             and the exported TrimBox visibly disagree).
 */

import {
  type KindOverlayRenderFn,
  registerKindOutsideOverlay,
  registerKindOverlay,
} from './artboard-guides-overlay.tsx';
import { effectivePrintGuides } from './kinds/print-guides.ts';
import {
  type ArtboardPrintProp,
  resolveBleedMm,
  resolveMarginsMm,
  resolveMmPx,
} from './print/units.ts';

// P8 C5 (08 RC-5, board 'ak-print-view'): bleed = the coral object colour, trim = a solid ink line, margins = the
// lilac object colour dashed - the app's own object palette from the HUD tokens (chrome, never exported content).
const BLEED_TINT = 'color-mix(in oklab, var(--maude-hud-object-coral, #f08a7c) 30%, transparent)';
const TRIM_LINE = 'var(--maude-hud-object-ink, #1a1d24)';
const MARGIN_LINE = 'var(--maude-hud-object-lilac, #a98bd9)';

const PrintOverlayContent: KindOverlayRenderFn = ({ rect, print, visibility }) => {
  // C25 — View › Advanced › Print guides is the default; the artboard's own switch (`print.showGuides`) wins.
  if (!print || !effectivePrintGuides(print, visibility.print === true)) return null;

  const bleedMm = resolveBleedMm(print);
  const bleedPx = resolveMmPx(bleedMm);
  const margins = resolveMarginsMm(print.marginsMm);
  const marginPx = {
    top: resolveMmPx(margins.top),
    right: resolveMmPx(margins.right),
    bottom: resolveMmPx(margins.bottom),
    left: resolveMmPx(margins.left),
  };

  // Trim box — inset from the artboard (= bleed box, Design Decision 1) by
  // bleedPx on every side.
  const trimW = Math.max(0, rect.w - 2 * bleedPx);
  const trimH = Math.max(0, rect.h - 2 * bleedPx);
  // Safe/margin box — inset further from the trim box by marginPx per side.
  const marginW = Math.max(0, trimW - marginPx.left - marginPx.right);
  const marginH = Math.max(0, trimH - marginPx.top - marginPx.bottom);

  return (
    <>
      {bleedPx > 0 ? (
        <>
          {/* Bleed zone — the annulus between the artboard edge and the trim
              line, drawn as 4 tinted strips (never a single translucent box
              over the whole artboard, which would also tint the live content
              inside the trim box). */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: rect.w,
              height: bleedPx,
              background: BLEED_TINT,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              width: rect.w,
              height: bleedPx,
              background: BLEED_TINT,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: bleedPx,
              width: bleedPx,
              height: trimH,
              background: BLEED_TINT,
            }}
          />
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: bleedPx,
              width: bleedPx,
              height: trimH,
              background: BLEED_TINT,
            }}
          />
        </>
      ) : null}
      {/* Trim line — the final cut edge, solid. */}
      <div
        style={{
          position: 'absolute',
          left: bleedPx,
          top: bleedPx,
          width: trimW,
          height: trimH,
          border: `1px solid ${TRIM_LINE}`,
          boxSizing: 'border-box',
        }}
      />
      {/* Safe-area / margin line — inset from trim, dashed. */}
      {marginW > 0 && marginH > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: bleedPx + marginPx.left,
            top: bleedPx + marginPx.top,
            width: marginW,
            height: marginH,
            border: `1px dashed ${MARGIN_LINE}`,
            boxSizing: 'border-box',
          }}
        />
      ) : null}
    </>
  );
};
PrintOverlayContent.displayName = 'PrintOverlayContent';

registerKindOverlay('print', PrintOverlayContent);

// ─────────────────────────────────────────────────────────────────────────────
// P8 C10 — what draws OUTSIDE the paper, on the un-clipped layer (artboard-guides-overlay.tsx): the dashed print-area
// outline and the four crop marks (15 an-print `.an-bleed` / `.an-crop`) and the legend under the sheet (10
// co-comment-print `.co-bleedtag`, 08 `.ak-bleedtag`). They show with the guides, nothing else: no guides, no marks.

const OUTLINE = 'var(--maude-hud-object-coral, #e8826f)';
const MARK_INK = 'var(--maude-chrome-fg-1, #5a5f6a)';
const LEGEND_INK = 'var(--maude-chrome-fg-2, #7a7f8a)';
/** Screen-sized at any zoom (the growth tag's rule): 12 world px is 3 px at the 25 % a sheet is seen at. */
const SCREEN_SIZED = 'scale(calc(1 / var(--dc-zoom, 1)))';
/** Crop mark: a leg of 8 screen px, 4 px off the sheet. */
const MARK_LEG = 8;
const MARK_GAP = 4;

const mmWords = (n: number): string => `${Number.isInteger(n) ? n : Number(n.toFixed(1))}`;

/** "Bleed 3 mm · trim · safe margin 5 mm" — the artboard's own numbers; margins that differ read as a range. */
export function printLegendWords(print: ArtboardPrintProp): string {
  const m = resolveMarginsMm(print.marginsMm);
  const sides = [m.top, m.right, m.bottom, m.left];
  const lo = Math.min(...sides);
  const hi = Math.max(...sides);
  const margin = lo === hi ? mmWords(lo) : `${mmWords(lo)}–${mmWords(hi)}`;
  return `Bleed ${mmWords(resolveBleedMm(print))} mm · trim · safe margin ${margin} mm`;
}

/** One corner's mark: two legs pointing away from the sheet, anchored at the corner, kept screen-sized. */
function CropMark({ at }: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  const right = at === 'tr' || at === 'br';
  const bottom = at === 'bl' || at === 'br';
  const leg = { position: 'absolute', background: MARK_INK } as const;
  // the box has no size and its origin is the corner, so the screen-size scale keeps it on the corner
  return (
    <span
      data-crop-mark={at}
      style={{
        position: 'absolute',
        [right ? 'right' : 'left']: 0,
        [bottom ? 'bottom' : 'top']: 0,
        width: 0,
        height: 0,
        transformOrigin: `${right ? '100%' : '0'} ${bottom ? '100%' : '0'}`,
        transform: SCREEN_SIZED,
      }}
    >
      {/* the horizontal leg: out to the side of the corner, level with the sheet's edge */}
      <i
        style={{
          ...leg,
          [right ? 'left' : 'right']: MARK_GAP,
          [bottom ? 'bottom' : 'top']: 0,
          width: MARK_LEG,
          height: 1,
        }}
      />
      {/* the vertical leg: out above or below the corner, in line with the sheet's edge */}
      <i
        style={{
          ...leg,
          [right ? 'right' : 'left']: 0,
          [bottom ? 'top' : 'bottom']: MARK_GAP,
          width: 1,
          height: MARK_LEG,
        }}
      />
    </span>
  );
}

const PrintOutsideContent: KindOverlayRenderFn = ({ print, visibility }) => {
  if (!print || !effectivePrintGuides(print, visibility.print === true)) return null;
  return (
    <>
      <div
        data-print-area
        style={{
          position: 'absolute',
          inset: 0,
          outline: `1px dashed ${OUTLINE}`,
          outlineOffset: 0,
        }}
      />
      {(['tl', 'tr', 'bl', 'br'] as const).map((at) => (
        <CropMark key={at} at={at} />
      ))}
      <span
        data-print-legend
        style={{
          position: 'absolute',
          left: 0,
          top: '100%',
          marginTop: 12,
          font: '400 var(--maude-hud-type-xs, 11px)/1.2 var(--font-ui, system-ui, sans-serif)',
          color: LEGEND_INK,
          whiteSpace: 'nowrap',
          transformOrigin: '0 0',
          transform: SCREEN_SIZED,
        }}
      >
        {printLegendWords(print)}
      </span>
    </>
  );
};
PrintOutsideContent.displayName = 'PrintOutsideContent';

registerKindOutsideOverlay('print', PrintOutsideContent);
