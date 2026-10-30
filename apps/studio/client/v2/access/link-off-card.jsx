// client/v2/access/link-off-card.jsx — S9.21 (10 co-access-ends, right; co-browser-view): a viewer on a link that
// was turned off gets the same calm card as a removed person. It names only the canvas the link was FOR (the one
// already on their screen) — never another canvas, never whether anything else exists.

import { useModalFocus } from '../shell/modal-focus.js';
import { Glyph } from '../share/glyphs.jsx';
import { canvasName, WORDS } from './access-client.js';

const noop = () => {};

export function LinkOffCard({ canvas }) {
  // a modal with nothing to press: focus rests on the card, Tab stays on it (no esc — there is no way back)
  const ref = useModalFocus({ onClose: noop, esc: false });
  return (
    <div className="v2ac-scrim" data-testid="access-link-off">
      <div
        ref={ref}
        className="v2ac-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="v2ac-linkoff-t"
        aria-describedby="v2ac-linkoff-b"
        tabIndex={-1}
      >
        <span className="v2ac-card-ic" aria-hidden="true">
          <Glyph name="link" size={16} />
        </span>
        <p className="v2ac-card-t" id="v2ac-linkoff-t">
          {WORDS.linkOffTitle}
        </p>
        <p className="v2ac-card-b" id="v2ac-linkoff-b">
          {WORDS.linkOffLine(canvasName(canvas))}
        </p>
      </div>
    </div>
  );
}
