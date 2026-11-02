// client/v2/settings/use-advanced-prefs.js — S11.13: this page's one Advanced-prefs store, wired to
// prefs.json, plus the React hook. ⌘K's "Use my own plugin copy" and the Settings switch reach the same
// instance. The disk read is made once per page, by whoever mounts first (the Advanced section).

import { useEffect, useSyncExternalStore } from 'react';
import { persistUiPrefs } from '../../shell/util.js';
import { createAdvancedPrefs } from './advanced-prefs.js';

export const advancedPrefs = createAdvancedPrefs({ persist: persistUiPrefs });

let loaded = false;
/** Read prefs.json once per page into the store (a failed read leaves the defaults and tries again). */
export function loadAdvancedPrefs(fetchImpl = fetch) {
  if (loaded) return Promise.resolve();
  loaded = true;
  return fetchImpl('/_api/ui-prefs')
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      if (p) advancedPrefs.hydrate(p.prefs ?? p);
    })
    .catch(() => {
      loaded = false;
    });
}

/** The three choices, live: `{ ownPluginCopy, experimentalTeams, reportLogs }`. */
export function useAdvancedPrefs() {
  useEffect(() => {
    loadAdvancedPrefs();
  }, []);
  return useSyncExternalStore(advancedPrefs.subscribe, advancedPrefs.get, advancedPrefs.get);
}
