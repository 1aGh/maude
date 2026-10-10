// _perf-shared.mjs — the measurement contract shared by every `maude design perf`
// engine lane (Chromium via agent-browser, WebKit via safaridriver).
//
// It lives in one file on purpose. Two lanes with two copies of the gesture
// script would drift, and the moment they drift the engines stop being
// comparable — which is the only thing this benchmark is for.

import { existsSync, readFileSync } from 'node:fs';

/** A frame at or above this many ms is a "long frame" (the Long Tasks API threshold). */
export const LONG_FRAME_MS = 50;
/** A frame at or above this many ms counts as jank (a dropped 60 Hz frame and then some). */
export const JANK_FRAME_MS = 25;
/** Idle rAF rate below which the page counts as occluded / throttled (locked screen, hidden window). */
export const OCCLUDED_HZ = 50;

// ── Idle rAF probe (the WebKit cross-origin-frame throttle check) ────────────
//
// WebKit caps requestAnimationFrame at ~30 fps in a cross-origin iframe the
// user has not interacted with. The canvas runs on its own origin (DDR-054), so
// in `--studio` mode every frame time read before a real click is quantised to
// that throttle (28/42 ms) and a heavy variant reads the same as a light one.
// Synthetic dispatchEvent input does not count as interaction; a WebDriver
// pointer action does. This probe reads idle rAF deltas so the caller can prove
// the throttle is gone (frame p50 ≈ parent p50) before it measures anything.
//
// Usable as a W3C `execute/async` script (the driver's callback is the last
// argument and receives the result) or as a plain expression that parks the
// result on `window.__maudePerfIdle`.
export function idleRafSource(frames = 40) {
  const n = Math.max(5, Math.min(240, Math.floor(Number(frames) || 40)));
  return `((done) => {
  window.__maudePerfIdle = null;
  const deltas = [];
  let last = 0;
  const tick = (t) => {
    if (last) deltas.push(t - last);
    last = t;
    if (deltas.length < ${n}) { window.requestAnimationFrame(tick); return; }
    const s = deltas.slice().sort((a, b) => a - b);
    window.__maudePerfIdle = { frames: s.length, p50: Math.round(s[Math.floor(s.length / 2)] * 100) / 100 };
    if (typeof done === 'function') done(JSON.stringify(window.__maudePerfIdle));
  };
  window.requestAnimationFrame(tick);
  return 'STARTED';
})(typeof arguments !== 'undefined' ? arguments[arguments.length - 1] : undefined)`;
}

/** Shape check for the idle probe's result (it lives in the untrusted canvas origin). */
export function parseIdleResult(raw) {
  let r;
  try {
    r = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!r || typeof r !== 'object') return null;
  if (typeof r.p50 !== 'number' || !Number.isFinite(r.p50) || r.p50 <= 0) return null;
  if (typeof r.frames !== 'number' || !Number.isFinite(r.frames)) return null;
  return { frames: r.frames, p50: r.p50 };
}

/**
 * Is the canvas frame still throttled relative to its parent document?
 * The throttle halves the rate (two vsyncs per frame), so the line sits halfway
 * between one and two vsyncs: a frame p50 at 1.5× the parent's or more is
 * throttled; within one vsync of it is not.
 */
export function frameThrottled({ frameP50, parentP50 }) {
  if (!(frameP50 > 0) || !(parentP50 > 0)) return true;
  return frameP50 >= parentP50 * 1.5;
}

/**
 * W3C WebDriver `actions` payload for ONE real mouse click at an offset from an
 * element's in-view centre (the element-origin convention). A WebDriver pointer
 * action is trusted user input — the thing that lifts WebKit's cross-origin
 * frame throttle, which a synthetic dispatchEvent never does.
 */
