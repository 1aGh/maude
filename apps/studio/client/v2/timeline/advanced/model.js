// client/v2/timeline/advanced/model.js — S7.18: the numbers and words of the Timeline's Advanced (07 ve-advanced,
// 06 ad-timeline). Pure; the components only draw them.

import { clock } from '../../export/sections/video-copy.js';

export const ADV_WORDS = Object.freeze({
  advanced: 'Advanced',
  /** the closed fold's hint (06 ad-timeline "Closed — what everyone sees") */
  hint: 'Frame numbers, codec, keyframes, the cut as code',
  timecode: 'Timecode',
  frames: 'Frames',
  thisVideo: 'Render settings',
  easing: (name) => `Easing · ${name}`,
  noKeyframe: 'Pick a keyframe on a clip to see its curve.',
  straight: 'Straight line',
  curveNote: 'Drag the two handles. The curve is written into the video.',
  otherCurve:
    'This curve is written another way, so it stays as it is. Drag a handle to replace it.',
  renderSettings: 'Render settings',
  longVideos: 'Long videos',
  addTrack: '+ track',
  addTrackHint: 'Video 2 · Music 2',
  cutAsCode: 'The cut as code',
  openInCode: 'Open in code view',
  noClip: 'Pick a clip to see it here.',
  copyTimecode: 'Copy timecode',
  copied: 'Timecode copied.',
  derived: 'The cut as this video describes it',
  readOnlyCode: 'Your role can’t read the code.',
  trackNames: Object.freeze({ video2: 'Video 2', music2: 'Music 2' }),
  trackAdded: (name) => `${name} added under Advanced.`,
});

/** `00:00:11:24` — hours, minutes, seconds and the frame inside the second. */
export function timecode(frame, fps) {
  const rate = Math.max(1, Math.round(fps || 30));
  const f = Math.max(0, Math.round(Number.isFinite(frame) ? frame : 0));
  const sec = Math.floor(f / rate);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}:${pad(f % rate)}`;
}

/** The foot's readout: `30 fps · frame 354 of 900 · 00:00:11:24` (the length, not the last frame's index). */
export function frameReadout({ fps, frame, total }) {
  const rate = Math.max(1, Math.round(fps || 30));
  const f = Math.max(0, Math.round(Number.isFinite(frame) ? frame : 0));
  return `${rate} fps · frame ${f} of ${Math.max(0, Math.round(total || 0))} · ${timecode(f, rate)}`;
}

/** The header's time while Advanced is open: `00:00:11:24 / 00:00:30:00`. */
export function timecodeReadout({ fps, frame, total }) {
  return `${timecode(frame, fps)} / ${timecode(total, fps)}`;
}

/** A ruler tick in Frames mode is its frame number. */
export const frameTick = (frame) => String(Math.round(frame));

/** The rows of Render settings (07 ve-advanced): what the video is, as the engine reads it. Read-only. */
export function renderRows({ fps, total }) {
  const rate = Math.max(1, Math.round(fps || 30));
  return [
    { k: 'fps', v: String(rate) },
    { k: 'durationInFrames', v: String(Math.round(total || 0)) },
    { k: 'codec', v: 'h264 · webm · gif' },
    { k: 'bitrate', v: '12 Mb/s (auto)' },
    { k: 'colour', v: 'Rec. 709' },
  ];
}

/** A value of an `interpolate` output range, as the row shows it (`48` → `48`; `[48, 0]` → `48 → 0`). */
export function valuesLine(values, unit = '') {
  if (!values) return null;
  const u = unit && /^-?[\d.]+$/.test(values[0]) ? unit : '';
  return `${values[0]}${u} → ${values[1]}${u}`;
}

/** The clip's file name for the EDL (`assets/314d43a3.mp4` → `314d43a3.mp4`). */
export const baseName = (src) =>
  String(src ?? '')
    .split('/')
    .pop() || null;

/**
 * One clip of the cut as an EDL entry — the fields 07 ve-advanced draws (`clip`, `name`, `startSec`,
 * `durationFrames`, `transition`, `overlay`). Derived from what the video says, so it is right for a cut that
 * never had an `.edl.json`; keys absent when the video does not say.
 */
export function edlEntry(seq, { fps = 30, transition = null } = {}) {
  if (!seq) return null;
  const out = {};
  const clip = baseName(seq.mediaSrc);
  if (clip) out.clip = clip;
  if (seq.label) out.name = String(seq.label);
  const rate = Math.max(1, Math.round(fps || 30));
  out.startSec = Math.round(((seq.from || 0) / rate) * 100) / 100;
  out.durationFrames = Math.round(seq.duration || 0);
  if (transition) out.transition = transition;
  if (!seq.series) out.overlay = { kind: seq.mediaTag ? 'media' : 'title' };
  return out;
}

/** Pretty JSON, the way the canvas draws it (two spaces). */
export const edlText = (entry) => (entry ? JSON.stringify(entry, null, 2) : '');

/** The slug of a canvas, as `<slug>.edl.json` is named: `ui/Video Nabor.tsx` → `video-nabor`. */
export function edlSlug(canvas) {
  const base =
    String(canvas ?? '')
      .split('/')
      .pop() || '';
  return (
    base
      .replace(/\.(tsx|jsx)$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || null
  );
}

export { clock };
