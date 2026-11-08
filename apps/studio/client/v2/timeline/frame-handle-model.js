// client/v2/timeline/frame-handle-model.js — #128 §5 (T3.6b): the shell's words for the on-canvas pan / zoom handle.
//
// "The user's first instinct was to drag the video's corners in the preview." The Timeline owns the selected clip and the
// one write pipe; the canvas (editing/video-frame-handle.tsx) only draws the handle over the clip's artboard and reports
// where the person left the picture. This file is what crosses: what the shell tells the canvas (`video-frame-handle`) and
// how the canvas's report becomes ONE `video.reframe` — the write the clip inspector's Zoom / Focus rows make, so undo, the
// toast and a refusal are theirs.
//
// The numbers are the renderer's (`video/framing.ts` `focusAt`): this artboard's own per-format keys win, then the shared
// ones, then the centre. A pan writes where those keys live — the artboard's format when it has its own framing, else the
// shared focus — and a focus that moves over time gets a keyframe at the playhead (source time), like the Re-frame island.
//
// Pure, apart from the toggle (a per-viewer UI fact, never stored).

import { aspectKey, focusAt } from '../../../video/framing.ts';
import { dropParams, keysFor, playheadSourceSec } from './reframe-model.js';

const PICTURE_TAGS = ['Video', 'OffthreadVideo', 'MaudeVideo', 'Img'];
export const LABEL_MAX = 120;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r4 = (v) => Math.round(v * 10000) / 10000;
const r2 = (v) => Math.round(v * 100) / 100;
const SAME = 0.0005;

// ── the toggle ───────────────────────────────────────────────────────────────────────────────────────────────
let openFor = null; // { stableId } | null
let version = 0;
const subs = new Set();
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};

export const frameHandleUi = {
  get: () => openFor,
  /** On or off (the action `video.frame-handle`). On pins nothing yet: the host pins the selected clip. */
  toggle() {
    openFor = openFor ? null : { stableId: null };
    notify();
  },
  close() {
    if (!openFor) return;
    openFor = null;
    notify();
  },
  /** The host pins the clip it opened on; another clip turns the handle off. */
  pin(stableId) {
    if (!openFor || openFor.stableId === stableId) return;
    openFor = openFor.stableId === null ? { stableId } : null;
    notify();
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  version: () => version,
};

// ── the rules ────────────────────────────────────────────────────────────────────────────────────────────────
/** Why the handle will not open on this selection, in the person's words; null when it may. */
export function frameHandleRefusal(seq) {
  if (!seq || !PICTURE_TAGS.includes(seq.mediaTag ?? ''))
    return 'Select a clip with a picture to move it on the canvas.';
  // Fit and Blur behind letterbox the whole picture: there is nothing to move inside the frame
  if (seq.fit === 'fit' || seq.fit === 'blur')
    return 'Set Framing to Fill to move the picture on the canvas.';
  return null;
}

/** Where this artboard's framing lives: its own format's keys when it has any, else the shared focus. */
export function handleScope(reframe, out) {
  const aspect = aspectKey(out.w, out.h);
  return reframe?.formats?.[aspect]?.length
    ? { scope: 'format', aspect }
    : { scope: 'all', aspect };
}

/** The zoom and the focus the renderer shows for this artboard at the playhead. */
export function frameHandleState(seq, out, frame, fps) {
  const reframe = seq?.reframe ?? null;
  const t = playheadSourceSec(frame, seq, fps);
  const f = focusAt(t, reframe?.focus, reframe?.formats, out);
  const z = typeof reframe?.zoom === 'number' && reframe.zoom >= 1 ? reframe.zoom : 1;
  return { zoom: z, focus: [r4(f[0]), r4(f[1])] };
}

/**
 * The `video-frame-handle` message for the active canvas: the clip, or the clear.
 * @param {{ open: boolean, seq: any, out: {w:number,h:number}|null, frame: number, fps: number,
 *   src: {w:number,h:number}|null, artboardId: string|null, label?: string }} p
 */
export function frameHandleMessage(p) {
  const { open, seq, out, artboardId } = p;
  if (!open || !artboardId || !out || !seq?.stableId || frameHandleRefusal(seq))
    return { dgn: 'video-frame-handle', v: 1, artboardId: null };
  const s = frameHandleState(seq, out, p.frame, p.fps);
  return {
    dgn: 'video-frame-handle',
    v: 1,
    artboardId,
    stableId: seq.stableId,
    label: String(p.label ?? '').slice(0, LABEL_MAX),
    src: p.src?.w > 0 && p.src?.h > 0 ? { w: p.src.w, h: p.src.h } : null,
    zoom: s.zoom,
    focus: s.focus,
  };
}

/**
 * The `video.reframe` params for where the canvas left the picture — or null when nothing changed.
 * @param {{ zoom: number, focus: [number, number] }} next the canvas's report
 */
export function frameCommitParams(seq, out, frame, fps, next) {
  const reframe = seq?.reframe ?? null;
  const cur = frameHandleState(seq, out, frame, fps);
  const params = {};
  const z = r2(clamp(Number(next?.zoom) || 1, ZOOM_MIN, ZOOM_MAX));
  if (z !== r2(cur.zoom)) params.zoom = z === 1 ? null : z;
  const fx = r4(clamp(Number(next?.focus?.[0]), 0, 1) || 0);
  const fy = r4(clamp(Number(next?.focus?.[1]), 0, 1) || 0);
  if (Math.abs(fx - cur.focus[0]) > SAME || Math.abs(fy - cur.focus[1]) > SAME) {
    const { scope, aspect } = handleScope(reframe, out);
    const keys = keysFor(reframe, scope, aspect);
    let focus;
    if (keys.length > 1) {
      focus = dropParams(reframe, scope, aspect, playheadSourceSec(frame, seq, fps), [
        fx,
        fy,
      ]).focus;
    } else if (Math.abs(fx - 0.5) <= SAME && Math.abs(fy - 0.5) <= SAME) {
      focus = null; // the centre is the default: nothing left to say
    } else {
      focus = [[keys[0]?.[0] ?? 0, fx, fy]];
    }
    params.focus = focus;
    if (scope === 'format') params.format = aspect;
  }
  return Object.keys(params).length ? params : null;
}
