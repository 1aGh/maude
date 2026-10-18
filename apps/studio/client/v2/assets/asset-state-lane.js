// client/v2/assets/asset-state-lane.js — S8.19: the shell tells each open canvas which of its pictures
// are here, still uploading from here, waiting for someone's Mac, or missing (contract
// S8-S9-asset-presence §5.5). Parent → iframe only (`asset-state`); the canvas draws the placeholder
// frame (asset-placeholder.tsx) and never asks a route itself.
//
// The rels are the ones the canvas FILE names: the studio reads them (`GET /_api/asset-state?canvas=`),
// so a canvas can never make the shell look up a path it does not reference.
//
// When: on canvas open (`loaded` / `canvas-rendered`), every 60 s while anything waits, at reconnect,
// and after a sweep ends. A refusal (a cell's studio, an older studio, offline) is the quiet state:
// nothing is said, and a frame that had news is told it has none — never Missing.
//
// Relink…: a Missing frame's button posts `asset-relink-request {rel}`; only the ACTIVE canvas is
// heard (origin + source gate), and the lane hands it to `onRelink` — the relink sheet decides.

import { useEffect, useRef } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';

const FRAME = 'iframe[data-testid="canvas-frame"]';
export const ASSET_STATE_POLL_MS = 60_000;

/** The canvas file a frame shows (`data-path`). */
const pathOf = (frame) => frame?.getAttribute?.('data-path') || frame?.dataset?.path || '';

/**
 * @param {object} deps
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => Element[]} [deps.frames] — the canvas iframes (default: every `canvas-frame`)
 * @param {() => Window | null} [deps.activeWindow] — the active canvas window (relink gate)
 * @param {() => string} deps.canvasOrigin
 * @param {(rel: string, canvas: string) => void} [deps.onRelink]
 * @param {Window} [deps.win]
 * @param {(fn: () => void, ms: number) => unknown} [deps.setTimer]
 * @param {(t: unknown) => void} [deps.clearTimer]
 */
export function createAssetStateLane(deps) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const doc = globalThis.document;
  const frames = deps.frames ?? (() => [...(doc?.querySelectorAll?.(FRAME) ?? [])]);
  const win = deps.win ?? globalThis.window;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  /** Window → the JSON last said to it; `waiting` → whether it needs the 60 s poll. */
  const spoken = new WeakMap();
  const waiting = new Set();
  let timer = null;
  let stopped = false;

  async function ask(canvas) {
    let res;
    try {
      res = await fetchImpl(`/_api/asset-state?canvas=${encodeURIComponent(canvas)}`, {
        headers: { accept: 'application/json' },
      });
    } catch {
      return null;
    }
    if (!res?.ok) return null; // 503 (a cell), 404, 400 — the quiet state
    try {
      const body = await res.json();
      return Array.isArray(body?.items) ? body.items : null;
    } catch {
      return null;
    }
  }

  async function tell(frame, force = false) {
    const target = frame?.contentWindow;
    const canvas = pathOf(frame);
    if (!target || !canvas || stopped) return;
    const got = await ask(canvas);
    // Refused / unreadable: quiet. Never invent a Missing; a frame that had news hears "none".
    const items = got ?? [];
    if (items.some((it) => it?.state === 'waiting')) waiting.add(canvas);
    else waiting.delete(canvas);
    arm();
    const json = JSON.stringify(items);
    const before = spoken.get(target);
    if (!force && before === json) return;
    if (before === undefined && items.length === 0) return;
    spoken.set(target, json);
    try {
      // A literal `{ dgn }` (not postToCanvas) so the bridge inventory sees this send site.
      target.postMessage({ dgn: 'asset-state', items }, deps.canvasOrigin() || '*');
    } catch {
      /* detached */
    }
  }

  function arm() {
    if (stopped || timer !== null || waiting.size === 0) return;
    timer = setTimer(() => {
      timer = null;
      void refreshAll();
    }, ASSET_STATE_POLL_MS);
  }

  async function refreshAll(force = false) {
    await Promise.all(frames().map((f) => tell(f, force)));
    arm();
  }

  const onMessage = (e) => {
    const dgn = e?.data?.dgn;
    if (dgn === 'loaded' || dgn === 'canvas-rendered') {
      const frame = frames().find((f) => f.contentWindow === e.source);
      if (frame) {
        spoken.delete(frame.contentWindow);
        void tell(frame, true);
      }
      return;
    }
    if (dgn !== 'asset-relink-request') return;
    const m = acceptFromCanvas(e, {
      canvasOrigin: deps.canvasOrigin(),
      active: deps.activeWindow?.() ?? null,
    });
    if (!m || m.dgn !== 'asset-relink-request') return;
    const frame = frames().find((f) => f.contentWindow === e.source);
    deps.onRelink?.(m.rel, pathOf(frame));
  };
  win?.addEventListener?.('message', onMessage);

  return {
    /** A canvas opened / the socket came back / a sweep ended: ask again for every open canvas. */
    refresh: () => refreshAll(true),
    /** Test seam: is the 60 s poll armed? */
    polling: () => timer !== null,
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      win?.removeEventListener?.('message', onMessage);
    },
  };
}

/** True once per edge: the socket came back, or a sweep that was running finished. */
export function assetStateTriggers(prev, next) {
  if (!prev) return false;
  if (!prev.wsConnected && next.wsConnected) return true;
  const was = prev.syncStatus;
  const now = next.syncStatus;
  if (was?.state && was.state !== 'online' && now?.state === 'online') return true;
  if (was?.assets && !was.assets.finished && now?.assets?.finished) return true;
  return false;
}

/**
 * Mount once in the shell. `syncStatus` / `wsConnected` are the app's live values; `onRelink` opens
 * the relink sheet for (rel, canvas).
 */
export function useAssetStateLane({
  syncStatus,
  wsConnected,
  canvasOrigin,
  activeWindow,
  onRelink,
}) {
  const lane = useRef(null);
  const live = useRef({ canvasOrigin, activeWindow, onRelink });
  live.current = { canvasOrigin, activeWindow, onRelink };
  useEffect(() => {
    lane.current = createAssetStateLane({
      canvasOrigin: () => live.current.canvasOrigin?.() ?? '',
      activeWindow: () => live.current.activeWindow?.() ?? null,
      onRelink: (rel, canvas) => live.current.onRelink?.(rel, canvas),
    });
    return () => lane.current?.stop();
  }, []);
  const prev = useRef(null);
  useEffect(() => {
    const next = { syncStatus, wsConnected };
    if (assetStateTriggers(prev.current, next)) void lane.current?.refresh();
    prev.current = next;
  }, [syncStatus, wsConnected]);
}
