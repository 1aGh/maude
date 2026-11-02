// client/v2/ai/needs-you-store.js — S5.13: how many chats are waiting on YOU, for the surfaces that are not the
// chat itself (03 `ai-panel-closed`, `ai-needs-hidden`): the folded spark's azure count, and — through
// `GET /_api/ai/runs` — the same number for chats this tab never attached to.
//
// Two sources, one number:
//   • local   — the open chats' own pending permission / elicitation lists (instant: the frame is in hand);
//   • server  — `needsYou` from `GET /_api/ai/runs` (V2-1.15 §7), which also counts a chat that was
//               already waiting before this tab loaded, and a peer window's chat on this Mac.
// The count is the larger of the two: the frame wins the first few milliseconds, the server wins after a
// reload. It only ever counts YOUR chats on THIS Mac (`needsYou` is mine-only by construction).

import { useEffect, useSyncExternalStore } from 'react';

let local = new Map(); // chatId -> number of open questions
let server = 0;
let snapshot = 0;
const listeners = new Set();
let pullNow = null; // set while the feed runs: an answered question re-reads the server's count

function recompute() {
  let sum = 0;
  for (const n of local.values()) sum += n;
  const next = Math.max(sum, server);
  if (next === snapshot) return;
  snapshot = next;
  for (const fn of listeners) fn();
}

/** A chat's open questions changed (permissions + elicitations pending right now). */
export function setLocalNeedsYou(chatId, n) {
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const before = local.get(chatId) ?? 0;
  if (before === count) return;
  const next = new Map(local);
  if (count) next.set(chatId, count);
  else next.delete(chatId);
  local = next;
  recompute();
  // Answered: the server's number is stale until it hears the answer, and the larger one wins.
  if (count < before && pullNow) setTimeout(pullNow, 250);
}

/** `GET /_api/ai/runs` answered. */
export function setServerNeedsYou(n) {
  server = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  recompute();
}

export const getNeedsYou = () => snapshot;

export function subscribeNeedsYou(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test seam. */
export function resetNeedsYou() {
  local = new Map();
  server = 0;
  snapshot = 0;
  for (const fn of listeners) fn();
}

export function useNeedsYou() {
  return useSyncExternalStore(subscribeNeedsYou, getNeedsYou, () => 0);
}

/**
 * Keep `server` fresh: once now, on every `maude:ai-runs` window event (the shell relays the bus event
 * `ai:runs {seq}` — lead patch request), and on a slow poll as the fallback when the relay is not wired.
 * Returns the stop function. Failures are silent: the local count still works.
 */
export function startNeedsYouFeed({
  fetchImpl = (...a) => fetch(...a),
  win = typeof window === 'undefined' ? null : window,
  pollMs = 30_000,
} = {}) {
  let stopped = false;
  let inflight = false;
  const pull = async () => {
    if (stopped || inflight) return;
    inflight = true;
    try {
      const res = await fetchImpl('/_api/ai/runs');
      if (!res.ok) return;
      const body = await res.json();
      if (!stopped && typeof body?.needsYou === 'number') setServerNeedsYou(body.needsYou);
    } catch {
      /* offline or not a v2 server: the local count stands */
    } finally {
      inflight = false;
    }
  };
  pullNow = pull;
  pull();
  const onRuns = () => pull();
  win?.addEventListener?.('maude:ai-runs', onRuns);
  const timer = pollMs > 0 ? setInterval(pull, pollMs) : null;
  return () => {
    stopped = true;
    if (pullNow === pull) pullNow = null;
    win?.removeEventListener?.('maude:ai-runs', onRuns);
    if (timer) clearInterval(timer);
  };
}

/** Mount once (the corner icons do): runs the feed while the shell is up. */
export function useNeedsYouFeed() {
  useEffect(() => startNeedsYouFeed(), []);
}
