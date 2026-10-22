/**
 * @file       web-overlay-content.tsx — feature-3-web-artboards T2.
 * @scope      apps/studio/web-overlay-content.tsx
 * @purpose    Registers the 'web' kind's on-canvas chrome into the
 *             foundation's kindOverlayRegistry (artboard-guides-overlay.tsx):
 *             a small breakpoint-band chip in the header's top-right corner
 *             (the video badge's own slot — 'web' and 'video' are mutually
 *             exclusive via DCArtboard's resolvedKind, so there's no
 *             collision) showing the artboard's CURRENT live width as
 *             "≤ {width}px" — the Framer-breakpoints-bar vocabulary (Design
 *             Decisions 2/3). Dragging the artboard's resize handle (T4)
 *             visibly updates this label live, which is how "drag width to
 *             test reflow" reads as a breakpoint change rather than a plain
 *             resize.
 *
 *             Decorative — aria-hidden, pointer-events none. Reuses the
 *             engine's own HUD chrome tokens (--bg-2/--fg-1/--font-mono),
 *             same as the artboard label strip itself, rather than DS tokens
 *             — this chip IS chrome, never exported content. Always-on (no
 *             visibility gate): unlike print's bleed/trim/margin overlay
 *             (which visually covers artboard content and needs an opt-in
 *             toggle), this is a single small corner label with nothing to
 *             collide with, so there's no reason to hide it.
 */

import { type KindOverlayRenderFn, registerKindOverlay } from './artboard-guides-overlay.tsx';

const WebOverlayContent: KindOverlayRenderFn = ({ rect }) => {
  const width = Math.round(rect.w);
  return (
    <div
      style={{
        position: 'absolute',
        top: 4,
        right: 6,
        padding: '2px 6px',
        borderRadius: 3,
        background: 'var(--bg-2, #e8e3d8)',
        color: 'var(--fg-1, #4a3f30)',
        fontFamily: 'var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif)',
        fontSize: 9,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {`≤ ${width}px`}
    </div>
  );
};
WebOverlayContent.displayName = 'WebOverlayContent';

registerKindOverlay('web', WebOverlayContent);
