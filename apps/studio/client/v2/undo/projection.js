// client/v2/undo/projection.js — S5.5: your ⌘Z stack as a pure projection of the op log
// (V2-1.5 §5.4, decision v2-V2-1.5-undo-is-a-projection).
//
// No React, no fetch, no clock: `reduce(state, event)` → a new state, plus selectors. The shell (S2)
// owns one state per canvas, feeds it `project:action` bus events and its own gestures, and calls
// `POST /_api/project/undo` with what `nextUndo` / `nextRedo` / `undoToHere` name. The server's
// `GET /_api/project/undo-stack` folds accepted history through this SAME reducer, so the two can
// never disagree about what an entry is.
//
// Membership:
//   - your actions on this canvas since it opened in this app session, kind edit · ai · trash · restore;
//   - an undo made from a panel (Undo this chat, Undo history, Version history) — it is an entry, so ⌘Z
//     takes it back; an undo / redo made by ⌘Z / ⇧⌘Z adds no entry, it flips its target's state;
//   - never: comment, outside, migration, other people's actions; at most 100 entries.
// Order: `madeAt` — the gesture time, or the time an AI run LANDED — never the acceptance order
// (U2: an edit made during a run is published behind its stage, but happened before it). Tie: revision.
// Keys: ⌘Z = the newest `done` entry; ⇧⌘Z = the newest `undone` one, and only while nothing newer was
// added (a new entry — your AI run landing included — clears redo). A fully conflicting undo marks the
// entry `stale`: it is skipped from then on, with one toast naming who changed it.

export const MAX_ENTRIES = 100;
export const ENTRY_KINDS = new Set(['edit', 'ai', 'trash', 'restore', 'history.restore']);
/** The labels a ⌘Z / ⇧⌘Z undo carries (routes/project-undo.ts `via: 'keys'`): a flip, not an entry. */
export const KEY_LABELS = new Set(['Undo', 'Redo']);
const STOPPED = ' — stopped';

/** @typedef {{ actionId: string|null, pendingTx?: string, who: 'you'|'ai', label: string, madeAt: number,
 *   revision?: number, canvas: string, artboards: string[], changes?: number, runId?: string,
 *   chatId?: string, partial?: true, undoes?: string[], state: 'done'|'undone'|'stale',
 *   undoneBy?: string, undoneAt?: number, undoneVia?: string, tx?: string, pendingVia?: string }} UndoEntry
 *   (`undoneVia` — S2.20: the id of the ⌘Z undo that undid it; ⇧⌘Z sends `{ actionId: undoneVia, redo }`;
 *    `tx` — S2.20c: the transaction it was proposed under; `pendingVia` — the inverse still waiting
 *    behind an AI run that undid it) */

/** @param {{ canvas: string, openedAt: number, you?: string|null }} o */
export function initialState(o) {
  return { canvas: o.canvas, openedAt: o.openedAt, you: o.you ?? null, entries: [], seq: 0 };
}

const byOrder = (a, b) => a.madeAt - b.madeAt || (a.revision ?? 0) - (b.revision ?? 0);
const undoesOf = (u) => (Array.isArray(u) ? u : typeof u === 'string' ? [u] : []);

function entryLabel(a) {
  const base =
    typeof a.label === 'string' && a.label ? a.label : a.kind === 'ai' ? 'AI edit' : 'Edit';
  return a.partial && !base.endsWith(STOPPED) ? `${base}${STOPPED}` : base;
}

function withEntry(state, entry) {
  // A new entry clears redo: the undone entries leave the stack (Version history keeps them).
  const kept = state.entries.filter((e) => e.state !== 'undone');
  const entries = [...kept, entry].sort(byOrder);
  return { ...state, entries: entries.slice(-MAX_ENTRIES), seq: state.seq + 1 };
}

function setState(state, ids, patch) {
  const want = new Set(ids);
  let hit = false;
  const entries = state.entries.map((e) => {
    if (!e.actionId || !want.has(e.actionId)) return e;
    hit = true;
    return { ...e, ...patch };
  });
  return hit ? { ...state, entries, seq: state.seq + 1 } : state;
}

