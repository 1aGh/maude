// client/v2/access/access-card.jsx — S9.21 (10 co-access-ends, left/middle): access ends, gently.
//
// Lukáš was removed while he had a canvas open. The hub waited `switchGraceMs` so his last change landed first
// (V2-1.7 §5.6), then ended the session; his window dims behind one sentence and Back to Home. The local copy of
// the project is removed (V2-1.7 Q6) — Back to Home is the only way on. The card names the PROJECT only: it
// never says which canvases there were, or that any other exists.

import { WORDS } from './access-client.js';

export function AccessEndedCard({ project, onHome }) {
  return (
    <div className="v2ac-scrim" data-testid="access-ended">
      <div className="v2ac-card v2ac-card--low" role="alertdialog" aria-labelledby="v2ac-ended-t">
        <span className="v2ac-card-ic" aria-hidden="true">
          <LockGlyph />
        </span>
        <p className="v2ac-card-t" id="v2ac-ended-t">
          {WORDS.endedTitle(project)}
        </p>
        <p className="v2ac-card-b">{WORDS.endedLine}</p>
        <button
          type="button"
          className="btn btn--primary"
          data-testid="access-ended-home"
          onClick={() => onHome?.()}
        >
          {WORDS.backHome}
        </button>
      </div>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