export function clickActions(elementRef, dx, dy) {
  return {
    actions: [
      {
        type: 'pointer',
        id: 'maude-perf-mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          {
            type: 'pointerMove',
            origin: elementRef,
            x: Math.round(Number(dx) || 0),
            y: Math.round(Number(dy) || 0),
            duration: 0,
          },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  };
}

/**
 * In-frame script: find a point of EMPTY world inside the canvas host, nearest
 * its top-left, and return its offset from the host's centre (the WebDriver
 * element-origin convention). Clicking an artboard would select it and paint a
 * selection halo for the rest of the run — a measurement artefact.
 */
export const EMPTY_POINT_SOURCE = `(() => {
  const host = document.querySelector('.dc-canvas');
  if (!host) return null;
  const r = host.getBoundingClientRect();
  const busy = '[data-dc-screen],.dc-artboard,.dc-section,.dc-postit,.dc-mm,.dc-zoom-tb,.dc-tool-palette,button,a,input,textarea,select,[contenteditable="true"],[role="button"],[role="toolbar"]';
  for (let y = 24; y < r.height - 24; y += 24) {
    for (let x = 24; x < r.width - 24; x += 24) {
      const el = document.elementFromPoint(r.left + x, r.top + y);
      if (!el || !host.contains(el)) continue;
      if (el.closest(busy)) continue;
      return { dx: Math.round(x - r.width / 2), dy: Math.round(y - r.height / 2) };
    }
  }
  return { dx: Math.round(24 - r.width / 2), dy: Math.round(24 - r.height / 2) };
})()`;

// ── Canvas-frame geometry (the T6 large-viewport control) ────────────────────
//
// WebKit's zoom cost was found to depend on the SIZE of the canvas iframe (a
// threshold, not a slope — V2-1.8 §6). The control pins the iframe with the same
// CSS at different sizes so "bigger iframe" is separated from "the pinning
// itself": `today` leaves it alone, `pinned` fixes it at today's rect, `full`
// fixes it at the window's size (the v2 edge-to-edge geometry), `WxH` fixes it
// at 0,0 with that size.
const FRAME_MAX = 8192;
export function parseFrameMode(v) {
  if (v === 'today' || v === 'pinned' || v === 'full') return { mode: v };
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(String(v || ''));
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w >= 100 && h >= 100 && w <= FRAME_MAX && h <= FRAME_MAX) return { mode: 'size', w, h };
  }
  return null;
}

/** Parent-document script that applies a parsed frame mode; returns the resulting rect. */
export function frameGeometrySource(frame) {
  const f = frame || { mode: 'today' };
  return `(() => {
  const frame = document.querySelector('[data-testid="canvas-frame"]');
  if (!frame) return null;
  const mode = ${JSON.stringify(f.mode)};
  const r0 = frame.getBoundingClientRect();
  const pin = (left, top, w, h) => {
    for (const [k, v] of [['position', 'fixed'], ['left', left + 'px'], ['top', top + 'px'],
      ['width', w + 'px'], ['height', h + 'px'], ['max-width', 'none'], ['max-height', 'none'],
      ['z-index', '2147482000']]) frame.style.setProperty(k, v, 'important');
  };
  if (mode === 'pinned') pin(r0.left, r0.top, r0.width, r0.height);
  else if (mode === 'full') pin(0, 0, window.innerWidth, window.innerHeight);
  else if (mode === 'size') pin(0, 0, ${Number(f.w) || 0}, ${Number(f.h) || 0});
  const r = frame.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), dpr: window.devicePixelRatio,
    innerW: window.innerWidth, innerH: window.innerHeight };
})()`;
}

/** WxH window size for the Safari lane, bounded so a typo cannot ask for a 1e9 px window. */
export function parseWindowSize(v) {
  const m = /^(\d{3,5})x(\d{3,5})$/.exec(String(v || ''));
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w < 400 || h < 300 || w > FRAME_MAX || h > FRAME_MAX) return null;
  return { w, h };
}

