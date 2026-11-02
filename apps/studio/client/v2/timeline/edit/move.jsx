// client/v2/timeline/edit/move.jsx — S7.9 (07 · ve-move-transition): a beat lifts, a line shows where it lands,
// the tip says "Drop before Touchdown", and when it lets go its old place closes up (the length stays). The commit
// is one `clip.move` edit-op (series beats) or `clip.retime { from }` (a layer) — never two writes for one drag.

import { moveLanding } from './ripple.js';
import { moveTip } from './words.js';

/** What the lifted beat will do if let go now: where it lands and the words for it. Null when nothing is lifted. */
export function landingOf({ story, reorderDrag }) {
  if (!reorderDrag) return null;
  const landing = moveLanding({
    count: story.length,
    slot: reorderDrag.slot,
    targetSlot: reorderDrag.targetSlot,
  });
  return {
    landing,
    text: moveTip(
      landing,
      story.map((s) => s.label)
    ),
  };
}

/** The line where the beat will land, and the tip beside it. `x` is axis px. */
export function MoveLanding({ x, text }) {
  return (
    <>
      <span
        className="tl-insert-line"
        data-testid="timeline-landing-line"
        style={{ left: x - 1 }}
      />
      <span
        className="tl-trim-tip tl-tip"
        data-testid="timeline-landing-tip"
        style={{ left: x + 8 }}
      >
        <span className="tl-tip-title">{text}</span>
      </span>
    </>
  );
}
