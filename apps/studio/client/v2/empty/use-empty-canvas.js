// client/v2/empty/use-empty-canvas.js — S11.2: what the empty canvas and the empty artboard need from the shell.
//
// PURE where it can be (the model, the ask flow, the lane), so test/v2-empty-canvas.test.tsx drives every rule
// without a browser; the hooks at the bottom only bind them to React and the window.
//
//   emptyCanvasModel(facts)     null, or { variant, quiet, ask, door, offlineLine } — which of the three 05
//                               situations the person is in (ready · offline · not connected).
//   createAskFlow(deps)         Ask AI: opens the chat, pre-fills words, never sends. Not connected → the
//                               ConnectSheet, once.
//   createEmptyLane(deps)       the canvas's `artboards {count}` / `artboard-empty` / `layers-tree` for the
//                               active canvas → { count, hint }.
//   fillPrompt · hintNext · hintPlacement   words and geometry.
//
// The words: the CONTRACT line is the copy table's `es-canvas-ai.canvas-ready`; the offline line is S5.13's
// (`gate-lines.js OFFLINE_BACK`) — not a second copy.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { OFFLINE_BACK } from '../ai/gate-lines.js';
import { COPY } from './empty-copy.js';

/** "AI is back when this Mac is online." — S5.13's line, the same bytes the chat's queued state uses. */
export const OFFLINE_LINE = OFFLINE_BACK;

/** The connection states past the reconnect grace window — outbox/hub-reachability.ts `UNREACHABLE`, the same set. */
const HUB_AWAY = new Set(['offline', 'offline-long']);

/**
 * P8 G1b (01 cf-offline-create): is this project's hub away? For a hub-linked project the hub gate is the truth
 * the queued card already follows (a prompt waits on `hub`), so the empty canvas's offline line reads it too —
 * not only navigator.onLine. `connecting` is the grace window (Syncing…); a local project never closes it.
 * @param {{ linked?: boolean, state?: string } | null | undefined} syncStatus
 */
export function hubAway(syncStatus) {
  if (!syncStatus || syncStatus.linked === false) return false;
  return HUB_AWAY.has(syncStatus.state);
}

/**
 * Which empty-canvas situation applies — or null (nothing to show).
 *
 * @param {{ count: number|null|undefined, mode: string, canEdit: boolean, online: boolean,
 *   claude: 'present'|'absent'|'unknown', canAsk: boolean }} f
 *   `count` is what the CANVAS reported (null until it has: no flash while it loads). `canEdit` false =
 *   Can view / Can comment: no create affordance at all. `canAsk`: the AI chat exists here (desktop app).
 */
export function emptyCanvasModel(f) {
  if (f.count !== 0) return null;
  if (f.mode !== 'edit') return null;
  if (!f.canEdit) return null;
  const offline = f.online === false;
  const variant = offline ? 'offline' : f.claude === 'absent' ? 'connect' : 'ready';
  return {
    variant,
    quiet: offline,
    ask: !!f.canAsk,
    // W7 "no door": an empty canvas always has a way in that is not the AI.
    door: true,
    offlineLine: offline ? OFFLINE_LINE : null,
  };
}

/**
 * Ask AI on the empty canvas / the empty artboard. The chat opens and the words are put in its field — the
 * person presses ↵ (nothing here sends). Not connected changes nothing here: the S5 ConnectSheet asks on the
 * first SEND, in the chat (CONTRACT §6; decision v2-lead-connect-sheet-on-first-send) — never on the press.
 *
 * @param {{ openChat: () => void, prefill: (text: string) => void }} deps
 */
export function createAskFlow(deps) {
  return {
    /** @returns 'chat' */
    ask(_model, text) {
      deps.openChat();
      if (text) deps.prefill(text);
      return 'chat';
    },
  };
}

/** The words Ask AI to fill puts in the composer. */
export function fillPrompt({ label, from }) {
  return from ? `Fill ${label} starting from ${from}.` : `Fill ${label}.`;
}

/**
 * The hint's second line: the table's sentence, minus its clause about another board when there is none.
 * (One source: the clause is cut from `es-artboard-new.artboard-empty.next`, never retyped.)
 */
export function hintNext(from) {
  const tpl = COPY['es-artboard-new.artboard-empty'].next;
  if (from) return tpl.replace('{from}', from);
  return tpl.replace(/, or let AI start it from \{from\}\.$/, '.');
}

/** Where the hint sits: its centre on the artboard's centre, kept inside the window. Fixed-position px. */
export function hintPlacement(frame, rect, viewport, size) {
  const pad = 8;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const left = frame.left + rect.x + rect.w / 2 - size.w / 2;
  const top = frame.top + rect.y + rect.h / 2 - size.h / 2;
  return {
    left: Math.round(clamp(left, pad, viewport.w - size.w - pad)),
    top: Math.round(clamp(top, pad, viewport.h - size.h - pad)),
  };
}