// ── The in-page harness ──────────────────────────────────────────────────────
//
// Synthesizes the same wheel events the viewport controller listens for
// (`canvas-lib.tsx` onWheel: plain wheel = 2D pan, ctrlKey wheel = pinch-zoom —
// a macOS trackpad pinch arrives as ctrlKey:true, so this is the real gesture
// path, not a side door).
//
// Runs async and parks its result on `window.__maudePerfResult`, which the
// caller polls: both driver protocols return one synchronous value per eval and
// cannot await.
export function harnessSource({ pan, zoom, injectCss, fitAll, setFlags }) {
  const flagBlock = (setFlags || []).map((f) => `\n  win[${JSON.stringify(f)}] = true;`).join('');
  const cssBlock = injectCss
    ? `
  {
    const st = doc.createElement('style');
    st.id = 'maude-perf-variant';
    st.textContent = ${JSON.stringify(injectCss)};
    doc.head.appendChild(st);
  }`
    : '';
  return `(() => {
  const host = document.querySelector('.dc-canvas') ||
               (document.querySelector('iframe') &&
                document.querySelector('iframe').contentDocument &&
                document.querySelector('iframe').contentDocument.querySelector('.dc-canvas'));
  if (!host) return 'NO_HOST';
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  win.__maudePerfResult = null;${flagBlock}${cssBlock}

  // Render counter, installed by canvas-lib when this object exists. Absent
  // instrumentation reports null rather than zero — "not measured" and
  // "measured zero" must never look alike in a baseline.
  win.__dcPerf = { artboardRenders: 0, annotationRenders: 0 };

  const frames = [];
  let longtasks = 0;
  let po = null;
  try {
    po = new win.PerformanceObserver((list) => { longtasks += list.getEntries().length; });
    po.observe({ entryTypes: ['longtask'] });
  } catch { /* longtask unsupported (WebKit) — count stays 0, frames still tell the story */ }

  let last = 0;
  let running = true;
  const tick = (t) => {
    if (last) frames.push(t - last);
    last = t;
    if (running) win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);

  const rect = host.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const wheel = (dx, dy, ctrl) => host.dispatchEvent(new win.WheelEvent('wheel', {
    deltaX: dx, deltaY: dy, ctrlKey: !!ctrl,
    clientX: cx, clientY: cy, bubbles: true, cancelable: true,
  }));

  const nextFrame = () => new Promise((r) => win.requestAnimationFrame(() => r()));

  // The world transform is the ground truth that the gesture LANDED. Without
  // this check a probe whose synthetic events get swallowed reports a beautiful
  // 60fps idle page as a baseline — the exact way a benchmark lies.
  const world = doc.querySelector('.dc-world');
  const transformOf = () => (world ? win.getComputedStyle(world).transform + '|' + (world.style.zoom || '') : '');

  (async () => {
    // Occlusion guard (V2-2.20). Behind a locked screen, a closed lid or another
    // window, WebKit throttles or freezes rendering: rAF stops and the numbers
    // describe nothing a user sees. Count rAF callbacks over 500 ms of idle
    // (timers still run when rAF is frozen) and stop before the gesture when
    // the page is hidden or delivers fewer than OCCLUDED_HZ frames a second.
    const visibility = String(doc.visibilityState || 'unknown');
    let idleFrames = 0;
    let idleOn = true;
    const idleTick = () => {
      if (!idleOn) return;
      idleFrames += 1;
      win.requestAnimationFrame(idleTick);
    };
    win.requestAnimationFrame(idleTick);
    await new Promise((r) => win.setTimeout(r, 500));
    idleOn = false;
    const idleHz = idleFrames * 2;
    if (visibility === 'hidden' || idleHz < ${OCCLUDED_HZ}) {
      running = false;
      win.__maudePerfResult = { occluded: true, visibility, idleHz };
      return;
    }

    // Warm-up: one frame so the first measured delta isn't the install cost.
    await nextFrame();

    // FIT-ALL first when asked. This is the state the moodboard RCA identified
    // as the painful one and the state a probe most easily misses: at the
    // canvas's stored viewport only a handful of boards are on screen, so
    // content-visibility culls the rest and the measurement flatters the
    // engine. Zoomed out to the whole plane nothing culls, every board paints,
    // and that is where the user says it stops being usable. Cmd+0 is the
    // canvas's own fit shortcut (canvas-lib keydown, case 0).
    // NB: no backticks in this comment — it lives inside a template literal.
    if (${fitAll ? 'true' : 'false'}) {
      doc.dispatchEvent(new win.KeyboardEvent('keydown', {
        key: '0', code: 'Digit0', metaKey: true, bubbles: true, cancelable: true,
      }));
      host.dispatchEvent(new win.KeyboardEvent('keydown', {
        key: '0', code: 'Digit0', metaKey: true, bubbles: true, cancelable: true,
      }));
      // Let the fit animation finish before the measured gesture starts.
      await new Promise((r) => win.setTimeout(r, 800));
    }
    // Baseline for the did-it-move check is taken HERE, after any fit, not at
    // harness install. Repeated passes are deterministic: pass N ends exactly
    // where "fit + the same pan" lands, so an install-time baseline compares two
    // identical states and rejects a gesture that ran perfectly.
    const t0 = transformOf();
    // What the gesture is measured AGAINST: artboards intersecting the canvas
    // viewport. A one-way pan of 720 x 540 CSS px used to push a fit-all canvas
    // completely off screen on a narrow iframe, so that "baseline" timed an
    // empty viewport (V2-2.20). The count is part of the result, and the pan is
    // out-and-back so the content stays where the fit put it.
    const onScreen = () => {
      const h = host.getBoundingClientRect();
      let n = 0;
      for (const a of doc.querySelectorAll('[data-dc-screen]')) {
        const r = a.getBoundingClientRect();
        if (r.right > h.left && r.left < h.right && r.bottom > h.top && r.top < h.bottom) n += 1;
      }
      return n;
    };
    const boardsOnScreen = onScreen();
    const panStart = frames.length;
    const panHalf = Math.max(1, Math.floor(${pan} / 2));
    let tPanMid = '';
    for (let i = 0; i < ${pan}; i++) {
      const out = i < panHalf;
      wheel(out ? -12 : 12, out ? -9 : 9, false);
      await nextFrame();
      if (i === panHalf - 1) tPanMid = transformOf();
    }
    const panEnd = frames.length;
    const tPan = transformOf();

    // Zoom: alternate in/out so the run neither drifts to the zoom clamp nor
    // ends somewhere a follow-up run would start from differently.
    // Zoom IN first, then back out — symmetric (net scale change ~0) but it
    // starts in the direction that always has headroom. Starting outward dies
    // at fit-all, where the viewport already sits on ZOOM_MIN: the clamp makes
    // the first half a no-op, the transform never moves, and the validity gate
    // correctly rejects the whole run.
    // Sampled at the TURNAROUND, not at the end: the run is symmetric, so its
    // endpoint transform equals its start. Comparing endpoints would report
    // "zoom never happened" for a zoom that happened twice.
    let tZoomMid = '';
    for (let i = 0; i < ${zoom}; i++) {
      wheel(0, i < ${zoom} / 2 ? -8 : 8, true);
      await nextFrame();
      if (i === Math.floor(${zoom} / 2) - 1) tZoomMid = transformOf();
    }
    const zoomEnd = frames.length;
    const tZoom = tZoomMid;

    // Settle window — the tail spike after the gesture is its own symptom
    // ("seká po dojezdu"), so it is measured separately, not averaged away.
    const settleStart = frames.length;
    await new Promise((r) => win.setTimeout(r, 900));
    running = false;
    if (po) { try { po.disconnect(); } catch {} }

    const slice = (a, b) => frames.slice(a, b).filter((n) => n > 0);
    const pct = (arr, p) => {
      if (!arr.length) return null;
      const s = arr.slice().sort((a, b) => a - b);
      return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 100) / 100;
    };
    const stat = (arr) => ({
      frames: arr.length,
      p50: pct(arr, 0.5),
      p95: pct(arr, 0.95),
      max: arr.length ? Math.round(Math.max(...arr) * 100) / 100 : null,
    });

    const gestureFrames = slice(panStart, zoomEnd);
    const settleFrames = slice(settleStart, frames.length);
    // Long frames, counted from rAF deltas so BOTH engines report them: WebKit
    // has no longtask entries at all (the count above stays 0 there), so a
    // "long-task count" rule cannot be read on the engine that matters most.
    // 50 ms is the Long Tasks API threshold; 25 ms (one dropped 60 Hz frame
    // and then some) is recorded as the softer jank signal.
    const countAtLeast = (arr, ms) => arr.filter((n) => n >= ms).length;
    win.__maudePerfResult = {
      longFrames: countAtLeast(gestureFrames, ${LONG_FRAME_MS}),
      jankFrames: countAtLeast(gestureFrames, ${JANK_FRAME_MS}),
      settleLongFrames: countAtLeast(settleFrames, ${LONG_FRAME_MS}),
      pan: stat(slice(panStart, panEnd)),
      zoom: stat(slice(panEnd, zoomEnd)),
      gesture: stat(gestureFrames),
      settle: stat(settleFrames),
      longtasks,
      artboardRenders: win.__dcPerf ? win.__dcPerf.artboardRenders : null,
      annotationRenders: win.__dcPerf ? win.__dcPerf.annotationRenders : null,
      instrumented: !!(win.__dcPerf && win.__dcPerf.instrumented),
      panApplied: tPanMid !== t0,
      boardsOnScreen,
      visibility,
      idleHz,
      zoomApplied: tZoom !== tPan,
    };
  })();
  return 'STARTED';
})()`;
}

