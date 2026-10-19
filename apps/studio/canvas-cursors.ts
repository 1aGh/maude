/**
 * @file       canvas-cursors.ts — Phase 24 custom tool cursors (Kenney CC0)
 * @scope      apps/studio/canvas-cursors.ts
 * @purpose    FigJam/Figma-style custom cursors for EVERY canvas tool. The
 *             native crosshair / text / arrow cursors are tiny + thin and
 *             vanish on busy canvases; these are 32×32 SVG cursors that read on
 *             any background.
 *
 *             Phase 24 — ALL tools draw from ONE library, the **Kenney Cursor
 *             Pack (1.1)** "Outline" set, which is **CC0 / public domain**
 *             (https://kenney.nl/assets/cursor-pack — no attribution required,
 *             redistributable inside this MIT package + marketplace clone). See
 *             DDR-067 for the licence gate (Bibata GPL-3.0 was rejected as
 *             copyleft). One library = one visual identity across move / hand /
 *             comment / pen / shape / sticky / text / eraser. The glyph paths
 *             are Kenney's; we RECOLOUR them (see `kenney()`) to a dark-glyph +
 *             white-halo treatment so they read crisply on light AND dark
 *             canvases. Per-tool glyph map:
 *               move→pointer_a · hand→hand_open · comment→message_dots_square ·
 *               pen→drawing_pencil · shape→line_cross · eraser→drawing_eraser.
 *             text (I-beam) + sticky (folded-corner note) have no clean Kenney
 *             equivalent, so they are AUTHORED in the identical dark-glyph +
 *             white-halo treatment to keep one visual identity.
 *
 *             Delivered as CSS `cursor: url("data:image/svg+xml,…") hx hy, fb`
 *             — no runtime dependency, no asset files. 32×32 is the
 *             cross-browser-safe ceiling; (hx, hy) is the click hotspot.
 */

import type { Tool } from './input-router.tsx';

/** Build a CSS cursor value from an inline SVG + hotspot + native fallback. */
function svgCursor(svg: string, hx: number, hy: number, fallback: string): string {
  // encodeURIComponent is the safest escaping for a data: URI inside url("…").
  return `url("data:image/svg+xml,${encodeURIComponent(svg.trim())}") ${hx} ${hy}, ${fallback}`;
}

// Phase 24 — 24px rendered box (down from 32) so cursors aren't oversized; the
// glyph coords stay in the 32-unit viewBox and scale into 24px. Hotspots are
// scaled to match (see the generator).
const W = `width='24' height='24' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'`;
const INK = '#1f1f1f';
const HALO = "stroke='#ffffff' stroke-linejoin='round' stroke-linecap='round'";

// Kenney CC0 glyph, recoloured to a FigJam-style **dark glyph + white halo**:
// Kenney's outline band (`b`) is painted WHITE (the halo) and its inner fill
// (`w`) is painted dark INK. Reads crisply on a LIGHT canvas (solid dark glyph)
// AND a dark one (white halo edge).
function kenney(b: string, w: string, transform?: string): string {
  // Optional `<g transform>` for the drawing tools whose Kenney glyph needs
  // re-orienting so the writing tip lands at the hotspot (user steer
  // 2026-06-04: pen / highlighter "kreslí pod koncem, ne na špičce" → flipped so
  // the nib points down-LEFT, top-right→bottom-left).
  const open = transform ? `<g transform='${transform}'>` : '';
  const close = transform ? '</g>' : '';
  return `<svg ${W}>${open}<path fill='#ffffff' d='${b}'/><path fill='${INK}' d='${w}'/>${close}</svg>`;
}

// Vertical mirror about the 32-viewBox horizontal centre: (x,y) → (x, 32−y).
// Applied to pen/highlighter so the glyph lies along the top-right→bottom-left
// diagonal with the nib at bottom-left.
const FLIP_V = 'translate(0,32) scale(1,-1)';

