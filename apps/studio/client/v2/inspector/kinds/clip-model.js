// client/v2/inspector/kinds/clip-model.js — S7.10: the clip inspector's pure parts (07 · ve-transition, ve-text,
// ve-fit-fill; the inspector `ClipInspector` in 07's source).
//
//   Length   2.5 s          the clip's length — a fixed number trims the END (clip.retime)
//   Speed    1×             the six presets, or a custom rate
//   Volume   70 %           0 mutes (clip.audio)
//   Framing  All formats    Fill · Fit · Blur behind — how the picture sits (video.fit)
//   Advanced src · in · out, then Grade · Crop · Transition frames (the v1 ClipInspector's tabs, D15)
//
// No DOM, no React: words in, numbers out.

/** The six speed presets the v1 dialog drew; a clip at any other rate shows it as a seventh, selected. */
export const SPEED_PRESETS = Object.freeze([0.25, 0.5, 1, 1.5, 2, 4]);

/** "1×", "0.25×", "1.5×" — never "1.0×". */
export const speedWords = (rate) => {
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return `${Number.parseFloat(r.toFixed(2))}×`;
};

/** The options of the Speed select, the clip's own rate included when it is not a preset. */
export function speedOptions(rate) {
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const all = SPEED_PRESETS.includes(r)
    ? [...SPEED_PRESETS]
    : [...SPEED_PRESETS, r].sort((a, b) => a - b);
  return all.map((p) => ({ value: String(p), label: speedWords(p) }));
}

/** Seconds with one decimal, "2.5 s"; whole seconds drop the decimal, "3 s". */
export function lengthWords(frames, fps) {
  const f = Math.max(1, Math.round(fps) || 30);
  if (!Number.isFinite(frames) || frames < 0) return '';
  const s = Math.round((frames / f) * 10) / 10;
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
}

/**
 * What a person typed in the Length field, as frames: "2.5", "2,5 s", "2.5s", "75f" (frames), "1:05" (m:ss).
 * null = not a length (the field restores its old value).
 */
export function parseLengthFrames(text, fps) {
  const f = Math.max(1, Math.round(fps) || 30);
  const t = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(',', '.');
  if (!t) return null;
  const frames = /^(\d+)\s*f(?:rames?)?$/.exec(t);
  if (frames) return Math.max(1, Number(frames[1]));
  const clock = /^(\d+):(\d{1,2})(?:\.(\d+))?$/.exec(t);
  if (clock) {
    const sec = Number(clock[1]) * 60 + Number(clock[2]) + (clock[3] ? Number(`0.${clock[3]}`) : 0);
    return sec > 0 ? Math.max(1, Math.round(sec * f)) : null;
  }
  const secs = /^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)?$/.exec(t);
  if (!secs) return null;
  const n = Number(secs[1]);
  return n > 0 ? Math.max(1, Math.round(n * f)) : null;
}

/** The volume 0…1 the clip plays at: muted is 0, no `volume` prop is full. */
export const volumeOf = (mediaProps) =>
  mediaProps?.muted ? 0 : Math.min(1, Math.max(0, mediaProps?.volume ?? 1));

/** "70 %" */
export const volumeWords = (v) => `${Math.round(Math.min(1, Math.max(0, v)) * 100)} %`;

/** "0:02.0" — the m:ss.s the Advanced rows speak. */
export function clockWords(seconds) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(s / 60);
  const rest = Math.round((s - m * 60) * 10) / 10;
  const whole = Math.floor(rest);
  const tenth = Math.round((rest - whole) * 10);
  return `${m}:${String(whole).padStart(2, '0')}.${tenth}`;
}

/** The file name of a media path ("assets/dron-sweep.mp4" → "dron-sweep.mp4"). */
export const fileNameOf = (src) =>
  String(src ?? '')
    .split('/')
    .pop() || '';

/**
 * The Advanced rows `src · in · out` (07 · ve-transition's clip inspector: in 0:02.0 · out 0:04.5): where in the
 * source file the clip plays. `in` is the clip's trim (frames), `out` is `in` plus what the clip plays at its rate.
 * A clip with no media of its own (a title) has none of them.
 * @returns {Array<[string, string]>}
 */
