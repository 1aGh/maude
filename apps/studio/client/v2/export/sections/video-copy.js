// client/v2/export/sections/video-copy.js — S8.6: every word the video part of the Export sheet says
// (09 Export › ex-video; CONTRACT §3–§4). Plain data and pure functions, so a test reads the copy
// without mounting anything. Captions are Off unless the person turns them on (C19).

export const FORMATS_LABEL = 'Formats';
export const FORMAT_LABEL = 'Format';
export const QUALITY_LABEL = 'Quality';
export const SOUND_LABEL = 'Sound';
export const SOUND_FILE_LABEL = 'Sound file';
export const CAPTIONS_LABEL = 'Captions';

/** The formats up front for a video; WebM is one click down, under Other…. */
export const VIDEO_FORMATS = [
  ['mp4', 'MP4'],
  ['gif', 'GIF'],
  ['audio', 'Sound only'],
];

/** 1080p is the artboard at its own size, 4K is twice that (the spec's `size.scale`). */
export const QUALITIES = [
  ['1080p', '1080p', 1],
  ['4k', '4K', 2],
];

export const SOUND_MIXED = 'Music, mixed as on the timeline';
export const SOUND_GIF = 'A GIF has no sound';
/** 07 ve-export: under Format when more than one format is ticked. */
export const SOUND_SHARED_NOTE = 'Sound only makes one file — the formats share their sound.';
export const SOUND_ONLY_NOTE = 'The same mix the video has, with no picture.';

export const SOUND_FILES = [
  ['m4a', 'M4A', 'small, plays anywhere'],
  ['wav', 'WAV', 'uncompressed'],
];

export const CAPTIONS_OFF = 'Off';
export const CAPTIONS_BURNED = 'Burned in';
export const CAPTIONS_NONE = 'No speech to caption';
export const CAPTIONS_GIF = 'A GIF has no captions';

export const FILM_LABEL = 'The whole edit — scrub it to check any frame';
export const FILM_SCRUB = 'Scrub the cut';

/** "1 artboard selected, 2 videos." — the note under the ticked formats. */
export function formatsNote({ selected, videos, linked }) {
  const a = `${selected} ${selected === 1 ? 'artboard' : 'artboards'} selected`;
  const v = `${videos} ${videos === 1 ? 'video' : 'videos'}`;
  return `${linked ? 'Its linked 16:9 is ticked too — ' : ''}${a}, ${v}.`;
}

/** The one button, with the noun of what it makes: "Export 2 videos", "Export 1 sound file". */
export function videoButtonLabel({ n, format, busy }) {
  if (busy) return 'Exporting…';
  if (format === 'audio') return n > 1 ? `Export ${n} sound files` : 'Export sound only';
  return n > 1 ? `Export ${n} videos` : 'Export';
}

const clock = (frames, fps) => {
  const s = Math.round(frames / Math.max(1, fps));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export { clock };

const grouped = (n) => n.toLocaleString('en-US');

/** The warning past the cap (C22): the length, the limit, and the one way out. */
export function overCapLine({ label, frames, fps, cap, allowed }) {
  if (allowed)
    return `${label} is ${clock(frames, fps)} long — this export may go up to ${clock(cap, fps)} (${grouped(cap)} frames).`;
  return `${label} is ${clock(frames, fps)} long — one export goes up to ${clock(cap, fps)} (${grouped(cap)} frames at ${fps} fps).`;
}
export const ALLOW_LONGER = 'Allow longer';
export const ALLOW_LONGER_OFF = 'Back to the limit';