// move → Kenney `pointer_b` (user steer 2026-06-04 — the plain variant, not the
// shaded one). Hotspot at the arrow tip (top).
const MOVE = svgCursor(
  kenney(
    'M10.25 8.25 L10.05 8.65 10 9 10 23.1 10.05 23.4 10.25 23.75 10.8 24 11.45 23.85 11.6 23.7 11.75 23.45 14.65 19.8 14.85 19.65 14.95 19.5 15.4 19.2 15.95 19.1 21.05 19.1 21.2 19.1 21.35 19.05 21.65 18.9 21.9 18.6 22 18.3 22 17.9 21.9 17.65 21.75 17.35 21.65 17.3 21.55 17.15 11.5 8.25 11.25 8.05 10.95 8 10.6 8.05 10.25 8.25 M9.15 6.6 L9.7 6.25 10 6.15 10.95 6 11.9 6.15 13 6.9 22.9 15.65 23 15.8 23.2 15.95 23.75 16.75 24 17.9 24 18.3 23.9 18.95 23.8 19.25 23.6 19.7 23.1 20.35 22.75 20.6 22.1 20.9 22.05 20.95 22 20.95 21.2 21.1 21.05 21.1 16.2 21.1 16.1 21.25 16.05 21.25 13.4 24.6 13.05 25.15 12.9 25.3 12.55 25.55 Q11.6 26.15 10.55 26 L10.5 26 Q9.65 25.85 9 25.3 L8.45 24.65 8.4 24.5 8.15 24.05 8 23.1 8 9 Q8 8.45 8.15 8.05 L8.25 7.75 8.45 7.35 9.15 6.6',
    'M10.25 8.25 L10.6 8.05 10.95 8 11.25 8.05 11.5 8.25 21.55 17.15 21.65 17.3 21.75 17.35 21.9 17.65 22 17.9 22 18.3 21.9 18.6 21.65 18.9 21.35 19.05 21.2 19.1 21.05 19.1 15.95 19.1 15.4 19.2 14.95 19.5 14.85 19.65 14.65 19.8 11.75 23.45 11.6 23.7 11.45 23.85 10.8 24 10.25 23.75 10.05 23.4 10 23.1 10 9 10.05 8.65 10.25 8.25'
  ),
  8,
  5,
  'default'
);
const HAND = svgCursor(
  kenney(
    'M28.55 17.8 Q29.4 20.3 28.75 22.8 L28.7 23 28.15 24.55 28.05 24.75 Q26.4 28.2 22.75 29.4 L22.45 29.5 18 29.9 17.75 29.85 Q15.8 29.25 13.8 28.1 L13.45 27.95 Q12 27.05 10.35 26.8 L10.25 26.75 7.9 26.7 7.8 26.7 Q6.1 26.9 4.8 25.8 L4.75 25.8 4.65 25.7 4.6 25.65 Q3.25 24.5 3.05 22.85 L3 22.75 Q2.8 20.95 4 19.5 5.05 18.15 6.75 17.95 L8.4 17.9 7.5 15.55 7.3 15.2 7.2 15 5 10.95 Q3.9 9.15 4.3 7.75 L4.4 7.5 Q4.75 6.15 6.45 5.2 9 3.65 11 5 11.05 4.1 11.5 3.45 12.15 2.1 14.2 1.6 L14.35 1.6 Q18.05 0.6 19.6 4.4 L19.65 4.55 Q20.75 3.65 22.7 3.75 L22.75 3.75 Q26.75 4 27 8.15 L27 8.25 27 8.35 27 8.45 Q26.9 10.75 27.1 12.6 27.15 14.65 28.2 16.75 L28.55 17.8 M26.65 18.4 L26.1 16.8 26.1 16.85 Q24.8 13.7 25 8.35 L25 8.25 Q24.85 5.9 22.6 5.75 20.7 5.65 20.4 7.35 L20.1 7.95 19.5 8.2 18.85 8.05 18.45 7.5 17.75 5.15 Q16.85 2.95 14.7 3.55 L14.65 3.55 Q12.55 4.05 13.15 6.15 L13.85 8.75 13.75 9.45 13.25 9.95 12.55 9.95 12 9.55 10.9 7.7 Q9.5 5.7 7.45 6.9 6.5 7.45 6.25 8.15 6.1 8.9 6.7 9.85 9.2 13.9 10.8 18.65 L10.8 19.3 10.4 19.8 9.75 19.95 Q8.35 19.8 6.95 19.95 6.1 20.05 5.55 20.75 4.9 21.55 5 22.55 5.15 23.55 6 24.2 L6.05 24.25 Q6.75 24.85 7.65 24.7 L7.7 24.7 10.65 24.8 Q12.7 25.15 14.45 26.2 L14.5 26.2 Q16.4 27.35 18.3 27.9 L22.05 27.5 22.1 27.5 Q24.95 26.55 26.25 23.85 L26.8 22.3 Q27.3 20.35 26.65 18.4',
    'M26.65 18.4 Q27.3 20.35 26.8 22.3 L26.25 23.85 Q24.95 26.55 22.1 27.5 L22.05 27.5 18.3 27.9 Q16.4 27.35 14.5 26.2 L14.45 26.2 Q12.7 25.15 10.65 24.8 L7.7 24.7 7.65 24.7 Q6.75 24.85 6.05 24.25 L6 24.2 Q5.15 23.55 5 22.55 4.9 21.55 5.55 20.75 6.1 20.05 6.95 19.95 8.35 19.8 9.75 19.95 L10.4 19.8 10.8 19.3 10.8 18.65 Q9.2 13.9 6.7 9.85 6.1 8.9 6.25 8.15 6.5 7.45 7.45 6.9 9.5 5.7 10.9 7.7 L12 9.55 12.55 9.95 13.25 9.95 13.75 9.45 13.85 8.75 13.15 6.15 Q12.55 4.05 14.65 3.55 L14.7 3.55 Q16.85 2.95 17.75 5.15 L18.45 7.5 18.85 8.05 19.5 8.2 20.1 7.95 20.4 7.35 Q20.7 5.65 22.6 5.75 24.85 5.9 25 8.25 L25 8.35 Q24.8 13.7 26.1 16.85 L26.1 16.8 26.65 18.4'
  ),
  12,
  12,
  'grab'
);
// comment → Kenney `message_round` (user steer 2026-06-04). Hotspot at the
// tail tip (bottom-centre), where the comment pin is dropped.
const COMMENT = svgCursor(
  kenney(
    'M28 14 Q28 9.85 24.45 6.9 20.95 4 16 4 11.05 4 7.5 6.9 L7.45 7 Q4 9.9 4 14 4 18.15 7.55 21.05 L7.5 21.05 Q9.2 22.45 11.2 23.2 L15.3 27.3 16 27.6 16.7 27.3 20.85 23.2 Q22.7 22.45 24.3 21.15 L24.45 21.05 Q28 18.15 28 14 M25.75 5.35 Q30.05 8.95 30 14 30.05 19.05 25.75 22.6 L25.4 22.85 Q23.8 24.1 22 24.9 L18.1 28.75 18.15 28.75 Q17.2 29.6 16 29.6 14.8 29.6 13.85 28.75 L13.9 28.75 10 24.9 6.6 22.85 6.25 22.6 Q1.95 19.05 2 14 1.95 8.95 6.25 5.35 10.3 2 16 2 21.7 2 25.75 5.35',
    'M28 14 Q28 18.15 24.45 21.05 L24.3 21.15 Q22.7 22.45 20.85 23.2 L16.7 27.3 16 27.6 15.3 27.3 11.2 23.2 Q9.2 22.45 7.5 21.05 L7.55 21.05 Q4 18.15 4 14 4 9.9 7.45 7 L7.5 6.9 Q11.05 4 16 4 20.95 4 24.45 6.9 28 9.85 28 14'
  ),
  12,
  21,
  'crosshair'
);
// pen → Kenney `drawing_pen`, mirrored vertically (FLIP_V) so the nib points
// down-LEFT (top-right→bottom-left diagonal). Source gradient-shade path dropped.
// Hotspot at the nib, bottom-left.
const PEN = svgCursor(
  kenney(
    'M4 13.1 L4 6 Q4 5.15 4.6 4.6 5.15 4 6 4 L13.1 4 Q13.95 4 14.55 4.6 L28.65 18.75 Q29.8 19.9 29.75 21.45 L29.75 21.6 29.75 21.7 Q29.75 23.2 28.7 24.35 L24.45 28.65 24.35 28.75 Q23.15 29.85 21.65 29.8 L21.55 29.8 21.4 29.8 Q20.2 29.8 19.25 29.15 L18 29.35 Q16.6 29.4 15.25 28 L15.2 27.95 8.2 20.95 Q7.6 20.35 7.6 19.55 7.6 18.7 8.2 18.1 L4.6 14.5 Q4 13.9 4 13.1 M19.5 26.65 L20.1 27.25 Q20.7 27.85 21.5 27.8 22.35 27.85 23 27.25 L27.25 22.95 Q27.8 22.35 27.75 21.55 27.8 20.75 27.2 20.15 L13.1 6 6 6 6 13.1 12.35 19.45 9.6 19.5 16.65 26.55 Q18.05 28.05 19.5 26.65 M8.05 12.3 L8 8 12.25 8.05 13.8 9.6 9.6 13.85 8.05 12.3 M15.25 11.05 L23 18.8 18.8 23.05 11.05 15.3 15.25 11.05',
    'M15.25 11.05 L11.05 15.3 18.8 23.05 23 18.8 15.25 11.05 M12.35 19.45 L6 13.1 6 6 13.1 6 27.2 20.15 Q27.8 20.75 27.75 21.55 27.8 22.35 27.25 22.95 L23 27.25 Q22.35 27.85 21.5 27.8 20.7 27.85 20.1 27.25 L19.5 26.65 12.35 19.45 M8.05 12.3 L9.6 13.85 13.8 9.6 12.25 8.05 8 8 8.05 12.3',
    FLIP_V
  ),
  6,
  18,
  'crosshair'
);
// highlighter → Kenney `drawing_pencil`, also mirrored vertically (distinct from
// the pen glyph). Hotspot at the lead tip, bottom-left.
const HIGHLIGHTER = svgCursor(
  kenney(
    'M5.15 10.85 Q4 9.65 4 8.1 L4 7.95 4 7.85 Q3.95 6.2 5.1 5.15 6.25 4 7.85 4 L7.95 4 8.1 4 Q9.65 4 10.85 5.15 L11 5.3 14.3 5.25 Q15.15 5.25 15.75 5.85 L29.9 20 Q31 21.15 31 22.75 L31 22.85 31 23 Q31.05 24.5 29.9 25.7 L29.55 25.95 25.65 29.9 25.65 29.95 Q24.45 31.1 22.75 31.1 21.2 31.15 20 29.95 L5.85 15.8 Q5.25 15.2 5.25 14.35 L5.25 10.95 5.15 10.85 M19.95 24.2 L18.55 22.8 22.8 18.55 24.2 19.95 19.95 24.2 M28.45 21.4 L14.3 7.25 10.15 7.3 9.4 6.55 Q8.8 5.95 7.95 6 7.1 5.95 6.5 6.55 5.95 7.1 6 7.95 5.95 8.8 6.55 9.4 L7.25 10.1 7.25 14.35 21.4 28.5 Q22 29.1 22.75 29.1 23.6 29.1 24.2 28.5 L28.45 24.25 Q29.05 23.65 29 22.85 29.05 22 28.45 21.4 M9.25 13.5 L9.25 9.3 13.5 9.25 14.3 10.05 10.05 14.3 9.25 13.5 M17.15 21.4 L11.5 15.75 15.75 11.5 21.4 17.15 17.15 21.4',
    'M17.15 21.4 L21.4 17.15 15.75 11.5 11.5 15.75 17.15 21.4 M28.45 21.4 Q29.05 22 29 22.85 29.05 23.65 28.45 24.25 L24.2 28.5 Q23.6 29.1 22.75 29.1 22 29.1 21.4 28.5 L7.25 14.35 7.25 10.1 6.55 9.4 Q5.95 8.8 6 7.95 5.95 7.1 6.5 6.55 7.1 5.95 7.95 6 8.8 5.95 9.4 6.55 L10.15 7.3 14.3 7.25 28.45 21.4 M19.95 24.2 L24.2 19.95 22.8 18.55 18.55 22.8 19.95 24.2 M9.25 13.5 L10.05 14.3 14.3 10.05 13.5 9.25 9.25 9.3 9.25 13.5',
    FLIP_V
  ),
  6,
  18,
  'crosshair'
);
const CROSSHAIR = svgCursor(
  kenney(
    'M17 2 Q18.2 2 19.15 2.9 20 3.8 20 5 L20 12 27 12 Q28.2 12 29.15 12.9 30 13.8 30 15 L30 17 Q30 18.2 29.15 19.15 28.2 20 27 20 L20 20 20 27 Q20 28.2 19.15 29.15 18.2 30 17 30 L15 30 Q13.8 30 12.9 29.15 12 28.2 12 27 L12 20 5 20 Q3.8 20 2.9 19.15 2 18.2 2 17 L2 15 Q2 13.8 2.9 12.9 3.8 12 5 12 L12 12 12 5 Q12 3.8 12.9 2.9 13.8 2 15 2 L17 2 M14 27 L14.3 27.7 Q14.6 28 15 28 L17 28 17.7 27.7 18 27 18 18.05 18.05 18 27 18 Q27.4 18 27.7 17.7 L28 17 28 15 27.7 14.3 Q27.4 14 27 14 L18 14 18 5 17.7 4.3 17 4 15 4 Q14.6 4 14.3 4.3 14 4.6 14 5 L14 14 5 14 Q4.6 14 4.3 14.3 4 14.6 4 15 L4 17 Q4 17.4 4.3 17.7 4.6 18 5 18 L14 18 14 27',
    'M14 27 L14 18 5 18 Q4.6 18 4.3 17.7 4 17.4 4 17 L4 15 Q4 14.6 4.3 14.3 4.6 14 5 14 L14 14 14 5 Q14 4.6 14.3 4.3 14.6 4 15 4 L17 4 17.7 4.3 18 5 18 14 27 14 Q27.4 14 27.7 14.3 L28 15 28 17 27.7 17.7 Q27.4 18 27 18 L18.05 18 18 18.05 18 27 17.7 27.7 17 28 15 28 Q14.6 28 14.3 27.7 L14 27'
  ),
  12,
  12,
  'crosshair'
);
const ERASER = svgCursor(
  kenney(
    'M3.9 11.35 Q2.3 12.5 3.7 13.9 L16.4 26.65 Q17.85 28.05 19.45 26.9 L27.65 21.15 Q29.3 20 27.85 18.6 L15.15 5.85 Q13.75 4.45 12.1 5.6 L3.9 11.35 M1.05 12.4 Q1 10.95 2.75 9.75 L10.95 4 10.95 3.95 Q14 1.85 16.6 4.45 L29.3 17.2 Q30.8 18.65 30.55 20.1 30.55 21.55 28.8 22.8 L20.6 28.55 20.65 28.55 Q17.7 30.65 15 28.1 L15 28.05 2.3 15.3 2.3 15.35 Q0.8 13.85 1.05 12.4 M13.5 7 L19.85 13.35 11.65 19.15 5.3 12.75 13.5 7',
    'M13.5 7 L5.3 12.75 11.65 19.15 19.85 13.35 13.5 7 M3.9 11.35 L12.1 5.6 Q13.75 4.45 15.15 5.85 L27.85 18.6 Q29.3 20 27.65 21.15 L19.45 26.9 Q17.85 28.05 16.4 26.65 L3.7 13.9 Q2.3 12.5 3.9 11.35'
  ),
  6,
  14,
  'cell'
);

