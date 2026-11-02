// client/v2/timeline/edit/trim.jsx — S7.9 (07 · ve-trim-split): the tip beside a clip edge while it is trimmed or
// moved. `Touchdown · 2.4 s` over `−0.6 s · video 0:14`. The numbers are said before the pointer lets go; the
// write is one `clip.retime` / `clip.trim-in` edit-op on release (client/v2/timeline/clip-verb.js).

import { totalAfterRetime } from './ripple.js';
import { trimTip } from './words.js';

/**
 * @param {{
 *   sequences: Array<{ label: string, from: number, duration: number, series?: boolean }>,
 *   index: number,
 *   newDuration: number,            // the clip's length if the pointer let go now
 *   newFrom?: number | null,        // a moved layer's start
 *   deltaFrames?: number | null,    // what the tip reports when it is not the length change (a move)
 *   fps: number,
 *   left: number,                   // axis px
 *   clamped?: boolean,
 *   testid: string,
 * }} p
 */
export function TrimTip({
  sequences,
  index,
  newDuration,
  newFrom = null,
  deltaFrames = null,
  fps,
  left,
  clamped,
  testid,
}) {
  const seq = sequences[index];
  if (!seq) return null;
  const totalFrames = totalAfterRetime({ sequences, index, newDuration, newFrom });
  const tip = trimTip({
    name: seq.label,
    frames: newDuration,
    deltaFrames: deltaFrames ?? newDuration - seq.duration,
    totalFrames,
    fps,
  });
  return (
    <span
      className={`tl-trim-tip tl-tip${clamped ? ' is-clamped' : ''}`}
      data-testid={testid}
      style={{ left }}
    >
      <span className="tl-tip-title">{tip.title}</span>
      <span className="tl-tip-dim">{tip.dim}</span>
    </span>
  );
}
