// client/v2/ai/video/LeftOut.jsx — S7.15 (07 · ve-ai-cut, ve-ai-scrub, ve-ai-proposal): the clips the cut did not
// use, named with their reason — never hidden. While shots land it is a plain message from AI ("Watched all 12.
// Left out 3: …"); once the run has ended it is a quiet row with Use them anyway, which is a new ask.
// Presentational: `model` is card-model.js `leftOutModel`.

export function LeftOut({ model, ended, onUseThem, disabled = false }) {
  if (!model) return null;
  if (!ended) {
    return (
      <p className="ai-vmsg" data-testid="ai-left-out-live">
        {model.text}
      </p>
    );
  }
  return (
    <p className="ai-vleft" data-testid="ai-left-out">
      <span>{model.text}</span>
      <button
        type="button"
        className="ai-vlink"
        data-testid="ai-left-out-use"
        disabled={disabled}
        onClick={onUseThem}
      >
        Use them anyway
      </button>
    </p>
  );
}
