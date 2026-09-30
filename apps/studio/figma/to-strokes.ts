/**
 * @file       figma/to-strokes.ts — FigJam board → whiteboard elements.
 * @scope      apps/studio/figma/to-strokes.ts
 * @purpose    The flagship mapping: a FigJam document (normalized by
 *             `types.ts`) becomes `Stroke[]` (`toStrokes`), and those become
 *             the v2 board ELEMENTS (`toBoardElements`, DDR-242) the importer
 *             writes to `<slug>.annotations.json`. Maude's whiteboard vocabulary
 *             is a close match for FigJam's primitives, and this is the piece no
 *             competitor ships.
 *
 * @invariant  IMPORT THE CANONICAL MODEL, NEVER HAND-WRITE A BOARD. Strokes are
 *             the real `Stroke` types; elements come out of the same pure
 *             transform the v1→v2 migration uses and are validated field by
 *             field by the element registry, so this translator can never emit
 *             an element the canvas wouldn't accept.
 *
 * @invariant  THE OUTPUT IS A VERSIONED, PEER-SYNCED, AGENT-READ ARTIFACT.
 *             `*.annotations.json` is VERSIONED (DDR-115), commits and syncs
 *             (DDR-054), and `maude design read-annotations` parses it into JSON
 *             EXPRESSLY to put in a model's context. DDR-216 D1 calls this the
 *             sharpest consumption sink in the feature. So every string here
 *             goes through `sanitize.ts` (D6a character classes + D6b
 *             normalization) — and residual 1 still applies: none of that stops
 *             an instruction from reading like an instruction.
 *
 * @invariant  DEPENDENCY-FREE beyond the model. No fs, no network — the caller
 *             (`_import-figma.mjs`) owns writes and asset downloads.
 */

import { v1ToV2 } from '../annotations/migrate-v1.ts';
import type { Dropped } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  type ArrowBind,
  type ArrowStroke,
  DEFAULT_SECTION_COLOR,
  type EllipseStroke,
  type ImageStroke,
  type PolygonShape,
  type PolygonStroke,
  type RectStroke,
  type SectionStroke,
  STICKY_PALETTE,
  type StickyStroke,
  type Stroke,
  type TextStroke,
} from '../annotations-model.ts';
import type { ArrowLineType } from '../canvas-arrowheads.ts';
import {
  attrValue,
  type Bounds,
  clampIntoBounds,
  cleanText,
  ensureContrast,
  ensureFontSize,
  hexToRgb01,
  ImportReport,
  rgb01ToHex,
} from './sanitize.ts';
import type { FigmaColor, FigmaNode, NormalizedDocument } from './types.ts';

/** Per-sink text capacities. Overflow is truncated AND reported, never silent. */
const STICKY_TEXT_CAP = 1200;
const SHAPE_LABEL_CAP = 400;
const TEXT_CAP = 4000;
const SECTION_LABEL_CAP = 120;

/**
 * Above this, a board import needs explicit confirmation.
 *
 * D6b's board-side control: on a board the payload does NOT have to hide. A
 * 300-sticky workshop board is imported wholesale, no human reads all 300, and
 * a fully visible sticky is completely effective — so no content rule helps.
 * What helps is bounding how much arrives unreviewed in one gesture
 * (post-implementation review F5: the DDR asserted this control and the code
 * did not have it).
 */
export const BOARD_STROKE_CEILING = 250;

/** Stamped on every imported stroke so a reader can see where it came from. */
export const FIGMA_AUTHOR_NAME = 'imported-figma';

/** Ink default when a node carries no usable stroke colour. */
const DEFAULT_INK = '#1a1a1a';
const DEFAULT_STROKE_WIDTH = 2;

/**
 * FigJam `shapeType` → Maude primitive. The five that land natively plus the
 * two triangles; everything else (parallelogram, the `ENG_*` engineering set,
 * etc.) has NO Maude equivalent and is skipped AND REPORTED — never silently
 * dropped, and never approximated into a shape that means something different.
 */
const SHAPE_MAP: Readonly<Record<string, 'rect' | 'ellipse' | PolygonShape>> = Object.assign(
  Object.create(null),
  {
    SQUARE: 'rect',
    ROUNDED_RECTANGLE: 'rect',
    ELLIPSE: 'ellipse',
    DIAMOND: 'diamond',
    TRIANGLE_UP: 'triangle',
    TRIANGLE_DOWN: 'triangle-down',
  }
);

