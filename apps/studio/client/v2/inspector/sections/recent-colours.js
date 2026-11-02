// client/v2/inspector/sections/recent-colours.js — P6 T2 (inspector-ux-rules IR-8): the colour picker's "Recent" row.
//
// The last 8 colours used in this project — tokens (`var(--accent)`) and raw colours alike — newest first. Per Mac, keyed
// by project, in prefs.json `recentColours` (the V2-4.10 fold-store pattern: `POST /_api/ui-prefs`, merged per project by
// the server's `writeUiPrefs`), so no new runtime path and no DDR-115 list changes. The store reads the prefs once, on
// first use; a page that cannot reach the server keeps Recent for the page only.

import { useEffect, useSyncExternalStore } from 'react';
import { isRecentColour } from '../../../../edit-ops/words-paint.ts';
import { persistUiPrefs } from '../../../shell/util.js';

export const RECENT_MAX = 8;
export const RECENT_PREF_KEY = 'recentColours';

/** A colour Recent can keep: one CSS colour or token reference, short, no declaration syntax — never an
 *  image reference (V2-8.9 r2 F4: `isRecentColour`, the server's own check, applied on hydrate too). */
export const recentOk = (css) =>
  isRecentColour(css) && !/^\s*(?:currentcolor|inherit|initial|unset|transparent)\s*$/i.test(css);

/** `list` with `css` put first: deduplicated (case-insensitive), at most 8. Pure. */
export function pushRecent(list, css) {
  const t = String(css ?? '').trim();
  if (!recentOk(t)) return list ?? [];
  const rest = (list ?? []).filter((c) => c.toLowerCase() !== t.toLowerCase());
  return [t, ...rest].slice(0, RECENT_MAX);
}

/** The prefs map key for this project: its name, made a safe id (`MAP_KEY` on the server). */
export function projectKeyOf(ctx) {
  const raw = String(ctx?.cfg?.name || ctx?.cfg?.designRel || 'project');
  return raw.replace(/[^A-Za-z0-9._:/-]/g, '-').slice(0, 128) || 'project';
}

/** A store of Recent lists by project. `persist(patch)` writes; `load()` resolves to the prefs object (or null). */
export function createRecentStore({ persist = () => {}, load = async () => null } = {}) {
  let byProject = {};
  let hydrated = false;
  const subs = new Set();
  const emit = () => {
    for (const f of subs) f();
  };
  return {
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
    get(project) {
      return byProject[project] ?? EMPTY;
    },
    /** Merge what prefs.json holds; a colour used in this page before the read arrived stays first. */
    hydrate(prefs) {
      hydrated = true;
      const map = prefs?.[RECENT_PREF_KEY];
      if (!map || typeof map !== 'object') return;
      const next = { ...byProject };
      for (const [k, v] of Object.entries(map)) {
        if (!Array.isArray(v)) continue;
        let list = v.filter(recentOk).slice(0, RECENT_MAX);
        for (const c of [...(byProject[k] ?? [])].reverse()) list = pushRecent(list, c);
        next[k] = list;
      }
      byProject = next;
      emit();
    },
    ensure() {
      if (hydrated) return;
      hydrated = true;
      Promise.resolve()
        .then(load)
        .then((p) => p && this.hydrate(p))
        .catch(() => {});
    },
    push(project, css) {
      const next = pushRecent(byProject[project], css);
      if (next === byProject[project] || next.length === 0) return;
      byProject = { ...byProject, [project]: next };
      persist({ [RECENT_PREF_KEY]: { [project]: next } });
      emit();
    },
    reset() {
      byProject = {};
      hydrated = false;
      emit();
    },
  };
}
const EMPTY = Object.freeze([]);

export const recentStore = createRecentStore({
  persist: persistUiPrefs,
  load: async () => {
    const r = await fetch('/_api/ui-prefs');
    return r.ok ? r.json() : null;
  },
});

/** This project's Recent colours, newest first (CSS strings). */
export function useRecentColours(ctx) {
  const key = projectKeyOf(ctx);
  useEffect(() => recentStore.ensure(), []);
  return useSyncExternalStore(
    recentStore.subscribe,
    () => recentStore.get(key),
    () => recentStore.get(key)
  );
}
