// client/v2/empty/spot-art.jsx — S11.1: the eight empty-state spots as inline JSX (GENERATED).
//
// Source of truth: .design/system/maude-v2/assets/organic/_build-spots.ts, drawn with the draw
// engine (DDR-070) — do not hand-edit; regenerate with
//   bash apps/studio/bin/draw-build.sh --script .design/system/maude-v2/assets/organic/_build-spots.ts
// Token fills only (no hex). `stickies` are the landing layers (render functions): spot.jsx wraps each in <g class="es-st">
// so the spring moves one note at a time while `base` holds still.

export const SPOT_NAMES = Object.freeze([
  'canvas',
  'ai',
  'none',
  'comment',
  'image',
  'done',
  'offline',
  'trash',
]);

/** The dot field every spot sits on (three rings of the canvas grid, fading out). */
export const DOTS = (
  <>
    <g>
      <circle cx="88" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="104" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="120" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="136" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="152" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="56" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="72" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="88" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="104" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="120" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="136" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="152" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="168" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="184" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="56" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="72" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="88" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="104" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="120" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="136" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="152" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="168" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="184" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="56" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="72" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="88" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="104" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="120" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="136" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="152" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="168" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="184" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="56" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="72" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="88" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="104" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="120" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="136" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="152" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="168" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="184" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="88" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="104" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="120" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="136" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="152" cy="120" r="1" fill="var(--canvas-dot)" />
    </g>
    <g opacity="0.6">
      <circle cx="72" cy="24" r="1" fill="var(--canvas-dot)" />
      <circle cx="88" cy="24" r="1" fill="var(--canvas-dot)" />
      <circle cx="104" cy="24" r="1" fill="var(--canvas-dot)" />
      <circle cx="120" cy="24" r="1" fill="var(--canvas-dot)" />
      <circle cx="136" cy="24" r="1" fill="var(--canvas-dot)" />
      <circle cx="152" cy="24" r="1" fill="var(--canvas-dot)" />
      <circle cx="168" cy="24" r="1" fill="var(--canvas-dot)" />
      <circle cx="40" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="56" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="72" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="168" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="184" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="200" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="40" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="200" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="24" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="40" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="200" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="216" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="24" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="40" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="200" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="216" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="40" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="200" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="40" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="56" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="72" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="168" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="184" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="200" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="72" cy="136" r="1" fill="var(--canvas-dot)" />
      <circle cx="88" cy="136" r="1" fill="var(--canvas-dot)" />
      <circle cx="104" cy="136" r="1" fill="var(--canvas-dot)" />
      <circle cx="120" cy="136" r="1" fill="var(--canvas-dot)" />
      <circle cx="136" cy="136" r="1" fill="var(--canvas-dot)" />
      <circle cx="152" cy="136" r="1" fill="var(--canvas-dot)" />
      <circle cx="168" cy="136" r="1" fill="var(--canvas-dot)" />
    </g>
    <g opacity="0.3">
      <circle cx="72" cy="8" r="1" fill="var(--canvas-dot)" />
      <circle cx="88" cy="8" r="1" fill="var(--canvas-dot)" />
      <circle cx="104" cy="8" r="1" fill="var(--canvas-dot)" />
      <circle cx="120" cy="8" r="1" fill="var(--canvas-dot)" />
      <circle cx="136" cy="8" r="1" fill="var(--canvas-dot)" />
      <circle cx="152" cy="8" r="1" fill="var(--canvas-dot)" />
      <circle cx="168" cy="8" r="1" fill="var(--canvas-dot)" />
      <circle cx="40" cy="24" r="1" fill="var(--canvas-dot)" />
      <circle cx="56" cy="24" r="1" fill="var(--canvas-dot)" />
      <circle cx="184" cy="24" r="1" fill="var(--canvas-dot)" />
      <circle cx="200" cy="24" r="1" fill="var(--canvas-dot)" />
      <circle cx="24" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="216" cy="40" r="1" fill="var(--canvas-dot)" />
      <circle cx="8" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="24" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="216" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="232" cy="56" r="1" fill="var(--canvas-dot)" />
      <circle cx="8" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="232" cy="72" r="1" fill="var(--canvas-dot)" />
      <circle cx="8" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="232" cy="88" r="1" fill="var(--canvas-dot)" />
      <circle cx="8" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="24" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="216" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="232" cy="104" r="1" fill="var(--canvas-dot)" />
      <circle cx="24" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="216" cy="120" r="1" fill="var(--canvas-dot)" />
      <circle cx="40" cy="136" r="1" fill="var(--canvas-dot)" />
      <circle cx="56" cy="136" r="1" fill="var(--canvas-dot)" />
      <circle cx="184" cy="136" r="1" fill="var(--canvas-dot)" />
      <circle cx="200" cy="136" r="1" fill="var(--canvas-dot)" />
      <circle cx="72" cy="152" r="1" fill="var(--canvas-dot)" />
      <circle cx="88" cy="152" r="1" fill="var(--canvas-dot)" />
      <circle cx="104" cy="152" r="1" fill="var(--canvas-dot)" />
      <circle cx="120" cy="152" r="1" fill="var(--canvas-dot)" />
      <circle cx="136" cy="152" r="1" fill="var(--canvas-dot)" />
      <circle cx="152" cy="152" r="1" fill="var(--canvas-dot)" />
      <circle cx="168" cy="152" r="1" fill="var(--canvas-dot)" />
    </g>
  </>
);

