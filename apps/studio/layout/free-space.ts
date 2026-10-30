// layout/free-space.ts — `maude design place` and `maude design layout-check` (contract V2-1.11
// §5.3), both on top of the `canvas-rects` manifest ({ artboards, elements } in WORLD coords).
//
//   placeNear(manifest, nearId, size, opts) → where a new w×h box goes next to `nearId` without
//     touching anything: right of it, then below, left, above, then outward rings on a grid.
//   layoutLint(manifest) → artboards that overlap (error) and elements that spill out of their
//     artboard (warning, the artboard clips them).
//
// Pure: no fs, no DOM. The bin shims feed it the manifest canvas-rects prints.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface RectsManifest {
  artboards: Array<Rect & { id: string }>;
  elements: Array<
    Rect & { cdId: string | null; artboard: string | null; tag?: string; selector?: string }
  >;
  elementsTruncated?: boolean;
}

export interface Placement extends Rect {
  near: string;
  side: 'right' | 'below' | 'left' | 'above' | 'ring';
}

export interface LayoutFinding {
  code: 'artboard-overlap' | 'element-clipped';
  severity: 'error' | 'warning';
  where: string;
  what: string;
  fix: string;
}

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** The rect `id` names: an artboard id first, else an element's data-cd-id. */
export function rectOf(m: RectsManifest, id: string): Rect | null {
  const ab = m.artboards.find((a) => a.id === id);
  if (ab) return ab;
  const el = m.elements.find((e) => e.cdId === id);
  return el ?? null;
}

/**
 * A free w×h spot next to `nearId`, `gap` away from every artboard (elements live inside their
 * artboard, so artboards are the obstacles on the canvas plane). null when `nearId` is unknown.
 */
export function placeNear(
  m: RectsManifest,
  nearId: string,
  size: { w: number; h: number },
  { gap = 80, step = 40, maxRings = 60 }: { gap?: number; step?: number; maxRings?: number } = {}
): Placement | null {
  const near = rectOf(m, nearId);
  if (!near) return null;
  const obstacles: Rect[] = m.artboards;
  const free = (r: Rect) => !obstacles.some((o) => overlaps(r, o, gap - 1));
  const { w, h } = size;
  const sides: Array<[Placement['side'], Rect]> = [
    ['right', { x: near.x + near.w + gap, y: near.y, w, h }],
    ['below', { x: near.x, y: near.y + near.h + gap, w, h }],
    ['left', { x: near.x - gap - w, y: near.y, w, h }],
    ['above', { x: near.x, y: near.y - gap - h, w, h }],
  ];
  for (const [side, r] of sides) if (free(r)) return { ...r, near: nearId, side };
  // Then the nearest free spot on a grid around it (centre distance), out to maxRings steps.
  const ncx = near.x + near.w / 2;
  const ncy = near.y + near.h / 2;
  let best: Rect | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = -maxRings; i <= maxRings; i++)
    for (let j = -maxRings; j <= maxRings; j++) {
      const r = {
        x: Math.round(ncx - w / 2 + i * step),
        y: Math.round(ncy - h / 2 + j * step),
        w,
        h,
      };
      const dist = Math.hypot(i, j);
      if (dist < bestD && free(r)) {
        best = r;
        bestD = dist;
      }
    }
  if (best) return { ...best, near: nearId, side: 'ring' };
  return null;
}

/** Overlapping artboards (error) and elements outside their artboard (warning). */
export function layoutLint(m: RectsManifest, canvas = 'canvas'): LayoutFinding[] {
  const out: LayoutFinding[] = [];
  const abs = m.artboards;
  for (let i = 0; i < abs.length; i++)
    for (let j = i + 1; j < abs.length; j++) {
      const a = abs[i] as RectsManifest['artboards'][number];
      const b = abs[j] as RectsManifest['artboards'][number];
      if (overlaps(a, b))
        out.push({
          code: 'artboard-overlap',
          severity: 'error',
          where: `${canvas}#${a.id} × #${b.id}`,
          what: `artboards ${a.id} and ${b.id} overlap on the canvas`,
          fix: `move one: \`maude design place ${canvas} --near ${a.id} --size ${b.w}x${b.h}\` gives a free spot`,
        });
    }
  const byId = new Map(abs.map((a) => [a.id, a]));
  const TOL = 1;
  for (const e of m.elements) {
    const ab = e.artboard ? byId.get(e.artboard) : undefined;
    if (!ab || e.w <= 0 || e.h <= 0) continue;
    const inside =
      e.x >= ab.x - TOL &&
      e.y >= ab.y - TOL &&
      e.x + e.w <= ab.x + ab.w + TOL &&
      e.y + e.h <= ab.y + ab.h + TOL;
    if (!inside)
      out.push({
        code: 'element-clipped',
        severity: 'warning',
        where: `${canvas}#${ab.id}${e.cdId ? ` @${e.cdId}` : e.selector ? ` ${e.selector}` : ''}`,
        what: `${e.tag ?? 'an element'} spills out of artboard ${ab.id}, which clips it`,
        fix: 'fit it inside the artboard, or grow the artboard',
      });
  }
  return out;
}