export function srcInOut(seq, fps) {
  const f = Math.max(1, Math.round(fps) || 30);
  if (!seq?.mediaSrc) return [];
  const rate = seq.mediaProps?.playbackRate > 0 ? seq.mediaProps.playbackRate : 1;
  const inSec = (seq.mediaProps?.trimBefore ?? 0) / f;
  const outSec = inSec + ((seq.duration ?? 0) / f) * rate;
  return [
    ['src', fileNameOf(seq.mediaSrc)],
    ['in', clockWords(inSec)],
    ['out', clockWords(outSec)],
  ];
}

/**
 * The Framing select — how the picture sits in the player. Fill (crop to the player, the same for every format)
 * is the default and is written as nothing, so it reads "All formats"; Fit adds bars, Blur behind fills the sides.
 */
export const FRAMING_OPTIONS = Object.freeze([
  { value: 'fill', label: 'All formats' },
  { value: 'fit', label: 'Fit' },
  { value: 'blur', label: 'Blur behind' },
]);
export const framingValue = (fit) => (fit === 'fit' || fit === 'blur' ? fit : 'fill');

/** A clip that carries a title: its text, and what its inspector is called. */
export function isTitleRow(seq) {
  if (!seq || seq.series || seq.loose) return false;
  if (seq.placeholder) return false;
  return (seq.rowKind ?? '') === 'jsx';
}

/** Which kind chip a Timeline row gets: a title, music (S7.12: a song on the Music track) or a clip (media, an AI slate, a beat). */
export const timelineKindOf = (seq) =>
  isTitleRow(seq) ? 'title' : seq?.rowKind === 'audio' && !seq.series ? 'music' : 'clip';

/** Does the clip play sound of its own? (A picture or a title does not; the Volume row says so.) */
export const hasSound = (seq) =>
  ['Video', 'OffthreadVideo', 'MaudeVideo', 'Audio', 'MaudeAudio'].includes(seq?.mediaTag ?? '');

/** Does this clip actually make sound — media that is not muted and not at volume 0? */
export const makesSound = (seq) =>
  hasSound(seq) && !seq.mediaProps?.muted && (seq.mediaProps?.volume ?? 1) > 0;

/**
 * Is the whole video silent? (07 · ve-fit-fill: every clip muted, no music bed — the Music track offers some.)
 * A video with no clip at all is empty, not silent; it has its own block.
 * @param {object[]} sequences the parsed rows
 * @param {object[]} audio the loose <Audio> beds
 */
export function isSilentVideo(sequences, audio) {
  if ((audio ?? []).length) return false;
  const rows = sequences ?? [];
  if (!rows.some((s) => s.mediaSrc)) return false;
  return !rows.some(makesSound);
}

/** The v1 filter chain → grade params (mirror of the server's filterToGrade). Null = a hand-written filter. */
export function filterToGradeParams(filter) {
  if (!filter) return {};
  const out = {};
  let rest = String(filter).trim();
  const fnRe = /^([a-z-]+)\(([^)]*)\)\s*/;
  const keys = {
    brightness: 'brightness',
    contrast: 'contrast',
    saturate: 'saturation',
    'hue-rotate': 'hue',
    sepia: 'sepia',
    grayscale: 'grayscale',
    invert: 'invert',
  };
  while (rest.length) {
    const m = rest.match(fnRe);
    if (!m || !keys[m[1]]) return null;
    const v = Number.parseFloat(m[2]);
    if (!Number.isFinite(v)) return null;
    out[keys[m[1]]] = v;
    rest = rest.slice(m[0].length);
  }
  return out;
}

/** The named looks (parameter bundles — still ONE flat filter string on disk). */
export const GRADE_PRESETS = Object.freeze({
  None: null,
  Mono: { saturation: 0, contrast: 1.05 },
  Warm: { hue: -12, saturation: 1.15, brightness: 1.03 },
  Cool: { hue: 12, saturation: 1.05, brightness: 0.98 },
  Punch: { contrast: 1.18, saturation: 1.25 },
});

/** Is this grade a change from nothing? (An all-neutral grade is written as no grade.) */
export const gradeMeaningful = (g) =>
  Object.entries(g ?? {}).some(([k, v]) =>
    k === 'brightness' || k === 'contrast' || k === 'saturation' ? v !== 1 : v !== 0
  );

/** The crop wrapper's neutral value. */
export const NO_CROP = Object.freeze({ scale: 1, x: 0, y: 0 });
export const cropIsNeutral = (f) => !f || (f.scale === 1 && f.x === 0 && f.y === 0);
