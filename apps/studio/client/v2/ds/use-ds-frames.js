// S10.4 wiring (A6b-3 lead patch) — the shell's side of a design system's revision, per canvas frame.
//
// Two pure helpers already exist (pins.js, follower-swap.js); this hook is where they meet the shell:
//   · `ds-pins-want` from the ACTIVE canvas → `createPinsHost.onMessage`, answered (`ds-pins`) into that frame;
//     the answers are re-sent when the index says the head (or a revision's presence) moved.
//   · the follower swap: a frame is seeded with the two files its URL loaded; when the head moves the
//     canvases that follow it get the new pair queued and swapped at the NEXT LOOK (tab visible again, a
//     canvas switch, an artboard move) — never under the viewer's eyes — and Present holds it until it ends.
//
// The frame is untrusted (DDR-054): `acceptFromCanvas` checks the origin, the gate (`active`) and cleans the
// payload before anything here sees it. Nothing here names a path the frame supplied.

import { useCallback, useEffect, useRef } from 'react';
import { acceptFromCanvas, postToCanvas } from '../../../bridge/dgn-protocol.ts';
import { canvasDsRender, canvasDsSystem } from '../../canvas-url.js';
import { createFollowerSwap } from './follower-swap.js';
import { createPinsHost } from './pins.js';

/** What the studio knows about canvas `key` for `createPinsHost` — null when it follows no converted system. */
export function dsFrameState(key, cfg) {
  const render = canvasDsRender(key, cfg);
  const ds = canvasDsSystem(key, cfg);
  if (!render || !ds || cfg?.dsConverted?.[ds.name] !== true) return null;
  const heads = cfg?.systemHeads;
  return {
    ds: { path: ds.path, rootClass: ds.rootClass ?? null },
    head: typeof heads?.[ds.name] === 'string' ? heads[ds.name] : null,
    canvasRev: render.rev,
    gaps: cfg?.dsRevGaps && typeof cfg.dsRevGaps === 'object' ? cfg.dsRevGaps : {},
  };
}

/**
 * `ds.set-theme-preview` (S10.6): the Design system canvas previews its Light or its Dark. A preview only —
 * the canvas keeps it in memory and writes nothing; it answers only its parent (the shell that framed it),
 * and the message goes to the canvas origin, never `*`.
 */
export function postDsThemePreview(frame, mode, origin) {
  if (mode !== 'light' && mode !== 'dark') return false;
  try {
    frame?.contentWindow?.postMessage({ type: 'maude:ds-theme-preview', mode }, origin);
    return !!frame?.contentWindow;
  } catch {
    return false; // detached
  }
}

/** The two files a frame was built showing (`tokens=` / `components=` of its URL), or nulls. */
export function framePair(frame) {
  try {
    const u = new URL(frame.src, window.location.href);
    return [u.searchParams.get('tokens'), u.searchParams.get('components')];
  } catch {
    return [null, null];
  }
}

/**
 * @param {{ cfg: any, iframesRef: { current: Map<string, HTMLIFrameElement> }, activePath: string | null,
 *           presentMode: boolean, canvasActiveArtboard?: unknown }} p
 */
export function useDsFrames({ cfg, iframesRef, activePath, presentMode, canvasActiveArtboard }) {
  const live = useRef({ cfg, activePath, presentMode });
  live.current = { cfg, activePath, presentMode };
  const hosts = useRef(null);
  if (!hosts.current) {
    const win = (key) => iframesRef.current.get(key)?.contentWindow ?? null;
    const origin = () => live.current.cfg?.canvasOrigin || window.location.origin;
    const send = (key, message) => {
      const { dgn, ...rest } = message;
      postToCanvas(win(key), dgn, rest, origin());
    };
    hosts.current = {
      pins: createPinsHost({ state: (key) => dsFrameState(key, live.current.cfg), post: send }),
      swap: createFollowerSwap({ send, presenting: () => live.current.presentMode === true }),
    };
  }
  const { pins, swap } = hosts.current;
  // frames that have reported `loaded` — only those can be swapped (an unloaded one is built with the live head)
  const seeded = useRef(new Set());

  // The frames speak: `ds-pins-want` (active only, cleaned by the dgn table) and `loaded` (seed the swap).
  useEffect(() => {
    function onMessage(e) {
      const t = e.data && typeof e.data === 'object' ? e.data.dgn : null;
      if (t !== 'ds-pins-want' && t !== 'loaded') return;
      const { activePath: active } = live.current;
      const frames = iframesRef.current;
      const activeWin = active ? (frames.get(active)?.contentWindow ?? null) : null;
      const m = acceptFromCanvas(e, {
        canvasOrigin: live.current.cfg?.canvasOrigin || window.location.origin,
        active: activeWin,
        frames: () => [...frames.values()].map((f) => f.contentWindow),
      });
      if (!m) return;
      if (m.dgn === 'ds-pins-want') {
        if (active) pins.onMessage(active, m);
        return;
      }
      for (const [key, frame] of frames) {
        if (frame.contentWindow !== e.source) continue;
        const [tokens, components] = framePair(frame);
        swap.seed(key, tokens, components);
        seeded.current.add(key);
        pins.refresh(key);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [iframesRef, pins, swap]);

  // The index moved the head, or a revision arrived / is still awaited: pins answer again, and every open
  // canvas that follows the head queues the swap of its two links for the next look.
  const headKey = JSON.stringify([cfg?.systemHeads ?? null, cfg?.dsRevGaps ?? null]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `headKey` stands for cfg.systemHeads + cfg.dsRevGaps
  useEffect(() => {
    pins.refresh();
    for (const key of iframesRef.current.keys()) {
      if (!seeded.current.has(key)) continue;
      const r = canvasDsRender(key, live.current.cfg);
      if (r?.tokens) swap.headMoved({ key, tokens: r.tokens, components: r.components ?? null });
    }
  }, [headKey, iframesRef, pins, swap]);

  // The next look: a canvas switch, an artboard move, the window becoming visible again.
  useEffect(() => {
    if (activePath) swap.look('canvas-switch', activePath);
  }, [activePath, swap]);
  useEffect(() => {
    if (activePath) swap.look('artboard-move', activePath);
  }, [canvasActiveArtboard, activePath, swap]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible')
        swap.look('visible', live.current.activePath ?? undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [swap]);

  // Present held the swaps (the audience never sees a canvas change under them); its end lands them.
  const wasPresenting = useRef(false);
  useEffect(() => {
    if (wasPresenting.current && !presentMode) swap.presentEnded();
    wasPresenting.current = presentMode === true;
  }, [presentMode, swap]);

  const postThemePreview = useCallback(
    (mode) =>
      postDsThemePreview(
        activePath ? iframesRef.current.get(activePath) : null,
        mode,
        cfg?.canvasOrigin || window.location.origin
      ),
    [activePath, cfg?.canvasOrigin, iframesRef]
  );

  return { pins, swap, postThemePreview };
}
