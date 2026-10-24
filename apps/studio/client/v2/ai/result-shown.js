// client/v2/ai/result-shown.js — P8 c6 (03 `ai-done`): "the result card under the last reply carries the
// follow-up chips" as one tiny per-chat flag, so the suggestion strip above the composer (a different branch of
// the panel) does not draw a second row of chips and a "Because you last asked …" line under the same finish.
// RunSurface writes it, SuggestStrip reads it; nothing else.

import { useSyncExternalStore } from 'react';

const shown = new Map(); // chatId → boolean
const listeners = new Set();

export function setResultShown(chatId, value) {
  const next = !!value;
  if ((shown.get(chatId) ?? false) === next) return;
  if (next) shown.set(chatId, true);
  else shown.delete(chatId);
  for (const fn of listeners) fn();
}

export const isResultShown = (chatId) => shown.get(chatId) ?? false;

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useResultShown(chatId) {
  return useSyncExternalStore(
    subscribe,
    () => isResultShown(chatId),
    () => false
  );
}
