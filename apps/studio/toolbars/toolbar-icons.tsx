// apps/studio/toolbars/toolbar-icons.tsx — the glyphs the two toolbars need that the v1 tool set
// (canvas-icons.tsx) never had: Frame, Image, Stickers, More. Same house style (24 grid, currentColor).

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

export function IconMore(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={3} />
    </Svg>
  );
}

export const SLOT_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  frame: IconFrame,
  image: IconImage,
  stickers: IconStickers,
  more: IconMore,
};
