// client/v2/preview/preview-bar.jsx — S3.9: Preview's own line, top centre (04 md-preview, md-preview-combine).
//
//   [ eye ]  Previewing **Homepage**  |  esc to edit
//   [ ‹ Homepage ]  Previewing **Pricing**  |  esc to edit        ← after a link was followed (S3.10a)
//
// It says which canvas you are previewing and what esc does. The word after esc is the role's: editors go
// back to Edit ("esc to edit"), a viewing role goes back to Viewing ("esc for Viewing", 04 md-edge-viewer).
// The back slot is S3.10a's: it renders only when the shell passes a `back` canvas name (the per-window
// back stack), and runs `onBack`. Pure presentational; the host wires it (preview-chrome-host.jsx).
//
// An `.island` with `data-occludes="top"` (V2-4.1): it sits in the same top band as the folded pill and the
// compact Share cluster, so it adds no inset of its own. It fades in over `--dur-panel` (CSS owns the
// motion; reduced motion collapses the token to 1 ms).

import { Kbd, StIcon } from '../../shell/icons.jsx';

/** The word after esc, per role: editors return to Edit, a viewing role to Viewing. */
export function previewHint(caps) {
  return caps?.edit ? 'to edit' : 'for Viewing';
}

// The mode glyph of Preview (an eye in a frame) — the same drawing as the Share cluster's segment.
function PreviewGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="3.75" width="19" height="16.5" rx="4.5" />
      <path d="M6 12s2.2-3.75 6-3.75S18 12 18 12s-2.2 3.75-6 3.75S6 12 6 12z" />
      <circle cx="12" cy="12" r="1.6" />
    </svg>
  );
}

/**
 * @param name the canvas being previewed
 * @param hint the word after esc (`previewHint(caps)`)
 * @param back the canvas a followed link came from — shows the way back (S3.10a); absent = no button
 * @param onBack runs the back (S3.10a's `preview.back`)
 * @param state `in` | `out` — the host drives the fade
 */
export function PreviewBar({ name, hint = 'to edit', back, onBack, state = 'in' }) {
  return (
    <div
      className="st-pbar island"
      data-testid="preview-bar"
      data-occludes="top"
      data-state={state}
    >
      {back ? (
        <button
          type="button"
          className="st-pbar-back"
          data-testid="preview-bar-back"
          aria-label={`Back to ${back}`}
          onClick={onBack}
        >
          <span className="st-pbar-flip" aria-hidden="true">
            <StIcon name="chevron-right" size={12} />
          </span>
          {back}
        </button>
      ) : (
        <span className="st-pbar-ic">
          <PreviewGlyph />
        </span>
      )}
      <span className="st-pbar-t" data-testid="preview-bar-title">
        Previewing <strong>{name}</strong>
      </span>
      <span className="st-pbar-div" aria-hidden="true" />
      <span className="st-pbar-esc" data-testid="preview-bar-esc">
        <Kbd>esc</Kbd> {hint}
      </span>
    </div>
  );
}
