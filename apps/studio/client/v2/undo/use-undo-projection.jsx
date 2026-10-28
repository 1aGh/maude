// client/v2/undo/use-undo-projection.jsx — S2.20: the shell's ⌘Z / ⇧⌘Z and Undo history, run over
// the one op log (V2-1.5 §5.4, decision v2-V2-1.5-undo-is-a-projection).
//
// The stack is SHELL-owned and keyed by canvas: a canvas reload / HMR re-mounts the iframe, never this
// store, so the stack survives it (U-key "HMR keeps the stack"). An app restart empties it (session
// scope, Q9). What an entry IS comes from S5's pure reducer (`projection.js`); the server's
// `GET /_api/project/undo-stack` folds accepted history through that same reducer, so this store
// takes the server's view as truth and adds only what the server cannot know:
//   - when this canvas opened in this app session (`since`), the stack's lower bound;
//   - entries marked `stale` here (a ⌘Z came back `undo-conflict`) — skipped from then on;
//   - pending gestures (`actionId: null`, behind an AI stage) handed in by `notePending` — the
//     server's view lists them too (S2.20c); ⌘Z on one sends `{ pendingTx, canvas }`, which queues
//     its inverse behind the same run, and the entry stays undone (`pendingVia`) until it lands.
//
// ⌘Z = `POST /_api/project/undo { actionId, via: 'keys' }` on the newest `done` entry; the answer's
// action id is kept (`undoneVia`) because ⇧⌘Z names THE UNDO (`{ actionId: undoneVia, redo: true }`).
// Undo history's click on row k = ONE `POST { actionIds: rows 0..k, via: 'panel' }` — one version,
// one entry ⌘Z takes back. Presses are serialized per canvas, so key-repeat never sends one entry
// twice. A project not on the op log answers `legacy`: every call returns `{ handled: false }` and the
// caller runs the DDR-050 canvas stack (the dgn `run-action` lane, V2-1.2 feed) instead.
//
// No React below `useUndoProjection` — the store is unit-tested without a DOM.

import { useSyncExternalStore } from 'react';
import { notifyUndo } from '../../../notifications.tsx';
import { getRunsStore } from '../ai/runs-store.js';
import { actorName, ownRunWorkingOn } from '../ai/runs-model.js';
import { historyRows, nextRedo, nextUndo } from './projection.js';

export const UNDO_STACK_ROUTE = '/_api/project/undo-stack';
export const UNDO_ROUTE = '/_api/project/undo';
export const HISTORY_ROUTE = '/_api/project/history';

/** The words (V2-1.5 §5.4; the iframe HUD's "Undo: …" / "Redo: …" move here with it). */
export const undoWords = {
  // board 01 cf-undo-ai: "Undone — <label> · Redo" (Redo is the toast's action, ⇧⌘Z's own run)
  undone: (label) => `Undone — ${label}`,
  redone: (label) => `Redone — ${label}`,
  // decision v2-p8-undo-while-ai-runs-refuses
  aiWorking: 'AI is still working — Stop is in the AI chat',
  redo: 'Redo',
  undo: 'Undo',
  skipped: (label, n, name) =>
    `Undid ${label} — ${n} ${n === 1 ? 'part was' : 'parts were'} changed by ${name} since, kept`,
  stale: (label, name) => `Can't undo ${label} — ${name} changed it since`,
  someone: 'someone else',
};

const isObj = (v) => !!v && typeof v === 'object';
const str = (v) => (typeof v === 'string' ? v : null);

