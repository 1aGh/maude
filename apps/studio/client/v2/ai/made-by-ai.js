// client/v2/ai/made-by-ai.js — S5.15: "Made by AI" on an artboard, DERIVED from `project:action`, never stored
// (V2-1.5 decision 7). An artboard shows it while the newest action that changed it is an `ai` action —
// anyone's AI (a teammate's shows their face). The next person's change to it clears it. Nothing is written
// to any versioned file, so a v1 peer never sees a field it does not know.
//
// Input: the shell's `project:action` bus events — `{ actionId, actor, mine, kind, canvases,
// artboards: Record<canvas, string[]>, undoes? }` (the run's publish, the undo routes, and S5.15's feed of
// every other accepted action, sync/action-feed.ts).
//
//   ai                    → each artboard it changed is Made by AI (by its actor)
//   undo / redo           → an undo takes back what it undid: those artboards clear (its own announcement
//                           names no artboards — the targets do); a redo of that undo puts them back
//   edit / restore / …    → each artboard it changed clears
//   comment / name / aside → no content changed: nothing moves
//
// The canvas draws it as the settled "done" ring with the fixed tag (ring-relay.js); the run's label, prompt or
// chat never reach that message.

import { useSyncExternalStore } from 'react';

export const MADE_BY_AI_TAG = 'Made by AI';
const NO_CONTENT = new Set(['comment', 'name', 'aside', 'migration.import']);
/** How many AI actions (and undos of them) are remembered for a later undo / redo. */
const KEEP = 300;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);
const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : str(v) ? [v] : []);

export const EMPTY_MADE_BY_AI = Object.freeze({ boards: {}, ai: {}, undid: {} });

/** The artboards of an action, as `[canvas, id[]]` pairs. */
function boardsOf(action) {
  const a = isObj(action?.artboards) ? action.artboards : {};
  return Object.entries(a).filter(([c, list]) => str(c) && Array.isArray(list) && list.length);
}

function trim(map) {
  const keys = Object.keys(map);
  if (keys.length <= KEEP) return map;
  const out = { ...map };
  for (const k of keys.slice(0, keys.length - KEEP)) delete out[k];
  return out;
}

function mark(boards, by, aiAction) {
  const next = { ...boards };
  for (const [canvas, list] of Object.entries(aiAction.artboards)) {
    const was = { ...(next[canvas] || {}) };
    for (const id of list) was[id] = { ...by };
    next[canvas] = was;
  }
  return next;
}

function clear(boards, pairs, onlyActionId = null) {
  const next = { ...boards };
  for (const [canvas, list] of pairs) {
    if (!next[canvas]) continue;
    const was = { ...next[canvas] };
    for (const id of list) {
      if (!was[id]) continue;
      if (onlyActionId && was[id].actionId !== onlyActionId) continue;
      delete was[id];
    }
    if (Object.keys(was).length) next[canvas] = was;
    else delete next[canvas];
  }
  return next;
}

/** Fold one `project:action` into the state (pure). */
export function reduceMadeByAi(state = EMPTY_MADE_BY_AI, action) {
  if (!isObj(action) || !str(action.actionId) || !str(action.kind)) return state;
  const kind = action.kind;
  if (NO_CONTENT.has(kind)) return state;
  const pairs = boardsOf(action);
  if (kind === 'ai') {
    const run = {
      actor: str(action.actor) ?? '',
      mine: action.mine === true,
      artboards: Object.fromEntries(pairs),
    };
    const by = { actionId: action.actionId, actor: run.actor, mine: run.mine };
    return {
      boards: mark(state.boards, by, run),
      ai: trim({ ...state.ai, [action.actionId]: run }),
      undid: state.undid,
    };
  }
  if (kind === 'undo' || kind === 'redo') {
    const targets = ids(action.undoes);
    let boards = clear(state.boards, pairs);
    let undid = state.undid;
    if (kind === 'undo') {
      const gone = targets.filter((t) => state.ai[t]);
      for (const t of gone) boards = clear(boards, Object.entries(state.ai[t].artboards), t);
      if (gone.length) undid = trim({ ...undid, [action.actionId]: gone });
    } else {
      // a redo names the AI action it re-applies, or the undo it takes back: that is AI's again
      for (const u of targets)
        for (const t of state.ai[u] ? [u] : state.undid[u] || []) {
          const run = state.ai[t];
          if (run) boards = mark(boards, { actionId: t, actor: run.actor, mine: run.mine }, run);
        }
    }
    return { boards, ai: state.ai, undid };
  }
  // a person's change (or an outside write, a restore, a trash): what it changed is not AI's any more
  if (!pairs.length) return state;
  return { boards: clear(state.boards, pairs), ai: state.ai, undid: state.undid };
}

/** `ui/k.tsx` names the frame `.design/ui/k.tsx` (or the same path): suffix match on a `/` boundary. */
export function sameCanvas(key, file) {
  const a = String(key || '').replace(/^\.?\/+/, '');
  const b = String(file || '').replace(/^\.?\/+/, '');
  if (!a || !b) return false;
  return a === b || b.endsWith(`/${a}`) || a.endsWith(`/${b}`);
}

/**
 * The settled rings for the open canvas: `{ [artboard]: { state: 'done', who, tag, waiting: 0 } }`.
 * `who` is 'you' for your AI, else the actor (the canvas draws their face). The tag is fixed.
 */
export function madeByAiRings(state, activeCanvas) {
  const out = {};
  for (const [canvas, boards] of Object.entries(state?.boards || {})) {
    if (!sameCanvas(canvas, activeCanvas)) continue;
    for (const [id, by] of Object.entries(boards))
      out[id] = { state: 'done', who: by.mine ? 'you' : by.actor, tag: MADE_BY_AI_TAG, waiting: 0 };
  }
  return out;
}

/** Is this artboard Made by AI right now? (the Layers / Canvases rows and tests read it) */
export function isMadeByAi(state, canvas, artboard) {
  for (const [c, boards] of Object.entries(state?.boards || {}))
    if (sameCanvas(c, canvas) && boards[artboard]) return true;
  return false;
}

export function createMadeByAiStore() {
  let snap = EMPTY_MADE_BY_AI;
  const subs = new Set();
  return {
    getSnapshot: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    note(action) {
      const next = reduceMadeByAi(snap, action);
      if (next === snap) return;
      snap = next;
      for (const fn of [...subs]) fn();
    },
    reset() {
      snap = EMPTY_MADE_BY_AI;
      for (const fn of [...subs]) fn();
    },
  };
}

let shared = null;
/** The tab's one store. */
export function getMadeByAiStore() {
  if (!shared) shared = createMadeByAiStore();
  return shared;
}

/** The shell's socket handler hands every `project:action` here (client/app.jsx, one line). */
export function noteMadeByAi(action) {
  getMadeByAiStore().note(action);
}

export function useMadeByAi(store = getMadeByAiStore()) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
