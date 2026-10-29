// client/v2/assets/connect-key-sheet.jsx — "Connect a Google key?" (12 · ia-edges H; p8-ia-edges, Michal 2026-10-29).
//
// Generate with no image key connected used to end in a red line. Now the press of Generate gets this sheet: Connect
// goes to the one key flow (Settings › Connections › AI images — `onConnect`, supplied by the Assets tab), and the
// prompt the person already wrote waits for the key (generate-ask.jsx runs it once the key lands). Cancel drops it.
//
// Same plane as the other import sheets (brand.css `.bi-*`, 372 wide like the Figma sheet), same focus discipline.

import { useRef } from 'react';
import { useModalFocus } from '../shell/modal-focus.js';

export const KEY_WORDS = Object.freeze({
  title: 'Connect a Google key?',
  body: "Connect a Google AI key to make this image. Images are billed to your own key; the cloud plan doesn't include them.",
  cancel: 'Cancel',
  connect: 'Connect',
  // the ask's own line while the prompt waits for the key (so Connect is never followed by silence)
  waiting: 'Waiting for your Google key. The picture starts by itself once it is connected.',
});

/** @param {{ onConnect: () => void, onCancel: () => void }} p */
export default function ConnectKeySheet({ onConnect, onCancel }) {
  const connectRef = useRef(null);
  const ref = useModalFocus({ open: true, onClose: onCancel, initialRef: connectRef });
  return (
    <>
      <div className="bi-scrim" aria-hidden="true" />
      <div
        ref={ref}
        className="bi-sheet island fi-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gk-title"
        tabIndex={-1}
        data-testid="generate-key-sheet"
      >
        <header className="bi-hd">
          <strong id="gk-title" className="bi-title">
            {KEY_WORDS.title}
          </strong>
        </header>
        <div className="bi-body">
          <p>{KEY_WORDS.body}</p>
        </div>
        <footer className="bi-foot">
          <span className="bi-gap" />
          <button
            type="button"
            className="btn btn--sm"
            data-testid="generate-key-cancel"
            onClick={onCancel}
          >
            {KEY_WORDS.cancel}
          </button>
          <button
            ref={connectRef}
            type="button"
            className="btn btn--sm btn--primary"
            data-testid="generate-key-connect"
            onClick={onConnect}
          >
            {KEY_WORDS.connect}
          </button>
        </footer>
      </div>
    </>
  );
}