/**
 * The shell's side of the canvas's empty-state messages, for the ACTIVE canvas only.
 *
 * @param {{ canvasOrigin: () => string, activePath: () => string|null,
 *   frameOf: (path: string) => { contentWindow: Window|null }|undefined }} deps
 */
export function createEmptyLane(deps) {
  const counts = new Map();
  let state = { count: null, hint: null };
  const subs = new Set();
  const set = (next) => {
    state = next;
    for (const fn of subs) fn();
  };
  const activeWin = () => {
    const p = deps.activePath();
    return p && p !== SYSTEM_TAB ? (deps.frameOf(p)?.contentWindow ?? null) : null;
  };
  const countOf = () => {
    const p = deps.activePath();
    return p && counts.has(p) ? counts.get(p) : null;
  };
  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** The window `message` handler. Everything is validated by the dgn table before it is read. */
    onMessage(e) {
      const t = e?.data?.dgn;
      if (t !== 'artboards' && t !== 'artboard-empty' && t !== 'layers-tree') return;
      const m = acceptFromCanvas(e, { canvasOrigin: deps.canvasOrigin(), active: activeWin() });
      if (!m) return;
      const path = deps.activePath();
      if (m.dgn === 'artboards') {
        if (!path) return;
        counts.set(path, Math.max(0, Math.round(m.count)));
        set({ ...state, count: countOf() });
      } else if (m.dgn === 'artboard-empty') {
        if (!m.rect || !m.artboardId) {
          if (state.hint) set({ ...state, hint: null });
          return;
        }
        set({
          ...state,
          hint: {
            path,
            artboardId: m.artboardId,
            label: m.label || m.artboardId,
            from: m.from,
            rect: m.rect,
          },
        });
      } else if (m.dgn === 'layers-tree') {
        // the first layer drawn on the empty board: the hint has done its job
        if (state.hint && m.artboardId === state.hint.artboardId && m.tree.length > 0)
          set({ ...state, hint: null });
      }
    },
    /** The active canvas changed: what was said about the last one is not about this one. */
    switched() {
      set({ count: countOf(), hint: null });
    },
    /** A canvas left the project / was closed. */
    forget(path) {
      counts.delete(path);
      set({ count: countOf(), hint: state.hint?.path === path ? null : state.hint });
    },
  };
}

// ── readiness ─────────────────────────────────────────────────────────────────────────────────────

const subscribeOnline = (fn) => {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
};
const onlineNow = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** Is this Mac online? (The shell's own reachability signal — the same one the Share cluster reads.) */
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, onlineNow, () => true);
}

/**
 * Is a Claude account connected? Read once from the preflight report the connect flow already uses
 * (`/_api/preflight` → items[claude].status). 'unknown' until it answers — and when it cannot: no nagging.
 * @param {boolean} enabled only the desktop app has an AI chat; elsewhere nothing is fetched
 * @returns {['present'|'absent'|'unknown', () => void]} the state and a re-read
 */
export function useClaudeState(enabled) {
  const [state, setState] = useState('unknown');
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-reads after Connect
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    fetch('/_api/preflight')
      .then((r) => (r.ok ? r.json() : null))
      .then((report) => {
        if (!live) return;
        const item = report?.items?.find((i) => i.id === 'claude');
        setState(!item ? 'unknown' : item.status === 'present' ? 'present' : 'absent');
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, tick]);
  return [state, () => setTick((n) => n + 1)];
}

/**
 * The lane for the active canvas, bound to the window. One lane per shell; the returned snapshot is
 * `{ count, hint }`.
 */
export function useEmptyLane({ activePath, iframesRef, canvasOrigin }) {
  const live = useRef({});
  live.current = { activePath, iframesRef, canvasOrigin };
  const laneRef = useRef(null);
  if (!laneRef.current)
    laneRef.current = createEmptyLane({
      canvasOrigin: () => live.current.canvasOrigin || window.location.origin,
      activePath: () => live.current.activePath,
      frameOf: (p) => live.current.iframesRef?.current?.get(p),
    });
  const lane = laneRef.current;
  useEffect(() => {
    window.addEventListener('message', lane.onMessage);
    return () => window.removeEventListener('message', lane.onMessage);
  }, [lane]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching canvases is the trigger
  useEffect(() => {
    lane.switched();
  }, [lane, activePath]);
  const snap = useSyncExternalStore(lane.subscribe, lane.get, lane.get);
  return { lane, ...snap };
}
