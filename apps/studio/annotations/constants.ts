/**
 * @file       annotations/constants.ts — defaults of the annotations-v2 model
 * @scope      apps/studio/annotations/constants.ts
 * @purpose    Values baked into the canonical form (a field equal to its default
 *             is omitted on disk, so these MUST NOT change once shipped — changing
 *             one silently restyles every element that relied on it). They match
 *             the v1 model (`annotations-model.ts`) value for value so migrated
 *             boards look identical.
 */

export const DEFAULT_INK = '#1f1f1f';
export const DEFAULT_STICKY_FILL = '#fce8a6';
export const DEFAULT_SECTION_COLOR = '#8b8b94';
export const DEFAULT_FONT_SIZE = 14;
export const DEFAULT_STROKE_WIDTH = 2;
export const STICKY_RADIUS = 8;
export const STICKY_MIN_SIZE = 40;
export const STICKY_MAX_GROWN_H = 8000;
export const SHAPE_MIN_SIZE = 4;
export const SECTION_MIN_SIZE = 64;
export const SECTION_LABEL_FONT = 12;
export const SECTION_LABEL_H = 20;
export const IMAGE_MIN_SIZE = 16;
export const TEXT_LINE_HEIGHT = 1.25;

/** Hard caps (untrusted input, DDR-054 §2d). */
export const MAX_PEN_POINTS = 20_000;
export const MAX_TEXT_CHARS = 20_000;
export const MAX_GROUPS_PER_ELEMENT = 16;
export const MAX_NESTING_DEPTH = 8;
export const MAX_ELEMENTS = 20_000;
/** Serialized bytes of one element record. */
export const MAX_ELEMENT_BYTES = 256 * 1024;
/** Serialized bytes of a whole board file. */
export const MAX_BOARD_BYTES = 4 * 1024 * 1024;
/** A legacy v1 `.annotations.svg` (v1 capped boards at 1 MB) — larger input is refused unparsed. */
export const MAX_LEGACY_SVG_BYTES = 2 * 1024 * 1024;

/** Arrow head vocabulary — mirrors `canvas-arrowheads.ts` ARROW_HEADS. */
export const ARROW_HEADS = [
  'none',
  'line',
  'triangle',
  'triangle-outline',
  'circle',
  'diamond',
] as const;
export const ARROW_LINES = ['straight', 'curved', 'elbow'] as const;
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond', 'triangle', 'triangle-down'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Relative `assets/<name>.<ext>` raster path — the only href an image keeps (DDR-054, Phase 23). */
export const ASSET_IMAGE_HREF_RE = /^assets\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|gif)$/;
/** Relative `assets/<name>.<ext>` video/audio path — the only src a media chip keeps (DDR-150 P4). */
export const ASSET_MEDIA_SRC_RE =
  /^assets\/[A-Za-z0-9._-]+\.(?:mp4|webm|mov|m4v|mp3|wav|m4a|aac|ogg)$/;
/** Link cards open http(s) only. */
export const LINK_URL_RE = /^https?:\/\/[^\s]+$/i;
