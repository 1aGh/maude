/**
 * @file       figma/types.ts — the normalized Figma node tree (DDR-216).
 * @scope      apps/studio/figma/types.ts
 * @purpose    The ONE shape both ingestion doors emit and all three translators
 *             consume. `client.ts` (REST, Phase 1) produces it today; a future
 *             `fig-decode.ts` (Phase 6) only has to produce the same shape and
 *             it inherits `to-strokes` / `to-artboard` / `to-tokens` for free.
 *             That seam is also what makes Phase 6's Tier-2 differential smoke
 *             possible at all — the same document through both doors must
 *             normalize to the same tree.
 *
 * @invariant  FIELD NAMES MIRROR THE REST API deliberately. Renaming them into
 *             a prettier house vocabulary would make the Phase-6 decoder's job
 *             "translate twice" instead of "emit this shape", and would make a
 *             differential diff read as a wall of false positives.
 *
 * @invariant  EVERY STRING FROM A DOCUMENT IS UNTRUSTED. `name` and
 *             `characters` in particular: a TEXT node's layer name DEFAULTS to
 *             its own content, so `name` is user text on a real file. They are
 *             carried verbatim through normalization on purpose — sanitization
 *             belongs at the emission sinks (DDR-216 D6), where the target
 *             grammar is known — and are marked UNTRUSTED at every declaration
 *             so nobody interpolates one into JSX, a path or a shell argument
 *             on the way past.
 *
 * @invariant  DEPENDENCY-FREE. No `node:*`, no network, no filesystem — the
 *             normalizer walks an already-parsed object and nothing else.
 */

// ── Caps (DDR-216 D5) ───────────────────────────────────────────────────────
// Pre-translation HARD REFUSALS. Each fails with a clear, actionable message —
// never an OOM, never a truncated best-effort tree. Measured baseline: a real
// first-party page is 449 KB / 4 125 nodes / depth 13 in the metadata-only
// projection, and the full REST payload (fills, strokes, effects, typeStyle per
// node) is materially larger.

/** ~18× the measured real page's metadata projection. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** ~5× the measured 4 125. */
export const MAX_NODE_COUNT = 20_000;
/** ~5× the measured 13. Also bounds every recursive walk structurally. */
export const MAX_TREE_DEPTH = 64;

/** Keys that must never be copied off an untrusted object (DDR-172 Decision 3). */
const POLLUTING_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ── Node vocabulary ─────────────────────────────────────────────────────────

/**
 * The node types both doors can produce. Sourced from the `.fig` container's
 * own embedded schema (`NodeType`, read out of the committed fixtures), so the
 * Phase-6 decoder has nothing to guess and this union needs no widening later.
 */
export type FigmaNodeType =
  | 'DOCUMENT'
  | 'CANVAS'
  | 'FRAME'
  | 'GROUP'
  | 'SECTION'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE'
  | 'VECTOR'
  | 'BOOLEAN_OPERATION'
  | 'STAR'
  | 'LINE'
  | 'ELLIPSE'
  | 'RECTANGLE'
  | 'ROUNDED_RECTANGLE'
  | 'REGULAR_POLYGON'
  | 'TEXT'
  | 'SLICE'
  | 'STICKY'
  | 'SHAPE_WITH_TEXT'
  | 'CONNECTOR'
  | 'CODE_BLOCK'
  | 'WIDGET'
  | 'STAMP'
  | 'TABLE'
  | 'MEDIA'
  | 'EMBED'
  | 'LINK_UNFURL'
  | 'WASHI_TAPE'
  | 'UNKNOWN';

/**
 * Exported so the `.fig` door can tell a vocabulary gap from a mapped type
 * WITHOUT keeping a second copy of the list (DDR-221 D3 degrade-and-report).
 * `nodeType()` below still owns the mapping; this is read-only.
 */
export const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  'DOCUMENT',
  'CANVAS',
  'FRAME',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'LINE',
  'ELLIPSE',
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'REGULAR_POLYGON',
  'TEXT',
  'SLICE',
  'STICKY',
  'SHAPE_WITH_TEXT',
  'CONNECTOR',
  'CODE_BLOCK',
  'WIDGET',
  'STAMP',
  'TABLE',
  'MEDIA',
  'EMBED',
  'LINK_UNFURL',
  'WASHI_TAPE',
]);

export interface FigmaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaPaint {
  type: string; // SOLID | GRADIENT_LINEAR | IMAGE | …
  visible: boolean;
  opacity?: number;
  color?: FigmaColor;
  /** Present on IMAGE paints — the handle `/v1/images` resolves. */
  imageRef?: string;
  gradientStops?: Array<{ position: number; color: FigmaColor }>;
  /** REST: three handles in the node's normalised box — start/centre, end/x-radius, width/y-radius. */
  gradientHandlePositions?: Array<{ x: number; y: number }>;
  blendMode?: string;
}

