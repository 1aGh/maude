/**
 * @file       figma/fig-vector.ts — path geometry out of a local `.fig`.
 * @scope      apps/studio/figma/fig-vector.ts
 * @purpose    Turn a `.fig`'s own vector geometry into SVG, so the offline door
 *             does NOT need Figma to render an icon.
 *
 * @invariant  THIS CORRECTS A CLAIM DDR-221 MADE. A9/A10 asserted that a vector
 *             cluster is a server-side render absent from a local export, and
 *             shipped an `asset-unavailable-offline` disposition saying so. That
 *             is false: every `VECTOR` carries `fillGeometry[].commandsBlob`, an
 *             index into the message's `blobs[]`, and the blob holds the actual
 *             path. Measured on a real export — both blobs decoded to the byte
 *             (196/196 and 82/82) with the command set below.
 *
 * @invariant  DEPENDENCY-FREE and pure. Bytes in, path string out. Every input
 *             is attacker-controlled, so each blob is bounded and a command the
 *             table does not know REFUSES the path rather than guessing at it
 *             (DDR-221 D3 — a half-read path draws plausible nonsense).
 */

/** Observed command set. Arity is in FLOAT PAIRS-worth of float32s. */
const CLOSE = 0;
const MOVE_TO = 1;
const LINE_TO = 2;
const QUAD_TO = 3;
const CUBIC_TO = 4;

const ARITY: Record<number, number> = {
  [CLOSE]: 0,
  [MOVE_TO]: 2,
  [LINE_TO]: 2,
  [QUAD_TO]: 4,
  [CUBIC_TO]: 6,
};

const LETTER: Record<number, string> = {
  [CLOSE]: 'Z',
  [MOVE_TO]: 'M',
  [LINE_TO]: 'L',
  [QUAD_TO]: 'Q',
  [CUBIC_TO]: 'C',
};

/** ~10x the largest observed (464 B). A path is not a payload. */
export const MAX_PATH_BLOB_BYTES = 64 * 1024;
/** Bounds the emitted string as well as the walk. */
export const MAX_PATH_COMMANDS = 4096;

export class FigVectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FigVectorError';
  }
}

