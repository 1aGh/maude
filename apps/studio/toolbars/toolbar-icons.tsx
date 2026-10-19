// apps/studio/toolbars/toolbar-icons.tsx — the glyphs the two toolbars need that the v1 tool set
// (canvas-icons.tsx) never had: Frame, Image, Stickers, Component, More, and (S2.13) Line, Polygon, Export area. Same house style (24 grid, currentColor).

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

/** Frame — the # of corner ticks Figma-style tools use for a box inside an artboard. */
export function IconFrame(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3v18M17 3v18M3 7h18M3 17h18" />
    </Svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l5-5 4 4 3-3 4 4" />
    </Svg>
  );
}

export function IconStickers(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14c.9 1.4 2.1 2.1 3.5 2.1s2.6-.7 3.5-2.1" />
      <path d="M9.2 9.6h.01M14.8 9.6h.01" strokeWidth={2.4} />
    </Svg>
  );
}

/** Component — four diamonds, the shape every design tool gives "an instance of something" (⇧I). */
export function IconComponent(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l3.2 3.2L12 9.9 8.8 6.7zM6.7 8.8l3.2 3.2-3.2 3.2L3.5 12zM17.3 8.8l3.2 3.2-3.2 3.2-3.2-3.2zM12 14.1l3.2 3.2L12 20.5l-3.2-3.2z" />
    </Svg>
  );
}

export function IconMore(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={3} />
    </Svg>
  );
}

/** Line (More, S2.13) — a diagonal stroke with its two ends. */
export function IconLineTool(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 19L19 5" />
      <path d="M4 20h.01M20 4h.01" strokeWidth={3} />
    </Svg>
  );
}

/** Pen (S2.14) — a pen nib over a curve. */
export function IconPenTool(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l6 8-3 4H9l-3-4z" />
      <path d="M12 15v3.5" />
      <circle cx="12" cy="11" r="1.1" />
      <path d="M8 21h8" />
    </Svg>
  );
}

/** Polygon (More, S2.13) — a hexagon. */
export function IconPolygon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" />
    </Svg>
  );
}

/** Export area (More, S2.13) — a dashed marquee with a corner tick. */
export function IconExportArea(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      <path d="M12 9v6M9.5 12.5L12 15l2.5-2.5" />
    </Svg>
  );
}

/** Crop (More, S2.15) — the two crossing crop marks. */
export function IconCrop(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3v14h14" />
      <path d="M3 7h14v14" />
    </Svg>
  );
}

export const SLOT_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  frame: IconFrame,
  image: IconImage,
  stickers: IconStickers,
  components: IconComponent,
  more: IconMore,
  line: IconLineTool,
  polygon: IconPolygon,
  slice: IconExportArea,
  crop: IconCrop,
};