export interface FigmaEffect {
  type: string; // DROP_SHADOW | INNER_SHADOW | LAYER_BLUR | BACKGROUND_BLUR
  visible: boolean;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

/** Figma's `style` block on a TEXT node. */
export interface FigmaTypeStyle {
  fontFamily?: string; // UNTRUSTED
  fontPostScriptName?: string; // UNTRUSTED
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  textCase?: string;
  textDecoration?: string;
}

/**
 * One normalized node. Optional everywhere by design: both doors see partial
 * documents (a `getFileNodes` projection carries less than `getFile`), and a
 * translator that copes with an absent field copes with both doors.
 */
export interface FigmaNode {
  /** `^[0-9]+:[0-9]+$` in practice — the ONLY string safe to derive an identifier from. */
  id: string;
  type: FigmaNodeType;
  /** UNTRUSTED — a TEXT node's layer name defaults to its own content. */
  name: string;
  /** False ⇒ the node is not emitted at all (DDR-216 D6b). */
  visible: boolean;
  absoluteBoundingBox?: FigmaRect;
  /**
   * What is actually DRAWN — geometry plus stroke weight, arrowheads and
   * effects. Differs from `absoluteBoundingBox` by more than a rounding error
   * on stroked paths: a horizontal arrow's geometric box has height 0.0001
   * while its render bounds are 22.09. Placing such a node at its geometric
   * box renders it into nothing, which is how nine flow arrows imported
   * "successfully" and were invisible.
   */
  absoluteRenderBounds?: FigmaRect;
  rotation?: number;
  opacity?: number;
  blendMode?: string;
  clipsContent?: boolean;

  // ── design-side layout ──
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutWrap?: string;

  // ── paint ──
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  effects?: FigmaEffect[];
  cornerRadius?: number;
  rectangleCornerRadii?: number[];

  // ── text ──
  /** UNTRUSTED — the literal user text. */
  characters?: string;
  style?: FigmaTypeStyle;

  // ── FigJam ──
  shapeType?: string;
  /** A real node id — the shape `ArrowBind.hostId` wants (DDR-216 D9). */
  connectorStart?: string;
  connectorEnd?: string;
  connectorStartCap?: string;
  connectorEndCap?: string;
  connectorLineType?: string;

  // ── component semantics (display-only; no runtime equivalent) ──
  componentId?: string;

  children?: FigmaNode[];
}

/** What either door hands the translators. */
export interface NormalizedDocument {
  /** Charset-validated by `url.ts` — never free text. */
  fileKey: string;
  /** `design` | `board`, from the URL shape or the `.fig` prelude. */
  surface: 'design' | 'board';
  /** Which door produced this — recorded for the Tier-2 differential diff. */
  origin: 'rest' | 'fig';
  root: FigmaNode;
  /** Post-normalization counts, so callers report rather than re-walk. */
  nodeCount: number;
  maxDepth: number;
}

export class FigmaCapError extends Error {
  readonly cap: 'nodes' | 'depth' | 'bytes';
  constructor(cap: 'nodes' | 'depth' | 'bytes', message: string) {
    super(message);
    this.name = 'FigmaCapError';
    this.cap = cap;
  }
}

// ── Normalization ───────────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function rect(v: unknown): FigmaRect | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const x = num(r.x);
  const y = num(r.y);
  const width = num(r.width);
  const height = num(r.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { x, y, width, height };
}

function color(v: unknown): FigmaColor | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const c = v as Record<string, unknown>;
  const r = num(c.r);
  const g = num(c.g);
  const b = num(c.b);
  if (r === undefined || g === undefined || b === undefined) return undefined;
  return { r, g, b, a: num(c.a) ?? 1 };
}

