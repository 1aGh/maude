// client/v2/timeline/island.jsx — S7.7: the island's shell (07 · `.ve-tl`): a floating panel in the shell's own
// material, a notch pointing at the artboard it belongs to, and the timeline body inside.
//
// It publishes its footprint as `data-occludes="bottom"` (V2-4.1) so Fit leaves room for it — but only while it
// is at rest: a sliding island would be measured mid-flight. Position and width come from anchor.js; this file
// draws them.

import { useEffect, useState } from 'react';

/** The slide in takes --dur-panel (220 ms); a little over, then the island is at rest and may publish its inset. */
const SETTLE_MS = 260;

/**
 * @param {{
 *   size: 'compact'|'full',
 *   placement: { left: number, width: number, notch: number|null },
 *   artboardId: string|null,
 *   leaving: boolean,
 *   children: import('react').ReactNode,
 * }} props
 */
export function TimelineIsland({ size, placement, artboardId, leaving, children }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <section
      className={`island tl-island tl-island--${size}${leaving ? ' is-leaving' : ''}`}
      data-testid="timeline-island"
      data-size={size}
      data-artboard={artboardId ?? undefined}
      data-occludes={settled && !leaving ? 'bottom' : undefined}
      aria-label="Timeline"
      style={{
        left: placement.left,
        width: placement.width,
        // the slide starts at the notch: the island rises out of the artboard it points at
        transformOrigin: `${placement.notch ?? placement.width / 2}px 0`,
      }}
    >
      {placement.notch != null ? (
        <span
          className="tl-notch"
          data-testid="timeline-notch"
          style={{ left: placement.notch }}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </section>
  );
}
