/**
 * @file       figma/fig-decode.ts — the local `.fig` / `.jam` ingestion door.
 * @scope      apps/studio/figma/fig-decode.ts
 * @purpose    ZIP → `canvas.fig` → container → the two decompressors → Kiwi →
 *             a REST-SHAPED raw tree → `normalizeDocument(raw, {origin:'fig'})`.
 *             The second door onto the tree the translators already consume
 *             (DDR-221). No network, no token, no SSRF: the whole door is local.
 *
 * @invariant  EMIT REST-SHAPED RAW, DO NOT BUILD A NormalizedDocument (DDR-221
 *             A5). Handing raw to the EXISTING normalizer makes the node/depth
 *             caps and the prototype-pollution guard literally the same code as
 *             the REST door, rather than a parallel implementation that drifts.
 *
 * @invariant  FRAMING ERRORS REFUSE THE FILE; VOCABULARY GAPS DEGRADE AND
 *             REPORT (DDR-221 D3). An unknown prelude or container version is
 *             a refusal — never a best-effort decode, because a design importer
 *             that guesses produces wrong geometry that looks right.
 *
 * @invariant  EVERY SCHEMA-SOURCED STRING IS ATTACKER-CHOSEN (DDR-221 A8/F1).
 *             Enum member names come from the file's own schema, so node
 *             `type` is attacker-controlled. Anything reaching a report goes
 *             through `reportToken` + a count, never verbatim — `attrValue`
 *             is NOT enough, it maps rejected characters to spaces and a
 *             bounded label can still read as prose.
 */

import { createHash } from 'node:crypto';
import { inflateRawSync, zstdDecompressSync } from 'node:zlib';

import { styleToWeight } from './codegen-fonts.ts';
import { decodeKiwi, findRootDefinition, type KiwiSchema, parseKiwiSchema } from './fig-kiwi.ts';
import { pathFromBlob, type VectorGradient, type VectorPath } from './fig-vector.ts';
import { FigZipError, readFigZip } from './fig-zip.ts';
import { reportToken } from './sanitize.ts';
import {
  KNOWN_NODE_TYPES,
  MAX_NODE_COUNT,
  MAX_TREE_DEPTH,
  type NormalizedDocument,
  normalizeDocument,
} from './types.ts';

// ── Container constants (measured on the committed fixtures) ────────────────

/** The 8-byte ASCII prelude is the ONLY editor discriminator. */
const PRELUDES: Record<string, 'design' | 'board'> = {
  'fig-kiwi': 'design',
  // Figma Slides. Same container, same schema; only the prelude differs
  // (#155 §9). Its slides sit under Presentation > Row and read as a design.
  'fig-deck': 'design',
  'fig-jam.': 'board',
};

/**
 * Container versions we have actually observed. INFORMATIONAL — not a gate.
 *
 * DDR-221 D3 originally REFUSED an unrecognised version, on the assumption that
 * the number predicts framing compatibility. Measured on a real third-party
 * export (2026-08-12): it does not. That file is version **101** — LOWER than
 * the fixtures' 106 despite being exported nine days later — carries a
 * DIFFERENT schema (`7ae1921b` vs `c22712ff`), and decodes perfectly under the
 * same code, because the framing is byte-identical and the file brings its own
 * schema (D1's whole thesis).
 *
 * So the version was refusing valid files while predicting nothing. What
 * actually gates correctness is STRUCTURE, all of it still enforced: the
 * prelude, exactly two chunks with zero trailing bytes, a raw-deflate schema
 * that parses and consumes every byte, the zstd magic, STRICT root resolution
 * (exactly one `Message` of kind MESSAGE with a `nodeChanges: NodeChange[]`),
 * and a data chunk that decodes with nothing left over. A file passing all of
 * those is a Figma document whatever integer sits in bytes 8–11.
 *
 * The version is reported instead, and an unobserved one is worth noticing —
 * see `FigDecodeReport.containerVersion` and the schema-hash alarm (D8).
 */
export const OBSERVED_CONTAINER_VERSIONS: ReadonlySet<number> = new Set([101, 106]);

/** ~1 500x the measured 42 KB. */
export const MAX_CANVAS_FIG_BYTES = 64 * 1024 * 1024;
/** 2 observed. */
export const MAX_CHUNKS = 8;
/** ~117x the measured 71 777 B. */
export const MAX_SCHEMA_BYTES = 8 * 1024 * 1024;
/** ~1 000x the measured 67 207 B. */
export const MAX_DATA_BYTES = 64 * 1024 * 1024;

const CANVAS_ENTRY = 'canvas.fig';
const META_ENTRY = 'meta.json';

export class FigDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FigDecodeError';
  }
}

export interface FigContainer {
  surface: 'design' | 'board';
  prelude: string;
  version: number;
  schema: Uint8Array;
  data: Uint8Array;
  /**
   * `sha256` of the COMPRESSED schema chunk. Stable and shared across editor
   * types, so a change is an early drift warning that fires before anything
   * breaks (DDR-221 D8).
   */
  schemaSha256: string;
}

export interface FigDecodeReport {
  /** Observed, not validated. See `OBSERVED_CONTAINER_VERSIONS`. */
  containerVersion: number;
  /** True when this version is one we have seen before — a soft drift signal. */
  containerVersionKnown: boolean;
  schemaSha256: string;
  /** From `meta.json`. Makes a dated fixture corpus self-labelling. */
  exportedAt?: string;
  nodeCount: number;
  /**
   * Node types the file carried that `FigmaNodeType` has no member for.
   * `reportToken`-bounded: one lowercase token, never spaces (DDR-221 A8/F1).
   */
  unmappedTypes: Array<{ type: string; count: number }>;
  /** Nodes dropped because Figma marks them internal (e.g. the hidden canvas). */
  internalNodesSkipped: number;
  /**
   * Fields this door CANNOT reproduce from a local file, with how many nodes
   * each affected. Reported rather than left implicit: the plan's bar is that
   * known-lossy fields are named, never silently degraded.
   */
  lossyFields: Array<{ field: string; count: number; why: string }>;
  /**
   * Nodes that could not be read cleanly. One bad node no longer fails the
   * whole file (#155 §5): it is degraded where there is a safe degradation and
   * named here so the importer can print it. Bounded to `MAX_NODE_ERRORS`
   * entries; `nodeErrorCount` is the true total.
   */
  nodeErrors: Array<{ nodeId: string; type: string; message: string }>;
  nodeErrorCount: number;
  /** Component instances expanded to their component's children (#155 §6), and why any were not. */
  instances: InstanceReport;
}

