// A canvas body that is one whole module written again right after itself.
//
// How it happens: two replicas each seed the SAME file into a shared document
// independently (a desktop adopting its file while the hub's own copy was not
// visible yet), and the CRDT keeps both inserts — the text concatenates. Every
// later start that repeats the race doubles it again (2×, 4×, …), and a write
// cut short leaves a whole copy plus a prefix of itself. Reported live on the
// Alligators project, 2026-09-15: 38 canvases at exactly 4×, one at 1× + 879
// characters.
//
// A module has ONE default export, so a body carrying the same module twice is
// never something a person wrote. The repair keeps exactly one copy; anything
// that is not a clean repeat (a real edit in either copy) is left alone for the
// conflict machinery.

const DEFAULT_EXPORT = /\bexport\s+default\b/g;

export interface RepeatedModule {
  /** The one copy to keep. */
  unit: string;
  /** Whole copies found (a trailing partial copy is counted as +0.5 → rounded up). */
  times: number;
  /** True when the tail was a cut-short copy (a prefix of the module). */
  partialTail: boolean;
}

/**
 * The single module a repeated canvas body is made of, or null when the body
 * is not a clean repeat of one module.
 */
export function collapseRepeatedModule(body: string): RepeatedModule | null {
  if (typeof body !== 'string' || body.length < 32) return null;
  // Cheap gate: one module, one default export.
  const exports = body.match(DEFAULT_EXPORT)?.length ?? 0;
  if (exports < 2) return null;
  // The second copy starts where the file's own opening appears again.
  const probe = body.slice(0, Math.min(80, Math.floor(body.length / 2)));
  const second = body.indexOf(probe, 1);
  if (second <= 0) return null;
  const unit = body.slice(0, second);
  if ((unit.match(DEFAULT_EXPORT)?.length ?? 0) !== 1) return null;
  let rest = body.slice(second);
  let times = 1;
  while (rest.startsWith(unit)) {
    rest = rest.slice(unit.length);
    times++;
  }
  if (rest === '') return times >= 2 ? { unit, times, partialTail: false } : null;
  // A copy cut short: what is left must be the start of the module, and long
  // enough that this is not a coincidence.
  if (rest.length >= probe.length && unit.startsWith(rest)) {
    return { unit, times: times + 1, partialTail: true };
  }
  return null;
}

/**
 * A stylesheet written k≥2 times in a row (the same race on a canvas's CSS
 * lane). Exact repeats only — a real stylesheet is never itself twice over.
 */
export function collapseRepeatedText(
  text: string,
  minUnit = 32
): { unit: string; times: number } | null {
  if (typeof text !== 'string' || text.length < minUnit * 2) return null;
  for (let k = 8; k >= 2; k--) {
    if (text.length % k) continue;
    const unit = text.slice(0, text.length / k);
    if (unit.length < minUnit || !unit.trim()) continue;
    if (unit.repeat(k) === text) return { unit, times: k };
  }
  return null;
}
