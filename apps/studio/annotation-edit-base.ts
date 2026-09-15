// Which SVG an annotation edit names as its base (DDR-241 accepted revisions).
//
// The project merges an annotation proposal element by element against the
// text it was derived from. The canvas used to send the CANONICAL
// re-serialization of the strokes it held — fine while the stored text is
// canonical too, and silently fatal when it is not: an element written by an
// older serializer, a hand edit or any other writer then looks changed on BOTH
// sides, the merge refuses it as a conflict, and the person's edit is reverted
// without a word (plan T31, L09 arrowheads on a non-canonical arrow).
//
// An edit made on exactly the state this canvas last RECEIVED names the text
// it received — the project then sees "nothing changed underneath", accepts
// the edit whole, and the stored text becomes canonical as a side effect. Any
// other state (edits stacked before the echo returns) is this canvas's own
// canonical output, which is what the project holds after accepting it.

import { type Stroke, strokesToSvg } from './annotations-model.ts';

export interface ReceivedAnnotations {
  /** The SVG text exactly as the project delivered it. */
  raw: string;
  /** The same state as this client serializes it. */
  canon: string;
}

export function receivedAnnotations(raw: string, strokes: readonly Stroke[]): ReceivedAnnotations {
  return { raw, canon: strokesToSvg(strokes) };
}

export function annotationEditBase(
  before: readonly Stroke[],
  received: ReceivedAnnotations | null
): string {
  const canon = strokesToSvg(before);
  return received && received.canon === canon ? received.raw : canon;
}
