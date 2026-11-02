// client/v2/present/presenter-store.js — S3.6b: the shell's presenter-view state, one per window.
//
//   presenterStore   { wanted, displays, displayId }
//     wanted     the person asked for presenter view (the Present ⌄ row or the controls' button). It is a
//                preference: it stays through End, so the next Present starts with it, and it does nothing
//                at all with one display (every way in is hidden, nothing opens).
//     displays   what `present_displays` last answered (desktop only; [] elsewhere)
//     displayId  the display the person picked for the audience, else the first one this window is not on
//   presentRunStore  the presenting canvas's artboards with their world rects, in canvas order, when the
//                    canvas has reported them (`present-run`); otherwise the shell falls back to the
//                    project index's list.
//
// Nothing a canvas posts writes `wanted`. Only `setWanted` / `toggle`, called from a click in the shell,
// do — so no canvas can open a window on the second display (S3-present-session §4, S3.6a review).

import { useEffect, useSyncExternalStore } from 'react';
import { audienceDisplay, canPresentToAnotherDisplay, presentDisplays } from './audience-window.js';

function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(next) {
      state = typeof next === 'function' ? next(state) : next;
      for (const fn of [...subs]) fn();
    },
  };
}

const EMPTY = Object.freeze({ wanted: false, displays: [], displayId: null });

export function createPresenterStore() {
  const s = createStore(EMPTY);
  return {
    get: s.get,
    subscribe: s.subscribe,
    setWanted(wanted) {
      const next = !!wanted;
      if (s.get().wanted !== next) s.set((st) => ({ ...st, wanted: next }));
    },
    toggle() {
      s.set((st) => ({ ...st, wanted: !st.wanted }));
    },
    setDisplays(list) {
      const displays = Array.isArray(list) ? list : [];
      const same =
        displays.length === s.get().displays.length &&
        displays.every(
          (d, i) => d.id === s.get().displays[i].id && d.current === s.get().displays[i].current
        );
      if (!same) s.set((st) => ({ ...st, displays }));
    },
    pickDisplay(displayId) {
      s.set((st) => ({ ...st, displayId: typeof displayId === 'string' ? displayId : null }));
    },
    /** Test seam: back to the start. */
    reset() {
      s.set(EMPTY);
    },
  };
}

export const presenterStore = createPresenterStore();

/** The display the audience goes to: the person's pick if it is still there and not this window's, else
 *  the default (a non-primary one this window is not on). null with no other display. */
export function chosenDisplay(state) {
  const others = (state.displays ?? []).filter((d) => !d.current);
  return others.find((d) => d.id === state.displayId) ?? audienceDisplay(state.displays);
}

/** Presenter view can run here: the desktop app, with another display to put the audience on. */
export function presenterAvailable(state) {
  return canPresentToAnotherDisplay(state.displays);
}

/** Presenter view is on and able to run: what the host shows. */
export function presenterOn(state) {
  return !!state.wanted && presenterAvailable(state);
}

export function usePresenterState() {
  return useSyncExternalStore(presenterStore.subscribe, presenterStore.get, presenterStore.get);
}

// ── displays: read while any consumer is mounted, again when the window gets the focus ─────────────
let watchers = 0;
let stopWatch = null;

async function refreshDisplays() {
  presenterStore.setDisplays(await presentDisplays());
}

function startWatch() {
  void refreshDisplays();
  const again = () => void refreshDisplays();
  window.addEventListener('focus', again);
  document.addEventListener('visibilitychange', again);
  return () => {
    window.removeEventListener('focus', again);
    document.removeEventListener('visibilitychange', again);
  };
}

/** The store's state, with the display list kept current for as long as this is mounted. */
export function usePresenterDisplays() {
  useEffect(() => {
    watchers += 1;
    if (watchers === 1) stopWatch = startWatch();
    else void refreshDisplays();
    return () => {
      watchers -= 1;
      if (watchers === 0) {
        stopWatch?.();
        stopWatch = null;
      }
    };
  }, []);
  return usePresenterState();
}

/** Read the displays once, right now (a click that needs the answer before it acts). */
export const refreshPresenterDisplays = refreshDisplays;

// ── the presenting canvas's artboard rects ──────────────────────────────────────────────────────────
const run = createStore(null);
export const presentRunStore = {
  get: run.get,
  subscribe: run.subscribe,
  /** `{ file, artboards: [{ id, label, x, y, w, h }] }` or null. */
  set: (v) => run.set(v),
};
export function usePresentRun() {
  return useSyncExternalStore(run.subscribe, run.get, run.get);
}