function paints(v: unknown): FigmaPaint[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: FigmaPaint[] = [];
  // Bounded: a node with thousands of paints is not a real node, and this walk
  // runs once per node under MAX_NODE_COUNT.
  for (const item of v.slice(0, 32)) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const type = str(p.type);
    if (!type) continue;
    const entry: FigmaPaint = { type, visible: bool(p.visible, true) };
    const o = num(p.opacity);
    if (o !== undefined) entry.opacity = o;
    const col = color(p.color);
    if (col) entry.color = col;
    const ref = str(p.imageRef);
    if (ref) entry.imageRef = ref;
    const blend = str(p.blendMode);
    if (blend) entry.blendMode = blend;
    if (Array.isArray(p.gradientHandlePositions)) {
      const hs: Array<{ x: number; y: number }> = [];
      for (const h of p.gradientHandlePositions.slice(0, 3)) {
        const hx = num((h as Record<string, unknown> | null)?.x);
        const hy = num((h as Record<string, unknown> | null)?.y);
        if (hx !== undefined && hy !== undefined) hs.push({ x: hx, y: hy });
      }
      if (hs.length >= 2) entry.gradientHandlePositions = hs;
    }
    if (Array.isArray(p.gradientStops)) {
      const stops: Array<{ position: number; color: FigmaColor }> = [];
      for (const s of p.gradientStops.slice(0, 32)) {
        if (!s || typeof s !== 'object') continue;
        const sr = s as Record<string, unknown>;
        const pos = num(sr.position);
        const sc = color(sr.color);
        if (pos !== undefined && sc) stops.push({ position: pos, color: sc });
      }
      if (stops.length) entry.gradientStops = stops;
    }
    out.push(entry);
  }
  return out.length ? out : undefined;
}

function effects(v: unknown): FigmaEffect[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: FigmaEffect[] = [];
  for (const item of v.slice(0, 32)) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const type = str(e.type);
    if (!type) continue;
    const entry: FigmaEffect = { type, visible: bool(e.visible, true) };
    const col = color(e.color);
    if (col) entry.color = col;
    const off = e.offset as Record<string, unknown> | undefined;
    if (off && typeof off === 'object') {
      const ox = num(off.x);
      const oy = num(off.y);
      if (ox !== undefined && oy !== undefined) entry.offset = { x: ox, y: oy };
    }
    const radius = num(e.radius);
    if (radius !== undefined) entry.radius = radius;
    const spread = num(e.spread);
    if (spread !== undefined) entry.spread = spread;
    out.push(entry);
  }
  return out.length ? out : undefined;
}

function typeStyle(v: unknown): FigmaTypeStyle | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = v as Record<string, unknown>;
  const out: FigmaTypeStyle = {};
  const assignStr = (k: keyof FigmaTypeStyle, raw: unknown) => {
    const val = str(raw);
    if (val !== undefined) (out as Record<string, unknown>)[k] = val;
  };
  const assignNum = (k: keyof FigmaTypeStyle, raw: unknown) => {
    const val = num(raw);
    if (val !== undefined) (out as Record<string, unknown>)[k] = val;
  };
  assignStr('fontFamily', s.fontFamily);
  assignStr('fontPostScriptName', s.fontPostScriptName);
  assignNum('fontWeight', s.fontWeight);
  assignNum('fontSize', s.fontSize);
  assignNum('lineHeightPx', s.lineHeightPx);
  assignNum('letterSpacing', s.letterSpacing);
  assignStr('textAlignHorizontal', s.textAlignHorizontal);
  assignStr('textAlignVertical', s.textAlignVertical);
  assignStr('textCase', s.textCase);
  assignStr('textDecoration', s.textDecoration);
  return Object.keys(out).length ? out : undefined;
}

function nodeType(v: unknown): FigmaNodeType {
  const t = str(v);
  return t && KNOWN_NODE_TYPES.has(t) ? (t as FigmaNodeType) : 'UNKNOWN';
}

interface WalkState {
  count: number;
  maxDepth: number;
}

/**
 * Recursively normalize one raw API node.
 *
 * Depth is checked BEFORE descent and the node count BEFORE each node is
 * built, so a document engineered to be deep or wide trips a cap rather than
 * exhausting the stack or the heap. `__proto__`/`constructor`/`prototype` keys
 * are never read off the input — every field is pulled by explicit name, which
 * is a stronger version of the DDR-172 Decision 3 guard: there is no generic
 * key-copy loop here to pollute.
 */
