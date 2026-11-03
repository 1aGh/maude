// client/v2/ai/activity-store.js — rc3-h (#182): what the chat's activity line knows that the canvas can use.
//
// One value per tab: the artboard the AI's in-flight edit names (`{ file, artboard, label, adding? }`, file
// repo-relative), or null. use-activity-line.js writes it from the live stream; the ring relay
// (ring-relay.js) marks that artboard the moment the edit starts — before the write lands and the run's
// lease arrives — and the empty canvas's drafting ghost (empty/ai-drafting.jsx) takes the name of an
// artboard being added. Names only (an index label or a capped `label`), never a path or the model's words.

import { useSyncExternalStore } from 'react';

export function createActivityStore() {
  let target = null;
  const subs = new Set();
  const same = (a, b) =>
    a === b ||
    (!!a &&
      !!b &&
      a.file === b.file &&
      a.artboard === b.artboard &&
      a.label === b.label &&
      !!a.adding === !!b.adding);
  return {
    get: () => target,
    set(next) {
      const t = next && typeof next === 'object' ? next : null;
      if (same(t, target)) return;
      target = t;
      for (const fn of [...subs]) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

let shared = null;
export function getActivityStore() {
  if (!shared) shared = createActivityStore();
  return shared;
}

export function useActivityTarget(store = getActivityStore()) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