// Text — a classic I-beam (vertical stem + top/bottom serifs). Authored in the
// same dark-INK glyph + white-HALO treatment as the Kenney glyphs (Kenney's
// pointer_i reads as a small bracket, not an I-beam). Hotspot dead-centre.
const TEXT = svgCursor(
  `<svg ${W}><path d='M16 4V28M11 4H21M11 28H21' fill='none' ${HALO} stroke-width='5'/><path d='M16 4V28M11 4H21M11 28H21' fill='none' stroke='${INK}' stroke-width='2.25' stroke-linecap='round'/></svg>`,
  12,
  12,
  'text'
);

// Sticky — a note with a peeled/folded top-right corner (the universal sticky
// glyph). Authored in the same treatment (Kenney has no sticky-note). Hotspot
// at the note's top-left, where the note is dropped.
const STICKY = svgCursor(
  `<svg ${W}><path d='M6 5H21L26 10V27H6Z' fill='${INK}' ${HALO} stroke-width='2.5'/><path d='M21 5V11H26' fill='none' ${HALO} stroke-width='2.25'/></svg>`,
  5,
  5,
  'crosshair'
);

/**
 * Tool → CSS cursor value. Phase 24 — every tool ships a Kenney glyph (no
 * system fallback for `move` anymore; the brief is ONE unified library). The
 * single Shape tool uses the crosshair; `rect`/`ellipse` stay keyed (still in
 * the Tool union) but are no longer directly selectable.
 */
