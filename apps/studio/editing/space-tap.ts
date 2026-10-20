// editing/space-tap.ts — S7.8: tap Space = play, hold Space = Hand (S7-slices Q10; CONTRACT §2).
//
// One key, two meanings, decided when it comes UP: released within 200 ms and with no pointer drag in
// between it was a tap (the canvas tells the shell `space-tap`, which plays or pauses the selected video);
// held longer, or used to pan, it was the Hand and nothing is sent. Pure state machine over timestamps so the
// rule is a unit test — canvas-lib feeds it keydown / keyup / pointer-drag; it holds no timers and reads no
// clock.

/** A tap is a press-and-release inside this many milliseconds. */
export const SPACE_TAP_MS = 200;

export interface SpaceTap {
  /** Space went down. A key-repeat is not a new press. */
  down(at: number): void;
  /** The pointer dragged while Space was held (the Hand panned) — this press is not a tap any more. */
  drag(): void;
  /** Space came up: true when that press was a tap. */
  up(at: number): boolean;
  /** Focus left or the key state was lost — forget the press. */
  cancel(): void;
}

export function createSpaceTap(thresholdMs: number = SPACE_TAP_MS): SpaceTap {
  let downAt: number | null = null;
  let dragged = false;
  return {
    down(at) {
      if (downAt !== null) return; // key repeat
      downAt = at;
      dragged = false;
    },
    drag() {
      if (downAt !== null) dragged = true;
    },
    up(at) {
      const start = downAt;
      const moved = dragged;
      downAt = null;
      dragged = false;
      return start !== null && !moved && at - start < thresholdMs;
    },
    cancel() {
      downAt = null;
      dragged = false;
    },
  };
}
