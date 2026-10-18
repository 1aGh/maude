// client/v2/ai/advanced-handlers.js — S5.12: what ⌘K "AI chat panel › Advanced …" RUNS.
//
// A row of the Advanced fold has no menu-bar home, so ⌘K is how a person finds "model", "raw log" or
// "terminal" by name. Running one opens the AI chat panel (if it is hidden), opens the Advanced fold, and
// asks the open Advanced to take that row (scroll to it and focus its control — or, for Raw log and Open in
// terminal, to do the thing). The panel may not be mounted yet when the row is picked, so the request is
// parked until Advanced mounts and claims it (a few seconds at most).
//
// DOM-free apart from `globalThis.dispatchEvent` (the same shape as panel-focus.js).

import { foldStore } from '../fold/use-fold.js';
import { AI_FOLD_PANEL, ADVANCED_ROWS } from './advanced-model.js';

/** Fired on `window` for the open Advanced to take a row. Detail: `{ row }`. */
export const ADVANCED_ROW_EVENT = 'maude:ai-advanced-row';

const PARK_MS = 4000;
let parked = null;

/** Park a request for `row`; also tell a mounted Advanced right away. */
export function requestAdvancedRow(row, target = globalThis) {
  parked = { row, at: Date.now() };
  target.dispatchEvent?.(new CustomEvent(ADVANCED_ROW_EVENT, { detail: { row } }));
}

/** Advanced calls this on mount and after each event: the parked row, once, if still fresh. */
export function takeParkedRow(now = Date.now()) {
  const p = parked;
  parked = null;
  return p && now - p.at <= PARK_MS ? p.row : null;
}

/** Is the AI chat panel showing right now? (The island is `hidden`, never unmounted — DDR-123.) */
export function aiPanelShown(doc = globalThis.document) {
  const island = doc?.querySelector?.('[data-testid="ai-chat-island"]');
  return (
    !!island && island.getAttribute('aria-hidden') !== 'true' && island.style?.display !== 'none'
  );
}

/**
 * @param d the shell's closures (menu-runner.js `createMenuHandlers`): `native`, `toast`, `toggleRightPanel`.
 * @returns {Record<string, () => void>} one handler per Advanced registry action.
 */
export function createAdvancedHandlers(d) {
  const open = (row) => () => {
    if (!d.native) {
      d.toast?.('AI chat is in the Maude desktop app.');
      return;
    }
    if (!aiPanelShown()) d.toggleRightPanel?.('assistant');
    foldStore.set(AI_FOLD_PANEL, true);
    requestAdvancedRow(row);
  };
  return Object.fromEntries(ADVANCED_ROWS.map((r) => [r.action, open(r.row)]));
}
