// Per-type byte ceilings for everything that crosses the sync boundary —
// DDR-054 §2d.
//
// A LEAF MODULE ON PURPOSE. These used to live in `sync/codec.ts`, which imports
// `Y_TYPES` from `collab/persistence.ts`; the moment persistence needed a
// ceiling of its own (the doc→disk comments/annotations lane, DDR-064's
// pre-cutover checklist) that became an import cycle whose only symptom would
// have been a `const` read in its temporal dead zone — a crash whose stack
// points at neither file. Numbers depend on nothing, so they belong where
// nothing has to depend back.
//
// `codec.ts` re-exports every name here, so existing importers are unaffected.

/** Canvas body (`.html` / opted-in `.tsx`). */
export const MAX_HTML_BYTES = 4 * 1024 * 1024;
/** `_comments/<slug>.json`, serialized. */
export const MAX_COMMENTS_BYTES = 1 * 1024 * 1024;
/**
 * `<slug>.annotations.json` (DDR-242). Must equal `MAX_BOARD_BYTES` in
 * annotations/constants.ts — annotations-v2-replica.test.ts pins the pair.
 * Raised from v1's 1 MB: the v1 cap bit at ~3.7k elements, and the v2 board is
 * ~3× more compact, so 4 MB is ≈ 20k typical elements (the element-count cap).
 */
export const MAX_ANNOTATIONS_BYTES = 4 * 1024 * 1024;
/** The shared subset of a canvas `.meta.json`. */
export const MAX_META_BYTES = 1 * 1024 * 1024;
/** The canvas's sibling stylesheet. */
export const MAX_CSS_BYTES = 4 * 1024 * 1024;

/**
 * Refuse a doc→file write once it exceeds a byte ceiling — the shared
 * enforcement point for every `MAX_*_BYTES` above, in both directions:
 * `sync/projection.ts` (html/css/meta) and `collab/persistence.ts`
 * (comments/annotations) each guard their own doc→file lane with this same
 * check-and-warn shape; consolidated here rather than kept as two copies
 * that would need editing in lockstep for any future change to the guard
 * (DDR-054 §2d).
 *
 * `label` is a log-line prefix (`projection/<slug>` / `collab/<slug>`) —
 * left to the caller rather than hardcoded, so each subsystem's log lines
 * stay identifiable as to which one refused.
 */
export function withinByteCap(
  label: string,
  what: string,
  byteLength: number,
  max: number
): boolean {
  if (byteLength <= max) return true;
  console.warn(
    `[${label}] refusing doc→file write of ${what} — ${byteLength} bytes > ${max} (hub-pushed oversize, DDR-054 §2d).`
  );
  return false;
}