/**
 * Events:
 *   { type: 'action', action }       a `project:action` payload (or a history row folded by the server):
 *                                     { actionId, mine, kind, label, madeAt?, committedAt?, revision?,
 *                                       canvases, artboards?: Record<canvas,string[]>, runId?, chatId?,
 *                                       undoes?, partial?, transactionId?, changes? }
 *   { type: 'pending', entry }        your gesture, proposed but not yet accepted (behind an AI stage):
 *                                     { pendingTx, label, madeAt, artboards? }
 *   { type: 'pending-undo', pendingTx, of }  S2.20c: ⌘Z on pending entry `of` queued its inverse
 *                                     `pendingTx` behind the same run — `of` is undone
 *   { type: 'pending-dropped', pendingTx }  it was discarded with the stage it waited behind
 *   { type: 'undone', actionId, via? } ⌘Z on it was accepted (`via` = that undo's action id)
 *   { type: 'redone', actionId }      ⇧⌘Z on it was accepted
 *   { type: 'stale', actionId, by? }  ⌘Z on it came back `undo-conflict`
 */
export function reduce(state, event) {
  if (!event || typeof event !== 'object') return state;
  switch (event.type) {
    case 'pending': {
      const p = event.entry ?? {};
      if (typeof p.pendingTx !== 'string' || !Number.isFinite(p.madeAt)) return state;
      if (p.madeAt < state.openedAt) return state;
      return withEntry(state, {
        actionId: null,
        pendingTx: p.pendingTx,
        who: 'you',
        label: typeof p.label === 'string' ? p.label : 'Edit',
        madeAt: p.madeAt,
        canvas: state.canvas,
        artboards: Array.isArray(p.artboards) ? p.artboards : [],
        state: 'done',
      });
    }
    case 'pending-undo': {
      // S2.20c — ⌘Z on a pending entry queued its inverse behind the same run: the entry is undone
      // (no new entry — ⌘Z flips); the inverse lands as an `Undo` of its action, which then names
      // the undo id ⇧⌘Z takes back.
      if (typeof event.of !== 'string' || typeof event.pendingTx !== 'string') return state;
      let hit = false;
      const entries = state.entries.map((e) => {
        if ((e.pendingTx ?? e.tx) !== event.of || e.state !== 'done') return e;
        hit = true;
        return { ...e, state: 'undone', undoneAt: state.seq + 1, pendingVia: event.pendingTx };
      });
      return hit ? { ...state, entries, seq: state.seq + 1 } : state;
    }
    case 'pending-dropped':
      return {
        ...state,
        entries: state.entries.filter((e) => e.pendingTx !== event.pendingTx || e.actionId),
        seq: state.seq + 1,
      };
    case 'undone':
      // S2.20 — `via`: the ⌘Z undo's own action id, the one ⇧⌘Z names (`redo takes the undo`).
      return setState(state, [event.actionId], {
        state: 'undone',
        undoneAt: state.seq + 1,
        ...(typeof event.via === 'string' ? { undoneVia: event.via } : {}),
      });
    case 'redone':
      return setState(state, [event.actionId], {
        state: 'done',
        undoneAt: undefined,
        undoneVia: undefined,
      });
    case 'stale':
      return setState(state, [event.actionId], {
        state: 'stale',
        ...(typeof event.by === 'string' ? { undoneBy: event.by } : {}),
      });
    case 'action':
      return onAction(state, event.action);
    default:
      return state;
  }
}