/**
 * Shape check behind `parseAndValidateResult` — validates a harness result
 * before ANY of it is printed or recorded.
 *
 * The harness parks its result on `window.__maudePerfResult` — a global inside
 * the canvas origin, which DDR-054 treats as untrusted. A canvas from a cloned
 * repo can define that global itself, ahead of our IIFE, and hand back whatever
 * shape it likes. The numbers would be laundered downstream by Math.round, but
 * the per-pass progress line and the refusal message print fields verbatim, so
 * without this gate a hostile canvas gets attacker-authored text into the
 * invoking agent's transcript wearing a first-party tool's voice.
 *
 * Returns the value only when every leaf is the primitive it claims to be.
 */
export function parseAndValidateResult(raw) {
  let decoded;
  try {
    decoded = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    // The PARSE is part of the trust boundary, not a step before it. A canvas
    // owns its window and can replace JSON.stringify, so `raw` is arbitrary
    // text — and a JSON.parse SyntaxError quotes a snippet of its input, which
    // would carry attacker-authored text into the invoking agent's transcript
    // through the generic error handler.
    return null;
  }
  return validateResult(decoded);
}

function validateResult(r) {
  const num = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
  // An occluded page parks only the guard's own reading.
  if (r && typeof r === 'object' && r.occluded === true) {
    if (typeof r.idleHz !== 'number' || !Number.isFinite(r.idleHz) || r.idleHz < 0) return null;
    const visibility = ['visible', 'hidden', 'prerender', 'unknown'].includes(r.visibility)
      ? r.visibility
      : 'unknown';
    return { occluded: true, visibility, idleHz: r.idleHz };
  }
  const stat = (o) => o && typeof o === 'object' && num(o.p50) && num(o.p95) && num(o.max);
  if (!r || typeof r !== 'object') return null;
  if (!stat(r.gesture) || !stat(r.pan) || !stat(r.zoom) || !stat(r.settle)) return null;
  if (!num(r.longtasks) || !num(r.artboardRenders) || !num(r.annotationRenders)) return null;
  const count = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!count(r.longFrames) || !count(r.jankFrames) || !count(r.settleLongFrames)) return null;
  if (!count(r.boardsOnScreen)) return null;
  if (typeof r.idleHz !== 'number' || !Number.isFinite(r.idleHz)) return null;
  if (!['visible', 'hidden', 'prerender', 'unknown'].includes(r.visibility)) return null;
  if (typeof r.panApplied !== 'boolean' || typeof r.zoomApplied !== 'boolean') return null;
  if (typeof r.instrumented !== 'boolean') return null;
  return r;
}

