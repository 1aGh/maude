// client/v2/settings/reset-section.jsx — S11.13: Settings › Advanced › Reset (06 ad-settings, ad-edge-remember).
//
//   Reset panel layout            panels back to their sides, Layers to its own panel, floating, shown
//   Close all Advanced sections   every panel's Advanced fold (⌘K "advanced" opens them, once)
//   Open now, on this Mac         one switch per fold — the panels that carry one, plus any remembered
//   Reset all settings…           a confirm dialog, titled with its verb; keys and sign-ins are not touched
//
// A command, never a mode: nothing here leaves a switch behind. ⌘Z does not undo it.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { persistUiPrefs } from '../../shell/util.js';
import { foldStore } from '../fold/use-fold.js';
import { restoreFocus, trapTab } from '../shell/modal-focus.js';
import { advancedPrefs } from './use-advanced-prefs.js';
import { Group, Row, SwitchRow } from './parts.jsx';
import { foldRows, resetAllPlan, resetPanelLayoutPlan } from './settings-model.js';

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

/** The fold switches re-render when a fold opens or closes, or when a new id is first remembered. */
function useFoldSnapshot() {
  const snap = () =>
    foldStore
      .ids()
      .map((id) => `${id}:${foldStore.get(id) ? 1 : 0}`)
      .join(',');
  useSyncExternalStore(foldStore.subscribe, snap, snap);
  return foldRows(foldStore.ids());
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
  const rows = useFoldSnapshot();
  const [layoutDone, setLayoutDone] = useState(false);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <Group title="Reset" testid="settings-reset">
      <Row
        label="Reset panel layout"
        hint="Each panel back on its own side, Layers in its own panel, panels floating over the canvas."
        testid="settings-reset-panel-layout"
      >
        <button
          type="button"
          className="btn btn--sm"
          data-testid="settings-reset-panel-layout-btn"
          onClick={() => {
            resetPanelLayout(live);
            setLayoutDone(true);
          }}
        >
          {layoutDone ? 'Reset' : 'Reset panel layout'}
        </button>
      </Row>
      <Row
        label="Close all Advanced sections"
        hint="Fold every panel’s Advanced section. ⌘K “advanced” opens them all again, once."
        testid="settings-reset-folds"
      >
        <button
          type="button"
          className="btn btn--sm"
          data-testid="settings-reset-folds-btn"
          onClick={() => foldStore.closeAll()}
        >
          Close all
        </button>
      </Row>
      <p className="v2s-sub" data-testid="settings-fold-list-t">
        Open now, on this Mac
      </p>
      {rows.map(({ id, label }) => (
        <SwitchRow
          key={id}
          testid={`settings-fold-${id}`}
          label={label}
          checked={foldStore.get(id)}
          onChange={(on) => foldStore.set(id, on)}
        />
      ))}
      <Row
        label="Reset all settings…"
        hint="Your keys, sign-ins and each project’s sync choices are not touched."
        testid="settings-reset-all"
      >
        <button
          type="button"
          className="btn btn--sm v2s-warn"
          data-testid="settings-reset-all-btn"
          aria-haspopup="dialog"
          onClick={() => setAsking(true)}
        >
          {done ? 'Reset' : 'Reset all settings…'}
        </button>
      </Row>
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
