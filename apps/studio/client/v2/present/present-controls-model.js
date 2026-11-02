// client/v2/present/present-controls-model.js — S3.2b: the pure half of the Present chrome.
//
// The counter, the label, the step limits, the zoom word and the "appear on move, fade after two
// seconds" clock. DOM-free so the tests run it on a manual clock. The components
// (present-controls.jsx, canvas-pill.jsx) only render what these return.

import { presentFromLabel } from '../shell/present-from-label.js';

/** 04 md-present-full: "The controls fade after two seconds." */
export const FADE_AFTER_MS = 2000;

const whole = (n) => Number.isInteger(n);

/**
 * "3 / 14" — the presented artboard's place in the RUN. `total` is the canvas's own count (it left the
 * skipped artboards out, S3.2a), so "of 14" for 15 artboards with one skipped needs no maths here.
 * @param pos the `present-position` echo `{ index, total, artboardId }`, or null before the first one
 * @returns the text, or null when there is nothing to say yet (bad numbers never print)
 */
export function counterText(pos) {
  if (!pos || !whole(pos.index) || !whole(pos.total) || pos.total < 1 || pos.index < 0) return null;
  return `${Math.min(pos.index, pos.total - 1) + 1} / ${pos.total}`;
}

/** Whether ‹ (`prev`) or › (`next`) has somewhere to go. The canvas clamps too; this only disables the button. */
export function canStep(pos, dir) {
  if (!pos || !whole(pos.index) || !whole(pos.total) || pos.total < 1) return false;
  return dir === 'prev' ? pos.index > 0 : pos.index < pos.total - 1;
}

/** The presented artboard's name, from the canvas index; null when it has none (the label is then left out). */
export function labelOf(pos, boards) {
  if (!pos || typeof pos.artboardId !== 'string') return null;
  return presentFromLabel({ selected: null, inView: pos.artboardId, boards });
}

/** "21%" — the canvas zoom as a whole percent; null while the canvas has not reported one. */
export function zoomText(zoom) {
  if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom <= 0) return null;
  return `${Math.round(zoom * 100)}%`;
}

const finiteSec = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Whole seconds, rounded down (a clock never runs ahead): "0:06"; with hours "1:02:05". */
function clock(sec, withHours) {
  const t = Math.floor(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  if (withHours) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${Math.floor(t / 60)}:${ss}`;
}

/**
 * S3.3 — "0:06 / 0:15", the clip's place in its length (04 md-present-video); hours only when the clip
 * has some. Null when the numbers are not usable, so nothing wrong is ever printed.
 * @param media `{ t, duration }` (seconds) from `present-media`, or null
 */
export function mediaTimeText(media) {
  if (!media || !finiteSec(media.t) || !finiteSec(media.duration)) return null;
  const hours = media.duration >= 3600;
  return `${clock(media.t, hours)} / ${clock(media.duration, hours)}`;
}

/** The transport's play button asks for the opposite of what is happening. */
export const mediaToggleOp = (media) => (media?.playing ? 'pause' : 'play');
/** …and so does the sound button. */
export const soundOp = (media) => (media?.muted ? 'unmute' : 'mute');

/**
 * The reveal clock: `poke()` (a move, a step) shows the controls and restarts the countdown; `hold(true)`
 * (hover, focus inside) keeps them up and `hold(false)` restarts it. The timers are injected.
 * @param setTimer (fn, ms) => handle
 * @param clearTimer (handle) => void
 * @param onChange (visible: boolean) => void   called only when the value changes
 */
export function createReveal({ delay = FADE_AFTER_MS, setTimer, clearTimer, onChange }) {
  let shown = false;
  let held = false;
  let handle = null;
  const stop = () => {
    if (handle !== null) clearTimer(handle);
    handle = null;
  };
  const set = (v) => {
    if (v === shown) return;
    shown = v;
    onChange(v);
  };
  const arm = () => {
    stop();
    if (held) return;
    handle = setTimer(() => {
      handle = null;
      set(false);
    }, delay);
  };
  return {
    visible: () => shown,
    poke() {
      set(true);
      arm();
    },
    hold(on) {
      held = !!on;
      if (held) {
        stop();
        set(true);
      } else if (shown) arm();
    },
    dispose: stop,
  };
}