export interface InstanceReport {
  expanded: number;
  /** Skipped: the component (transitively) contains an instance of itself. */
  cycle: number;
  /** Skipped or cut short: expanding would pass the node or depth cap. */
  budget: number;
  /** Skipped: the component the instance names is not in the file. */
  missing: number;
  /**
   * Expanded, but the instance is a different size from its component: the
   * children keep the component's own layout (the file's per-instance layout
   * pass is not replayed), so they may not fill or fit the instance.
   */
  resized: number;
}

/** Cap on the itemised node-error list — a hostile file cannot grow the report. */
export const MAX_NODE_ERRORS = 100;

export interface FigDecodeResult {
  document: NormalizedDocument;
  report: FigDecodeReport;
  /**
   * Vector geometry the archive carries, by node id. Kept OUT of the normalized
   * tree on purpose: REST has no equivalent, so putting it there would make the
   * Tier-2 differential diverge for a field the REST door cannot produce. The
   * local importer reads this to build SVGs without asking Figma to render.
   */
  vectors: Map<string, VectorPath>;
}

function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function decompress(chunk: Uint8Array, kind: 'schema' | 'data', max: number): Uint8Array {
  try {
    // maxOutputLength is enforced BY the codec, so a bomb never allocates
    // (DDR-221 D4, measured: a 28 533:1 zstd bomb throws instead of expanding).
    return kind === 'schema'
      ? inflateRawSync(chunk, { maxOutputLength: max })
      : zstdDecompressSync(chunk, { maxOutputLength: max });
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new FigDecodeError(`the ${kind} chunk decompresses past the ${max}-byte limit`);
    }
    throw new FigDecodeError(
      kind === 'schema'
        ? 'the schema chunk is not raw-deflate data'
        : 'the data chunk is not zstd data'
    );
  }
}

/**
 * Read `canvas.fig`'s framing. Every failure here refuses the file and names
 * the observed value, so diagnosis is one line rather than an afternoon.
 */