// Frozen so the docstring's "frozen map" guarantee is real: `resolveToolCursor`
// is a pure lookup into this object, and freezing forecloses any same-realm
// shell-side code ever mutating an entry out from under the lookup (the canvas
// runs cross-origin and can't reach it regardless — this is belt-and-braces).
export const TOOL_CURSORS: Record<Tool, string> = Object.freeze({
  // feature-4 (browse/move split) — the browse tool is a pure native
  // pass-through, so it shows the SYSTEM cursor: `default` over the shell
  // chrome, and (special-cased in use-tool-mode.tsx) native element cursors
  // — pointer over buttons, text over inputs — over the live mock, so the
  // canvas reads as ALIVE. Never a forced custom glyph.
  browse: 'default',
  move: MOVE,
  inspect: MOVE, // S3.11 — the arrow: inspect reads, it does not grab
  hand: HAND,
  comment: COMMENT,
  pen: PEN,
  // FigJam v3 — the section container draws like a shape (crosshair glyph).
  section: CROSSHAIR,
  // Highlighter = Kenney `drawing_pencil` rot180; pen = `drawing_pen` rot180 —
  // distinct glyphs, both from the Kenney pack (user steer 2026-06-04).
  highlighter: HIGHLIGHTER,
  shape: CROSSHAIR,
  rect: CROSSHAIR,
  ellipse: CROSSHAIR,
  sticky: STICKY,
  arrow: CROSSHAIR,
  text: TEXT,
  // S2.12b — Edit's click-to-type Text wears the same I-beam.
  'el-text': TEXT,
  // S2.13 — the drag tools of Edit draw from a crosshair
  frame: CROSSHAIR,
  'el-shape': CROSSHAIR,
  line: CROSSHAIR,
  polygon: CROSSHAIR,
  slice: CROSSHAIR,
  // S2.14 — the Pen draws from a crosshair too
  'el-pen': CROSSHAIR,
  crop: CROSSHAIR,
  eraser: ERASER,
});

