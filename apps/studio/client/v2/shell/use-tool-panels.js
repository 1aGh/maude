// client/v2/shell/use-tool-panels.js — V2-4.5c: the shell end of `toolbar-rect` and `tool-panel-open`
// (V2-1.2 §5.5). Both are `active` messages: they come from the ACTIVE canvas's own window on the
// canvas origin or they are dropped (`acceptFromCanvas` is the one gate). A background canvas, a
// sibling frame and a foreign origin therefore open nothing.
//
//   toolbar-rect {mode, rect}   → remembered per canvas (the island's box in the iframe viewport)
//   tool-panel-open {panel, …}  → stickers:   the Stickers gallery (S4.3), anchored above/below the island
//                                  templates:  the Templates panel's host (S4.4 wires the opener)
//                                  assets:     the left panel's Assets tab (V2-4.4a)
//                                  components: the Component picker (S2.16), anchored the same way
//                                  sizes:      the F size picker (S7.20), anchored the same way
//
// EH-P4-2 gate (S4.3): a panel opens only (a) while the canvas iframe has focus, (b) at most once per
// PANEL_MIN_GAP_MS, (c) anchored on the reported `toolbar-rect` (the message's own anchor is believed
// only when it lies on that box ± 16 px), and `placePanel` keeps it under the top chrome band. A refusal
// is silent: a canvas the user is not driving gets no toast either.
//
// The pure lane (`createToolPanelLane`) takes everything it touches as a function so a test drives it
// with fake events; the hook only wires it to `window` and the shell's openers.

import { useEffect, useRef } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import {
  anchorWithinToolbar,
  createPanelGate,
  createToolbarRects,
  PANEL_HOSTS,
  PANEL_SIZE,
  placePanel,
  toShellRect,
} from './tool-panels.js';
import { showRoleDenial } from './role-denial.js';

/**
 * @param deps.canvasOrigin () => string — the canvas origin messages must come from
 * @param deps.activePath () => string | null
 * @param deps.frameOf (path) => HTMLIFrameElement | undefined
 * @param deps.viewport () => {w,h}
 * @param deps.openStickers ({canvas, anchor, replace}) => void — `anchor` is a placement or null (centred);
 *   `replace` (S4.13) is the id of the sticker being replaced
 * @param deps.closeStickers () => void — the canvas let go of its stamp (`stamp-disarmed`): put the Stamps row away
 * @param deps.openTemplates ({canvas, anchor}) => void — optional until the Templates panel exists (S4.4)
 * @param deps.openComponents ({canvas, anchor}) => void — the Component picker (S2.16); optional like Templates
 * @param deps.openSizes ({canvas, anchor}) => void — the F size picker (S7.20); optional like Templates
 * @param deps.openAssets () => void
 * @param deps.hasFocus (canvas) => boolean — the canvas iframe is the shell's `document.activeElement`
 * @param deps.now () => number — ms clock (the 500 ms quiet period)
 * @param deps.canEdit () => boolean — the panels add to the design; a non-editor gets `deps.deny()`
 * @param deps.deny (panel) => void
 */
export function createToolPanelLane(deps) {
  const rects = createToolbarRects();
  const gate = createPanelGate();
  const activeWin = () => {
    const p = deps.activePath();
    return p && p !== SYSTEM_TAB ? (deps.frameOf(p)?.contentWindow ?? null) : null;
  };

  function onMessage(e) {
    const t = e?.data?.dgn;
    if (t !== 'toolbar-rect' && t !== 'tool-panel-open' && t !== 'stamp-disarmed') return;
    const m = acceptFromCanvas(e, { canvasOrigin: deps.canvasOrigin(), active: activeWin() });
    if (!m) return;
    const canvas = deps.activePath();
    if (m.dgn === 'toolbar-rect') {
      rects.set(canvas, m.mode, m.rect);
      return;
    }
    // 15 an-stamps — the canvas let go of its stamp (Esc in the canvas): the Stamps row goes too. Closing pops
    // nothing, so neither the focus gate nor the quiet period applies.
    if (m.dgn === 'stamp-disarmed') {
      deps.closeStickers?.();
      return;
    }
    // tool-panel-open — EH-P4-2 first: an unfocused canvas, or a second open inside the quiet period,
    // is refused before anything (role toast included) is said.
    if (deps.hasFocus && !deps.hasFocus(canvas)) return;
    if (!gate.admit(deps.now ? deps.now() : Date.now())) return;
    // Stickers / Assets add to the design: an editor's (V2-4.5b, Q2). A viewing role's E reaches here as
    // a request; the shell owns the role and says the one denial line.
    if (deps.canEdit && !deps.canEdit()) {
      deps.deny?.(m.panel);
      return;
    }
    const host = PANEL_HOSTS[m.panel];
    if (host === 'popover') {
      const frame = deps.frameOf(canvas);
      const bar = rects.get(canvas);
      const placement = placePanel(
        {
          toolbar: toShellRect(frame, bar),
          // the canvas picks its own anchor: believe it only where the toolbar actually is
          anchor: toShellRect(frame, anchorWithinToolbar(m.anchor, bar) ? m.anchor : null),
        },
        deps.viewport(),
        PANEL_SIZE[m.panel]
      );
      if (m.panel === 'templates') deps.openTemplates?.({ canvas, anchor: placement });
      else if (m.panel === 'components') deps.openComponents?.({ canvas, anchor: placement });
      else if (m.panel === 'sizes') deps.openSizes?.({ canvas, anchor: placement });
      else deps.openStickers({ canvas, anchor: placement, replace: m.replace });
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

export function useToolPanels({
  activePath,
  iframesRef,
  cfg,
  canEdit,
  openStickers,
  closeStickers,
  openTemplates,
  openComponents,
  openSizes,
  openAssets,
}) {
  const live = useRef({});
  live.current = {
    activePath,
    iframesRef,
    cfg,
    canEdit,
    openStickers,
    closeStickers,
    openTemplates,
    openComponents,
    openSizes,
    openAssets,
  };
  const laneRef = useRef(null);
  if (!laneRef.current)
    laneRef.current = createToolPanelLane({
      canvasOrigin: () => live.current.cfg?.canvasOrigin || window.location.origin,
      activePath: () => live.current.activePath,
      frameOf: (p) => live.current.iframesRef.current?.get(p),
      viewport: () => ({ w: window.innerWidth, h: window.innerHeight }),
      canEdit: () => live.current.canEdit !== false,
      deny: (panel) => showRoleDenial({ panel }),
      openStickers: (req) => live.current.openStickers(req),
      closeStickers: () => live.current.closeStickers?.(),
      openTemplates: (req) => live.current.openTemplates?.(req),
      openComponents: (req) => live.current.openComponents?.(req),
      openSizes: (req) => live.current.openSizes?.(req),
      // the canvas iframe is the shell's focused element (the key was pressed / the slot clicked in it)
      hasFocus: (canvas) => {
        const frame = live.current.iframesRef.current?.get(canvas);
        return !!frame && document.activeElement === frame;
      },
      now: () => Date.now(),
      openAssets: () => live.current.openAssets(),
    });
  const lane = laneRef.current;
  useEffect(() => {
    window.addEventListener('message', lane.onMessage);
    return () => window.removeEventListener('message', lane.onMessage);
  }, [lane]);
}