/** Median across kept passes — robust to the one pass that hit a GC. */
export function medianOf(passes) {
  const med = (pick) => {
    const vals = passes.map(pick).filter((v) => v != null);
    if (!vals.length) return null;
    const s = vals.slice().sort((a, b) => a - b);
    return Math.round(s[Math.floor(s.length / 2)] * 100) / 100;
  };
  return {
    pan: { p95: med((p) => p.pan.p95) },
    zoom: { p95: med((p) => p.zoom.p95) },
    gesture: {
      p50: med((p) => p.gesture.p50),
      p95: med((p) => p.gesture.p95),
      max: med((p) => p.gesture.max),
    },
    settle: { max: med((p) => p.settle.max) },
    longtasks: med((p) => p.longtasks),
    longFrames: med((p) => p.longFrames),
    jankFrames: med((p) => p.jankFrames),
    settleLongFrames: med((p) => p.settleLongFrames),
    boardsOnScreen: med((p) => p.boardsOnScreen),
    artboardRenders: med((p) => p.artboardRenders),
    annotationRenders: med((p) => p.annotationRenders),
    instrumented: passes.some((p) => p.instrumented),
    passes: passes.length,
    // The spread across kept passes IS a result: a delta smaller than this is
    // noise, and the report says so rather than leaving the reader to guess.
    p95Spread: spreadOf(passes, (p) => p.gesture.p95),
    zoomP95Spread: spreadOf(passes, (p) => p.zoom.p95),
    longFramesRange: spreadOf(passes, (p) => p.longFrames),
    // Every kept pass, compact — the go rule (V2-1.8 M7) compares medians AND
    // ranges, and re-deriving those from a history row needs the passes.
    kept: passes.map((p) => ({
      p50: p.gesture.p50,
      p95: p.gesture.p95,
      panP95: p.pan.p95,
      zoomP95: p.zoom.p95,
      longFrames: p.longFrames,
      jankFrames: p.jankFrames,
      settleLongFrames: p.settleLongFrames,
      boardsOnScreen: p.boardsOnScreen,
    })),
  };
}

