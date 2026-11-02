// client/v2/empty/suggestions.jsx — S11.1: what the AI could do next, written as things you'd say.
// One chip per phrase. With `onPick` a chip is a button that hands the words back (the caller pre-fills the
// ask box and never sends — the person presses ↵); without it the chips are plain words.

/** @param {{ items: string[], onPick?: (text: string) => void }} props */
export function Suggestions({ items, onPick }) {
  return items.map((text) =>
    onPick ? (
      <button key={text} type="button" className="es-sugg" onClick={() => onPick(text)}>
        {text}
      </button>
    ) : (
      <span key={text} className="es-sugg">
        {text}
      </span>
    )
  );
}
