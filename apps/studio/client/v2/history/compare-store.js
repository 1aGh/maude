// client/v2/history/compare-store.js — S1.15: Compare's state, shared by the panel and the canvas area.
//
//   Version history (the dock) marks the rows A and B and owns the buttons; the two frames, the bar and the
//   list sit where the canvas is (the Viewport). One small external store joins them — the same shape as the
//   shell's mode store. Compare rides on Viewing: the hold keeps the AI chat, tools and locks off, and esc
//   (or another canvas in front) ends both.
//
//   start({ path, a, b? })   A is the selected row (words from `viewingWords`), B defaults to Now
//   setB(words | null)       a second row click makes it B; null = Now
//   setMode('side'|'overlay') · setFocus(artboardId) · setRows(rows) · setAnswer(answer) · stop()

import { useSyncExternalStore } from 'react';
import { formatWhen } from './use-versions.js';

/** B = Now: `at: 'now'` is the ref the changes route and the frame both understand. */
export const nowWords = (ms = Date.now()) => ({
  at: 'now',
  title: 'Now',
  when: formatWhen(ms),
  who: '',
});

const LOADING = Object.freeze({ status: 'loading' });

let state = null;
const subs = new Set();
const emit = () => {
  for (const f of subs) f();
};
const set = (next) => {
  state = next;
  emit();
};

export const compareStore = {
  get: () => state,
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  start({ path, a, b = null, nowMs }) {
    set({
      path,
      a,
      b: b ?? nowWords(nowMs),
      mode: 'side',
      focus: null,
      rows: state?.path === path ? state.rows : [],
      answer: LOADING,
    });
  },
  setB(words, nowMs) {
    if (!state) return;
    const b = words ?? nowWords(nowMs);
    if (state.b.at === b.at) return;
    set({ ...state, b, focus: null, answer: LOADING });
  },
  setMode(mode) {
    if (state && state.mode !== mode) set({ ...state, mode });
  },
  setFocus(focus) {
    if (state && state.focus !== focus) set({ ...state, focus });
  },
  setRows(rows) {
    if (state && state.rows !== rows) set({ ...state, rows });
  },
  setAnswer(answer) {
    if (state) set({ ...state, answer });
  },
  stop() {
    if (state) set(null);
  },
};

const get = () => compareStore.get();

/** The Compare in progress (`{ path, a, b, mode, focus, rows, answer }`) or null. */
export function useCompare() {
  return useSyncExternalStore(compareStore.subscribe, get, get);
}
