// client/v2/present/canvas-pill.jsx — S3.2b: Present the canvas (04 md-present-canvas).
//
//   Presenting the canvas │ 21% │ esc to leave
//
// "Today's Presentation mode, kept": no chrome, no pins, no annotations — this pill is the only thing the
// shell shows. It replaces the v1 exit button (`.st-present-exit`, "Exit presentation mode"): the class,
// the aria-label and the click are the same, so the characterization run and the contrast gate that name
// them still hold, and the pill carries its own testid. It is NOT faded — the v1 pill was pinned to AA at
// full strength (shell-text-contrast.test.ts), and the shell cannot hear a mouse move over the canvas
// iframe to bring a faded one back.

import { zoomText } from './present-controls-model.js';

/** @param zoom the canvas's zoom (1 = 100 %), from `viewport-zoom`; null until it reports one */
export function CanvasPill({ zoom = null, onLeave }) {
  const z = zoomText(zoom);
  return (
    <button
      type="button"
      className="st-present-exit pr-pill"
      data-testid="present-pill"
      onClick={onLeave}
      aria-label="Exit presentation mode"
      title="Exit presentation mode (Esc)"
    >
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 3.5h20" />
        <path d="M20.5 3.5v10a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5v-10" />
        <path d="m7.5 21 4.5-5 4.5 5" />
      </svg>
      <span className="pr-pill-t">Presenting the canvas</span>
      {z ? (
        <>
          <span className="pr-div" aria-hidden="true" />
          <span className="pr-zoom">{z}</span>
        </>
      ) : null}
      <span className="pr-div" aria-hidden="true" />
      <span className="pr-esc-hint">
        <kbd className="st-present-exit-kbd">esc</kbd>
        <span>to leave</span>
      </span>
    </button>
  );
}
