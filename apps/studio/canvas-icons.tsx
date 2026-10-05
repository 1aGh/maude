/**
 * @file       canvas-icons.tsx — Phase 5.1 inline-SVG icon set
 * @scope      apps/studio/canvas-icons.tsx
 * @purpose    Tiny dependency-free Lucide-style icon set for the canvas
 *             chrome (tool palette, context toolbar). Each icon is a single
 *             `<svg>` with `currentColor` stroke so it inherits the button
 *             foreground. Sized 16 px by default; the parent button is
 *             32 × 32, leaving 8 px of optical padding on every side.
 */

import type { JSX, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconMove(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4l16 6-7 2-2 7z" />
    </Svg>
  );
}
// feature-4 (browse/move split) — Browse tool. A pointing-hand ("tap") cursor:
// the universal "the mock is alive, click it" glyph, deliberately distinct from
// Move's solid selection arrow.
export function IconBrowse(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 9V5a1.4 1.4 0 012.8 0v6" />
      <path d="M12.8 10.4V9.6a1.3 1.3 0 012.6 0V12" />
      <path d="M15.4 12.2v-1a1.3 1.3 0 012.6 0V15c0 2.6-1.7 5-5 5-2 0-3.3-.8-4.4-2.2L6 13.4a1.4 1.4 0 012.2-1.7L10 13.6V9" />
    </Svg>
  );
}

// DDR-223 addendum 2 — the Preview/Edit/Present toggle glyphs (owner steer
// 2026-08-15): lucide `eye` + `pencil-ruler` (ISC), redrawn in the house
// 24 × 24 / 1.75-stroke language. Mode segments deliberately do NOT reuse tool
// glyphs — a mode is a way of looking at the canvas, not a recalled tool.
export function IconEye(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}
export function IconPencilRuler(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13" />
      <path d="m8 6 2-2" />
      <path d="m18 16 2-2" />
      <path d="m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17" />
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </Svg>
  );
}

export function IconHand(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 13V5a1.5 1.5 0 013 0v6" />
      <path d="M11 11V4a1.5 1.5 0 013 0v7" />
      <path d="M14 11V5.5a1.5 1.5 0 013 0V13" />
      <path d="M17 9a1.5 1.5 0 013 0v6a6 6 0 01-6 6h-2a6 6 0 01-5-2.5L4 14a1.5 1.5 0 012-2l2 2" />
    </Svg>
  );
}

export function IconComment(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12a8 8 0 11-3.3-6.5L21 4l-1 4.3A8 8 0 0121 12z" />
    </Svg>
  );
}

export function IconPen(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.5 4.5l5 5L8 21H3v-5z" />
      <path d="M13 6l5 5" />
    </Svg>
  );
}

export function IconRect(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
    </Svg>
  );
}

export function IconEllipse(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="12" rx="8" ry="6" />
    </Svg>
  );
}

export function IconArrow(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h14" />
      <path d="M13 6l6 6-6 6" />
    </Svg>
  );
}

export function IconEraser(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 3l5 5-11 11H4v-6z" />
      <path d="M8 14l5 5" />
    </Svg>
  );
}

// Phase 21 — sticky note: folded-corner square (dog-ear at the top-right).
export function IconSticky(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5h12l4 4v10H4z" />
      <path d="M16 5v4h4" />
    </Svg>
  );
}

// Phase 21 — standalone text: capital-T glyph (cap bar + stem).
export function IconText(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16" />
      <path d="M12 6v12" />
    </Svg>
  );
}

// Phase 23 — link (chain) glyph, used by the annotation context toolbar's
// "Open link" button. (Media is paste/drop-only — no toolbar buttons — so the
// picture-frame image icon was dropped.)
export function IconLink(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}

// DDR-223 addendum 2 — redrawn to the lucide `presentation` glyph so the three
// mode-segment icons (eye / pencil-ruler / presentation) read as one family.
export function IconPresentation(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 3h20" />
      <path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
      <path d="m7 21 5-5 5 5" />
    </Svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

// ── Phase 21 context-toolbar icons ──────────────────────────────────────────
// Corner radius: a square whose corners show the chosen rounding.
export function IconCornerSquare(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="5" width="14" height="14" rx="0.5" />
    </Svg>
  );
}
export function IconCornerSoft(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="5" width="14" height="14" rx="4" />
    </Svg>
  );
}
export function IconCornerPill(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="5" width="14" height="14" rx="7" />
    </Svg>
  );
}

