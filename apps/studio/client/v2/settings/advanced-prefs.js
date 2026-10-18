// client/v2/settings/advanced-prefs.js — S11.13: the three per-Mac choices Settings › Advanced owns.
//
//   ownPluginCopy      Claude Code › "Use my own plugin copy". On = the AI chat starts without Maude's
//                      bundled plugins (`MAUDE_NO_PLUGIN_BOOTSTRAP`, read at ACP spawn), so a copy you
//                      installed yourself loads natively.
//   experimentalTeams  Experimental › "AI reviews argue it out (teams)". On = the next AI session starts
//                      with Claude Code's agent teams enabled (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`).
//   reportLogs         Privacy › "Logs in bug reports": ask each time (default) · always · never. The
//                      Report a bug dialog reads it.
//
// PURE (no DOM, no React, no fetch), like fold-store.js and single-keys-store.js: persistence is injected.
// Home: prefs.json, one top-level field each — per Mac, never per project. A switch or a policy takes
// effect on the NEXT session / report, which the rows say.

export const OWN_PLUGIN_COPY_PREF = 'ownPluginCopy';
export const EXPERIMENTAL_TEAMS_PREF = 'experimentalTeams';
export const REPORT_LOGS_PREF = 'reportLogs';

export const REPORT_LOGS_VALUES = Object.freeze(['ask', 'always', 'never']);

/** What a fresh Mac has. */
export const ADVANCED_PREF_DEFAULTS = Object.freeze({
  [OWN_PLUGIN_COPY_PREF]: false,
  [EXPERIMENTAL_TEAMS_PREF]: false,
  [REPORT_LOGS_PREF]: 'ask',
});

const valid = (key, v) =>
  key === REPORT_LOGS_PREF
    ? REPORT_LOGS_VALUES.includes(v)
    : typeof v === 'boolean' && key in ADVANCED_PREF_DEFAULTS;

/** @param {{ persist?: (patch: Record<string, unknown>) => void }} [opts] */
export function createAdvancedPrefs({ persist = () => {} } = {}) {
  let snap = Object.freeze({ ...ADVANCED_PREF_DEFAULTS });
  /** Changed in this page: a late disk read must not overwrite the person's click. */
  const touched = new Set();
  const subs = new Set();
  const notify = () => {
    for (const fn of subs) fn();
  };
  const write = (patch) => {
    const next = { ...snap };
    const changed = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!valid(k, v)) continue;
      touched.add(k);
      if (next[k] !== v) {
        next[k] = v;
        changed[k] = v;
      }
    }
    if (Object.keys(changed).length === 0) return false;
    snap = Object.freeze(next);
    try {
      persist(changed);
    } catch {
      /* no prefs file (a browser tab on a viewer): the choice lives for the page */
    }
    notify();
    return true;
  };
  return {
    /** A stable object until something changes — fit for `useSyncExternalStore`. */
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(key, value) {
      return write({ [key]: value });
    },
    /** Reset all settings: back to a fresh Mac's. */
    reset() {
      return write({ ...ADVANCED_PREF_DEFAULTS });
    },
    /** Adopt the disk values (GET /_api/ui-prefs); an id changed in this page keeps the page's value. */
    hydrate(prefs) {
      const next = { ...snap };
      let changed = false;
      for (const k of Object.keys(ADVANCED_PREF_DEFAULTS)) {
        if (touched.has(k) || !valid(k, prefs?.[k]) || next[k] === prefs[k]) continue;
        next[k] = prefs[k];
        changed = true;
      }
      if (!changed) return;
      snap = Object.freeze(next);
      notify();
    },
  };
}
