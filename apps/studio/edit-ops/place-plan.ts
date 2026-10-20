// edit-ops/place-plan.ts — what a drop of N pictures does, in one place (S8.14; 12 · ia-drop-photos).
//
// Pictures dropped from Finder (or added with Image I) go to ONE place and the artboard under the pointer says which
// before the drop: empty picture frames fill in order, else a tidy grid, else (one picture) the picture is put in loose.
// The server resolves `mode: 'auto'` with this function (edit-ops/image-fit.ts) and the canvas draws the hint with the
// same function (editing/finder-drop.tsx), so the words and the write cannot disagree. Pure: no DOM, no server import.

/** What the pictures land on. A picture swaps its source; a frame is filled; the artboard holds them loose. */
export type PlaceTargetKind = 'picture' | 'frame' | 'artboard';

export type PlanMode = 'fill' | 'fill-in-order' | 'grid' | 'loose';

export interface PlacePlan {
  mode: PlanMode;
  /** the empty frames that take the first pictures (only for `fill-in-order`) */
  fills: number;
  /** pictures that do not fit an empty frame and go in after the filled ones */
  rest: number;
}

/**
 * @param n      how many pictures (0 = not known yet, as in dragover on a browser that hides the list)
 * @param empty  empty picture frames inside the target
 */
export function planPlacement(kind: PlaceTargetKind, n: number, empty: number): PlacePlan {
  const count = Math.max(0, Math.floor(n));
  if (kind === 'picture') return { mode: 'fill', fills: 0, rest: 0 };
  if (empty > 0) {
    const fills = count > 0 ? Math.min(count, empty) : empty;
    return { mode: 'fill-in-order', fills, rest: Math.max(0, count - fills) };
  }
  if (count > 1) return { mode: 'grid', fills: 0, rest: 0 };
  return { mode: kind === 'frame' ? 'fill' : 'loose', fills: 0, rest: 0 };
}

const photos = (n: number): string => (n === 1 ? 'photo' : 'photos');
const frames = (n: number): string => (n === 1 ? 'empty frame' : 'empty frames');

/** The pill over the artboard while the drag is over it. Names what will happen, in plain words (CONTRACT §3). */
export function dropHint(kind: PlaceTargetKind, n: number, empty: number): string {
  const plan = planPlacement(kind, n, empty);
  if (kind === 'picture') return 'Drop to replace the photo';
  if (plan.mode === 'fill-in-order') {
    const head = `Drop to fill ${plan.fills === 1 ? 'the' : plan.fills} ${frames(plan.fills)}${plan.fills === 1 ? '' : ' in order'}`;
    return plan.rest > 0 ? `${head}, then place ${plan.rest} more` : head;
  }
  if (plan.mode === 'grid') return `Drop to place ${n} photos in a tidy grid`;
  if (plan.mode === 'fill') return 'Drop to fill the frame';
  return n > 1 ? `Drop to place ${n} ${photos(n)} here` : 'Drop to place the photo here';
}
