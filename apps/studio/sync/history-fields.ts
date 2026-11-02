// The additive fields a history row carries for Version history (S1.12b, V2-1.9 §5.1 / §5.4).
// Shared by BOTH readers — the linked runtime (`sync/index.ts`) and the local home
// (`sync/local-kernel.ts`) — so the two homes answer the same row shape.
//
//   lanes  per canvas path, the lanes the action's effects touched (`html`, `css`, `meta`,
//          `annotations`, `comments`, `@manifest`, `@name`, `@aside`, `@trash`). A comments-only
//          action is then not a version of the canvas (§5.1 visible versions).
//   named  a `name` action's target (`origin.named`, stamped by the kernel — never the client):
//          `{ rev, name }`, `name: null` clears it.
//
// Additive only: a v1 reader ignores both keys.

export interface HistoryEffectLike {
  doc: string | null;
  lane: string;
  beforePath: string | null;
  afterPath: string | null;
}

export interface RowNamed {
  rev: number;
  name: string | null;
}

const MAX_NAME = 80;

/** The canvases an action touched and, per canvas, the lanes it touched there. */
export function canvasLanes(
  effects: readonly HistoryEffectLike[],
  pathOf: (doc: string) => string | null | undefined,
  isCanvas: (path: string) => boolean
): { canvases: string[]; lanes: Record<string, string[]> } {
  const lanes = new Map<string, Set<string>>();
  for (const e of effects) {
    const p = e.afterPath ?? (e.doc ? pathOf(e.doc) : null) ?? e.beforePath;
    if (!p || !isCanvas(p)) continue;
    let set = lanes.get(p);
    if (!set) {
      set = new Set();
      lanes.set(p, set);
    }
    if (typeof e.lane === 'string' && e.lane) set.add(e.lane);
  }
  const canvases = [...lanes.keys()].sort();
  return {
    canvases,
    lanes: Object.fromEntries(canvases.map((c) => [c, [...(lanes.get(c) as Set<string>)].sort()])),
  };
}

/** `origin.named` of a `name` action, validated (a malformed one is dropped, never trusted). */
export function namedField(kind: string, origin: unknown): RowNamed | undefined {
  if (kind !== 'name' || !origin || typeof origin !== 'object') return undefined;
  const n = (origin as { named?: unknown }).named;
  if (!n || typeof n !== 'object') return undefined;
  const { rev, name } = n as { rev?: unknown; name?: unknown };
  if (!Number.isSafeInteger(rev) || (rev as number) < 1) return undefined;
  if (name === null) return { rev: rev as number, name: null };
  if (typeof name !== 'string' || !name.trim() || [...name].length > MAX_NAME) return undefined;
  return { rev: rev as number, name };
}