/**
 * Paired comparison of two variants measured in the SAME session, pass by pass
 * (round i of A against round i of B). Load drift hits both sides of a pair
 * equally, so the per-round difference is the quantity to read; its range is
 * the noise. Returns null when no round has both sides.
 */
export function pairedDiff(passesA, passesB) {
  const n = Math.min(passesA.length, passesB.length);
  if (!n) return null;
  const sum = (pick) => {
    const d = [];
    for (let i = 0; i < n; i++)
      d.push(Math.round((pick(passesB[i]) - pick(passesA[i])) * 100) / 100);
    const s = d.slice().sort((a, b) => a - b);
    return { median: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1] };
  };
  return {
    rounds: n,
    p95: sum((p) => p.gesture.p95),
    zoomP95: sum((p) => p.zoom.p95),
    longFrames: sum((p) => p.longFrames),
  };
}

/**
 * Two frame sizes are only comparable when they show the same content: the
 * refusal text when any round saw a different number of artboards on screen,
 * else null.
 */
export function onScreenMismatch(passesA, passesB) {
  const n = Math.min(passesA.length, passesB.length);
  for (let i = 0; i < n; i++) {
    if (passesA[i].boardsOnScreen !== passesB[i].boardsOnScreen) {
      return (
        `the two frames showed different content in round ${i + 1} ` +
        `(${passesA[i].boardsOnScreen} vs ${passesB[i].boardsOnScreen} artboards on screen) — ` +
        'not the same measurement; refusing to compare them.'
      );
    }
  }
  return null;
}

