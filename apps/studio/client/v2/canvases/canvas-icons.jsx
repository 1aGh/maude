// client/v2/canvases/canvas-icons.jsx — S1.1: the few glyphs the Canvases panel needs that the shell's icon
// set has not got (pin, more, print, video). Same 16-box, 1.4 hairline grid as `StIcon`.

const Svg = ({ size = 12, filled = false, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ flex: 'none' }}
  >
    {children}
  </svg>
);

export const PinIcon = ({ size, filled }) => (
  <Svg size={size} filled={filled}>
    <path d="M9.6 2.2l4.2 4.2-1.2.6-2 2-.2 2.2-1 1-2.6-2.6-3.8 3.8" />
    <path d="M5.6 6.4l1-1 2.2-.2 2-2 .8-.4" />
  </Svg>
);

export const MoreIcon = ({ size }) => (
  <Svg size={size} filled>
    <circle cx="3.5" cy="8" r="1.1" stroke="none" />
    <circle cx="8" cy="8" r="1.1" stroke="none" />
    <circle cx="12.5" cy="8" r="1.1" stroke="none" />
  </Svg>
);

export const PrintIcon = ({ size }) => (
  <Svg size={size}>
    <path d="M4.5 6V2.5h7V6" />
    <path d="M4.5 11.5h-2V6h11v5.5h-2" />
    <rect x="4.5" y="9.5" width="7" height="4" />
  </Svg>
);

// V2-8.5 C4 (08 ak-picker): a video is the kit's picture frame with a play mark — not a camera
export const VideoIcon = ({ size }) => (
  <Svg size={size}>
    <rect x="2" y="3.5" width="12" height="9" rx="2.5" />
    <path d="M6.75 6.1v3.8L9.9 8z" />
  </Svg>
);

// the size picker's App (laptop) and Social (picture) group heads — the kit's own glyphs
export const LaptopIcon = ({ size }) => (
  <Svg size={size}>
    <rect x="3.5" y="3.5" width="9" height="6.5" rx="1.25" />
    <path d="M1.75 12.5h12.5" />
  </Svg>
);

export const ImageIcon = ({ size }) => (
  <Svg size={size}>
    <rect x="2.5" y="3" width="11" height="10" rx="2" />
    <circle cx="6" cy="6.5" r="1.25" />
    <path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" />
  </Svg>
);

// S1.3 — the artboard kind glyphs of the jump list (web and digital; print and video are above).
export const WebIcon = ({ size }) => (
  <Svg size={size}>
    <rect x="2" y="3" width="12" height="10" rx="1.2" />
    <path d="M2 6h12" />
  </Svg>
);

export const DigitalIcon = ({ size }) => (
  <Svg size={size}>
    <rect x="4.5" y="1.8" width="7" height="12.4" rx="1.4" />
    <path d="M7 12.2h2" />
  </Svg>
);

export const SparkIcon = ({ size }) => (
  <Svg size={size} filled>
    <path d="M8 1.8l1.4 4.8L14 8l-4.6 1.4L8 14.2l-1.4-4.8L2 8l4.6-1.4z" stroke="none" />
  </Svg>
);

// T-S1a — the glyphs a row slot's `sub.icon` names ('trash' | 'eye' | 'comment').
export const TrashIcon = ({ size }) => (
  <Svg size={size}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Svg>
);

export const EyeIcon = ({ size }) => (
  <Svg size={size}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="1.8" />
  </Svg>
);

export const CommentIcon = ({ size }) => (
  <Svg size={size}>
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
  </Svg>
);
