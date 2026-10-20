// client/v2/settings/settings-handlers.js — S11.13: what the four Settings › Advanced actions RUN from ⌘K.
//
// Spread into `createMenuHandlers` (shell/menu-runner.js), so the Settings row and its ⌘K twin are one
// function. The two switches flip the same store the sheet reads. The two resets open Settings › Advanced
// instead of acting from a palette: a reset that changes the whole window is done where its words and,
// for Reset all settings, its confirm dialog are — never by a keystroke in a search box.

import { advancedPrefs, loadAdvancedPrefs } from './use-advanced-prefs.js';
import { EXPERIMENTAL_TEAMS_PREF, OWN_PLUGIN_COPY_PREF } from './advanced-prefs.js';

const noop = () => {};

/**
 * @param d the shell's closures — `setSettingsOpen(tab)` and `toast(msg)`.
 * @param io test seam: `prefs` (the store)
 */
export function createSettingsHandlers(d, io = {}) {
  const prefs = io.prefs ?? advancedPrefs;
  const toast = (m) => (d.toast ?? noop)(m);
  /** Flip a switch; the disk value is read first so a ⌘K flip before Settings ever opened is right. */
  const flip = (key, onSay, offSay) => async () => {
    if (!io.prefs) await loadAdvancedPrefs();
    const next = !prefs.get()[key];
    prefs.set(key, next);
    toast(next ? onSay : offSay);
  };
  return {
    'settings.reset-panel-layout': () => d.setSettingsOpen?.('advanced'),
    'settings.reset-all': () => d.setSettingsOpen?.('advanced'),
    // S11.14 — the Connections rows open where their words are; nothing is typed or linked from ⌘K.
    'connections.replace-hub-token': () => d.setSettingsOpen?.('connections'),
    'connections.figma-test': () => d.setSettingsOpen?.('connections'),
    'connections.cloud-project-connect': () => d.setSettingsOpen?.('connections'),
    'connections.cloud-project-disconnect': () => d.setSettingsOpen?.('connections'),
    'settings.use-own-plugin-copy': flip(
      OWN_PLUGIN_COPY_PREF,
      'Using your own plugin copy. Takes effect when the AI chat next starts.',
      'Using Maude’s plugins. Takes effect when the AI chat next starts.'
    ),
    'settings.experimental-teams': flip(
      EXPERIMENTAL_TEAMS_PREF,
      'AI reviews will argue it out. Takes effect when the AI chat next starts.',
      'AI reviews run one at a time. Takes effect when the AI chat next starts.'
    ),
  };
}
