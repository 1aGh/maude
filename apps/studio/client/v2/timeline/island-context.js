// client/v2/timeline/island-context.js — S7.7: what the island hands the timeline body it hosts.
//
// The body (Timeline.jsx, the v1 panel moved whole) draws its own header; the island adds to it through this
// context instead of the body learning about islands: the Expand / Compact button, the "Kept open" status,
// and the empty-comp block (the S11 kit line + one AI chip). Absent (the panel mounted on its own, as the
// tests do) the body draws exactly what it drew before.

import { createContext, useContext } from 'react';

/**
 * @typedef {{
 *   size: 'compact'|'full',
 *   kept: boolean,
 *   onToggleSize: () => void,
 *   fileDrag?: boolean,                                   // footage is being dragged over the window (S7.9)
 *   dropRect?: { left: number, top: number, width: number, height: number } | null,   // the artboard, in window px
 *   canvas?: string | null,                               // the open canvas (S7.10: a per-viewer "asked once" key)
 *   canEdit?: boolean,                                    // the role may write (S7.10: the picker's tiles, the Music link)
 *   canAsk?: boolean,                                     // the AI chat exists here (S7.10: "or ask AI for a track")
 *   empty: import('react').ReactNode,
 * }} IslandValue
 */

export const TimelineIslandContext = createContext(/** @type {IslandValue|null} */ (null));

/** The island around this timeline body, or null when it stands alone. */
export function useTimelineIsland() {
  return useContext(TimelineIslandContext);
}