/**
 * A pass on an occluded page (locked screen, closed lid, hidden window) measures
 * nothing a user sees: WebKit throttles or freezes rendering there. Returns the
 * refusal text, or null when the page was visible and delivering frames.
 */
export function occlusionRefusal(r, pass) {
  if (r && (r.occluded === true || r.visibility === 'hidden' || r.idleHz < OCCLUDED_HZ)) {
    return (
      `the page was occluded during pass ${pass} (visibility ${r.visibility}, idle rAF ${r.idleHz} Hz < ${OCCLUDED_HZ}) — ` +
      'WebKit throttles hidden pages and a locked screen; unlock the Mac, keep the browser window in front, and re-run.'
    );
  }
  return null;
}

/**
 * A pass that timed an empty viewport measures nothing. Returns the refusal
 * text, or null when the pass saw at least one artboard.
 */
export function emptyViewportRefusal(r, pass) {
  if (r && r.boardsOnScreen === 0) {
    return (
      `no artboard was on screen during pass ${pass} — the gesture timed an empty viewport; ` +
      'refusing to record it (move the camera, or measure with --fit-all).'
    );
  }
  return null;
}

/** max − min of one field across passes (null with fewer than two values). */
function spreadOf(passes, pick) {
  const vals = passes.map(pick).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (vals.length < 2) return null;
  return Math.round((Math.max(...vals) - Math.min(...vals)) * 100) / 100;
}

export function buildRow({ result, label, engineTag, opts, extra }) {
  return {
    date: new Date().toISOString(),
    canvas: label,
    engine: engineTag,
    url: opts.url,
    panFrames: opts.pan,
    zoomFrames: opts.zoom,
    p50FrameMs: result.gesture.p50,
    p95FrameMs: result.gesture.p95,
    maxFrameMs: result.gesture.max,
    panP95Ms: result.pan.p95,
    zoomP95Ms: result.zoom.p95,
    settleMaxMs: result.settle.max,
    longtasks: result.longtasks,
    longFrames: result.longFrames,
    jankFrames: result.jankFrames,
    settleLongFrames: result.settleLongFrames,
    boardsOnScreen: result.boardsOnScreen,
    artboardRenders: result.artboardRenders,
    annotationRenders: result.annotationRenders,
    instrumented: result.instrumented,
    passes: result.passes,
    p95SpreadMs: result.p95Spread,
    zoomP95SpreadMs: result.zoomP95Spread,
    longFramesRange: result.longFramesRange,
    kept: result.kept,
    // Measurement conditions that change the numbers (Safari lane): a delta
    // across a different window or frame geometry is not a delta.
    ...(extra || {}),
  };
}

/** Delta vs the previous run of the same (canvas, engine) pair. */
export function deltaLine(label, cur, prev, unit = 'ms') {
  if (cur == null) return `  ${label.padEnd(22)} —`;
  if (prev == null) return `  ${label.padEnd(22)} ${cur}${unit}   (no prior run)`;
  const d = Math.round((cur - prev) * 100) / 100;
  const pctChange = prev === 0 ? null : Math.round((d / prev) * 1000) / 10;
  const arrow = d === 0 ? '=' : d < 0 ? '▼' : '▲';
  const pctTxt = pctChange == null ? '' : ` ${pctChange > 0 ? '+' : ''}${pctChange}%`;
  return `  ${label.padEnd(22)} ${cur}${unit}   ${arrow} ${d > 0 ? '+' : ''}${d}${unit}${pctTxt}  (was ${prev}${unit})`;
}

export function readHistory(path, label, engineTag) {
  if (!path || !existsSync(path)) return null;
  let prev = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.canvas === label && row.engine === engineTag) prev = row;
    } catch {
      /* a corrupt line must not sink the run — history is a convenience, not a source of truth */
    }
  }
  return prev;
}

