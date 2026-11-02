// exporters/print-back.ts — S8.7: which print artboard is "the back" of a front (09 Export › ex-print).
//
// The sheet offers `Add “B · zadní (FLAG)”` under a print front, and the PDF then carries the back as
// page 2. Nothing in the file says which artboard that is (no pairing field exists, and a new one would
// have to be read by every peer), so the pairing is the one a person makes by reading the names: the back
// is the print artboard of the SAME size whose label says "back" — Back, Zadní, Verso, Rückseite … — and
// whose remaining words match the front's ("A · přední (FLAG)" ↔ "B · zadní (FLAG)", never TACKLE's).
//
// decision:maude/v2-S8.7-back-by-name — pure and deterministic, so the sheet, the server's resolver and the
// agent path (`maude design export … --option back=true`) all pick the same artboard. An ambiguous or
// absent pairing is "no back": the checkbox is not drawn, the export is never guessed.

export interface BoardLite {
  id: string;
  label: string | null;
  kind: string | null;
  w: number | null;
  h: number | null;
}

const FRONT_WORDS = new Set([
  'front',
  'predni',
  'face',
  'recto',
  'vorne',
  'vorderseite',
  'avant',
  'frente',
]);
const BACK_WORDS = new Set([
  'back',
  'rear',
  'zadni',
  'verso',
  'ruckseite',
  'hinten',
  'dos',
  'reverso',
  'arriere',
]);

/** Lower-case words of a label, diacritics folded ("zadní" → "zadni"). */
function words(label: string | null | undefined): string[] {
  return String(label ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const isBack = (label: string | null) => words(label).some((w) => BACK_WORDS.has(w));

/** The words that name WHAT the artboard is, without which side it is ("a", "b" and the side word go). */
function subject(label: string | null): Set<string> {
  return new Set(
    words(label).filter((w) => !FRONT_WORDS.has(w) && !BACK_WORDS.has(w) && w.length > 1)
  );
}

const sameSize = (a: BoardLite, b: BoardLite) =>
  a.w == null || a.h == null || b.w == null || b.h == null
    ? true
    : Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let both = 0;
  for (const w of a) if (b.has(w)) both += 1;
  return both / (a.size + b.size - both);
}

/**
 * The back of `front` among `boards` (document order), or null.
 * Only a print artboard that is not itself a back has one.
 */
export function findBack(front: BoardLite, boards: readonly BoardLite[]): BoardLite | null {
  if (front.kind !== 'print' || isBack(front.label)) return null;
  const cands = boards.filter(
    (b) => b.id !== front.id && b.kind === 'print' && isBack(b.label) && sameSize(front, b)
  );
  if (cands.length === 0) return null;
  const mine = subject(front.label);
  const scored = cands.map((b) => ({ b, s: overlap(mine, subject(b.label)) }));
  const best = Math.max(...scored.map((x) => x.s));
  const top = scored.filter((x) => x.s === best);
  // one candidate that shares the front's words (or the only back of that size at all) is the back;
  // several equally good ones are a guess, so there is none
  if (top.length === 1 && (best >= 0.5 || cands.length === 1)) return top[0]?.b ?? null;
  return null;
}