// Arrow direction: a shaft with chevron head(s) on the chosen end(s).
export function IconArrowNone(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h16" />
    </Svg>
  );
}
export function IconArrowStartHead(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h16" />
      <path d="M9 7l-5 5 5 5" />
    </Svg>
  );
}
export function IconArrowEndHead(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h16" />
      <path d="M15 7l5 5-5 5" />
    </Svg>
  );
}
export function IconArrowBothHeads(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="M9 7l-5 5 5 5" />
      <path d="M15 7l5 5-5 5" />
    </Svg>
  );
}

// Dashed line toggle.
export function IconDash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h4" />
      <path d="M10 12h4" />
      <path d="M17 12h4" />
    </Svg>
  );
}

// Stroke weight: thin vs thick rule.
export function IconLineThin(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={1.25}>
      <path d="M4 12h16" />
    </Svg>
  );
}
export function IconLineThick(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={3.75}>
      <path d="M4 12h16" />
    </Svg>
  );
}

// Letter "A" — font-size chips render it at three sizes (S / M / L).
export function IconLetterA(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5L6 19" />
      <path d="M12 5l6 14" />
      <path d="M8.5 14h7" />
    </Svg>
  );
}

// Trash — delete selected annotations.
export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
      <path d="M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

// ── Phase 24 shape-tool icons ────────────────────────────────────────────────
// IconShape — the Shape tool button: a square + circle composite (FigJam-style).
export function IconShape(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="11" height="11" rx="1.5" />
      <circle cx="15" cy="15" r="5" />
    </Svg>
  );
}
export function IconSquare(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="0.5" />
    </Svg>
  );
}
export function IconRoundedSquare(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
    </Svg>
  );
}
export function IconCircle(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
    </Svg>
  );
}
export function IconDiamond(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l9 9-9 9-9-9z" />
    </Svg>
  );
}
export function IconTriangle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4l8 16H4z" />
    </Svg>
  );
}
export function IconTriangleDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4h16l-8 16z" />
    </Svg>
  );
}

// ── Phase 24 arrowhead-picker icons ──────────────────────────────────────────
// Each shows a short shaft ending in the head style on the right.
export function IconArrowheadLine(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h13" />
      <path d="M12 8l5 4-5 4" />
    </Svg>
  );
}
export function IconArrowheadTriangle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h11" />
      <path d="M13 8l6 4-6 4z" fill="currentColor" />
    </Svg>
  );
}
export function IconArrowheadTriangleOutline(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h11" />
      <path d="M13 8l6 4-6 4z" />
    </Svg>
  );
}
export function IconArrowheadCircle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h11" />
      <circle cx="17" cy="12" r="3" fill="currentColor" />
    </Svg>
  );
}
export function IconArrowheadDiamond(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h10" />
      <path d="M17 8l4 4-4 4-4-4z" fill="currentColor" />
    </Svg>
  );
}

// ── Phase 24 line-type icons ─────────────────────────────────────────────────
export function IconLineStraight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h16" />
    </Svg>
  );
}
export function IconLineCurved(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 18C4 9 20 15 20 6" />
    </Svg>
  );
}
export function IconLineElbow(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6v6a2 2 0 002 2h14" />
    </Svg>
  );
}

// ── Phase 24 text-style icons ────────────────────────────────────────────────
export function IconBold(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z" />
    </Svg>
  );
}
export function IconStrike(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="M8 7a4 3 0 016-1M16 16a4 3 0 01-7 1" />
    </Svg>
  );
}
export function IconAlignLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M4 12h10M4 18h13" />
    </Svg>
  );
}
export function IconAlignCenter(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M7 12h10M5 18h14" />
    </Svg>
  );
}
export function IconAlignRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M10 12h10M7 18h13" />
    </Svg>
  );
}