export const SPOT_ART = {
  canvas: {
    base: (
      <g transform="translate(116 20)">
        <rect x="0" y="2" width="96" height="72" rx="8" fill="var(--object-ink)" opacity="0.08" />
        <rect
          x="0"
          y="0"
          width="96"
          height="72"
          rx="8"
          fill="var(--bg-1)"
          stroke="var(--fg-2)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="4"
          y1="-8"
          x2="28"
          y2="-8"
          stroke="var(--fg-2)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
      </g>
    ),
    stickies: [
      () => (
        <g transform="translate(36 96) rotate(-6 20 20)">
          <rect x="0" y="2" width="40" height="40" rx="4" fill="var(--object-ink)" opacity="0.08" />
          <rect
            x="0"
            y="0"
            width="40"
            height="40"
            rx="4"
            fill="var(--object-yellow)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="8"
            y1="8"
            x2="32"
            y2="8"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.35"
          />
          <line
            x1="8"
            y1="14"
            x2="22.4"
            y2="14"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.35"
          />
        </g>
      ),
      () => (
        <g transform="translate(100 76) rotate(5 18 18)">
          <rect x="0" y="2" width="36" height="36" rx="4" fill="var(--object-ink)" opacity="0.08" />
          <rect
            x="0"
            y="0"
            width="36"
            height="36"
            rx="4"
            fill="var(--object-lilac)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="7.2"
            y1="7.2"
            x2="28.8"
            y2="7.2"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.35"
          />
          <line
            x1="7.2"
            y1="13.2"
            x2="20.16"
            y2="13.2"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.35"
          />
        </g>
      ),
      () => (
        <g transform="translate(184 116) rotate(-3 14 14)">
          <rect x="0" y="2" width="28" height="28" rx="4" fill="var(--object-ink)" opacity="0.08" />
          <rect
            x="0"
            y="0"
            width="28"
            height="28"
            rx="4"
            fill="var(--object-green)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="5.6"
            y1="5.6"
            x2="22.4"
            y2="5.6"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.35"
          />
        </g>
      ),
    ],
  },
  ai: {
    base: (
      <>
        <polygon
          points="84,43 92.4,67.6 117,76 92.4,84.4 84,109 75.6,84.4 51,76 75.6,67.6"
          fill="var(--spark)"
        />
        <polygon
          points="128,26.1 130.52,33.48 137.9,36 130.52,38.52 128,45.9 125.48,38.52 118.1,36 125.48,33.48"
          fill="var(--spark)"
        />
      </>
    ),
    stickies: [
      () => (
        <g transform="translate(136 56) rotate(4 28 28)">
          <rect x="0" y="2" width="56" height="56" rx="4" fill="var(--object-ink)" opacity="0.08" />
          <rect
            x="0"
            y="0"
            width="56"
            height="56"
            rx="4"
            fill="var(--object-yellow)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="11.2"
            y1="7.2"
            x2="11.2"
            y2="19.2"
            stroke="var(--spark)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
      ),
    ],
  },
  none: {
    base: (
      <>
        <g transform="translate(120 80) rotate(-6 48 32)">
          <rect
            x="0"
            y="0"
            width="96"
            height="64"
            rx="10"
            fill="var(--object-sky)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fillOpacity="0.55"
            strokeDasharray="4 4"
          />
        </g>
        <g transform="translate(20 28)">
          <rect
            x="0"
            y="2"
            width="128"
            height="32"
            rx="16"
            fill="var(--object-ink)"
            opacity="0.08"
          />
          <rect
            x="0"
            y="0"
            width="128"
            height="32"
            rx="16"
            fill="var(--bg-1)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx="18"
            cy="16"
            r="5"
            fill="none"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="21.54"
            y1="19.54"
            x2="24.36"
            y2="22.36"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="36"
            y1="16"
            x2="76"
            y2="16"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="82"
            y1="10"
            x2="82"
            y2="22"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
      </>
    ),
    stickies: [],
  },
  comment: {
    base: (
      <>
        <g transform="translate(52 26)">
          <rect
            x="0"
            y="2"
            width="112"
            height="84"
            rx="8"
            fill="var(--object-ink)"
            opacity="0.08"
          />
          <rect
            x="0"
            y="0"
            width="112"
            height="84"
            rx="8"
            fill="var(--bg-1)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="12"
            y1="16"
            x2="60"
            y2="16"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.55"
          />
          <line
            x1="12"
            y1="26"
            x2="44"
            y2="26"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.55"
          />
          <rect
            x="12"
            y="38"
            width="88"
            height="34"
            rx="4"
            fill="var(--object-sky)"
            fillOpacity="0.45"
          />
        </g>
        <g transform="translate(140 62) scale(3)">
          <g transform="translate(0 0.6)">
            <path
              d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z"
              fill="var(--object-ink)"
              opacity="0.08"
            />
          </g>
          <path
            d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z"
            fill="var(--object-yellow)"
            stroke="var(--fg-2)"
            strokeWidth="0.5"
            strokeLinejoin="round"
          />
          <g opacity="0.45">
            <circle cx="5.5" cy="8" r="0.6" fill="var(--object-ink)" />
            <circle cx="8" cy="8" r="0.6" fill="var(--object-ink)" />
            <circle cx="10.5" cy="8" r="0.6" fill="var(--object-ink)" />
          </g>
        </g>
        <g transform="translate(22 88) scale(2.25)">
          <path
            d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z"
            fill="none"
            stroke="var(--fg-2)"
            strokeWidth="0.67"
            strokeLinejoin="round"
            strokeDasharray="1.33 1.33"
          />
        </g>
      </>
    ),
    stickies: [],
  },
  image: {
    base: (
      <>
        <g transform="translate(40 40)">
          <rect
            x="0"
            y="0"
            width="160"
            height="104"
            rx="12"
            fill="var(--object-sky)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fillOpacity="0.22"
            strokeDasharray="4 4"
          />
        </g>
        <g transform="translate(58 56) rotate(-7 40 30)">
          <rect x="0" y="2" width="80" height="60" rx="6" fill="var(--object-ink)" opacity="0.08" />
          <rect
            x="0"
            y="0"
            width="80"
            height="60"
            rx="6"
            fill="var(--object-green)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx="58"
            cy="18"
            r="6"
            fill="var(--object-yellow)"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeOpacity="0.35"
          />
          <polyline
            points="8,50 26,32 38,42 50,30 72,50"
            fill="none"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.4"
          />
        </g>
        <g transform="translate(104 66) rotate(6 40 30)">
          <rect x="0" y="2" width="80" height="60" rx="6" fill="var(--object-ink)" opacity="0.08" />
          <rect
            x="0"
            y="0"
            width="80"
            height="60"
            rx="6"
            fill="var(--object-coral)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx="58"
            cy="18"
            r="6"
            fill="var(--object-yellow)"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeOpacity="0.35"
          />
          <polyline
            points="8,50 26,32 38,42 50,30 72,50"
            fill="none"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.4"
          />
        </g>
        <line
          x1="120"
          y1="10"
          x2="120"
          y2="34"
          stroke="var(--fg-2)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points="112,27 120,35 128,27"
          fill="none"
          stroke="var(--fg-2)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
    stickies: [],
  },
  done: {
    base: (
      <>
        <g transform="translate(40 58) scale(2.5)">
          <g transform="translate(0 0.6)">
            <path
              d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z"
              fill="var(--object-ink)"
              opacity="0.08"
            />
          </g>
          <path
            d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z"
            fill="var(--object-lilac)"
            stroke="var(--fg-2)"
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(160 40) scale(2.25)">
          <g transform="translate(0 0.6)">
            <path
              d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z"
              fill="var(--object-ink)"
              opacity="0.08"
            />
          </g>
          <path
            d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z"
            fill="var(--object-sky)"
            stroke="var(--fg-2)"
            strokeWidth="0.67"
            strokeLinejoin="round"
          />
        </g>
      </>
    ),
    stickies: [
      () => (
        <g transform="translate(84 24) scale(4.5)">
          <g transform="translate(0 0.6)">
            <path
              d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z"
              fill="var(--object-ink)"
              opacity="0.08"
            />
          </g>
          <path
            d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z"
            fill="var(--object-green)"
            stroke="var(--fg-2)"
            strokeWidth="0.33"
            strokeLinejoin="round"
          />
          <polyline
            points="5.5,8.1 7.2,9.8 10.5,6.2"
            fill="none"
            stroke="var(--object-ink)"
            strokeWidth="0.33"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.7"
          />
        </g>
      ),
    ],
  },
  offline: {
    base: (
      <>
        <g transform="translate(68 40)">
          <rect
            x="0"
            y="2"
            width="104"
            height="66"
            rx="8"
            fill="var(--object-ink)"
            opacity="0.08"
          />
          <rect
            x="0"
            y="0"
            width="104"
            height="66"
            rx="8"
            fill="var(--bg-1)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(56 108)">
          <rect
            x="0"
            y="0"
            width="128"
            height="8"
            rx="4"
            fill="var(--bg-1)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g transform="translate(80 52) rotate(-4 15 15)">
          <rect x="0" y="2" width="30" height="30" rx="4" fill="var(--object-ink)" opacity="0.08" />
          <rect
            x="0"
            y="0"
            width="30"
            height="30"
            rx="4"
            fill="var(--object-yellow)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="6"
            y1="6"
            x2="24"
            y2="6"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.35"
          />
        </g>
        <g transform="translate(120 58) rotate(5 13 13)">
          <rect x="0" y="2" width="26" height="26" rx="4" fill="var(--object-ink)" opacity="0.08" />
          <rect
            x="0"
            y="0"
            width="26"
            height="26"
            rx="4"
            fill="var(--object-green)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="5.2"
            y1="5.2"
            x2="20.8"
            y2="5.2"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.35"
          />
          <line
            x1="5.2"
            y1="11.2"
            x2="14.56"
            y2="11.2"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.35"
          />
        </g>
        <g transform="translate(168 14)">
          <rect
            x="0"
            y="0"
            width="56"
            height="28"
            rx="14"
            fill="none"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="4 4"
          />
        </g>
        <line
          x1="176"
          y1="46"
          x2="158"
          y2="64"
          stroke="var(--fg-2)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="3 4"
        />
      </>
    ),
    stickies: [],
  },
  trash: {
    base: (
      <>
        <g transform="translate(36 62) rotate(-6 22 30)">
          <rect
            x="0"
            y="0"
            width="44"
            height="60"
            rx="6"
            fill="var(--object-sky)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fillOpacity="0.35"
            strokeDasharray="4 4"
          />
        </g>
        <ellipse cx="120" cy="128" rx="34" ry="3" fill="var(--object-ink)" opacity="0.08" />
        <rect
          x="108"
          y="40"
          width="24"
          height="8"
          rx="3"
          fill="var(--bg-1)"
          stroke="var(--fg-2)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="88"
          y1="52"
          x2="152"
          y2="52"
          stroke="var(--fg-2)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polygon
          points="92,58 148,58 142,124 98,124"
          fill="var(--bg-1)"
          stroke="var(--fg-2)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="108"
          y1="72"
          x2="108"
          y2="110"
          stroke="var(--fg-2)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
        <line
          x1="120"
          y1="72"
          x2="120"
          y2="110"
          stroke="var(--fg-2)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
        <line
          x1="132"
          y1="72"
          x2="132"
          y2="110"
          stroke="var(--fg-2)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
        <g transform="translate(164 88) rotate(8 16 16)">
          <rect x="0" y="2" width="32" height="32" rx="4" fill="var(--object-ink)" opacity="0.08" />
          <rect
            x="0"
            y="0"
            width="32"
            height="32"
            rx="4"
            fill="var(--object-yellow)"
            stroke="var(--fg-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="6.4"
            y1="6.4"
            x2="25.6"
            y2="6.4"
            stroke="var(--object-ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.35"
          />
        </g>
      </>
    ),
    stickies: [],
  },
};