/** FigJam connector caps → the `canvas-arrowheads` vocabulary. */
const CAP_MAP: Readonly<Record<string, 'none' | 'triangle' | 'line'>> = Object.assign(
  Object.create(null),
  {
    NONE: 'none',
    ARROW_LINES: 'line',
    ARROW_EQUILATERAL: 'triangle',
    TRIANGLE_FILLED: 'triangle',
  }
);

// Values are ArrowLineType — 'curved', not 'curve'. The old 'curve' matched no
// arm of the renderer's `lineType === 'curved'` checks, so every curved FigJam
// connector imported as a stroke nothing could draw as curved (it fell through
// to straight). Typed against the real union so a third spelling cannot recur.
const LINE_TYPE_MAP: Readonly<Record<string, ArrowLineType>> = Object.assign(Object.create(null), {
  STRAIGHT: 'straight',
  ELBOWED: 'elbow',
  CURVED: 'curved',
});

export interface PendingImage {
  /** The stroke whose `href` must be rewritten once the asset lands. */
  strokeId: string;
  nodeId: string;
  /**
   * Figma's image handle for a raster fill — resolved via `/v1/images`,
   * downloaded by T8. `null` for loose vector artwork, which has no handle:
   * there the NODE itself is what gets rendered.
   */
  imageRef: string | null;
  /**
   * What to ask Figma for. Absent ⇒ `png` (the raster-fill case, unchanged).
   * Vector artwork ALSO asks for png — `ASSET_IMAGE_HREF_RE` admits only raster
   * on an `<image>`, and an svg href is silently stripped by the sanitizer
   * rather than rejected loudly.
   */
  format?: 'png' | 'svg';
}

export interface ToStrokesResult {
  strokes: Stroke[];
  report: ImportReport;
  /** Images the caller must resolve + download through `fetch-asset` (T8). */
  pendingImages: PendingImage[];
  /** The translation origin, so a caller can report what it shifted by. */
  origin: { x: number; y: number };
}

function figmaColorToHex(c: FigmaColor | undefined): string | null {
  if (!c) return null;
  return rgb01ToHex({ r: c.r, g: c.g, b: c.b });
}

/** First visible SOLID fill, as hex. */
function solidFillHex(node: FigmaNode): string | null {
  for (const p of node.fills ?? []) {
    if (!p.visible) continue;
    if (p.type === 'SOLID') return figmaColorToHex(p.color);
  }
  return null;
}

function solidStrokeHex(node: FigmaNode): string | null {
  for (const p of node.strokes ?? []) {
    if (!p.visible) continue;
    if (p.type === 'SOLID') return figmaColorToHex(p.color);
  }
  return null;
}

/** First visible IMAGE fill's handle. */
function imageRef(node: FigmaNode): string | null {
  for (const p of node.fills ?? []) {
    if (!p.visible) continue;
    if (p.type === 'IMAGE' && p.imageRef) return p.imageRef;
  }
  return null;
}

/**
 * Snap an arbitrary sticky colour onto the nearest `STICKY_PALETTE` tint.
 * `StickyStroke.color` is a free-form string so a raw hex WOULD round-trip —
 * but a FigJam board's named tints (`STICKY_GRAY`, `…_UI3`, `CUSTOM`) should
 * read as Maude paper, not as arbitrary ink.
 */
