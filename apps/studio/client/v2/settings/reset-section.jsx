// client/v2/settings/reset-section.jsx — S11.13: Settings › Advanced › Reset (06 ad-settings, ad-edge-remember).
//
//   Reset panel layout            panels back to their sides, Layers to its own panel, floating, shown
//   Close all Advanced sections   every panel's Advanced fold (⌘K "advanced" opens them, once)
//   Reset all settings…           a confirm dialog, titled with its verb; keys and sign-ins are not touched
// One wrapping row of three buttons, as 06 ad-settings draws it. (The per-fold "Open now, on this Mac" switch
// list of ad-edge-remember is not drawn here: a fold opens and closes at its own panel — Phase 8 round 8.)
//
// A command, never a mode: nothing here leaves a switch behind. ⌘Z does not undo it.

import { useEffect, useRef, useState } from 'react';

import { persistUiPrefs } from '../../shell/util.js';
import { foldStore } from '../fold/use-fold.js';
import { restoreFocus, trapTab } from '../shell/modal-focus.js';
import { advancedPrefs } from './use-advanced-prefs.js';
import { Group } from './parts.jsx';
import { resetAllPlan, resetPanelLayoutPlan } from './settings-model.js';

/** The live handlers the open window follows (the same props General's rows get). */
function runCalls(plan, live) {
  for (const [id, side] of plan.sideCalls ?? []) live.onSetPanelSide?.(id, side);
  if (plan.layersModeCall) live.onSetLayersMode?.(plan.layersModeCall);
}

/** Reset panel layout — pure side effects; returns nothing. Exported for the ⌘K entry and tests. */
export function resetPanelLayout(live = {}, persist = persistUiPrefs) {
  const plan = resetPanelLayoutPlan({ panelSide: live.panelSide, layersMode: live.layersMode });
  runCalls(plan, live);
  persist(plan.patch);
}

/** Reset all settings. Never touches keys, sign-ins, this project's sync switches or the "seen" markers. */
export function resetAllSettings(live = {}, persist = persistUiPrefs) {
  const plan = resetAllPlan(live, foldStore.ids());
  runCalls(plan, live);
  for (const [handler, arg] of plan.toggles) live[handler]?.(arg);
  foldStore.reset();
  advancedPrefs.reset();
  persist(plan.patch);
}

function ConfirmResetAll({ onCancel, onConfirm }) {
  const ref = useRef(null);
  const cancelRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    cancelRef.current?.focus(); // the safe answer first: Enter on open must not wipe anything
    return () => restoreFocus(opener);
  }, []);
  return (
    <div
      className="gi-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="v2s-reset-all-t"
      data-testid="settings-reset-all-dialog"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else trapTab(e, ref.current);
      }}
    >
      <div className="gi-scrim" aria-hidden="true" onClick={onCancel} />
      <div className="gi-dialog v2s-confirm-dialog">
        <h2 id="v2s-reset-all-t" className="v2s-confirm-t">
          Reset all settings
        </h2>
        <p className="v2s-confirm-d">
          Look, panel positions, shortcuts, Advanced sections and the Claude Code switches go back
          to a fresh Mac’s. Your keys, sign-ins, and each project’s sync choices stay as they are.
        </p>
        <div className="v2s-confirm-foot">
          <button
            type="button"
            className="btn"
            ref={cancelRef}
            data-testid="settings-reset-all-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="settings-reset-all-confirm"
            onClick={onConfirm}
          >
            Reset all settings
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ResetSection({ live = {} }) {
  const [layoutDone, setLayoutDone] = useState(false);
  const [foldsDone, setFoldsDone] = useState(false);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  // 06 ad-settings › Reset: ONE wrapping row of three buttons (the third in the warning colour) and a hint —
  // no row labels, no per-fold switch list (each panel's own Advanced fold is where a fold opens or closes).
  return (
    <Group title="Reset" testid="settings-reset">
      <div className="v2s-acts">
        <span data-testid="settings-reset-panel-layout">
          <button
            type="button"
            className="btn btn--sm"
            data-testid="settings-reset-panel-layout-btn"
            title="Each panel back on its own side, Layers in its own panel, panels floating over the canvas."
            onClick={() => {
              resetPanelLayout(live);
              setLayoutDone(true);
            }}
          >
            {layoutDone ? 'Reset' : 'Reset panel layout'}
          </button>
        </span>
        <span data-testid="settings-reset-folds">
          <button
            type="button"
            className="btn btn--sm"
            data-testid="settings-reset-folds-btn"
            title="Fold every panel’s Advanced section."
            onClick={() => {
              foldStore.closeAll();
              setFoldsDone(true);
            }}
          >
            {foldsDone ? 'Closed' : 'Close all Advanced sections'}
          </button>
        </span>
        <span data-testid="settings-reset-all">
          <button
            type="button"
            className="btn btn--sm v2s-warn"
            data-testid="settings-reset-all-btn"
            aria-haspopup="dialog"
            title="Your keys, sign-ins and each project’s sync choices are not touched."
            onClick={() => setAsking(true)}
          >
            {done ? 'Reset' : 'Reset all settings…'}
          </button>
        </span>
      </div>
      <p className="v2s-hint">⌘K “open advanced” opens them all, once.</p>
      {asking && (
        <ConfirmResetAll
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            resetAllSettings(live);
            setAsking(false);
            setDone(true);
          }}
        />
      )}
    </Group>
  );
}