/** Trim float noise without pretending to more precision than Figma stored. */
function n(v: number): string {
  if (!Number.isFinite(v)) throw new FigVectorError('path coordinate is not finite');
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * Decode one commands blob into an SVG `d` attribute.
 *
 * Refuses rather than truncates: an unknown command byte, a run past the end,
 * or a non-finite coordinate all throw, because a partially-read path renders
 * as confident nonsense — the exact failure mode the fail-loud posture exists
 * to prevent.
 */
export function pathFromBlob(bytes: Uint8Array): string {
  if (bytes.length > MAX_PATH_BLOB_BYTES) {
    throw new FigVectorError(`path blob is ${bytes.length} bytes, over the limit`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: string[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const command = bytes[offset];
    const arity = ARITY[command];
    if (arity === undefined) {
      throw new FigVectorError(`unknown path command ${command} at byte ${offset}`);
    }
    offset += 1;
    if (offset + arity * 4 > bytes.length) {
      throw new FigVectorError(`path command ${command} runs past the end of the blob`);
    }
    if (parts.length >= MAX_PATH_COMMANDS) {
      throw new FigVectorError(`path has more than ${MAX_PATH_COMMANDS} commands`);
    }
    const coords: string[] = [];
    for (let i = 0; i < arity; i++) {
      coords.push(n(view.getFloat32(offset, true)));
      offset += 4;
    }
    parts.push(coords.length > 0 ? `${LETTER[command]}${coords.join(' ')}` : LETTER[command]);
  }

  if (parts.length === 0) throw new FigVectorError('path blob is empty');
  return parts.join(' ');
}

/**
 * A gradient fill (#155 §10) — without it a gradient blob collapsed to no fill
 * at all. `matrix` is an SVG matrix `[a b c d e f]` mapping Figma's GRADIENT
 * space (where a linear gradient runs along x from 0 to 1 and a radial one is
 * the circle of radius 0.5 around (0.5, 0.5)) into the node's own space, i.e.
 * `diag(size) * inverse(paint.transform)`.
 */
export interface VectorGradient {
  kind: 'linear' | 'radial';
  stops: Array<{ offset: number; color: string; opacity: number }>;
  matrix: [number, number, number, number, number, number];
}

export interface VectorPath {
  /** SVG `d`, in the owning node's own coordinate space. */
  d: string;
  /** `#rrggbb` of the first visible solid fill, or null when there is none. */
  fill: string | null;
  /** Set when the first visible fill is a gradient; `fill` is then null. */
  gradient?: VectorGradient;
  fillOpacity: number;
  /** `nonzero` | `evenodd`, straight from the geometry record. */
  fillRule: string;
  /** Placement inside the cluster, already composed. */
  x: number;
  y: number;
}

/** One cluster's worth of paths plus the box they live in. */
export interface VectorArt {
  width: number;
  height: number;
  paths: VectorPath[];
}

/**
 * Serialize to a standalone SVG.
 *
 * Emits ONLY `<svg>`, `<path>` and plain geometry/colour attributes — no
 * scripts, no `<use>`, no external references — so the result is trivially
 * within the DDR-167 allowlist it is then promoted through. It is still routed
 * through that sanitizer rather than trusted, on the standing rule that this
 * module's input is a third party's file.
 */
export function artToSvg(art: VectorArt): string {
  const w = Math.max(1, Math.round(art.width));
  const h = Math.max(1, Math.round(art.height));
  const defs: string[] = [];
  const body = art.paths
    .map((p, i) => {
      const transform = p.x !== 0 || p.y !== 0 ? ` transform="translate(${n(p.x)} ${n(p.y)})"` : '';
      const opacity = p.fillOpacity < 1 ? ` fill-opacity="${n(p.fillOpacity)}"` : '';
      const rule = p.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
      let fill = p.fill ?? 'none';
      if (p.gradient) {
        defs.push(gradientDef(`g${i}`, p.gradient, w));
        fill = `url(#g${i})`;
      }
      return `<path d="${p.d}" fill="${fill}"${opacity}${rule}${transform}/>`;
    })
    .join('');
  const defsEl = defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">${defsEl}${body}</svg>`;
}

/** Matrix terms need more precision than a coordinate: a/width is ~0.004. */
function fine(v: number): string {
  if (!Number.isFinite(v)) throw new FigVectorError('gradient matrix is not finite');
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * One gradient definition, written ONLY with attributes the DDR-167 allowlist
 * keeps (`x1`..`y2` are not among them, so they are never relied on).
 *
 * userSpaceOnUse with a `gradientTransform`. A radial gradient is the unit
 * circle in gradient space (`cx`/`cy`/`r` survive the sanitizer). A linear one
 * needs its vector to be the SVG DEFAULT — (0,0) to (viewport width, 0) — so
 * that, if the sanitizer strips the explicit `x1`..`y2` written here, the
 * result is identical; the matrix is therefore scaled by 1/width.
 */
function gradientDef(id: string, g: VectorGradient, viewportWidth: number): string {
  const stops = g.stops
    .map(
      (s) =>
        `<stop offset="${n(s.offset)}" stop-color="${s.color}"${s.opacity < 1 ? ` stop-opacity="${n(s.opacity)}"` : ''}/>`
    )
    .join('');
  const [a, b, c, d, e, f] = g.matrix;
  if (g.kind === 'radial') {
    const m = [a, b, c, d, e, f].map(fine).join(' ');
    return `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5" gradientUnits="userSpaceOnUse" gradientTransform="matrix(${m})">${stops}</radialGradient>`;
  }
  const k = 1 / viewportWidth;
  const m = [a * k, b * k, c * k, d * k, e, f].map(fine).join(' ');
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${viewportWidth}" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(${m})">${stops}</linearGradient>`;
}
