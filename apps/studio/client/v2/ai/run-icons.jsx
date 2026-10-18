// client/v2/ai/run-icons.jsx — S5.9: the few glyphs the working line and the result card draw
// (03 AI Chat: stop, undo, redo, compare, check). 12–14 px, currentColor, hairline stroke.

const base = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  focusable: 'false',
});

export const StopGlyph = ({ size = 12 }) => (
  <svg aria-hidden="true" {...base(size)} stroke="none" fill="currentColor">
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.6" />
  </svg>
);

export const UndoGlyph = ({ size = 12 }) => (
  <svg aria-hidden="true" {...base(size)}>
    <path d="M6 3.5 3 6.5l3 3" />
    <path d="M3.5 6.5h6a3.5 3.5 0 0 1 0 7H7" />
  </svg>
);

export const RedoGlyph = ({ size = 12 }) => (
  <svg aria-hidden="true" {...base(size)}>
    <path d="M10 3.5l3 3-3 3" />
    <path d="M12.5 6.5h-6a3.5 3.5 0 0 0 0 7H9" />
  </svg>
);

export const CompareGlyph = ({ size = 12 }) => (
  <svg aria-hidden="true" {...base(size)}>
    <rect x="2" y="3" width="5" height="10" rx="1" />
    <rect x="9" y="3" width="5" height="10" rx="1" />
  </svg>
);

export const CheckGlyph = ({ size = 12 }) => (
  <svg aria-hidden="true" {...base(size)}>
    <path d="M13.5 4.5l-7 7L3 8" />
  </svg>
);

export const StepsChevron = ({ size = 12 }) => (
  <svg aria-hidden="true" {...base(size)}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
);
