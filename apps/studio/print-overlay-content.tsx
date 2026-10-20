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

import { type KindOverlayRenderFn, registerKindOverlay } from './artboard-guides-overlay.tsx';
import { effectivePrintGuides } from './kinds/print-guides.ts';
import { resolveBleedMm, resolveMarginsMm, resolveMmPx } from './print/units.ts';

// Adobe print-tool convention (Design Decision 3): bleed = red, trim = solid
// dark line, margins/safe-area = magenta dashed. Chrome-engine constants, not
// DS tokens — guides are never part of exported artboard content, same
// reasoning as the foundation's own COLUMN_FILL/GRID_LINE constants.
const BLEED_TINT = 'color-mix(in oklab, oklch(55% 0.22 25) 14%, transparent)';
const TRIM_LINE = 'oklch(25% 0 0)';
const MARGIN_LINE = 'oklch(58% 0.24 340)';

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
