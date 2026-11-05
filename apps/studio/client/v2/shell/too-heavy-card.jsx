// client/v2/shell/too-heavy-card.jsx — 2.0.5: the card a tab shows instead of a canvas that keeps crashing
// the page (canvas-crash-guard.js). The viewport mounts it INSTEAD of the frame, like the not-local card:
// no frame, so nothing heavy runs until the person picks a way in.

import { Empty } from '../empty/empty.jsx';

/** @param {{ name: string, onLight: () => void, onAll: () => void }} props */
export function TooHeavyCanvas({ name, onLight, onAll }) {
  return (
    <Empty
      size="canvas"
      glyph="offline"
      title="This canvas is too heavy to show all at once."
      next={`Maude had to reload twice while ${name} was drawing. Show the artboards near where you look; the rest draw as you move to them.`}
      testid="canvas-too-heavy"
      actions={
        <>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            data-testid="canvas-too-heavy-light"
            onClick={onLight}
          >
            Show visible artboards only
          </button>
          <button
            type="button"
            className="btn btn--sm"
            data-testid="canvas-too-heavy-all"
            onClick={onAll}
          >
            Show everything
          </button>
        </>
      }
    />
  );
}