export function readFigContainer(bytes: Uint8Array): FigContainer {
  if (bytes.length > MAX_CANVAS_FIG_BYTES) {
    throw new FigDecodeError(
      `canvas.fig is ${bytes.length} bytes, over the ${MAX_CANVAS_FIG_BYTES}-byte limit`
    );
  }
  if (bytes.length < 12)
    throw new FigDecodeError('canvas.fig is too short to be a Figma container');

  const prelude = new TextDecoder('latin1').decode(bytes.subarray(0, 8));
  const surface = PRELUDES[prelude];
  if (!surface) {
    // The observed bytes are attacker-chosen; hex keeps them inert in a report.
    const hex = Array.from(bytes.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join(' ');
    throw new FigDecodeError(`unrecognised Figma container prelude (bytes: ${hex})`);
  }

  // Read, reported, NOT gated — see OBSERVED_CONTAINER_VERSIONS for why the
  // allowlist was removed. Structure gates; the integer does not.
  const version = u32le(bytes, 8);

  const chunks: Uint8Array[] = [];
  let offset = 12;
  while (offset + 4 <= bytes.length) {
    const len = u32le(bytes, offset);
    offset += 4;
    if (offset + len > bytes.length) {
      throw new FigDecodeError(
        `chunk ${chunks.length} declares ${len} bytes past the end of canvas.fig`
      );
    }
    chunks.push(bytes.subarray(offset, offset + len));
    offset += len;
    if (chunks.length > MAX_CHUNKS) {
      throw new FigDecodeError(`canvas.fig declares more than ${MAX_CHUNKS} chunks`);
    }
  }

  if (chunks.length !== 2) {
    throw new FigDecodeError(`canvas.fig has ${chunks.length} chunks, expected exactly 2`);
  }
  if (offset !== bytes.length) {
    throw new FigDecodeError(`canvas.fig has ${bytes.length - offset} trailing bytes`);
  }

  // The zstd magic is checked up front so a swapped chunk order refuses with a
  // clear message instead of a confusing inflate failure.
  const d = chunks[1];
  if (!(d.length >= 4 && d[0] === 0x28 && d[1] === 0xb5 && d[2] === 0x2f && d[3] === 0xfd)) {
    throw new FigDecodeError('the data chunk is missing its zstd magic');
  }

  return {
    surface,
    prelude,
    version,
    schema: decompress(chunks[0], 'schema', MAX_SCHEMA_BYTES),
    data: decompress(chunks[1], 'data', MAX_DATA_BYTES),
    schemaSha256: createHash('sha256').update(chunks[0]).digest('hex'),
  };
}

// ── Tree reconstruction ─────────────────────────────────────────────────────

interface Matrix {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

const IDENTITY: Matrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/**
 * ABSENT is not the same as NaN. A missing `transform` legitimately means the
 * identity, but a component that is PRESENT and non-finite is a crafted or
 * corrupt file: defaulting it to the identity yields plausible-but-wrong
 * geometry with no error signal, which is the exact failure D3 exists to
 * prevent (and the same shape as the A4 float trap). Refuse instead.
 */
function component(v: unknown, fallback: number, name: string): number {
  if (v === undefined) return fallback;
  const n = num(v);
  if (n === undefined)
    throw new FigDecodeError(`transform component ${name} is not a finite number`);
  return n;
}

function matrixOf(v: unknown): Matrix {
  const m = obj(v);
  if (!m) return IDENTITY;
  return {
    m00: component(m.m00, 1, 'm00'),
    m01: component(m.m01, 0, 'm01'),
    m02: component(m.m02, 0, 'm02'),
    m10: component(m.m10, 0, 'm10'),
    m11: component(m.m11, 1, 'm11'),
    m12: component(m.m12, 0, 'm12'),
  };
}

function compose(p: Matrix, c: Matrix): Matrix {
  return {
    m00: p.m00 * c.m00 + p.m01 * c.m10,
    m01: p.m00 * c.m01 + p.m01 * c.m11,
    m02: p.m00 * c.m02 + p.m01 * c.m12 + p.m02,
    m10: p.m10 * c.m00 + p.m11 * c.m10,
    m11: p.m10 * c.m01 + p.m11 * c.m11,
    m12: p.m10 * c.m02 + p.m11 * c.m12 + p.m12,
  };
}

/**
 * `.fig` geometry is a parent-relative affine transform plus a size; REST
 * reports an absolute axis-aligned box. Composing down the parent chain is one
 * of the two places the two doors can legitimately disagree, so it is also one
 * of the two things the Tier-2 differential exists to check (DDR-221 A3).
 */
function absoluteBox(m: Matrix, w: number, h: number) {
  const xs = [m.m02, m.m00 * w + m.m02, m.m01 * h + m.m02, m.m00 * w + m.m01 * h + m.m02];
  const ys = [m.m12, m.m10 * w + m.m12, m.m11 * h + m.m12, m.m10 * w + m.m11 * h + m.m12];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function guidOf(v: unknown): string | undefined {
  const g = obj(v);
  if (!g) return undefined;
  const s = num(g.sessionID);
  const l = num(g.localID);
  return s === undefined || l === undefined ? undefined : `${s}:${l}`;
}

/**
 * Map ONE decoded `NodeChange` onto REST-shaped fields.
 *
 * Reads a HARDCODED list of field names and never iterates the decoded
 * object's own keys (DDR-221 A8/F5) — field names come from the attacker's
 * schema, so a generic copy would let them choose which REST field each value
 * lands in (`absoluteBoundingBox`, `characters`, `children`).
 */
/**
 * `.fig` carries Figma's INTERNAL node vocabulary; REST reports the public one,
 * and the translators are written against REST. Measured by the Tier-2
 * differential on the fixtures — the unit tests could not have found this,
 * because both sides of an internal-vocabulary mismatch look perfectly valid.
 *
 * A GROUP is internally a FRAME with `resizeToFit` (shrink-wrap to children);
 * that flag is the discriminator, 5/5 on the design fixture and 1/1 on the
 * board. `ROUNDED_RECTANGLE` collapses to `RECTANGLE` (the radius survives in
 * `cornerRadius`), and `SYMBOL` is Figma's internal name for a `COMPONENT`.
 */
function restType(change: Record<string, unknown>): string | undefined {
  const type = str(change.type);
  if (type === 'FRAME' && change.resizeToFit === true) return 'GROUP';
  if (type === 'ROUNDED_RECTANGLE') return 'RECTANGLE';
  if (type === 'SYMBOL') return 'COMPONENT';
  return type;
}

/**
 * Pull a FigJam node's text out of its template overrides. Reads only the
 * hardcoded `nodeGenerationData.overrides[].textData.characters` path (A8/F5) —
 * the override list is attacker-controlled, so it is walked, never spread — and
 * takes the first entry that carries characters, which is what REST reports as
 * the node's own `characters`.
 */
/**
 * `.fig` identifies an image fill by a 20-byte `image.hash`; REST calls the same
 * thing `imageRef` and states it as hex. Measured on a real export: the hex IS
 * the archive entry name (`images/<hex>`), which is what makes D6's "images
 * travel inside the file" resolvable with no network at all.
 *
 * Only that one field is added — the paint is otherwise passed through for
 * `normalizeDocument` to sanitize, exactly like the REST door's paints.
 */
function toRestPaint(paint: unknown): unknown {
  const p = obj(paint);
  if (p && Array.isArray(p.stops) && p.gradientStops === undefined) return toRestGradient(p);
  if (!p || p.imageRef !== undefined) return paint;
  const hash = obj(p.image)?.hash;
  if (!Array.isArray(hash) || hash.length === 0 || hash.length > 64) return paint;
  let hex = '';
  for (const byte of hash) {
    const n = num(byte);
    if (n === undefined || n < 0 || n > 255 || !Number.isInteger(n)) return paint;
    hex += n.toString(16).padStart(2, '0');
  }
  return { ...p, imageRef: hex };
}

/**
 * A `.fig` gradient paint -> the REST one. `.fig` says `stops` + a `transform`
 * (node box -> gradient space); REST says `gradientStops` + three handle points
 * in the node's own normalised box. The CSS lane reads the REST shape, so
 * without this a `.fig` gradient reached the vector geometry but never the
 * rectangle's `background` (#155 §4).
 *
 * The handles are gradient-space anchors carried back through
 * `inverse(transform)`: linear = start / end / width, the rest = centre /
 * x-radius / y-radius. A singular transform yields no handles (stops only), so
 * the mapper falls back to a box-centred gradient rather than a guessed angle.
 */
function toRestGradient(p: Record<string, unknown>): Record<string, unknown> {
  const { stops, transform, ...rest } = p;
  const out: Record<string, unknown> = { ...rest, gradientStops: stops };
  const t = obj(transform);
  const m00 = num(t?.m00) ?? 1;
  const m01 = num(t?.m01) ?? 0;
  const m02 = num(t?.m02) ?? 0;
  const m10 = num(t?.m10) ?? 0;
  const m11 = num(t?.m11) ?? 1;
  const m12 = num(t?.m12) ?? 0;
  const det = m00 * m11 - m01 * m10;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return out;
  const linear = str(p.type) === 'GRADIENT_LINEAR';
  const anchors = linear
    ? [
        [0, 0.5],
        [1, 0.5],
        [0, 1],
      ]
    : [
        [0.5, 0.5],
        [1, 0.5],
        [0.5, 1],
      ];
  const round = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
  const handles = anchors.map(([gx, gy]) => ({
    x: round((m11 * gx - m01 * gy + (m01 * m12 - m11 * m02)) / det),
    y: round((-m10 * gx + m00 * gy + (m10 * m02 - m00 * m12)) / det),
  }));
  if (handles.every((h) => Number.isFinite(h.x) && Number.isFinite(h.y))) {
    out.gradientHandlePositions = handles;
  }
  return out;
}

function overrides(change: Record<string, unknown>): unknown[] {
  const list = obj(change.nodeGenerationData)?.overrides;
  return Array.isArray(list) ? list : [];
}

/**
 * First override carrying `key`. The template's own root comes first, so this
 * resolves to the node's own paint/text rather than a sub-part's.
 *
 * The ordering is an OBSERVED property, not a documented one — which is exactly
 * why the Tier-3 comparison is the guard: if Figma ever reorders these, the
 * translator diff against REST fails loudly instead of quietly picking the
 * wrong colour. Only hardcoded keys are read (A8/F5).
 */
function fromOverrides(change: Record<string, unknown>, key: string): unknown {
  for (const entry of overrides(change)) {
    const value = obj(entry)?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function overrideText(change: Record<string, unknown>): string | undefined {
  for (const entry of overrides(change)) {
    const characters = str(obj(obj(entry)?.textData)?.characters);
    if (characters !== undefined) return characters;
  }
  return undefined;
}

function toRestNode(
  change: Record<string, unknown>,
  absolute: Matrix,
  lossy: { lineHeights: number }
): Record<string, unknown> {
  const size = obj(change.size);
  const w = num(size?.x) ?? 0;
  const h = num(size?.y) ?? 0;

  const raw: Record<string, unknown> = {
    id: guidOf(change.guid),
    type: restType(change),
    name: str(change.name) ?? '',
    visible: change.visible !== false,
    absoluteBoundingBox: absoluteBox(absolute, w, h),
  };

  const opacity = num(change.opacity);
  if (opacity !== undefined) raw.opacity = opacity;
  const blend = str(change.blendMode);
  if (blend) raw.blendMode = blend;
  const cornerRadius = num(change.cornerRadius);
  if (cornerRadius !== undefined) raw.cornerRadius = cornerRadius;
  const strokeWeight = num(change.strokeWeight);
  if (strokeWeight !== undefined) raw.strokeWeight = strokeWeight;
  // A FigJam STICKY / SHAPE_WITH_TEXT is a template instance: its own paint is
  // an override, not a top-level field. Reading only the top level left every
  // board node on the translator's default colour (found by Tier 3).
  const fills = change.fillPaints ?? fromOverrides(change, 'fillPaints');
  if (Array.isArray(fills)) raw.fills = fills.map(toRestPaint);
  const strokes = change.strokePaints ?? fromOverrides(change, 'strokePaints');
  if (Array.isArray(strokes)) raw.strokes = strokes;
  if (Array.isArray(change.effects)) raw.effects = change.effects;

  // Auto-layout. `.fig` calls it `stack*`; REST calls it `layout*`.
  const stackMode = str(change.stackMode);
  if (stackMode === 'HORIZONTAL' || stackMode === 'VERTICAL') {
    raw.layoutMode = stackMode;
    const spacing = num(change.stackSpacing);
    if (spacing !== undefined) raw.itemSpacing = spacing;
    const hPad = num(change.stackHorizontalPadding);
    const vPad = num(change.stackVerticalPadding);
    if (hPad !== undefined) {
      raw.paddingLeft = hPad;
      raw.paddingRight = hPad;
    }
    if (vPad !== undefined) {
      raw.paddingTop = vPad;
      raw.paddingBottom = vPad;
    }
    const primary = str(change.stackPrimaryAlignItems);
    if (primary) raw.primaryAxisAlignItems = primary;
    const counter = str(change.stackCounterAlignItems);
    if (counter) raw.counterAxisAlignItems = counter;
  }

  // Text. Two storage locations, and the second one is not optional:
  //  - a design-file TEXT node carries `textData.characters` directly;
  //  - a FigJam STICKY / SHAPE_WITH_TEXT is an instance of an internal
  //    template, and its text is an OVERRIDE on a sub-node, under
  //    `nodeGenerationData.overrides[].textData.characters`.
  // Missing the second path lost the text of every sticky and every shape on
  // the board while the tree still looked perfect — found by the Tier-2
  // differential (20 nodes), invisible to every unit test.
  const characters = str(obj(change.textData)?.characters) ?? overrideText(change);
  if (characters !== undefined) raw.characters = characters;
  const fontSize = num(change.fontSize);
  const fontName = obj(change.fontName);
  if (fontSize !== undefined || fontName || characters !== undefined) {
    // `.fig` encodes typography sparsely and semantically; REST reports it
    // resolved. Three deltas, all found by the Tier-3 translator comparison:
    //  - weight lives in the font STYLE name ("Bold"), not a number — reuse the
    //    codegen lane's map rather than keeping a second one;
    //  - a default alignment is OMITTED, where REST always states it;
    //  - lineHeight is authored ({value, units}), and REST reports the RESOLVED
    //    pixel value. A PERCENT line-height cannot be resolved to px without
    //    font metrics we do not have offline, so it is carried only when the
    //    file already states pixels. This is the local door's one genuinely
    //    lossy typography field and it is asserted as lossy in the Tier-3 test.
    const lineHeight = obj(change.lineHeight);
    const lineHeightPx = str(lineHeight?.units) === 'PIXELS' ? num(lineHeight?.value) : undefined;
    if (lineHeight && lineHeightPx === undefined) lossy.lineHeights++;
    raw.style = {
      fontSize,
      fontFamily: str(fontName?.family),
      fontPostScriptName: str(fontName?.postscript),
      fontWeight: styleToWeight(str(fontName?.style) ?? null) ?? undefined,
      textAlignHorizontal: str(change.textAlignHorizontal) ?? 'LEFT',
      ...(lineHeightPx !== undefined ? { lineHeightPx } : {}),
    };
  }

  // FigJam.
  const shapeType = str(change.shapeWithTextType);
  if (shapeType) raw.shapeType = shapeType;
  // REST wraps an endpoint as `{ endpointNodeId }` (lowercase d) and the
  // normalizer unwraps it; `.fig` carries a GUID struct under `endpointNodeID`
  // (uppercase D). Emit REST's shape so the SHARED normalizer resolves it —
  // handing it a bare string silently yields an unbound connector.
  const start = guidOf(obj(change.connectorStart)?.endpointNodeID);
  if (start) raw.connectorStart = { endpointNodeId: start };
  const end = guidOf(obj(change.connectorEnd)?.endpointNodeID);
  if (end) raw.connectorEnd = { endpointNodeId: end };
  const startCap = str(change.connectorStartCap);
  if (startCap) raw.connectorStartCap = startCap;
  const endCap = str(change.connectorEndCap);
  if (endCap) raw.connectorEndCap = endCap;
  const lineStyle = str(change.connectorLineStyle);
  if (lineStyle) raw.connectorLineType = lineStyle;

  return raw;
}

/**
 * A PERCENT line-height cannot be resolved to pixels without font metrics, and
 * REST reports the resolved value. Counted per node so the import summary can
 * say so out loud (the only lossy typography field — Tier 3 asserts it is).
 */
const LOSSY_LINE_HEIGHT = {
  field: 'style.lineHeightPx',
  why: 'a percent line-height needs font metrics the local file does not carry',
};

/**
 * Read one node's own path geometry, if it has any.
 *
 * A decode failure DEGRADES to "no vector" rather than refusing the document:
 * a single unreadable icon should not cost the whole import, and the caller
 * reports the absence. That is the one place the fail-loud rule bends, and it
 * bends toward reporting rather than toward guessing at the shape.
 */
function vectorOf(change: Record<string, unknown>, blobs: readonly unknown[]): VectorPath | null {
  const geometry = change.fillGeometry;
  if (!Array.isArray(geometry) || geometry.length === 0) return null;
  const first = obj(geometry[0]);
  const index = num(first?.commandsBlob);
  if (index === undefined || index < 0 || index >= blobs.length) return null;

  const raw = obj(blobs[index])?.bytes;
  const bytes =
    raw instanceof Uint8Array ? raw : Array.isArray(raw) ? Uint8Array.from(raw as number[]) : null;
  if (!bytes) return null;

  let d: string;
  try {
    d = pathFromBlob(bytes);
  } catch {
    return null;
  }

  // The first visible SOLID or GRADIENT fill. A gradient used to be skipped, so
  // a gradient blob collapsed to no fill at all (#155 §10).
  const paint = (Array.isArray(change.fillPaints) ? change.fillPaints : []).find((p) => {
    const t = str(obj(p)?.type);
    return (t === 'SOLID' || (t?.startsWith('GRADIENT_') ?? false)) && obj(p)?.visible !== false;
  });
  const gradient = gradientOf(obj(paint), obj(change.size));
  const colour = obj(obj(paint)?.color);
  const hex = (c: Record<string, unknown> | undefined): string | null =>
    c === undefined
      ? null
      : `#${(['r', 'g', 'b'] as const)
          .map((k) => {
            const v = num(c[k]) ?? 0;
            return Math.max(0, Math.min(255, Math.round(v * 255)))
              .toString(16)
              .padStart(2, '0');
          })
          .join('')}`;

  return {
    d,
    // A gradient owns the fill; an ANGULAR one (no SVG equivalent) falls back
    // to its first stop rather than to nothing.
    fill: gradient
      ? null
      : str(obj(paint)?.type) === 'SOLID'
        ? hex(colour)
        : hex(obj(obj((obj(paint)?.stops as unknown[] | undefined)?.[0])?.color)),
    ...(gradient ? { gradient } : {}),
    fillOpacity: num(obj(paint)?.opacity) ?? 1,
    fillRule: str(first?.windingRule) === 'EVENODD' ? 'evenodd' : 'nonzero',
    x: 0,
    y: 0,
  };
}

/**
 * A `.fig` gradient paint -> `VectorGradient`. `stops` (REST: `gradientStops`)
 * and `transform` are the file's own names; `transform` maps the node's
 * normalised box into gradient space, so `diag(size) * inverse(transform)`
 * carries gradient space back to the node. LINEAR and RADIAL map exactly;
 * DIAMOND is drawn as a radial one (the nearest SVG has); ANGULAR has no SVG
 * equivalent and returns null. A singular transform also returns null, since
 * guessing an orientation would draw a plausible wrong gradient.
 */
function gradientOf(
  paint: Record<string, unknown> | undefined,
  size: Record<string, unknown> | undefined
): VectorGradient | null {
  const type = str(paint?.type);
  const kind =
    type === 'GRADIENT_LINEAR'
      ? 'linear'
      : type === 'GRADIENT_RADIAL' || type === 'GRADIENT_DIAMOND'
        ? 'radial'
        : null;
  if (!kind || !Array.isArray(paint?.stops)) return null;

  const stops: VectorGradient['stops'] = [];
  for (const raw of (paint.stops as unknown[]).slice(0, 32)) {
    const st = obj(raw);
    const c = obj(st?.color);
    const position = num(st?.position);
    if (!c || position === undefined) continue;
    const channel = (k: string) =>
      Math.max(0, Math.min(255, Math.round((num(c[k]) ?? 0) * 255)))
        .toString(16)
        .padStart(2, '0');
    stops.push({
      offset: Math.max(0, Math.min(1, position)),
      color: `#${channel('r')}${channel('g')}${channel('b')}`,
      opacity: Math.max(0, Math.min(1, num(c.a) ?? 1)),
    });
  }
  if (stops.length < 2) return null;

  const t = obj(paint?.transform);
  const m = {
    m00: num(t?.m00) ?? 1,
    m01: num(t?.m01) ?? 0,
    m02: num(t?.m02) ?? 0,
    m10: num(t?.m10) ?? 0,
    m11: num(t?.m11) ?? 1,
    m12: num(t?.m12) ?? 0,
  };
  const det = m.m00 * m.m11 - m.m01 * m.m10;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  // inverse(transform): gradient space -> normalised box.
  const ia = m.m11 / det;
  const ic = -m.m01 / det;
  const ib = -m.m10 / det;
  const id = m.m00 / det;
  const ie = (m.m01 * m.m12 - m.m11 * m.m02) / det;
  const iff = (m.m10 * m.m02 - m.m00 * m.m12) / det;
  const w = num(size?.x) ?? 0;
  const h = num(size?.y) ?? 0;
  if (w <= 0 || h <= 0) return null;
  // diag(size) * that: normalised box -> node space.
  // `+ 0` folds a -0 (from negating a zero) into 0.
  const matrix = [ia * w, ib * h, ic * w, id * h, ie * w, iff * h].map(
    (v) => v + 0
  ) as VectorGradient['matrix'];
  if (!matrix.every(Number.isFinite)) return null;
  return { kind, stops, matrix };
}

export interface RebuildResult {
  root: Record<string, unknown>;
  unmapped: Map<string, number>;
  internalSkipped: number;
  nodeCount: number;
  lossyLineHeights: number;
  vectors: Map<string, VectorPath>;
  nodeErrors: Array<{ nodeId: string; type: string; message: string }>;
  nodeErrorCount: number;
  instances: InstanceReport;
}

/**
 * Rebuild the tree from `parentIndex`. A `.fig` is a FLAT `nodeChanges[]`, not
 * a nested document (DDR-221 A3), and this reconstruction is a SECOND recursion
 * that the Kiwi decode-depth cap does not bound (A8/F4) — hence the explicit
 * cycle, duplicate, orphan and single-root controls here.
 */
export function rebuildTree(changes: unknown[], blobs: readonly unknown[]): RebuildResult {
  if (changes.length > MAX_NODE_COUNT) {
    throw new FigDecodeError(
      `file carries ${changes.length} nodes, over the ${MAX_NODE_COUNT} limit. Import a specific frame instead.`
    );
  }

  const byId = new Map<string, Record<string, unknown>>();
  const order: string[] = [];

  for (const entry of changes) {
    const change = obj(entry);
    if (!change) throw new FigDecodeError('a node change is not an object');
    const id = guidOf(change.guid);
    if (!id) throw new FigDecodeError('a node change has no usable guid');
    if (byId.has(id)) throw new FigDecodeError(`duplicate node guid ${id}`);
    // Internal-only nodes are NOT removed here. Dropping them before parentage
    // is resolved would orphan their children and refuse a legitimate file —
    // the fixtures' internal canvas happens to be childless, which is why this
    // looked safe. They are pruned as whole subtrees during the walk instead.
    byId.set(id, change);
    order.push(id);
  }

  const childIds = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of order) {
    const change = byId.get(id) as Record<string, unknown>;
    const parentIndex = obj(change.parentIndex);
    const parent = guidOf(parentIndex?.guid);
    if (parent === undefined) {
      roots.push(id);
      continue;
    }
    if (parent === id) throw new FigDecodeError(`node ${id} is its own parent`);
    if (!byId.has(parent)) {
      // Not silently dropped: an orphan means we misread the file or the file
      // is crafted, and either way a partial tree is the wrong outcome.
      throw new FigDecodeError(`node ${id} references parent ${parent}, which is not in the file`);
    }
    const siblings = childIds.get(parent);
    if (siblings) siblings.push(id);
    else childIds.set(parent, [id]);
  }

  if (roots.length !== 1) {
    throw new FigDecodeError(`file has ${roots.length} root nodes, expected exactly 1`);
  }

  // Fractional-index ordering. Plain comparison, not `localeCompare`: the
  // strings are attacker-controlled and locale collation on 20k items is both
  // slow and locale-dependent.
  for (const siblings of childIds.values()) {
    siblings.sort((a, b) => {
      const pa = str(obj(byId.get(a)?.parentIndex)?.position) ?? '';
      const pb = str(obj(byId.get(b)?.parentIndex)?.position) ?? '';
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
  }

  const unmapped = new Map<string, number>();
  const onStack = new Set<string>();
  const vectors = new Map<string, VectorPath>();
  const lossy = { lineHeights: 0 };
  const nodeErrors: RebuildResult['nodeErrors'] = [];
  let nodeErrorCount = 0;
  let nodeCount = 0;
  let internalSkipped = 0;

  /** Count a pruned internal subtree so the report says how much was dropped. */
  const countSubtree = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    let n = 1;
    for (const kid of childIds.get(id) ?? []) n += countSubtree(kid, seen);
    return n;
  };

  // ── INSTANCE expansion (#155 §6) ──
  //
  // An INSTANCE has no children in the file: it names a SYMBOL, and the symbol's
  // children are what it draws. They are rebuilt under the instance with ids
  // `I<instance>;<child>` (REST's own convention for a node inside an instance).
  // Three controls bound it: a symbol already being expanded is a CYCLE and is
  // skipped (A contains B contains A would otherwise recurse forever); the whole
  // tree stays under the node cap, so a file with thousands of instances
  // degrades instead of failing; and every skip is counted for the report.
  const instances = { expanded: 0, cycle: 0, budget: 0, missing: 0, resized: 0 };
  const expanding: string[] = [];
  /**
   * Headroom below the cap: the normalizer counts the same nodes and refuses
   * past MAX_NODE_COUNT. Every ORIGINAL node is reserved up front (`changes`),
   * so an early instance cannot starve the nodes still to come into a refusal.
   */
  const NODE_BUDGET = MAX_NODE_COUNT - 16;
  let expandedNodes = 0;
  const descendantMemo = new Map<string, number>();
  /** Nodes under a component, nested instances not counted (they check their own budget). */
  const descendantsOf = (symbolId: string): number => {
    const known = descendantMemo.get(symbolId);
    if (known !== undefined) return known;
    let n = 0;
    const stack = [...(childIds.get(symbolId) ?? [])];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      n++;
      stack.push(...(childIds.get(next) ?? []));
    }
    descendantMemo.set(symbolId, n);
    return n;
  };
  const DEPTH_BUDGET = MAX_TREE_DEPTH - 2;

  interface Expansion {
    /** The id a child gets before its own: `I2:14`, then `I2:14;5:5` for a nested instance. */
    prefix: string;
    /** Original-id path from the outermost instance down to the node being built. */
    path: string[];
    /** Overrides by path from the outermost instance. */
    overrides: Map<string, Record<string, unknown>>;
  }

  /**
   * The fields an instance override may change — a HARDCODED list (A8/F5): the
   * override object is the file's, so its keys never choose what they touch.
   */
  const OVERRIDE_FIELDS = [
    'textData',
    'fillPaints',
    'strokePaints',
    'effects',
    'visible',
    'opacity',
    'fontSize',
    'fontName',
    'lineHeight',
    'textAlignHorizontal',
  ] as const;

  const pathKey = (path: readonly string[]) => path.join('/');

  const overridesOf = (
    change: Record<string, unknown>,
    base: readonly string[],
    into: Map<string, Record<string, unknown>>
  ) => {
    const list = obj(change.symbolData)?.symbolOverrides;
    if (!Array.isArray(list)) return;
    for (const entry of list.slice(0, 5000)) {
      const o = obj(entry);
      const guids = obj(o?.guidPath)?.guids;
      if (!o || !Array.isArray(guids) || guids.length === 0 || guids.length > 16) continue;
      const rel = guids.map(guidOf);
      if (rel.some((x) => x === undefined)) continue;
      const key = pathKey([...base, ...(rel as string[])]);
      // The outer instance's override beats the inner one's own.
      if (!into.has(key)) into.set(key, o);
    }
  };

  const withOverride = (
    change: Record<string, unknown>,
    override: Record<string, unknown> | undefined
  ): Record<string, unknown> => {
    if (!override) return change;
    const merged = { ...change };
    for (const field of OVERRIDE_FIELDS) {
      if (override[field] !== undefined) merged[field] = override[field];
    }
    return merged;
  };

  const build = (
    id: string,
    parentAbsolute: Matrix,
    depth: number,
    x?: Expansion
  ): Record<string, unknown> => {
    // The id this node carries in the output: inside an instance it is the
    // instance's path. Cycle detection keys on it, because the SAME original
    // node is legitimately built once per instance.
    const outId = x ? `${x.prefix};${id}` : id;
    // Cycle detection. A→B→A would otherwise recurse until the stack dies.
    if (onStack.has(outId)) throw new FigDecodeError(`node parentage forms a cycle at ${id}`);
    onStack.add(outId);

    const original = byId.get(id) as Record<string, unknown>;
    const change = x ? withOverride(original, x.overrides.get(pathKey(x.path))) : original;
    // ONE bad node must not fail the file (#155 §5). An unreadable transform
    // places the node at its parent's origin (the identity) — and says so in
    // `report.nodeErrors`, so it is never the silent plausible-but-wrong
    // placement the old hard refusal existed to prevent.
    let local: Matrix;
    try {
      local = matrixOf(change.transform);
    } catch (err) {
      local = IDENTITY;
      nodeErrorCount++;
      if (nodeErrors.length < MAX_NODE_ERRORS) {
        nodeErrors.push({
          nodeId: id,
          type: reportToken(str(change.type) ?? ''),
          message: String((err as Error).message).slice(0, 200),
        });
      }
    }
    const absolute = compose(parentAbsolute, local);
    const node = toRestNode(change, absolute, lossy);
    if (x) {
      node.id = outId;
      expandedNodes++;
    }
    nodeCount++;

    const art = vectorOf(change, blobs);
    if (art) vectors.set(String(node.id), art);

    const type = node.type;
    if (typeof type !== 'string' || !KNOWN_NODE_TYPES.has(type)) {
      // Vocabulary gap: degrade and report (D3). The raw string is left in
      // place so the SHARED normalizer maps it to 'UNKNOWN' — this door does
      // not get its own opinion about the vocabulary (A5). Only the REPORT
      // label is produced here, and it is BOUNDED because the type name comes
      // from the attacker's schema (A8/F1).
      // `reportToken`, NOT `attrValue`: attrValue maps rejected characters to
      // SPACES, so a 32-char bound still yields readable prose — measured, the
      // test for this control failed against attrValue first. One token, no
      // spaces, or the fixed word `unrecognized`.
      const label = reportToken(typeof type === 'string' ? type : '');
      unmapped.set(label, (unmapped.get(label) ?? 0) + 1);
    }

    // A component being built in place is "being expanded" too: an instance of
    // it inside itself is a cycle.
    const isSymbol = str(original.type) === 'SYMBOL';
    if (isSymbol && !x) expanding.push(id);

    const buildKids = (parentId: string, ex?: Expansion) => {
      const kept: Array<Record<string, unknown>> = [];
      for (const kid of childIds.get(parentId) ?? []) {
        // Prune Figma's internal-only nodes as WHOLE SUBTREES here, where the
        // parentage is already resolved, rather than dropping them up front.
        if (byId.get(kid)?.internalOnly === true) {
          internalSkipped += countSubtree(kid, new Set());
          continue;
        }
        if (ex) {
          // Expansions respect the budget at every node, so a deep or wide
          // component cannot run past the cap the normalizer enforces.
          if (expandedNodes + changes.length >= NODE_BUDGET || depth + 1 > DEPTH_BUDGET) {
            instances.budget++;
            continue;
          }
          kept.push(build(kid, absolute, depth + 1, { ...ex, path: [...ex.path, kid] }));
        } else {
          kept.push(build(kid, absolute, depth + 1));
        }
      }
      return kept;
    };

    const kids = childIds.get(id);
    if (kids?.length) {
      const kept = buildKids(id, x ? { ...x } : undefined);
      if (kept.length > 0) node.children = kept;
    } else if (str(original.type) === 'INSTANCE') {
      const symbolId = guidOf(obj(original.symbolData)?.symbolID);
      const symbol = symbolId === undefined ? undefined : byId.get(symbolId);
      if (symbolId === undefined || !symbol) {
        instances.missing++;
      } else if (expanding.includes(symbolId)) {
        instances.cycle++;
      } else if (
        depth + 1 > DEPTH_BUDGET ||
        expandedNodes + descendantsOf(symbolId) + changes.length > NODE_BUDGET
      ) {
        instances.budget++;
      } else {
        const overrides = new Map(x?.overrides ?? []);
        const here = x ? [...x.path] : [];
        overridesOf(change, here, overrides);
        expanding.push(symbolId);
        const kept = buildKids(symbolId, {
          // REST's spelling: `I<instance>;<child>`, and nested instances extend it.
          prefix: x ? outId : `I${outId}`,
          path: here,
          overrides,
        });
        expanding.pop();
        instances.expanded++;
        const isz = obj(original.size);
        const ssz = obj(symbol.size);
        if (
          Math.abs((num(isz?.x) ?? 0) - (num(ssz?.x) ?? 0)) > 0.5 ||
          Math.abs((num(isz?.y) ?? 0) - (num(ssz?.y) ?? 0)) > 0.5
        ) {
          instances.resized++;
        }
        if (kept.length > 0) node.children = kept;
      }
    }

    if (isSymbol && !x) expanding.pop();
    onStack.delete(outId);
    return node;
  };

  if (byId.get(roots[0])?.internalOnly === true) {
    throw new FigDecodeError('the document root is marked internal-only');
  }
  const root = build(roots[0], IDENTITY, 0);
  return {
    root,
    unmapped,
    internalSkipped,
    nodeCount,
    lossyLineHeights: lossy.lineHeights,
    vectors,
    nodeErrors,
    nodeErrorCount,
    instances,
  };
}

// ── The door ────────────────────────────────────────────────────────────────

export interface DecodeFigOptions {
  /** Charset-validated upstream. Provenance only — never derived from the file. */
  fileKey: string;
}

/**
 * Decode a `.fig` / `.jam` archive into the normalized tree both doors share.
 */
export function decodeFigArchive(archive: Uint8Array, opts: DecodeFigOptions): FigDecodeResult {
  // Both the directory parse AND the lazy per-entry read can refuse, and a
  // caller of this door should only ever have to catch FigDecodeError. Wrapping
  // just the first call let a FigZipError escape from `get()` — caught by the
  // fuzz corpus, which is exactly the class of leak it exists to find.
  let zip: ReturnType<typeof readFigZip>;
  let canvas: Uint8Array | undefined;
  try {
    zip = readFigZip(archive);
    canvas = zip.get(CANVAS_ENTRY);
  } catch (err) {
    if (err instanceof FigZipError) throw new FigDecodeError(err.message);
    throw err;
  }

  if (!canvas) throw new FigDecodeError(`archive has no ${CANVAS_ENTRY} entry`);

  const container = readFigContainer(canvas);

  let schema: KiwiSchema;
  let message: Record<string, unknown> | undefined;
  try {
    schema = parseKiwiSchema(container.schema);
    const rootIndex = findRootDefinition(schema, 'Message', 'nodeChanges', 'NodeChange');
    message = obj(decodeKiwi(container.data, schema, rootIndex));
  } catch (err) {
    throw new FigDecodeError(`could not decode canvas.fig: ${(err as Error).message}`);
  }

  const changes = message?.nodeChanges;
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new FigDecodeError('canvas.fig carries no node changes');
  }

  const blobs = Array.isArray(message?.blobs) ? message.blobs : [];
  const {
    root,
    unmapped,
    internalSkipped,
    nodeCount,
    lossyLineHeights,
    vectors,
    nodeErrors,
    nodeErrorCount,
    instances,
  } = rebuildTree(changes, blobs);

  const document = normalizeDocument(root, {
    fileKey: opts.fileKey,
    surface: container.surface,
    origin: 'fig',
  });

  return {
    document,
    vectors,
    report: {
      containerVersion: container.version,
      containerVersionKnown: OBSERVED_CONTAINER_VERSIONS.has(container.version),
      schemaSha256: container.schemaSha256,
      exportedAt: readExportedAt(safeEntry(zip, META_ENTRY)),
      nodeCount,
      unmappedTypes: [...unmapped.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      internalNodesSkipped: internalSkipped,
      lossyFields: lossyLineHeights > 0 ? [{ ...LOSSY_LINE_HEIGHT, count: lossyLineHeights }] : [],
      nodeErrors,
      nodeErrorCount,
      instances,
    },
  };
}

/**
 * `meta.json` is optional and its bytes are lazily verified, so a corrupt entry
 * must not turn a decodable document into a hard failure — nor let a
 * FigZipError escape this door's error type.
 */
function safeEntry(zip: ReturnType<typeof readFigZip>, name: string): Uint8Array | undefined {
  try {
    return zip.get(name);
  } catch {
    return undefined;
  }
}

/**
 * Read `exported_at` (Tier 4 needs it) and DELIBERATELY DROP `file_name`, which
 * sits in the same object: DDR-216 D7 forbids recording the Figma file NAME
 * anywhere an agent later reads (DDR-221 A6). The REST door never had it to
 * hand; this one must decline it explicitly.
 */
function readExportedAt(metaBytes: Uint8Array | undefined): string | undefined {
  if (!metaBytes) return undefined;
  try {
    const meta = obj(JSON.parse(new TextDecoder().decode(metaBytes)));
    const exportedAt = str(meta?.exported_at);
    if (!exportedAt) return undefined;
    // Bounded and charset-checked: it is untrusted text from the archive.
    return /^[0-9TZ:.-]{1,32}$/.test(exportedAt) ? exportedAt : undefined;
  } catch {
    return undefined;
  }
}
