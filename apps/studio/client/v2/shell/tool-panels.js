// client/v2/shell/tool-panels.js — V2-4.5c: where a shell-rendered tool panel goes (pure core).
//
// The canvas toolbar is an island INSIDE the iframe, so a panel it opens (Stickers, Templates, the
// Component picker, Assets) has to be drawn by the shell and anchored to where the island is. The
// iframe reports that box in its own viewport CSS px (`toolbar-rect`, V2-1.2 §5.5); this module keeps
// the latest one per canvas, translates it into shell (window) coordinates and picks the panel's
// place: above the toolbar when it sits low on the canvas, below it when it sits high, horizontally
// centred on the button that opened it and clamped inside the window.

/** The panel a slot opens → how the shell serves it today (V2-4.5c). */
export const PANEL_HOSTS = Object.freeze({
  stickers: 'popover', // the Stickers gallery (S4.3), anchored
  assets: 'left-panel', // the Canvases panel's Assets tab (V2-4.4a)
  components: null, // no surface yet (the Component picker is S2)
  // The Templates panel is S4's (canvas 15 owns it; S4.4, annotations/templates-panel.jsx). Placed like
  // Stickers; it opens only once the shell wires `openTemplates` (app.jsx).
  templates: 'popover',
});

/** A panel's preferred width (shell px); absent = `placePanel`'s default. Stickers is 440, Templates 640 (canvas 15). */
export const PANEL_SIZE = Object.freeze({ stickers: { w: 440 }, templates: { w: 640 } });

export const PANEL_GAP = 10;
export const PANEL_MARGIN = 8;

// EH-P4-2 (Phase 4 security): the canvas is untrusted and these panels are the shell's. The shell opens
// one only for a canvas that has focus, at most once per PANEL_MIN_GAP_MS, anchored on the toolbar the
// canvas reported (± ANCHOR_SLACK) and never over the top chrome band (title row, project pill, warn/error
// callouts), so a planted canvas cannot paint a trusted-looking panel over them.
export const PANEL_MIN_GAP_MS = 500;
export const ANCHOR_SLACK = 16;
export const TOP_CHROME_BAND = 64;

/**
 * The quiet period between two opens. `admit(now)` is true (and starts the period) only when at least
 * `minGap` ms have passed since the last ADMITTED call, so a refused burst never extends its own ban.
 */
export function createPanelGate({ minGap = PANEL_MIN_GAP_MS } = {}) {
  let last = Number.NEGATIVE_INFINITY;
  return {
    admit(now) {
      if (!Number.isFinite(now) || now - last < minGap) return false;
      last = now;
      return true;
    },
  };
}

/**
 * Is `anchor` (the opening button's box) on the toolbar the canvas reported? Both are in the iframe's
 * viewport px. No reported toolbar = no anchor is believed.
 */
export function anchorWithinToolbar(anchor, toolbar, slack = ANCHOR_SLACK) {
  if (!anchor || !toolbar) return false;
  return (
    anchor.x >= toolbar.x - slack &&
    anchor.y >= toolbar.y - slack &&
    anchor.x + anchor.w <= toolbar.x + toolbar.w + slack &&
    anchor.y + anchor.h <= toolbar.y + toolbar.h + slack
  );
}

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * The latest `toolbar-rect` per canvas. A canvas only ever shows ONE toolbar (its current mode's), so
 * the newest message wins; a `null` rect (Present, Can view) is remembered as "no toolbar".
 */
export function createToolbarRects() {
  const byCanvas = new Map();
  return {
    set(canvas, mode, rect) {
      if (!canvas) return;
      byCanvas.set(canvas, { mode, rect: rect ?? null });
    },
    /** @returns the rect, or null when none was reported / the toolbar is hidden */
    get(canvas) {
      return byCanvas.get(canvas)?.rect ?? null;
    },
    mode(canvas) {
      return byCanvas.get(canvas)?.mode ?? null;
    },
    forget(canvas) {
      byCanvas.delete(canvas);
    },
  };
}

/**
 * Iframe viewport px → shell window px. A frame that is CSS-scaled (clientWidth ≠ its painted width)
 * scales the rect with it; happy-dom and detached frames report 0 and read as 1.
 * @param frame an element with getBoundingClientRect (+ clientWidth/clientHeight)
 * @param rect {x,y,w,h} in the frame's viewport
 */
export function toShellRect(frame, rect) {
  if (!frame || !rect) return null;
  const box = frame.getBoundingClientRect();
  const sx = frame.clientWidth > 0 && box.width > 0 ? box.width / frame.clientWidth : 1;
  const sy = frame.clientHeight > 0 && box.height > 0 ? box.height / frame.clientHeight : 1;
  return {
    x: num(box.left) + num(rect.x) * sx,
    y: num(box.top) + num(rect.y) * sy,
    w: num(rect.w) * sx,
    h: num(rect.h) * sy,
  };
}

/**
 * Where the panel goes.
 * @param toolbar the toolbar island in shell px (vertical anchor) or null
 * @param anchor the button that opened it in shell px (horizontal anchor) or null
 * @param viewport {w,h} of the shell window
 * @param size {w} the panel's preferred width
 * @returns null when there is nothing to anchor to (the caller keeps the centred dialog), else
 *   `{ left, width, maxHeight, top | bottom, placement }` in fixed-position CSS px
 */
export function placePanel({ toolbar, anchor }, viewport, size = { w: 640 }) {
  const box = toolbar ?? anchor;
  if (!box) return null;
  const vw = num(viewport?.w);
  const vh = num(viewport?.h);
  if (vw <= 0 || vh <= 0) return null;
  const width = Math.max(240, Math.min(size.w, vw - 2 * PANEL_MARGIN));
  const cx = (anchor ?? box).x + (anchor ?? box).w / 2;
  const left = Math.round(
    Math.max(PANEL_MARGIN, Math.min(cx - width / 2, vw - width - PANEL_MARGIN))
  );
  const below = box.y + box.h / 2 < vh / 2;
  if (below) {
    const top = Math.max(TOP_CHROME_BAND, Math.round(box.y + box.h + PANEL_GAP));
    return {
      left,
      width,
      top,
      maxHeight: Math.max(160, vh - top - PANEL_MARGIN),
      placement: 'below',
    };
  }
  const bottom = Math.round(vh - box.y + PANEL_GAP);
  return {
    left,
    width,
    bottom,
    // capped so the panel's top edge stays under the chrome band (a window too short for 160 px wins)
    maxHeight: Math.max(160, vh - bottom - TOP_CHROME_BAND),
    placement: 'above',
  };
}
