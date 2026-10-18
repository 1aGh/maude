// client/v2/ai/runs-store.js — S5.11: the shell's copy of the AI run list (V2-1.15 §5.4).
//
// One store per tab. It reads `GET /_api/ai/runs` and re-reads when the server says the registry moved: the
// inspector socket's `{type:'ai:runs', seq}` reaches it as a window event (`noteAiRuns`, called from the one
// line in client/app.jsx that handles that message), and a tab that comes back to the front re-reads once.
// The run list, the waiting cards and the artboard rings are all views of this snapshot.
//
// Actions go to the same routes the registry serves; each one re-reads on success so the UI never guesses.

import { useSyncExternalStore } from 'react';
import { EMPTY_RUNS, normalizeRuns } from './runs-model.js';

export const RUNS_EVENT = 'maude:ai-runs';
const DONE_MS = 6000;

/** The shell tells the store the registry moved. `seq` lets it skip a re-read it already has. */
export function noteAiRuns(seq, target = globalThis.window) {
  target?.dispatchEvent?.(new CustomEvent(RUNS_EVENT, { detail: { seq } }));
}

export function createRunsStore({ fetchImpl, target = globalThis.window, setTimer } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const timer = setTimer || ((fn, ms) => setTimeout(fn, ms));
  let snap = { view: EMPTY_RUNS, loaded: false, done: {} };
  const subs = new Set();
  let inflight = null;
  let again = false;
  let stopListening = null;

  const emit = () => {
    for (const fn of [...subs]) fn();
  };
  const set = (patch) => {
    snap = { ...snap, ...patch };
    emit();
  };

  async function read() {
    try {
      const res = await doFetch('/_api/ai/runs', { cache: 'no-store' });
      if (!res.ok) return;
      const view = normalizeRuns(await res.json());
      // a reply older than what we hold is a late answer to an earlier question
      if (snap.loaded && view.seq < snap.view.seq) return;
      set({ view, loaded: true });
    } catch {
      /* an old server, or offline: the list stays as it was */
    }
  }

  /** Read now. Calls that arrive during a read fold into one more read after it. */
  function refresh() {
    if (inflight) {
      again = true;
      return inflight;
    }
    inflight = read().finally(() => {
      inflight = null;
      if (again) {
        again = false;
        void refresh();
      }
    });
    return inflight;
  }

  function note(seq) {
    if (Number.isFinite(seq) && snap.loaded && seq <= snap.view.seq) return;
    void refresh();
  }

  const post = async (path, body) => {
    try {
      const res = await doFetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* no body */
      }
      void refresh();
      return { ok: res.ok, status: res.status, code: json?.code ?? null, body: json };
    } catch {
      return { ok: false, status: 0, code: 'offline', body: null };
    }
  };
  const run = (id, verb) => post(`/_api/ai/runs/${encodeURIComponent(id)}/${verb}`);

  /** Mark artboards as just-finished: the canvas settles a ring on each, then lets go. */
  function markDone(ids, ms = DONE_MS) {
    const next = { ...snap.done };
    for (const id of ids || []) next[id] = true;
    set({ done: next });
    timer(() => {
      const left = { ...snap.done };
      for (const id of ids || []) delete left[id];
      set({ done: left });
    }, ms);
  }

  function start() {
    if (stopListening) return stopListening;
    const onNote = (e) => note(e?.detail?.seq);
    const onShow = () => {
      if (target?.document?.visibilityState === 'hidden') return;
      void refresh();
    };
    target?.addEventListener?.(RUNS_EVENT, onNote);
    target?.addEventListener?.('focus', onShow);
    void refresh();
    stopListening = () => {
      target?.removeEventListener?.(RUNS_EVENT, onNote);
      target?.removeEventListener?.('focus', onShow);
      stopListening = null;
    };
    return stopListening;
  }

  return {
    getSnapshot: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    start,
    refresh,
    note,
    markDone,
    stop: (id) => run(id, 'stop'),
    cancel: (id) => run(id, 'cancel'),
    keepGoing: (id) => run(id, 'keep-going'),
    copy: (id) => run(id, 'copy'),
  };
}

let shared = null;
/** The tab's one store, started on first use. */
export function getRunsStore() {
  if (!shared) {
    shared = createRunsStore();
    shared.start();
  }
  return shared;
}

export function resetRunsStoreForTests() {
  shared = null;
}

/** `{view, loaded, done}` plus the store's actions, re-rendering on every change. */
export function useAiRuns(store = getRunsStore()) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snap, store };
}