/**
 * One-line, control-character-free rendering of a caller-supplied string.
 * A canvas filename comes from the repo and POSIX allows newlines in it, so
 * echoing one raw lets a hostile repo inject its own line into a report an
 * agent reads.
 */
function safeLabel(v) {
  let out = '';
  for (const ch of String(v).slice(0, 200)) {
    const code = ch.codePointAt(0);
    const unsafe =
      code < 0x20 || // C0 — newline and friends: the line-injection case
      code === 0x7f || // DEL
      (code >= 0x80 && code <= 0x9f) || // C1 — some terminals still act on these
      (code >= 0x202a && code <= 0x202e) || // bidi embedding / override
      (code >= 0x2066 && code <= 0x2069); // bidi isolates
    // Bidi controls can't break a line, but they can visually reorder one, so a
    // filename could make a report read differently than it is.
    out += unsafe ? ' ' : ch;
  }
  return out;
}

export function renderReport({ row, prev, opts, label, engineTag }) {
  const out = [];
  out.push(`\n  canvas: ${safeLabel(label)}    engine: ${safeLabel(engineTag)}`);
  out.push(`  gesture: ${opts.pan} pan frames + ${opts.zoom} zoom frames\n`);
  out.push(deltaLine('frame p50', row.p50FrameMs, prev?.p50FrameMs));
  out.push(deltaLine('frame p95', row.p95FrameMs, prev?.p95FrameMs));
  out.push(deltaLine('frame max', row.maxFrameMs, prev?.maxFrameMs));
  out.push(deltaLine('pan p95', row.panP95Ms, prev?.panP95Ms));
  out.push(deltaLine('zoom p95', row.zoomP95Ms, prev?.zoomP95Ms));
  out.push(deltaLine('settle max', row.settleMaxMs, prev?.settleMaxMs));
  out.push(deltaLine('long frames (≥50ms)', row.longFrames, prev?.longFrames, ''));
  out.push(deltaLine('jank frames (≥25ms)', row.jankFrames, prev?.jankFrames, ''));
  out.push(deltaLine('settle long frames', row.settleLongFrames, prev?.settleLongFrames, ''));
  out.push(deltaLine('long tasks', row.longtasks, prev?.longtasks, ''));
  out.push(deltaLine('boards on screen', row.boardsOnScreen, prev?.boardsOnScreen, ''));
  out.push(deltaLine('artboard renders', row.artboardRenders, prev?.artboardRenders, ''));
  out.push(deltaLine('annotation renders', row.annotationRenders, prev?.annotationRenders, ''));
  if (!row.instrumented) {
    out.push(
      '\n  note: render counters are not instrumented in this build — frame timings are still valid.'
    );
  }
  if (row.p95SpreadMs != null) {
    out.push(
      `\n  p95 spread across ${row.passes} kept passes: ${row.p95SpreadMs}ms ` +
        `(zoom p95 ${row.zoomP95SpreadMs ?? '—'}ms, long frames ${row.longFramesRange ?? '—'}) ` +
        '— treat any delta smaller than this as noise.'
    );
  }
  if (row.idle) {
    out.push(
      `  idle rAF p50: canvas frame ${row.idle.frameP50}ms, studio ${row.idle.parentP50}ms ` +
        '(after one real click into the frame — WebKit throttles an untouched cross-origin frame)'
    );
  }
  if (row.frame) {
    out.push(
      `  canvas frame: ${safeLabel(row.frame.mode)} ${row.frame.w}×${row.frame.h} @${row.frame.dpr}x` +
        ` in a ${row.frame.innerW}×${row.frame.innerH} window`
    );
  }
  if (opts.history) out.push(`\n  history: ${opts.history}`);
  out.push(
    `  ${prev ? 'compared against the previous run' : 'first run — this IS the baseline'}\n`
  );
  return out.join('\n');
}
