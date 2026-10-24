// client/v2/undo/zoom-undo.jsx — P8 C3: the Undo · Redo · zoom % island, bottom left (the kit's `ZoomUndo`,
// 01 cf-blank, 10 co-browser-view `k-uz`, 14 edit frames).
//
// Edit draws all three; Viewing draws the zoom alone (`co-zoom-only`: a viewer changes nothing); Preview
// has its own readout (ZoomOnly), Present none. The shell draws it — the canvas' own pill (the View ›
// Zoom controls toggle) stays what it was, a bigger tool for people who want fit / 1:1 on the canvas.
//
// Undo and Redo run the same verbs as ⌘Z / ⇧⌘Z (`edit.undo` / `edit.redo` through the menu runner), so
// the stack that takes back an AI edit, a timeline cut and a move is the one these buttons use. The
// percentage is a button: it fits the canvas (⌘0), which is what a person asks of the number.

import { modeCell } from '../../../bridge/mode-shows.ts';
import { StIcon } from '../../shell/icons.jsx';
import { zoomLabel } from '../preview/zoom-only.jsx';

/** Which form the island takes in a mode: `full` (Edit), `zoom-only` (Viewing), or none. */
export function zoomUndoForm(mode, present) {
  const bar = modeCell('toolbar', mode, present);
  if (bar === 'edit') return 'full';
  if (bar === 'viewing') return 'zoom-only';
  return null;
}

export function ZoomUndo({ zoom, form = 'full', onUndo, onRedo, onFit }) {
  const full = form === 'full';
  return (
    <div
      className={`st-zoomundo island${full ? '' : ' is-zoom-only'}`}
      data-testid="zoom-undo"
      data-form={form}
    >
      {full ? (
        <>
          <button
            type="button"
            className="icon-btn"
            data-testid="zoom-undo-undo"
            aria-label="Undo"
            title="Undo ⌘Z"
            onClick={onUndo}
          >
            <StIcon name="undo" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-testid="zoom-undo-redo"
            aria-label="Redo"
            title="Redo ⇧⌘Z"
            onClick={onRedo}
          >
            <StIcon name="redo" size={16} />
          </button>
          <span className="st-zoomundo-div" aria-hidden="true" />
        </>
      ) : null}
      <button
        type="button"
        className="btn btn--ghost btn--sm st-zoomundo-pct"
        data-testid="zoom-undo-pct"
        aria-label={`Zoom ${zoomLabel(zoom)}, zoom to fit`}
        title="Zoom to fit ⌘0"
        onClick={onFit}
      >
        {zoomLabel(zoom)}
      </button>
    </div>
  );
}
