// client/v2/present/presenter-button.jsx — S3.6b: the "Presenter view" button in the Present controls
// (04 md-present-full: the laptop glyph beside the label). It fills the `presenterView` slot S3.2b left in
// present-controls.jsx, and the host only passes it when another display exists — hidden, never greyed.
// A click is the person's gesture: it sets the preference; the host opens the audience window.

import { StIcon } from '../../shell/icons.jsx';
import { chosenDisplay, presenterStore, usePresenterState } from './presenter-store.js';

export function PresenterViewButton() {
  const pv = usePresenterState();
  const name = chosenDisplay(pv)?.name;
  return (
    <button
      type="button"
      className="sh-iconbtn"
      data-testid="present-presenter-view"
      aria-label="Presenter view"
      aria-pressed={pv.wanted}
      title={name ? `Presenter view on ${name}` : 'Presenter view on another display'}
      onClick={() => presenterStore.toggle()}
    >
      <StIcon name="laptop" size={15} />
    </button>
  );
}
