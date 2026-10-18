// client/v2/empty/artboard-hint.jsx — S11.2 (05 es-artboard-new): the hint that floats over a fresh, empty artboard.
//
// "Empty artboard." + how to start (draw a frame F, place an image I or a component ⇧I, or let AI start it
// from <another board>) + Ask AI to fill <the board>. It is chrome, drawn by the shell at the rect the canvas
// reported (`artboard-empty`), so it follows the app theme and the words live in the one copy table. It leaves
// the moment the board gets a first layer (the lane clears it on the first `layers-tree` with a layer).
//
// The ask pre-fills the chat and never sends (use-empty-canvas.js `createAskFlow` / `fillPrompt`).

import { AskButton } from './ask-button.jsx';
import { copy } from './empty-copy.js';
import { Empty } from './empty.jsx';
import { hintNext } from './use-empty-canvas.js';

/** The hint's box, for placement (05 `.es-abhint`: 236 wide). */
export const HINT_SIZE = Object.freeze({ w: 236, h: 150 });

/**
 * @param {{ hint: { artboardId: string, label: string, from?: string },
 *   placement: { left: number, top: number }, canAsk: boolean, onAsk?: (hint: object) => void }} props
 */
export function ArtboardHint({ hint, placement, canAsk, onAsk }) {
  const words = copy('es-artboard-new.artboard-empty', {
    artboard: hint.label,
    from: hint.from ?? '',
  });
  return (
    <div
      className="es-abhint"
      data-testid="empty-artboard-hint"
      data-artboard={hint.artboardId}
      style={{ left: placement.left, top: placement.top, width: HINT_SIZE.w }}
    >
      <Empty
        title={words.title}
        next={hintNext(hint.from)}
        chips={
          canAsk ? (
            <AskButton keys={words.keys} onClick={() => onAsk?.(hint)} testid="empty-artboard-ask">
              {words.action}
            </AskButton>
          ) : undefined
        }
      />
    </div>
  );
}
