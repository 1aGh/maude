// apps/studio/present/pointer-point.ts — S3.2b: the Pointer's wire shape and its validator.
//
// A leaf module (no imports) so `use-collab.tsx` can run `sanitizePointer` in `sanitizeForeignState` — the
// one chokepoint foreign awareness passes through (DDR-054) — without a cycle with `pointer-dot.tsx`,
// which imports `useCollab`.

/** A world-coordinate point (canvas-lib viewport space), as the cursor is. */
export interface WorldPoint {
  x: number;
  y: number;
}

/** Awareness is untrusted input: a peer's point must sit inside any plausible canvas. */
export const POINTER_WORLD_LIMIT = 1_000_000;

/** A peer's `pointer`, or null. Finite numbers inside ±1e6 only; extra keys are dropped. */
export function sanitizePointer(raw: unknown): WorldPoint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { x, y } = raw as { x?: unknown; y?: unknown };
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > POINTER_WORLD_LIMIT || Math.abs(y) > POINTER_WORLD_LIMIT) return null;
  return { x, y };
}