function onAction(state, a) {
  if (!a || typeof a !== 'object' || typeof a.actionId !== 'string' || !a.mine) return state;
  const isUndo = a.kind === 'undo' || a.kind === 'redo';
  if (isUndo && KEY_LABELS.has(a.label)) {
    // ⌘Z / ⇧⌘Z: flip the target, add nothing. A redo's `undoes` names the undo it re-applies; the
    // entries it brings back are the ones that undo flipped (`flips`).
    const targets = undoesOf(a.undoes);
    if (a.kind === 'undo') {
      const next = setState(state, targets, {
        state: 'undone',
        undoneAt: state.seq + 1,
        undoneVia: a.actionId,
      });
      return { ...next, flips: { ...(state.flips ?? {}), [a.actionId]: targets } };
    }
    const back = targets.flatMap((u) => state.flips?.[u] ?? []);
    return setState(state, back, { state: 'done', undoneAt: undefined, undoneVia: undefined });
  }
  if (!Array.isArray(a.canvases) || !a.canvases.includes(state.canvas)) return state;
  if (state.entries.some((e) => e.actionId === a.actionId)) return state;
  const madeAt = Number.isFinite(a.madeAt)
    ? a.madeAt
    : Number.isFinite(a.committedAt)
      ? a.committedAt
      : 0;
  if (!isUndo && !ENTRY_KINDS.has(a.kind)) return state; // comment, outside, migration.import, …
  if (madeAt < state.openedAt) return state;
  // A pending gesture of yours just got its action: the entry keeps its place (gesture time).
  if (typeof a.transactionId === 'string') {
    const i = state.entries.findIndex((e) => e.pendingTx === a.transactionId && !e.actionId);
    if (i >= 0) {
      const entries = state.entries.slice();
      entries[i] = { ...entries[i], actionId: a.actionId, revision: a.revision };
      return { ...state, entries, seq: state.seq + 1 };
    }
  }
  const artboards =
    a.artboards && typeof a.artboards === 'object' ? (a.artboards[state.canvas] ?? []) : [];
  return withEntry(state, {
    actionId: a.actionId,
    who: a.kind === 'ai' ? 'ai' : 'you',
    label: entryLabel(a),
    madeAt,
    ...(Number.isFinite(a.revision) ? { revision: a.revision } : {}),
    canvas: state.canvas,
    artboards: Array.isArray(artboards) ? artboards : [],
    ...(Number.isFinite(a.changes) ? { changes: a.changes } : {}),
    ...(a.runId ? { runId: a.runId } : {}),
    ...(a.chatId ? { chatId: a.chatId } : {}),
    ...(a.partial ? { partial: true } : {}),
    ...(isUndo ? { undoes: undoesOf(a.undoes) } : {}),
    ...(typeof a.transactionId === 'string' ? { tx: a.transactionId } : {}),
    state: 'done',
  });
}

/** Fold a list of events (oldest first). */
export function fold(state, events) {
  let s = state;
  for (const e of events) s = reduce(s, e);
  return s;
}

/** The entry ⌘Z undoes next: the newest `done` one (pending included), else null. */
export function nextUndo(state) {
  for (let i = state.entries.length - 1; i >= 0; i -= 1) {
    if (state.entries[i].state === 'done') return state.entries[i];
  }
  return null;
}

/** The entry ⇧⌘Z redoes next: the most recently undone one, else null. */
export function nextRedo(state) {
  let best = null;
  for (const e of state.entries) {
    if (e.state !== 'undone') continue;
    if (!best || (e.undoneAt ?? 0) >= (best.undoneAt ?? 0)) best = e;
  }
  return best;
}

/** Undo history rows: done + stale entries, newest first. */
export function historyRows(state) {
  return state.entries.filter((e) => e.state !== 'undone').reverse();
}

/**
 * U18 — clicking Undo history row k undoes rows 0..k as ONE action: the `actionIds` of the done,
 * published entries among them (a stale row is skipped; a pending one has no action yet).
 */
export function undoToHere(state, k) {
  const rows = historyRows(state).slice(0, Math.max(0, k) + 1);
  return rows.filter((e) => e.state === 'done' && e.actionId).map((e) => e.actionId);
}

/** The `GET undo-stack` answer shape (V2-1.5 §5.3). */
export function view(state) {
  const redo = state.entries
    .filter((e) => e.state === 'undone')
    .sort((a, b) => (b.undoneAt ?? 0) - (a.undoneAt ?? 0));
  return { entries: historyRows(state), redo };
}

/** Server side: accepted history rows (any order) → the events the reducer takes, oldest first. */
export function eventsFromHistory(rows) {
  return [...rows]
    .sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0))
    .map((r) => ({
      type: 'action',
      action: { ...r, canvases: Array.isArray(r.canvases) ? r.canvases : [] },
    }));
}
