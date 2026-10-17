// client/v2/shell/use-tool-panels.js — V2-4.5c: the shell end of `toolbar-rect` and `tool-panel-open`
// (V2-1.2 §5.5). Both are `active` messages: they come from the ACTIVE canvas's own window on the
// canvas origin or they are dropped (`acceptFromCanvas` is the one gate). A background canvas, a
// sibling frame and a foreign origin therefore open nothing.
//
//   toolbar-rect {mode, rect}   → remembered per canvas (the island's box in the iframe viewport)
//   tool-panel-open {panel, …}  → stickers: today's StickerPicker, anchored above/below the island
//                                  assets:  the left panel's Assets tab (V2-4.4a)
//                                  components / templates: no surface yet (S2) — nothing opens
//
// The pure lane (`createToolPanelLane`) takes everything it touches as a function so a test drives it
// with fake events; the hook only wires it to `window` and the shell's openers.

import { useEffect, useRef } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { createToolbarRects, PANEL_HOSTS, placePanel, toShellRect } from './tool-panels.js';

/**
 * @param deps.canvasOrigin () => string — the canvas origin messages must come from
 * @param deps.activePath () => string | null
 * @param deps.frameOf (path) => HTMLIFrameElement | undefined
 * @param deps.viewport () => {w,h}
 * @param deps.openStickers ({canvas, anchor}) => void — `anchor` is a placement or null (centred)
 * @param deps.openAssets () => void
 */
export function createToolPanelLane(deps) {
  const rects = createToolbarRects();
  const activeWin = () => {
    const p = deps.activePath();
    return p && p !== SYSTEM_TAB ? (deps.frameOf(p)?.contentWindow ?? null) : null;
  };

  function onMessage(e) {
    const t = e?.data?.dgn;
    if (t !== 'toolbar-rect' && t !== 'tool-panel-open') return;
    const m = acceptFromCanvas(e, { canvasOrigin: deps.canvasOrigin(), active: activeWin() });
    if (!m) return;
    const canvas = deps.activePath();
    if (m.dgn === 'toolbar-rect') {
      rects.set(canvas, m.mode, m.rect);
      return;
    }
    // tool-panel-open
    const host = PANEL_HOSTS[m.panel];
    if (host === 'popover') {
      const frame = deps.frameOf(canvas);
      const placement = placePanel(
        {
          toolbar: toShellRect(frame, rects.get(canvas)),
          anchor: toShellRect(frame, m.anchor),
        },
        deps.viewport()
      );
      deps.openStickers({ canvas, anchor: placement });
    } else if (host === 'left-panel') {
      deps.openAssets();
    }
  }

  return {
    onMessage,
    rects,
    /** A canvas left the project / was closed. */
    forget: (canvas) => rects.forget(canvas),
  };
}

export function useToolPanels({ activePath, iframesRef, cfg, openStickers, openAssets }) {
  const live = useRef({});
  live.current = { activePath, iframesRef, cfg, openStickers, openAssets };
  const laneRef = useRef(null);
  if (!laneRef.current)
    laneRef.current = createToolPanelLane({
      canvasOrigin: () => live.current.cfg?.canvasOrigin || window.location.origin,
      activePath: () => live.current.activePath,
      frameOf: (p) => live.current.iframesRef.current?.get(p),
      viewport: () => ({ w: window.innerWidth, h: window.innerHeight }),
      openStickers: (req) => live.current.openStickers(req),
      openAssets: () => live.current.openAssets(),
    });
  const lane = laneRef.current;
  useEffect(() => {
    window.addEventListener('message', lane.onMessage);
    return () => window.removeEventListener('message', lane.onMessage);
  }, [lane]);
}
