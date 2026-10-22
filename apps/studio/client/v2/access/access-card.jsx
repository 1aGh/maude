// client/v2/access/access-card.jsx — S9.21 (10 co-access-ends, left/middle): access ends, gently.
//
// Lukáš was removed while he had a canvas open. The hub waited `switchGraceMs` so his last change landed first
// (V2-1.7 §5.6), then ended the session; his window dims behind one sentence and Back to Home. The local copy of
// the project is removed (V2-1.7 Q6) — Back to Home is the only way on. The card names the PROJECT only: it
// never says which canvases there were, or that any other exists.
//
// P8 C7 (10 a11y): it is a modal — `aria-modal`, described by its own line, focus on Back to Home, Tab kept
// on the card, and no esc (there is nothing to go back to: the project is gone from this Mac).

import { useRef } from 'react';
import { useModalFocus } from '../shell/modal-focus.js';
import { Glyph } from '../share/glyphs.jsx';
import { WORDS } from './access-client.js';

const noop = () => {};

export function AccessEndedCard({ project, onHome }) {
  const homeRef = useRef(null);
  const ref = useModalFocus({ onClose: noop, esc: false, initialRef: homeRef });
  return (
    <div className="v2ac-scrim" data-testid="access-ended">
      <div
        ref={ref}
        className="v2ac-card v2ac-card--low"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="v2ac-ended-t"
        aria-describedby="v2ac-ended-b"
        tabIndex={-1}
      >
        <span className="v2ac-card-ic" aria-hidden="true">
          <Glyph name="lock" size={16} />
        </span>
        <p className="v2ac-card-t" id="v2ac-ended-t">
          {WORDS.endedTitle(project)}
        </p>
        <p className="v2ac-card-b" id="v2ac-ended-b">
          {WORDS.endedLine}
        </p>
        <button
          ref={homeRef}
          type="button"
          className="btn btn--primary"
          data-testid="access-ended-home"
          onClick={() => onHome?.()}
        >
          <Glyph name="home" size={14} />
          {WORDS.backHome}
        </button>
      </div>
    </div>
  );
}
