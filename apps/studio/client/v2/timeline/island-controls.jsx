// client/v2/timeline/island-controls.jsx — S7.7: what the island adds to the timeline's header (07 · .ve-tl-hd).
//
//   · "Kept open" — the status shown while ⇧⌘T holds the island open (07 · .ve-kept, the pin glyph);
//   · Expand / Compact — the button at the right of the header, the island's size. No key (CONTRACT §2).
//
// Drawn from the island context; with no island around the timeline body they draw nothing.

import { useCompMedia } from '../transcript/comp-media-store.js';
import { useTimelineIsland } from './island-context.js';

const GLYPHS = {
  expand: 'M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9',
  compact: 'M13 7H9V3M9 7l4.5-4.5M3 9h4v4M7 9l-4.5 4.5',
  pin: 'M10 2.5l3.5 3.5-2 .5-2.5 2.5.5 3-1 1L6 9.5 2.5 13M6 9.5l-3-3 1-1 3 .5L9.5 3.5z',
  link: 'M6.8 9.2l2.4-2.4M5.6 7.4L4.2 8.8a2.5 2.5 0 0 0 3.5 3.5l1.4-1.4M10.4 8.6l1.4-1.4a2.5 2.5 0 0 0-3.5-3.5L6.9 5.1',
};

function Glyph({ name }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={GLYPHS[name]} />
    </svg>
  );
}

/** "Shared by 3 formats" (07 · ve-formats) — only while other formats play this same cut (S7.13; derived, never stored). */
export function SharedStatus({ canvas, artboardId }) {
  const { media } = useCompMedia(canvas ?? null, artboardId ?? null);
  const n = media?.formats?.formats?.length ?? 0;
  if (n < 2) return null;
  return (
    <span
      className="tl-shared"
      data-testid="timeline-shared"
      title="A trim or a title change here shows in every format of this cut"
    >
      <Glyph name="link" />
      Shared by {n} formats
    </span>
  );
}

/** "Kept open" — only while ⇧⌘T is what holds the island up. */
export function KeptStatus() {
  const island = useTimelineIsland();
  if (!island?.kept) return null;
  return (
    <span className="tl-kept" data-testid="timeline-kept" title="Kept open — ⇧⌘T hides it">
      <Glyph name="pin" />
      Kept open
    </span>
  );
}

/** Expand ↔ Compact. */
export function SizeButton() {
  const island = useTimelineIsland();
  if (!island) return null;
  const full = island.size === 'full';
  return (
    <button
      type="button"
      className="tl-size"
      data-testid="timeline-size"
      aria-label={full ? 'Make the timeline compact' : 'Expand the timeline'}
      title={full ? 'Make the timeline compact' : 'Expand the timeline'}
      onClick={island.onToggleSize}
    >
      <Glyph name={full ? 'compact' : 'expand'} />
      {full ? 'Compact' : 'Expand'}
    </button>
  );
}