/**
 * Resolve a tool token — received over the **untrusted** canvas→shell
 * `tool-cursor` postMessage bridge — to a TRUSTED cursor string from
 * {@link TOOL_CURSORS}, or `null` when the token is not a known tool.
 *
 * The app shell applies the value this RETURNS, never the raw message. That is
 * the security boundary: a malicious *synced* canvas (DDR-054 — canvas content
 * is untrusted and may be hub-pushed) can call
 * `window.parent.postMessage({ dgn: 'tool-cursor', tool: … }, '*')` directly,
 * bypassing the honest `ToolProvider` sender. By echoing only a token and
 * looking the cursor up here, the worst that canvas can do is pick *which*
 * known, always-visible glyph the shell shows — it can no longer smuggle an
 * invisible / displaced / zero-content SVG cursor that would act as a
 * clickjacking aid over the un-CSP'd shell (phase-24 ethical-hacker Finding 2;
 * see DDR-067). `hasOwnProperty` (not `in`) keeps `constructor`/`__proto__`
 * off the allowlist, and the `[a-z-]` shape gate bars anything but a tool id.
 */
export function resolveToolCursor(token: unknown): string | null {
  if (typeof token !== 'string' || !/^[a-z-]+$/.test(token)) return null;
  if (!Object.hasOwn(TOOL_CURSORS, token)) return null;
  return TOOL_CURSORS[token as Tool];
}