// ── Annotation polish text-style icons (italic / underline / lists) ──────────
export function IconItalic(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 5h8M6 19h8M14 5l-4 14" />
    </Svg>
  );
}
export function IconUnderline(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4v7a5 5 0 0010 0V4M5 20h14" />
    </Svg>
  );
}
export function IconListBullet(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  );
}
export function IconListOrdered(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M3 5l1.4-.5V9M3 9h2.8" strokeWidth={1.4} />
      <path d="M3.2 14.2a1 1 0 011.7.7c0 .9-1.7 1.4-1.7 2.6h2" strokeWidth={1.4} />
    </Svg>
  );
}

// ── Annotation polish — highlighter (chisel-tip marker) ──────────────────────
export function IconHighlighter(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 4l6 6-8.5 8.5H6v-5.5z" />
      <path d="M11 7l6 6" />
      <path d="M4 21h7" strokeWidth={2.5} />
    </Svg>
  );
}

export const TOOL_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  browse: IconBrowse,
  move: IconMove,
  hand: IconHand,
  comment: IconComment,
  pen: IconPen,
  highlighter: IconHighlighter,
  // Phase 24 — single Shape tool. rect/ellipse kept for any legacy lookups.
  shape: IconShape,
  rect: IconRect,
  ellipse: IconEllipse,
  sticky: IconSticky,
  // FigJam v3 — labelled organizing container.
  section: IconSection,
  arrow: IconArrow,
  text: IconText,
  eraser: IconEraser,
};

// Phase 24 — shape-kind → icon, for the palette popover + context toolbar.
export const SHAPE_KIND_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  square: IconSquare,
  rounded: IconRoundedSquare,
  circle: IconCircle,
  diamond: IconDiamond,
  triangle: IconTriangle,
  'triangle-down': IconTriangleDown,
};

// ── FigJam v3 — multi-select manipulation icons ──────────────────────────────
// Object align (an edge line + two boxes), distribute (rails + a box), and
// group/ungroup. Same 24×24 stroke language as the rest of the set.

export function IconObjAlignLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 3v18" />
      <rect x="7" y="6" width="11" height="4" rx="1" />
      <rect x="7" y="14" width="6" height="4" rx="1" />
    </Svg>
  );
}
export function IconObjAlignHCenter(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v2M12 19v2" />
      <rect x="6" y="6" width="12" height="4" rx="1" />
      <rect x="8" y="14" width="8" height="4" rx="1" />
    </Svg>
  );
}
export function IconObjAlignRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 3v18" />
      <rect x="6" y="6" width="11" height="4" rx="1" />
      <rect x="11" y="14" width="6" height="4" rx="1" />
    </Svg>
  );
}
export function IconObjAlignTop(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 4h18" />
      <rect x="6" y="7" width="4" height="11" rx="1" />
      <rect x="14" y="7" width="4" height="6" rx="1" />
    </Svg>
  );
}
export function IconObjAlignVCenter(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h2M19 12h2" />
      <rect x="6" y="6" width="4" height="12" rx="1" />
      <rect x="14" y="8" width="4" height="8" rx="1" />
    </Svg>
  );
}
export function IconObjAlignBottom(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 20h18" />
      <rect x="6" y="6" width="4" height="11" rx="1" />
      <rect x="14" y="11" width="4" height="6" rx="1" />
    </Svg>
  );
}
export function IconDistributeH(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 3v18M20 3v18" />
      <rect x="9" y="8" width="6" height="8" rx="1" />
    </Svg>
  );
}
export function IconDistributeV(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 4h18M3 20h18" />
      <rect x="8" y="9" width="8" height="6" rx="1" />
    </Svg>
  );
}
export function IconGroup(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7V4a1 1 0 011-1h3M17 3h3a1 1 0 011 1v3M21 17v3a1 1 0 01-1 1h-3M7 21H4a1 1 0 01-1-1v-3" />
      <rect x="7" y="7" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </Svg>
  );
}
/** Lucide `lock` — #137 annotation lock. */
export function IconLock(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </Svg>
  );
}
/** Lucide `lock-open` — #137 annotation unlock. */
export function IconLockOpen(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 019.9-1" />
    </Svg>
  );
}
export function IconUngroup(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
      <path d="M15 6l3 3M6 15l3 3" />
    </Svg>
  );
}

/** FigJam v3 — section tool: a region with its name chip docked top-left. */
export function IconSection(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M4 4h7" />
    </Svg>
  );
}
