// client/v2/empty/ask-button.jsx — S11.1: "Ask AI", the one button an empty state offers when the AI is the
// next step. Azure fill ("Azure acts"), the spark only as its glyph, drawn in the button's own colour — an AI
// action is still an action (05 · AskBtn; DS `.btn--spark`). Reached through the kit barrel; never copied.

/** The AI's four-point mark, filled with the button's own colour. */
export function SparkGlyph({ size = 10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5l1.4 3.7 3.7 1.4-3.7 1.4L8 11.7 6.6 8 2.9 6.6l3.7-1.4L8 1.5z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * @param {{ children: import('react').ReactNode, keys?: string, onClick?: (e: unknown) => void,
 *   disabled?: boolean, testid?: string }} props
 */
export function AskButton({ children, keys, onClick, disabled = false, testid = 'empty-ask' }) {
  return (
    <button
      type="button"
      className="es-ask"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
    >
      <SparkGlyph />
      {children}
      {keys ? <span className="es-keys">{keys}</span> : null}
    </button>
  );
}