export function nearestStickyColor(hex: string | null): string {
  const target = hex ? hexToRgb01(hex) : null;
  if (!target) return STICKY_PALETTE[0];
  let best: (typeof STICKY_PALETTE)[number] = STICKY_PALETTE[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const candidate of STICKY_PALETTE) {
    const c = hexToRgb01(candidate);
    if (!c) continue;
    const d = (c.r - target.r) ** 2 + (c.g - target.g) ** 2 + (c.b - target.b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}

/** World bounds of every node carrying geometry — the translation origin. */
function documentBounds(root: FigmaNode): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const visit = (n: FigmaNode) => {
    const b = n.absoluteBoundingBox;
    if (b) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

let idCounter = 0;
/** Deterministic per-run stroke ids — derived from the NODE ID, never text. */
function strokeId(nodeId: string, suffix = ''): string {
  idCounter += 1;
  return `fig_${nodeId.replace(/[^0-9]+/g, '_')}${suffix ? `_${suffix}` : ''}_${idCounter}`;
}

export interface ToStrokesOptions {
  /** Reset the id counter — tests want deterministic ids. */
  resetIds?: boolean;
  /**
   * Shift by THIS origin instead of the document's own bounding box.
   *
   * A design page's annotation layer has to line up with the artboards the
   * canvas already positioned, and those were placed against the PAGE origin —
   * which includes the frames this call does not see. Without the override the
   * strokes get their own origin and every note lands offset by the distance
   * between the two.
   */
  originOverride?: { x: number; y: number };
  /** Caller confirmed a board above `BOARD_STROKE_CEILING`. */
  confirmLarge?: boolean;
}

/** Thrown when a board exceeds the ceiling and the caller has not confirmed. */
export class BoardTooLargeError extends Error {
  readonly strokeCount: number;
  constructor(strokeCount: number) {
    super(
      `board translates to ${strokeCount} strokes (ceiling ${BOARD_STROKE_CEILING}) — re-run with --confirm-large to import it all`
    );
    this.name = 'BoardTooLargeError';
    this.strokeCount = strokeCount;
  }
}

/**
 * Translate a normalized FigJam document into strokes.
 *
 * Coordinates: FigJam is absolute-canvas and a real board spans roughly
 * 14 000 × 30 000 units starting deep in negative space (measured: x ≈ −3 244…
 * +11 037, y ≈ −6 272…+23 488). An untranslated import lands tens of thousands
 * of px off-screen, so everything is shifted by the document's own bounding-box
 * origin. **Absolute SIZES are preserved** — FigJam's sticky default is 240×240
 * against Maude's `STICKY_DEFAULT_W` 200, and normalising to Maude's default
 * collapses every layout.
 */
export function toStrokes(doc: NormalizedDocument, opts: ToStrokesOptions = {}): ToStrokesResult {
  if (opts.resetIds) idCounter = 0;
  const report = new ImportReport();
  const pendingImages: PendingImage[] = [];
  const bounds = documentBounds(doc.root);
  const origin = opts.originOverride ?? { x: bounds.minX, y: bounds.minY };
  // Post-shift bounds, for D6b's geometry clamp.
  const shifted: Bounds = {
    minX: 0,
    minY: 0,
    maxX: bounds.maxX - bounds.minX,
    maxY: bounds.maxY - bounds.minY,
  };

  const strokes: Stroke[] = [];
  /** Figma node id → the stroke id it produced, for connector binding. */
  const nodeToStroke = new Map<string, string>();
  /** Figma node id → its shifted bbox, for the group-endpoint fallback. */
  const nodeBBox = new Map<string, { x: number; y: number; w: number; h: number }>();
  /** Connectors are resolved in a second pass — their hosts must exist first. */
  const connectors: Array<{ node: FigmaNode; groupIds: string[] }> = [];

  const shift = (x: number, y: number) => ({ x: x - origin.x, y: y - origin.y });

  const emitText = (
    node: FigmaNode,
    groupIds: string[],
    box: { x: number; y: number; w: number; h: number }
  ): void => {
    const raw = node.characters ?? node.name;
    const cleaned = cleanText(raw, TEXT_CAP);
    if (cleaned.strippedHidden) report.add(node.id, node.type, 'hidden-chars-dropped');
    if (cleaned.truncated) report.add(node.id, node.type, 'truncated-text');
    if (!cleaned.text.trim()) {
      report.add(node.id, node.type, 'hidden-node-skipped', 'empty after sanitize');
      return;
    }
    const size = ensureFontSize(node.style?.fontSize ?? 16);
    if (size.changed) report.add(node.id, node.type, 'text-normalized', 'font-size floor');
    // Contrast is against the board paper, which is what a standalone FigJam
    // text sits on — there is no parent fill to resolve.
    const ink = ensureContrast(solidFillHex(node) ?? DEFAULT_INK, '#ffffff');
    if (ink.changed) report.add(node.id, node.type, 'text-normalized', 'contrast floor');
    const id = strokeId(node.id);
    const stroke: TextStroke = {
      id,
      tool: 'text',
      color: ink.hex,
      fontSize: size.size,
      text: cleaned.text,
      x: box.x,
      y: box.y,
      ...(groupIds.length ? { groupIds } : {}),
      ...(node.rotation ? { rotation: -node.rotation } : {}),
    };
    strokes.push(stroke);
    nodeToStroke.set(node.id, id);
    report.add(node.id, node.type, 'imported');
  };

  const visit = (node: FigmaNode, groupIds: string[], silent = false): void => {
    // D6b: an explicitly hidden node is not emitted at all.
    if (!node.visible) {
      if (!silent) report.add(node.id, node.type, 'hidden-node-skipped', 'visible:false');
      return;
    }

    const bb = node.absoluteBoundingBox;
    let box = { x: 0, y: 0, w: 0, h: 0 };
    if (bb) {
      const p = shift(bb.x, bb.y);
      const clamped = clampIntoBounds(p.x, p.y, shifted);
      if (clamped.changed) report.add(node.id, node.type, 'geometry-clamped');
      box = { x: clamped.x, y: clamped.y, w: bb.width, h: bb.height };
      nodeBBox.set(node.id, box);
    }

    switch (node.type) {
      case 'DOCUMENT':
      case 'CANVAS':
        for (const c of node.children ?? []) visit(c, groupIds, silent);
        return;

      case 'GROUP':
      case 'FRAME': {
        // A FigJam group becomes a flat `groupIds[]` TAG on its members — the
        // Excalidraw tag model. Deepest-first, so nested groups nest correctly.
        const gid = strokeId(node.id, 'g');
        const nextGroups = [gid, ...groupIds];
        for (const c of node.children ?? []) visit(c, nextGroups, silent);
        report.add(node.id, node.type, 'imported', 'group → groupIds tag');
        return;
      }

      case 'SECTION': {
        // SectionStroke is FLAT — no parent field. Nesting survives as
        // GEOMETRIC CONTAINMENT (dragging carries every stroke whose centre is
        // inside), which is how Maude sections already work. The sample board
        // has a section with 12 child sections; that reads correctly here.
        const label = cleanText(node.name, SECTION_LABEL_CAP);
        if (label.strippedHidden) report.add(node.id, node.type, 'hidden-chars-dropped');
        const id = strokeId(node.id);
        const stroke: SectionStroke = {
          id,
          tool: 'section',
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
          label: label.text,
          color: solidFillHex(node) ?? DEFAULT_SECTION_COLOR,
          ...(groupIds.length ? { groupIds } : {}),
        };
        strokes.push(stroke);
        nodeToStroke.set(node.id, id);
        report.add(node.id, node.type, 'imported');
        for (const c of node.children ?? []) visit(c, groupIds, silent);
        return;
      }

      case 'STICKY': {
        const body = cleanText(node.characters ?? '', STICKY_TEXT_CAP);
        if (body.strippedHidden) report.add(node.id, node.type, 'hidden-chars-dropped');
        if (body.truncated) report.add(node.id, node.type, 'truncated-text');
        const paper = nearestStickyColor(solidFillHex(node));
        const size = ensureFontSize(node.style?.fontSize ?? 14);
        if (size.changed) report.add(node.id, node.type, 'text-normalized', 'font-size floor');
        const id = strokeId(node.id);
        const stroke: StickyStroke = {
          id,
          tool: 'sticky',
          color: paper,
          // Absolute geometry PRESERVED — FigJam's 240×240 default (and the
          // 416×240 wide variant) must not collapse to Maude's 200.
          x: box.x,
          y: box.y,
          w: box.w || 240,
          h: box.h || 240,
          text: body.text,
          fontSize: size.size,
          ...(groupIds.length ? { groupIds } : {}),
          ...(node.rotation ? { rotation: -node.rotation } : {}),
        };
        strokes.push(stroke);
        nodeToStroke.set(node.id, id);
        report.add(node.id, node.type, 'imported');
        return;
      }

      case 'SHAPE_WITH_TEXT': {
        const kind = node.shapeType ? SHAPE_MAP[node.shapeType] : undefined;
        if (!kind) {
          report.add(node.id, node.type, 'unmappable-shape', node.shapeType ?? 'unknown');
          return;
        }
        const ink = solidStrokeHex(node) ?? DEFAULT_INK;
        const fill = solidFillHex(node);
        const id = strokeId(node.id);
        const base = {
          id,
          color: ink,
          width: node.strokeWeight ?? DEFAULT_STROKE_WIDTH,
          ...(fill ? { fill } : {}),
          ...(groupIds.length ? { groupIds } : {}),
          ...(node.rotation ? { rotation: -node.rotation } : {}),
        };
        if (kind === 'ellipse') {
          const stroke: EllipseStroke = {
            ...base,
            tool: 'ellipse',
            cx: box.x + box.w / 2,
            cy: box.y + box.h / 2,
            rx: box.w / 2,
            ry: box.h / 2,
          };
          strokes.push(stroke);
        } else if (kind === 'rect') {
          const stroke: RectStroke = {
            ...base,
            tool: 'rect',
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            ...(node.cornerRadius ? { cornerRadius: node.cornerRadius } : {}),
          };
          strokes.push(stroke);
        } else {
          const stroke: PolygonStroke = {
            ...base,
            tool: 'polygon',
            shape: kind,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
          };
          strokes.push(stroke);
        }
        nodeToStroke.set(node.id, id);
        report.add(node.id, node.type, 'imported');

        // The shape's label becomes ANCHORED text on it — the same shape a
        // double-click produces natively.
        const label = cleanText(node.characters ?? '', SHAPE_LABEL_CAP);
        if (label.text.trim()) {
          const size = ensureFontSize(node.style?.fontSize ?? 14);
          const ink2 = ensureContrast(DEFAULT_INK, fill ?? '#ffffff');
          if (ink2.changed) report.add(node.id, node.type, 'text-normalized', 'contrast floor');
          strokes.push({
            id: strokeId(node.id, 'label'),
            tool: 'text',
            color: ink2.hex,
            fontSize: size.size,
            text: label.text,
            anchorId: id,
            ...(groupIds.length ? { groupIds } : {}),
          } as TextStroke);
        }
        return;
      }

      case 'TEXT':
        emitText(node, groupIds, box);
        return;

      case 'CONNECTOR':
        // Deferred — hosts must exist before endpoints can bind.
        connectors.push({ node, groupIds });
        return;

      case 'VECTOR':
      case 'LINE':
      case 'STAR':
      case 'REGULAR_POLYGON':
      case 'BOOLEAN_OPERATION': {
        // LOOSE VECTOR ARTWORK IS CONTENT, NOT NOISE.
        //
        // These used to fall through to `unmappable-type` and vanish. On the
        // live StudyFi file that dropped the NINE red flow arrows drawn between
        // the onboarding screens on Phase 0 — hand-drawn `VECTOR` nodes named
        // "Arrow 35/37/38/…", not CONNECTORs, so the connector path never saw
        // them. Side by side against Figma, the screens were right and the flow
        // between them was simply gone.
        //
        // There is no stroke tool that reproduces an arbitrary path, and there
        // does not need to be: the same renderer that draws the artboards draws
        // these. Ask Figma for the node and place it as an image.
        //
        // RASTER, NOT VECTOR — and that is a security boundary, not a taste
        // call. `ASSET_IMAGE_HREF_RE` admits only png/jpeg/webp/gif on an
        // `<image>`, because an annotation SVG is PERSISTED AND SYNCED TO PEERS
        // (DDR-054/060) and an `<image href="…svg">` pulls in a nested SVG
        // document — a script-execution vector. Asking for svg here does not
        // fail loudly: the sanitizer keeps the element and strips the href, so
        // the arrow renders as nothing at all. Widening that allowlist to suit
        // an importer would weaken every peer-synced board, so the import bends
        // instead. The artboard renders stay svg — those are `<img src>` in a
        // TSX canvas, a different surface with its own containment (D12).
        // GEOMETRY COMES FROM THE RENDER BOUNDS, NOT THE GEOMETRIC BOX.
        //
        // A stroked path is drawn wider than its geometry. The nine Phase-0
        // arrows are horizontal, so `absoluteBoundingBox.height` is 0.0001
        // while `absoluteRenderBounds.height` is 22.09 (3px stroke plus the
        // arrowhead). Placed at the geometric box the image is 121 × 0.00005
        // px — present in the file, referenced correctly, and invisible.
        const rb = node.absoluteRenderBounds;
        const geo = rb ? { ...shift(rb.x, rb.y), w: rb.width, h: rb.height } : box;
        const id = strokeId(node.id);
        const stroke: ImageStroke = {
          id,
          tool: 'image',
          x: geo.x,
          y: geo.y,
          w: Math.max(1, geo.w),
          h: Math.max(1, geo.h),
          href: '',
          alt: attrValue(node.name) || 'vector',
          ...(groupIds.length ? { groupIds } : {}),
          ...(node.rotation ? { rotation: -node.rotation } : {}),
        };
        strokes.push(stroke);
        nodeToStroke.set(node.id, id);
        pendingImages.push({ strokeId: id, nodeId: node.id, imageRef: null, format: 'png' });
        report.add(node.id, node.type, 'asset-pending');
        return;
      }

      case 'RECTANGLE':
      case 'ROUNDED_RECTANGLE':
      case 'ELLIPSE': {
        // A plain shape with an image fill is the board's picture case.
        const ref = imageRef(node);
        if (ref) {
          const id = strokeId(node.id);
          const stroke: ImageStroke = {
            id,
            tool: 'image',
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            // Rewritten by the caller once `fetch-asset` lands the bytes. Until
            // then it is a placeholder, never an external URL — a hotlink is
            // CSP-blocked in the canvas anyway (DDR-216 D4).
            href: '',
            ...(groupIds.length ? { groupIds } : {}),
            ...(node.rotation ? { rotation: -node.rotation } : {}),
          };
          strokes.push(stroke);
          nodeToStroke.set(node.id, id);
          pendingImages.push({ strokeId: id, nodeId: node.id, imageRef: ref });
          report.add(node.id, node.type, 'asset-pending');
          return;
        }
        // Otherwise it is an ordinary geometric shape.
        const ink = solidStrokeHex(node) ?? DEFAULT_INK;
        const fill = solidFillHex(node);
        const id = strokeId(node.id);
        if (node.type === 'ELLIPSE') {
          strokes.push({
            id,
            tool: 'ellipse',
            color: ink,
            width: node.strokeWeight ?? DEFAULT_STROKE_WIDTH,
            cx: box.x + box.w / 2,
            cy: box.y + box.h / 2,
            rx: box.w / 2,
            ry: box.h / 2,
            ...(fill ? { fill } : {}),
            ...(groupIds.length ? { groupIds } : {}),
          } as EllipseStroke);
        } else {
          strokes.push({
            id,
            tool: 'rect',
            color: ink,
            width: node.strokeWeight ?? DEFAULT_STROKE_WIDTH,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            ...(fill ? { fill } : {}),
            ...(node.cornerRadius ? { cornerRadius: node.cornerRadius } : {}),
            ...(groupIds.length ? { groupIds } : {}),
          } as RectStroke);
        }
        nodeToStroke.set(node.id, id);
        report.add(node.id, node.type, 'imported');
        return;
      }

      default: {
        // WIDGET, STAMP, TABLE, CODE_BLOCK, EMBED, LINK_UNFURL, MEDIA, and a
        // FigJam sticker (an INSTANCE) … have no Maude equivalent. Skipped AND
        // REPORTED — the summary is what makes "never silently dropped" true.
        //
        // But report the SUBTREE ONCE, not every leaf. Measured on a real retro
        // board: 16 stickers carried 136 VECTOR children, so per-leaf reporting
        // produced 152 lines of noise around 102 stickies that actually
        // mattered. A summary nobody reads is not an honesty mechanism, and
        // "this sticker didn't come through" is the fact — its 9 internal paths
        // are not.
        let descendants = 0;
        const count = (n: FigmaNode) => {
          for (const c of n.children ?? []) {
            descendants += 1;
            count(c);
          }
        };
        count(node);
        if (!silent) {
          report.add(
            node.id,
            node.type,
            'unmappable-type',
            descendants > 0 ? `+${descendants} nested` : undefined
          );
        }
        // STILL RECURSE. Quieting the report must not quiet the IMPORT: a
        // sticker's subtree can hold a real photo, and on the first live board
        // an earlier version of this collapse silently dropped 2 images and 6
        // ellipses along with the 136 vector leaves it was meant to stop
        // listing. Losing content is a worse failure than a noisy summary, and
        // it is the harder one to notice. `silent` suppresses the per-descendant
        // REPORT only.
        for (const c of node.children ?? []) visit(c, groupIds, true);
        return;
      }
    }
  };

  visit(doc.root, []);

  // PROVENANCE (review F5). Every imported stroke carries an author marker, so
  // `read-annotations` — which parses this file expressly to put it in a
  // model's context — can tell "the user drew this" from "a third party's Figma
  // file did". Deliberately NOT `author: 'ai'`: the whiteboard trust model says
  // in as many words that `author:'ai'` is not a trust signal, and the blank
  // human default is exactly what this needs to stop looking like.
  for (const stroke of strokes) {
    stroke.authorName = FIGMA_AUTHOR_NAME;
  }

  // ── Connector pass ────────────────────────────────────────────────────────
  const strokeById = new Map(strokes.map((s) => [s.id, s]));
  for (const { node, groupIds } of connectors) {
    const startNode = node.connectorStart;
    const endNode = node.connectorEnd;

    // A degenerate self-connector (start id == end id) was observed on the real
    // board. Emitting it as a bound arrow yields a zero-length shape that reads
    // as a rendering bug; report and skip.
    if (startNode && endNode && startNode === endNode) {
      report.add(node.id, node.type, 'bind-dropped-self-connector');
      continue;
    }

    const resolve = (
      figmaId: string | undefined
    ): { bind?: ArrowBind; point: [number, number] } | null => {
      if (!figmaId) return null;
      const sid = nodeToStroke.get(figmaId);
      const bbox = nodeBBox.get(figmaId);
      if (sid) {
        const host = strokeById.get(sid);
        if (host) {
          // `isBindable` decides — widened to text + section by DDR-216 D9, and
          // deliberately still excluding groups (Maude groups are tags, not
          // addressable objects) and anchored text (no resolvable bbox here).
          const b = bbox ?? { x: 0, y: 0, w: 0, h: 0 };
          return {
            bind: { hostId: sid, nx: 0.5, ny: 0.5 },
            point: [b.x + b.w / 2, b.y + b.h / 2],
          };
        }
      }
      if (bbox) {
        // A GROUP-targeted endpoint: fall back to the group's geometric bbox,
        // unbound, and report the degradation. Deliberately does NOT invent a
        // group stroke — that would add an addressable object to a model which
        // by design has none (DDR-216 D9).
        report.add(node.id, node.type, 'bind-degraded-to-bbox', 'group endpoint');
        return { point: [bbox.x + bbox.w / 2, bbox.y + bbox.h / 2] };
      }
      return null;
    };

    const from = resolve(startNode);
    const to = resolve(endNode);
    const bb = node.absoluteBoundingBox;
    const fallback = bb ? shift(bb.x, bb.y) : { x: 0, y: 0 };
    const p1 = from?.point ?? [fallback.x, fallback.y];
    const p2 = to?.point ?? [fallback.x + (bb?.width ?? 100), fallback.y + (bb?.height ?? 0)];

    const arrow: ArrowStroke = {
      id: strokeId(node.id),
      tool: 'arrow',
      color: solidStrokeHex(node) ?? DEFAULT_INK,
      width: node.strokeWeight ?? DEFAULT_STROKE_WIDTH,
      x1: p1[0],
      y1: p1[1],
      x2: p2[0],
      y2: p2[1],
      startHead: CAP_MAP[node.connectorStartCap ?? 'NONE'] ?? 'none',
      endHead: CAP_MAP[node.connectorEndCap ?? 'NONE'] ?? 'none',
      lineType: LINE_TYPE_MAP[node.connectorLineType ?? 'STRAIGHT'] ?? 'straight',
      ...(from?.bind ? { startBind: from.bind } : {}),
      ...(to?.bind ? { endBind: to.bind } : {}),
      ...(groupIds.length ? { groupIds } : {}),
    };
    strokes.push(arrow);
    report.add(node.id, node.type, 'imported');
  }

  if (strokes.length > BOARD_STROKE_CEILING && !opts.confirmLarge) {
    throw new BoardTooLargeError(strokes.length);
  }

  return { strokes, report, pendingImages, origin };
}

/**
 * DDR-242 — translated strokes → v2 board ELEMENTS. The pure `v1ToV2`
 * transform (the one every migration path uses): shape labels become embedded
 * labels, section membership becomes explicit `parent` ids with relative
 * coordinates, bound connectors keep only their hosts. Every element is then
 * validated by the element registry — no SVG serializer, no SVG sanitizer, no
 * round trip. Anything that can't be carried over is listed in `dropped`.
 */
export function toBoardElements(strokes: readonly Stroke[]): {
  elements: AnnotationElement[];
  dropped: Dropped[];
} {
  const r = v1ToV2(strokes);
  return { elements: r.elements, dropped: r.report };
}
