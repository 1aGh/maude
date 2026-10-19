// client/v2/access/link-off-card.jsx — S9.21 (10 co-access-ends, right; co-browser-view): a viewer on a link that
// was turned off gets the same calm card as a removed person. It names only the canvas the link was FOR (the one
// already on their screen) — never another canvas, never whether anything else exists.

import { WORDS } from './access-client.js';

export function LinkOffCard({ canvas }) {
  return (
    <div className="v2ac-scrim" data-testid="access-link-off">
      <div className="v2ac-card" role="alertdialog" aria-labelledby="v2ac-linkoff-t">
        <span className="v2ac-card-ic" aria-hidden="true">
          <LinkGlyph />
        </span>
        <p className="v2ac-card-t" id="v2ac-linkoff-t">
          {WORDS.linkOffTitle}
        </p>
        <p className="v2ac-card-b">{WORDS.linkOffLine(canvas)}</p>
      </div>
    </div>
  );
}

function LinkGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" />
    </svg>
  );
}
