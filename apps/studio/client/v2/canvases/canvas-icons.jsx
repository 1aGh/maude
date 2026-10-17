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

export const VideoIcon = ({ size }) => (
  <Svg size={size}>
    <rect x="2" y="4" width="8" height="8" rx="1.2" />
    <path d="M10 7.2l4-2v5.6l-4-2z" />
  </Svg>
);

export const SparkIcon = ({ size }) => (
  <Svg size={size} filled>
    <path d="M8 1.8l1.4 4.8L14 8l-4.6 1.4L8 14.2l-1.4-4.8L2 8l4.6-1.4z" stroke="none" />
  </Svg>
);
