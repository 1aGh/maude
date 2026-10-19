// client/v2/create/use-render-error.js — S6.12 (C5, 01 `cf-render-error`): what the shell knows about a canvas
// that cannot draw.
//
// The canvas document says two things (dgn c2s, canvas-comment-mount.tsx):
//   render-error {file, message}   it threw while drawing — ONCE per failure; it keeps holding the last good
//                                  render underneath (DDR-077)
//   render-ok    {file}            it drew without an error (every clean commit)
// The canvas is the UNTRUSTED side (DDR-054): both are claims. So this module
//   · takes the CANVAS from the iframe the message came from (`data-path`), never from the `file` it names —
//     a canvas cannot speak for another canvas;
//   · ignores a frame that is Viewing a past version (it draws an old version, it says nothing about now);
//   · draws the message as plain text (clipped) and never acts on it;
//   · relays `render-ok` to the server as a bare canvas NAME (inspector socket frame) — the server reads and
//     hashes the source itself (history/render-ok-signal.ts), so no hash and no source ever travels from here.
//
// The card (render-error.jsx) is silent while a run of THIS Mac draws on the canvas — a broken intermediate
// is normal then (DDR-077) — and appears if the canvas is still broken when the run ends.

import { useEffect, useRef, useState } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { onCanvas, runFile } from '../ai/runs-model.js';

export const RENDER_MESSAGE_MAX = 300;
const WRITING = new Set(['starting', 'running', 'needs-you']);

const clip = (s, n = RENDER_MESSAGE_MAX) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * A canvas→shell `render-*` message, validated: its origin, that it came from one of the shell's own frames,
 * and its payload (the dgn table). The canvas it is about is the FRAME's, not the message's.
 * @param {MessageEvent} e
 * @param {{ canvasOrigin: string, frames: Array<{ contentWindow: Window|null, getAttribute: (k: string) => string|null }> }} ctx
 * @returns {{ kind: 'render-error'|'render-ok', canvas: string, message: string } | null}
 */
export function readRenderMessage(e, { canvasOrigin, frames }) {
  const wins = frames.map((f) => f.contentWindow);
  const m = acceptFromCanvas(e, { canvasOrigin, active: null, frames: () => wins });
  if (!m || (m.dgn !== 'render-error' && m.dgn !== 'render-ok')) return null;
  const frame = frames.find((f) => f.contentWindow && f.contentWindow === e.source);
  const canvas = frame?.getAttribute('data-path');
  if (!canvas) return null;
  return {
    kind: m.dgn,
    canvas,
    message: m.dgn === 'render-error' ? clip(m.message) : '',
  };
}

/**
 * The per-canvas ledger: `{ [canvas]: { status: 'error'|'ok', message, lastGoodAt } }`.
 * `lastGoodAt` is when THIS session last saw the canvas draw cleanly (null on a cold load that never did).
 */
export function noteRender(state, { kind, canvas, message = '', at }) {
  const prev = state[canvas];
  if (kind === 'render-ok')
    return { ...state, [canvas]: { status: 'ok', message: '', lastGoodAt: at } };
  return {
    ...state,
    [canvas]: { status: 'error', message: clip(message), lastGoodAt: prev?.lastGoodAt ?? null },
  };
}

/** Is a run of THIS Mac drawing on `canvas` right now? (A queued run is not drawing yet.) */
export function writingRunOn(view, canvas, designRel) {
  if (!canvas) return false;
  return (view?.mine || []).some(
    (r) =>
      r &&
      WRITING.has(r.state) &&
      (runFile(r, designRel) === canvas || (r.leases || []).some((l) => onCanvas(l, canvas)))
  );
}

/**
 * Does the card show? The canvas said it cannot draw, and: no run of this Mac is drawing on it (it shows if
 * the canvas is still broken once the run ends), no past version is held on it, and the viewport is not
 * already showing the load-failure card for it (one card, not two).
 */
export function cardShown({ entry, canvas, view, designRel, loadFailed = false, viewing = false }) {
  if (!canvas || entry?.status !== 'error') return false;
  if (loadFailed || viewing) return false;
  return !writingRunOn(view, canvas, designRel);
}

/**
 * Listen for the canvases' render signal. One listener for the viewport (every open frame speaks).
 * `wsSend` relays "this canvas drew fine" to the server; `viewingPath` is the canvas held at a past version.
 * @returns {Record<string, {status: string, message: string, lastGoodAt: number|null}>}
 */
export function useRenderSignal({ cfg, wsSend, viewingPath }) {
  const [state, setState] = useState({});
  const live = useRef({});
  live.current = { cfg, wsSend, viewingPath };
  useEffect(() => {
    const onMessage = (e) => {
      const t = e.data && typeof e.data === 'object' ? e.data.dgn : null;
      if (t !== 'render-error' && t !== 'render-ok') return;
      const frames = [...document.querySelectorAll('iframe[data-path]')];
      const r = readRenderMessage(e, {
        canvasOrigin: live.current.cfg?.canvasOrigin || window.location.origin,
        frames,
      });
      if (!r || r.canvas === live.current.viewingPath) return;
      setState((s) => noteRender(s, { ...r, at: Date.now() }));
      if (r.kind === 'render-ok') live.current.wsSend?.({ type: 'render-ok', file: r.canvas });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return state;
}