function normalizeNode(raw: unknown, depth: number, state: WalkState): FigmaNode | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (depth > MAX_TREE_DEPTH) {
    throw new FigmaCapError(
      'depth',
      `Figma document nests deeper than ${MAX_TREE_DEPTH} levels — import a specific frame instead`
    );
  }
  const r = raw as Record<string, unknown>;

  const id = str(r.id);
  if (!id) return null; // a node with no id cannot be referenced, stamped, or bound

  state.count += 1;
  if (state.count > MAX_NODE_COUNT) {
    throw new FigmaCapError(
      'nodes',
      `Figma document has more than ${MAX_NODE_COUNT} nodes — import a specific frame instead`
    );
  }
  if (depth > state.maxDepth) state.maxDepth = depth;

  const node: FigmaNode = {
    id,
    type: nodeType(r.type),
    // UNTRUSTED, carried verbatim — see the file-level invariant.
    name: str(r.name) ?? '',
    visible: bool(r.visible, true),
  };

  const assign = <K extends keyof FigmaNode>(key: K, value: FigmaNode[K] | undefined) => {
    if (value !== undefined) node[key] = value;
  };

  assign('absoluteBoundingBox', rect(r.absoluteBoundingBox));
  assign('absoluteRenderBounds', rect(r.absoluteRenderBounds));
  assign('rotation', num(r.rotation));
  assign('opacity', num(r.opacity));
  assign('blendMode', str(r.blendMode));
  assign('clipsContent', typeof r.clipsContent === 'boolean' ? r.clipsContent : undefined);

  const layoutMode = str(r.layoutMode);
  if (layoutMode === 'HORIZONTAL' || layoutMode === 'VERTICAL' || layoutMode === 'NONE') {
    node.layoutMode = layoutMode;
  }
  assign('itemSpacing', num(r.itemSpacing));
  assign('paddingLeft', num(r.paddingLeft));
  assign('paddingRight', num(r.paddingRight));
  assign('paddingTop', num(r.paddingTop));
  assign('paddingBottom', num(r.paddingBottom));
  assign('primaryAxisAlignItems', str(r.primaryAxisAlignItems));
  assign('counterAxisAlignItems', str(r.counterAxisAlignItems));
  assign('layoutWrap', str(r.layoutWrap));

  assign('fills', paints(r.fills));
  assign('strokes', paints(r.strokes));
  assign('strokeWeight', num(r.strokeWeight));
  assign('effects', effects(r.effects));
  assign('cornerRadius', num(r.cornerRadius));
  if (Array.isArray(r.rectangleCornerRadii)) {
    const radii = r.rectangleCornerRadii
      .slice(0, 4)
      .map((n) => num(n))
      .filter((n): n is number => n !== undefined);
    if (radii.length) node.rectangleCornerRadii = radii;
  }

  // UNTRUSTED, carried verbatim.
  assign('characters', str(r.characters));
  assign('style', typeStyle(r.style));

  assign('shapeType', str(r.shapeType));
  assign('connectorStart', connectorEndpointId(r.connectorStart));
  assign('connectorEnd', connectorEndpointId(r.connectorEnd));
  assign('connectorStartCap', str(r.connectorStartCap));
  assign('connectorEndCap', str(r.connectorEndCap));
  assign('connectorLineType', str(r.connectorLineType));
  assign('componentId', str(r.componentId));

  if (Array.isArray(r.children)) {
    const kids: FigmaNode[] = [];
    for (const child of r.children) {
      const normalized = normalizeNode(child, depth + 1, state);
      if (normalized) kids.push(normalized);
    }
    if (kids.length) node.children = kids;
  }

  return node;
}

/**
 * A connector endpoint is `{ endpointNodeId, magnet }` (bound) or
 * `{ position }` (free-floating). Only the bound form carries a host id — and
 * a free endpoint must NOT be mistaken for one, or T5 mints a bind to nothing.
 */
function connectorEndpointId(v: unknown): string | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const e = v as Record<string, unknown>;
  return str(e.endpointNodeId);
}

/**
 * Normalize a raw `GET /v1/files/:key` (or `/nodes`) document into the shape
 * both doors share. Throws `FigmaCapError` on a hard refusal — callers turn
 * that into the user-facing "import a specific frame instead" message.
 */
export function normalizeDocument(
  raw: unknown,
  meta: { fileKey: string; surface: 'design' | 'board'; origin?: 'rest' | 'fig' }
): NormalizedDocument {
  const state: WalkState = { count: 0, maxDepth: 0 };
  const root = normalizeNode(raw, 0, state);
  if (!root) throw new FigmaCapError('nodes', 'Figma document has no readable root node');
  return {
    fileKey: meta.fileKey,
    surface: meta.surface,
    origin: meta.origin ?? 'rest',
    root,
    nodeCount: state.count,
    maxDepth: state.maxDepth,
  };
}

/** Depth-first walk over a normalized tree. Iterative — no stack growth. */
export function walkNodes(root: FigmaNode, visit: (node: FigmaNode, depth: number) => void): void {
  const stack: Array<{ node: FigmaNode; depth: number }> = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    visit(entry.node, entry.depth);
    const kids = entry.node.children;
    if (!kids) continue;
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push({ node: kids[i], depth: entry.depth + 1 });
    }
  }
}

/** Guard used by the normalizer's own tests and by the `.fig` door later. */
export function isPollutingKey(key: string): boolean {
  return POLLUTING_KEYS.has(key);
}