async function defaultRequest(method, url, body) {
  const r = await fetch(url, {
    method,
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { status: r.status, body: json };
}

/** The design-root-relative path history rows carry, from the shell's repo-relative tab path. */
export function canvasKeyOf(repoRel, designRel = '.design') {
  const p = String(repoRel ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const prefix = `${String(designRel).replace(/^\/+|\/+$/g, '')}/`;
  return prefix !== '/' && p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

/**
 * @param {{
 *   request?: (method: string, url: string, body?: unknown) => Promise<{ status: number, body: any }>,
 *   now?: () => number,
 *   announce?: (text: string) => void,
 *   designRel?: () => string,
 * }} [o]
 */
export function createUndoProjection(o = {}) {
  const request = o.request ?? defaultRequest;
  const now = o.now ?? Date.now;
  const announce = o.announce ?? ((t, action) => notifyUndo(t, action));
  // is a run of mine still working on this canvas? (the runs store is the shell's; a test hands its own)
  const ownRunOn =
    o.ownRunOn ??
    ((repoRel) => {
      try {
        return ownRunWorkingOn(getRunsStore().getSnapshot().view, repoRel, designRel());
      } catch {
        return false;
      }
    });
  const designRel = o.designRel ?? (() => '.design');

  /** repoRel → { repoRel, canvas, openedAt, mode, entries, chain, version } */
  const docs = new Map();
  const subs = new Set();
  let version = 0;
  const changed = () => {
    version += 1;
    for (const fn of subs) fn();
  };

  function doc(repoRel) {
    let d = docs.get(repoRel);
    if (!d) {
      d = {
        repoRel,
        canvas: canvasKeyOf(repoRel, designRel()),
        openedAt: now(),
        mode: 'unknown',
        entries: [],
        chain: Promise.resolve(),
      };
      docs.set(repoRel, d);
    }
    return d;
  }

  /** The projection-state shape the reducer's selectors read. */
  const stateOf = (d) => ({ canvas: d.canvas, openedAt: d.openedAt, entries: d.entries });

  /** Entries a `done` panel undo (Undo history, Undo this chat) already took back: shown, not offered. */
  const coveredOf = (d) =>
    new Set(
      d.entries
        .filter((e) => e.state === 'done' && Array.isArray(e.undoes))
        .flatMap((e) => e.undoes)
    );

  function adoptView(d, view) {
    const prev = new Map(d.entries.filter((e) => e.actionId).map((e) => [e.actionId, e]));
    // S2.20c — a pending entry is known by its transaction id until (and after) it lands.
    const prevTx = new Map();
    for (const e of d.entries) for (const t of [e.pendingTx, e.tx]) if (t) prevTx.set(t, e);
    const fromServer = [...(view.entries ?? []), ...(view.redo ?? [])]
      .filter((e) => isObj(e) && (str(e.actionId) || str(e.pendingTx)))
      .map((e) => {
        const was =
          (e.actionId ? prev.get(e.actionId) : undefined) ??
          prevTx.get(e.pendingTx ?? e.tx ?? '') ??
          undefined;
        // `stale` and the undo id are this session's knowledge; the server's fold has neither.
        if (was?.state === 'stale' && e.state === 'done')
          return { ...e, state: 'stale', ...(was.undoneBy ? { undoneBy: was.undoneBy } : {}) };
        if (e.state === 'undone' && !e.undoneVia && was?.undoneVia)
          return { ...e, undoneVia: was.undoneVia };
        // S2.20c — its inverse went out behind the run and has not landed yet: still undone.
        if (e.state === 'done' && was?.state === 'undone' && was.pendingVia)
          return { ...e, state: 'undone', undoneAt: was.undoneAt, pendingVia: was.pendingVia };
        return e;
      });
    const known = new Set(
      fromServer
        .flatMap((e) => [e.actionId, e.pendingTx, e.tx])
        .filter((t) => typeof t === 'string')
    );
    // A pending gesture stays until its action shows up (then the server's entry replaces it).
    const pending = d.entries.filter((e) => !e.actionId && !known.has(e.pendingTx));
    d.entries = [...fromServer, ...pending].sort(
      (a, b) => a.madeAt - b.madeAt || (a.revision ?? 0) - (b.revision ?? 0)
    );
  }

  async function refreshNow(d) {
    const qs = `${UNDO_STACK_ROUTE}?canvas=${encodeURIComponent(d.repoRel)}&since=${d.openedAt}`;
    const r = await request('GET', qs).catch(() => null);
    const b = r?.body;
    if (b?.ok === true) {
      d.mode = 'op-log';
      adoptView(d, b);
    } else if (b?.reason === 'legacy' || (r && r.status >= 400 && r.status !== 503)) {
      // Not on the op log (or this door refuses it, a cell): the DDR-050 canvas stack answers.
      d.mode = 'legacy';
    }
    // `unreachable` / a network error: keep what we had.
    changed();
    return d;
  }

  const serial = (d, fn) => {
    const run = d.chain.then(fn, fn);
    d.chain = run.catch(() => {});
    return run;
  };

  /** `key` = an action id, or (S2.20c) the pending entry's transaction id. */
  function patch(d, key, fields) {
    d.entries = d.entries.map((e) =>
      (e.actionId ? e.actionId === key : e.pendingTx === key) ? { ...e, ...fields } : e
    );
    changed();
  }
  const keyOf = (e) => e.actionId ?? e.pendingTx;

  async function whoChanged(d, entry) {
    const qs = `${HISTORY_ROUTE}?limit=40&path=${encodeURIComponent(d.repoRel)}`;
    const r = await request('GET', qs).catch(() => null);
    const rows = Array.isArray(r?.body?.history) ? r.body.history : [];
    const after = rows
      .filter((x) => isObj(x) && !x.mine && (x.revision ?? 0) > (entry.revision ?? 0))
      .sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0));
    const who = str(after[0]?.actorName) ?? str(after[0]?.actor);
    // a hub member's actor is her e-mail: named by its local part, never printed (runs-model `actorName`)
    return who ? (who.includes('@') ? actorName(who) : who) : undoWords.someone;
  }

  async function onRejected(d, entry, r) {
    const body = r?.body ?? {};
    if (body.code === 'undo-conflict' || body.reason === 'undo-conflict') {
      const name = await whoChanged(d, entry);
      patch(d, keyOf(entry), { state: 'stale', undoneBy: name });
      announce(undoWords.stale(entry.label, name));
      return { handled: true, ok: false, stale: true };
    }
    return { handled: true, ok: false, reason: body.code ?? body.reason ?? 'refused' };
  }

  async function skippedNote(d, entry, skipped) {
    if (!Array.isArray(skipped) || skipped.length === 0) return;
    const name = await whoChanged(d, entry);
    announce(undoWords.skipped(entry.label, skipped.length, name));
  }

  /** The toast's inline actions: the same run a key press would make. */
  const redoAction = (repoRel) => ({ label: undoWords.redo, onClick: () => redo(repoRel) });
  const undoAction = (repoRel) => ({ label: undoWords.undo, onClick: () => undo(repoRel) });

  /** ⌘Z. `{ handled: false }` → not on the op log: the caller runs the canvas stack. */
  function undo(repoRel) {
    const d = doc(repoRel);
    // decision v2-p8-undo-while-ai-runs-refuses: undoing the entry the run builds on would lose its work and
    // leave Version history and disk disagreeing (the server's landing barrier stays for the moment it ends)
    if (ownRunOn(repoRel)) {
      announce(undoWords.aiWorking);
      return Promise.resolve({ handled: true, ok: false, reason: 'ai-working' });
    }
    return serial(d, async () => {
      await refreshNow(d);
      if (d.mode !== 'op-log') return { handled: false };
      const e = nextUndo(stateOf(d));
      if (!e) return { handled: true, ok: false, reason: 'empty' };
      if (!e.actionId) {
        // S2.20c — pending behind your AI run: it has no action yet. Its inverse joins the run's
        // waiting list right behind it and lands as its undo (V2-1.5 §5.4); the run's staged
        // writes are never touched. No entry is added — ⌘Z flips this one.
        const r = await request('POST', UNDO_ROUTE, {
          pendingTx: e.pendingTx,
          canvas: d.repoRel,
          via: 'keys',
        }).catch(() => null);
        if (!r?.body?.ok) {
          // It went out meanwhile (the run ended): the next press undoes the action it became.
          if (r?.body?.reason === 'not-pending') await refreshNow(d);
          return onRejected(d, e, r);
        }
        patch(d, e.pendingTx, {
          state: 'undone',
          undoneAt: version + 1,
          pendingVia: str(r.body.pendingTx) ?? undefined,
        });
        announce(undoWords.undone(e.label), redoAction(repoRel));
        return { handled: true, ok: true, pending: true, pendingTx: r.body.pendingTx ?? null };
      }
      const r = await request('POST', UNDO_ROUTE, { actionId: e.actionId, via: 'keys' }).catch(
        () => null
      );
      if (!r?.body?.ok) return onRejected(d, e, r);
      patch(d, e.actionId, {
        state: 'undone',
        undoneAt: version + 1,
        undoneVia: str(r.body.actionId) ?? undefined,
      });
      announce(undoWords.undone(e.label), redoAction(repoRel));
      await skippedNote(d, e, r.body.skipped);
      return { handled: true, ok: true, actionId: r.body.actionId, undid: e.actionId };
    });
  }

  /** ⇧⌘Z — redoes the most recently undone entry (a new entry since has cleared redo). */
  function redo(repoRel) {
    const d = doc(repoRel);
    return serial(d, async () => {
      await refreshNow(d);
      if (d.mode !== 'op-log') return { handled: false };
      const e = nextRedo(stateOf(d));
      if (!e) return { handled: true, ok: false, reason: 'empty' };
      // S2.20c — undone by an inverse still waiting behind the run: nothing to redo until it lands.
      if (!e.undoneVia && e.pendingVia) return { handled: true, ok: false, reason: 'pending' };
      if (!e.undoneVia) return { handled: true, ok: false, reason: 'no-undo-id' };
      const r = await request('POST', UNDO_ROUTE, {
        actionId: e.undoneVia,
        redo: true,
        via: 'keys',
      }).catch(() => null);
      if (!r?.body?.ok) return onRejected(d, e, r);
      patch(d, e.actionId, {
        state: 'done',
        undoneAt: undefined,
        undoneVia: undefined,
        pendingVia: undefined,
      });
      announce(undoWords.redone(e.label), undoAction(repoRel));
      return { handled: true, ok: true, actionId: r.body.actionId, redid: e.actionId };
    });
  }

  /** Undo history: clicking row k (newest first) undoes rows 0..k as ONE action. */
  function undoToHere(repoRel, k) {
    const d = doc(repoRel);
    return serial(d, async () => {
      await refreshNow(d);
      if (d.mode !== 'op-log') return { handled: false };
      const rows = historyRows(stateOf(d)).slice(0, Math.max(0, k) + 1);
      const covered = coveredOf(d);
      const ids = rows
        .filter((e) => e.state === 'done' && e.actionId && !covered.has(e.actionId))
        .map((e) => e.actionId);
      if (!ids.length) return { handled: true, ok: false, reason: 'empty' };
      const target = rows[rows.length - 1];
      const r = await request('POST', UNDO_ROUTE, { actionIds: ids, via: 'panel' }).catch(
        () => null
      );
      if (!r?.body?.ok) return onRejected(d, target, r);
      announce(undoWords.undone(target.label), redoAction(repoRel));
      await skippedNote(d, target, r.body.skipped);
      await refreshNow(d); // the panel undo is an entry now — ⌘Z takes it back
      return { handled: true, ok: true, actionId: r.body.actionId, undid: ids };
    });
  }

  /** A `project:action` bus event: refresh every open canvas it touched (a new entry clears redo). */
  function onAction(action) {
    if (!isObj(action) || !Array.isArray(action.canvases)) return;
    for (const d of docs.values()) {
      if (action.canvases.includes(d.canvas)) void serial(d, () => refreshNow(d));
    }
  }

  /** The people (not you, not outside writes) who changed this canvas since it opened — the foot. */
  async function loadOthers(repoRel) {
    const d = doc(repoRel);
    const qs = `${HISTORY_ROUTE}?limit=40&path=${encodeURIComponent(d.repoRel)}`;
    const r = await request('GET', qs).catch(() => null);
    const rows = Array.isArray(r?.body?.history) ? r.body.history : [];
    const names = rows
      .filter(
        (x) =>
          isObj(x) &&
          !x.mine &&
          (x.madeAt ?? x.committedAt ?? 0) >= d.openedAt &&
          !['outside', 'migration.import', 'comment'].includes(x.kind)
      )
      .map((x) => str(x.actorName) ?? str(x.actor))
      .filter(Boolean);
    d.others = [...new Set(names)];
    changed();
    return d.others;
  }

  /** Your gesture, proposed but not accepted yet (behind an AI stage on the same file). */
  function notePending(repoRel, p) {
    const d = doc(repoRel);
    if (!isObj(p) || !str(p.pendingTx) || !Number.isFinite(p.madeAt)) return;
    if (d.entries.some((e) => e.pendingTx === p.pendingTx)) return;
    d.entries = [
      ...d.entries.filter((e) => e.state !== 'undone'), // a new entry clears redo
      {
        actionId: null,
        pendingTx: p.pendingTx,
        who: 'you',
        label: str(p.label) ?? 'Edit',
        madeAt: p.madeAt,
        canvas: d.canvas,
        artboards: Array.isArray(p.artboards) ? p.artboards : [],
        state: 'done',
      },
    ].sort((a, b) => a.madeAt - b.madeAt);
    changed();
  }

  return {
    /** The canvas opened (or became active): starts its session scope once, then refreshes. */
    open(repoRel) {
      if (!repoRel) return Promise.resolve(null);
      const d = doc(repoRel);
      return serial(d, () => refreshNow(d));
    },
    refresh(repoRel) {
      const d = docs.get(repoRel);
      return d ? serial(d, () => refreshNow(d)) : Promise.resolve(null);
    },
    undo,
    redo,
    undoToHere,
    onAction,
    notePending,
    loadOthers,
    others: (repoRel) => docs.get(repoRel)?.others ?? [],
    /** 'unknown' | 'op-log' | 'legacy' */
    mode: (repoRel) => docs.get(repoRel)?.mode ?? 'unknown',
    /** Undo history rows (done + stale), newest first; `top` is what ⌘Z undoes next. */
    rows(repoRel) {
      const d = docs.get(repoRel);
      if (!d) return [];
      const s = stateOf(d);
      const top = nextUndo(s);
      const covered = coveredOf(d);
      return historyRows(s).map((e) => ({
        ...e,
        top: e === top,
        ...(e.actionId && covered.has(e.actionId) ? { covered: true } : {}),
      }));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    version: () => version,
  };
}

/** The shell's one store (shell-owned: it outlives every canvas iframe). */
export const undoProjection = createUndoProjection();

/** Re-render on any change; `rows` / `mode` read the store directly. */
export function useUndoProjection(store = undoProjection) {
  useSyncExternalStore(store.subscribe, store.version, store.version);
  return store;
}

/**
 * The shell's ⌘Z / ⇧⌘Z: the projection first; a project not on the op log falls back to the canvas
 * stack (`fallback()` — the dgn `run-action` lane). Returns the store's answer.
 */
export async function runUndoKey(repoRel, redo, fallback, store = undoProjection) {
  if (!repoRel) {
    fallback?.();
    return { handled: false };
  }
  const r = await (redo ? store.redo(repoRel) : store.undo(repoRel));
  if (!r.handled) fallback?.();
  return r;
}
