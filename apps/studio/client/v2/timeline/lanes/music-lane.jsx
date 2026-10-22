// client/v2/timeline/lanes/music-lane.jsx — S7.12: the Music track's beats and its volume line (07 · ve-music).
//
//   · a tick on every beat of the song, a TALL one on every bar (only where the analysis was sure of the bar);
//   · the song's tempo ("120 BPM") on the clip;
//   · the volume line dipping under speech, labelled "Lower under speech", drawn when the song sits in a `<Duck>`;
//   · "Finding the beat…" while the studio listens to a song that was just added.
//
// The lane draws what `GET /_api/comp-media` derives (video/derive.ts) — it stores nothing, so the ticks and
// the dip follow every trim, move and speed change with no extra write. The Timeline hands each Music row an
// overlay (`MusicLaneOverlay`) and one hook (`useMusicLane`); the waveform and the clip block stay the
// Timeline's own.

import { useEffect, useMemo, useRef } from 'react';
import { shellToast } from '../../../shell/util.js';
import { CLIP_VERB_LABELS } from '../clip-verb.js';
import { TGlyph } from '../glyphs.jsx';
import {
  findBeats,
  isFinding,
  mediaOf,
  storedSnap,
  useCompMedia,
  useMusicVersion,
} from './music-media.js';
import {
  beatTicks,
  dipsAnywhere,
  duckPoints,
  hasClearBeat,
  MUSIC_WORDS,
  shouldDuckByDefault,
  snapBeatFrames,
  snapMode,
} from './music-model.js';

// The toast after a landed music write says what happened ("Applied: lower music under speech.").
for (const [verb, words] of Object.entries({
  'video.music.duck': 'lower music under speech',
  'video.music.volume': 'set music volume',
  'video.cut-to-beat': 'cut to the beat',
})) {
  if (!(verb in CLIP_VERB_LABELS)) CLIP_VERB_LABELS[verb] = words;
}

const H = 30; // the overlay's own drawing height (it stretches to the row)
const TICK = 5;
const BAR = 10;

/**
 * The ticks, the tempo and the dip over one Music clip's block. `x` is the Timeline's frame → px.
 * Pointer-transparent: the block under it keeps every click and drag.
 */
export function MusicLaneOverlay({ info, x, speech, fps, finding, name }) {
  const left = info ? x(info.from) : 0;
  const w = info ? Math.max(2, x(info.durationInFrames)) : 0;
  const drawn = useMemo(() => {
    if (!info) return null;
    const px = (f) => Math.min(w, Math.max(0, x(f) - left));
    const ticks = beatTicks(info.grid);
    const small = [];
    const tall = [];
    for (const t of ticks) {
      const p = Math.round(px(t.frame) * 10) / 10;
      // P8 C3 (07 · .ve-beat) — the marks hang from the top edge of the song, a tall one every bar
      (t.bar ? tall : small).push(`M${p} 0V${t.bar ? BAR : TICK}`);
    }
    const dip = duckPoints({
      speech,
      duck: info.duck,
      fps: fps || 30,
      from: info.from,
      durationInFrames: info.durationInFrames,
    });
    const line = dipsAnywhere(dip)
      ? dip.map(
          (p) => `${Math.round(px(p.f) * 10) / 10},${Math.round((3 + p.depth * 15) * 10) / 10}`
        )
      : null;
    const firstDip = dip.find((p) => p.depth > 0);
    return {
      small: small.join(''),
      tall: tall.join(''),
      line,
      labelAt: firstDip ? px(firstDip.f) : 0,
    };
  }, [info, x, left, w, speech, fps]);
  if (!info || !drawn) return null;
  const clear = hasClearBeat(info.grid);
  return (
    <div
      className="tl-music-ov"
      style={{ left, width: w }}
      data-testid={`timeline-music-${info.stableId}`}
      data-clear-beat={clear ? '1' : '0'}
      aria-hidden="true"
    >
      <svg
        className="tl-music-svg"
        viewBox={`0 0 ${w} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
      >
        {drawn.small ? (
          <path className="tl-beat-tick" d={drawn.small} data-testid="timeline-beat-ticks" />
        ) : null}
        {drawn.tall ? (
          <path
            className="tl-beat-tick tl-beat-tick--bar"
            d={drawn.tall}
            data-testid="timeline-bar-ticks"
          />
        ) : null}
        {drawn.line ? (
          <polyline
            className="tl-duck-line"
            points={drawn.line.join(' ')}
            data-testid="timeline-duck-line"
          />
        ) : null}
      </svg>
      {drawn.line ? (
        <span
          className="tl-duck-label"
          style={{ left: Math.min(Math.max(0, drawn.labelAt), Math.max(0, w - 120)) }}
          data-testid="timeline-duck-label"
        >
          {MUSIC_WORDS.duck}
        </span>
      ) : null}
      {/* P8 C3 (07 · .ve-music-lab) — one chip at the song's foot: its name and, when the beat is clear, its tempo */}
      <span className="tl-music-lab">
        <TGlyph name="music" size={10} />
        {name ? <span className="tl-music-n">{name}</span> : null}
        {clear ? (
          <span className="tl-music-bpm" data-testid="timeline-music-bpm">
            {Math.round(info.grid.bpm)} BPM
          </span>
        ) : null}
      </span>
      {finding ? (
        <span className="tl-music-finding" data-testid="timeline-music-finding">
          {MUSIC_WORDS.finding}
        </span>
      ) : null}
    </div>
  );
}

const NONE = Object.freeze([]);
const keyOf = (canvas, artboardId) => `${canvas}\u0000${artboardId ?? ''}`;
const sigOf = (sequences, audio) =>
  `${(sequences ?? [])
    .map(
      (s) =>
        `${s.stableId ?? ''}:${s.from}:${s.duration}:${s.mediaSrc ?? ''}:${s.mediaProps?.trimBefore ?? ''}:${s.mediaProps?.playbackRate ?? ''}:${s.mediaProps?.muted ? 'm' : ''}`
    )
    .join('|')}#${(audio ?? []).map((a) => `${a.src}:${a.from}:${a.duration}`).join('|')}`;

/**
 * The Timeline's one hook for music: the media of the followed artboard, the beats Snap lands on, which overlay
 * belongs to which row — and "Add music → beats detected": a song that shows up while the Timeline is open
 * gets its beat found (and, when the video has speech, "Lower under speech" turned on — Q5), once.
 *
 * @param {{ canvas?: string|null, artboardId?: string|null, sequences: object[], audio: object[],
 *   canEdit: boolean, runOp?: (ref: object, verb: string, params: object, opts?: object) => Promise<any>,
 *   fetchImpl?: typeof fetch }} o
 */
export function useMusicLane({ canvas, artboardId, sequences, audio, canEdit, runOp, fetchImpl }) {
  const rev = sigOf(sequences, audio);
  // Read even while the comp has no music yet: the first answer says which songs were already here, so a song
  // added later is the only one whose beat gets found.
  const media = useCompMedia({
    canvas,
    artboardId,
    enabled: !!(canvas && artboardId),
    rev,
    fetchImpl,
  });
  useMusicVersion();
  const music = media?.music ?? NONE;
  const speech = media?.speech ?? NONE;
  const fps = media?.fps ?? 30;
  const mode = canvas && artboardId ? snapMode(storedSnap(canvas, artboardId), music) : 'off';
  const snapBeats = useMemo(() => snapBeatFrames(music, mode), [music, mode]);

  // Add music → beats detected: only songs that appear AFTER the Timeline first looked (a project that
  // already had music is never re-analysed behind the person's back — the inspector's Find the beat is for those).
  const known = useRef(new Map());
  useEffect(() => {
    if (!canvas || !artboardId || !media) return;
    const k = keyOf(canvas, artboardId);
    if (!known.current.has(k)) {
      known.current.set(k, new Set(music.map((m) => m.src)));
      return;
    }
    if (!canEdit) return;
    const seen = known.current.get(k);
    for (const m of music) {
      if (seen.has(m.src)) continue;
      seen.add(m.src);
      if (m.grid) continue;
      void (async () => {
        const r = await findBeats({ canvas, artboardId, src: m.src, fetchImpl });
        if (!r.ok) {
          if (r.message) shellToast(r.message);
          return;
        }
        const fresh = mediaOf(canvas, artboardId);
        if (fresh && runOp && shouldDuckByDefault({ speech: fresh.speech, music: fresh.music })) {
          const bed = fresh.music.find((x) => x.src === m.src);
          if (bed) void runOp({ stableId: bed.stableId, bed: !!bed.loose }, 'video.music.duck', {});
        }
      })();
    }
  }, [canvas, artboardId, media, music, canEdit, runOp, fetchImpl]);

  // a loose bed (audio[i]) ↔ the media's loose music entry of the same song, in document order
  const beds = useMemo(() => {
    const loose = music.filter((m) => m.loose);
    const used = new Set();
    return (audio ?? []).map((a) => {
      const at = loose.findIndex((m, i) => !used.has(i) && m.src === a.src);
      if (at < 0) return null;
      used.add(at);
      return loose[at];
    });
  }, [music, audio]);

  return {
    media,
    music,
    speech,
    fps,
    mode,
    snapBeats,
    /** the media entry of a standalone music clip (its stable id), or null */
    forClip: (stableId) => (stableId ? (music.find((m) => m.stableId === stableId) ?? null) : null),
    /** the media entry of loose bed `audio[i]`, or null */
    forBed: (i) => beds[i] ?? null,
    /** the loose bed whose stable id this is, as `{ info, index }`, or null */
    bedById: (id) => {
      if (!id) return null;
      const i = beds.findIndex((b) => b?.stableId === id);
      return i < 0 ? null : { info: beds[i], index: i };
    },
    finding: (src) => !!canvas && isFinding(canvas, src),
  };
}

/**
 * The selection snapshot of a music row (a loose bed has no `sequences` row to publish one from).
 * `ref` is how the Timeline's verb pipe names it: a clip by its stable id, a bed with `bed: true`
 * (the pipe sends the id as is — the server resolves a `loose:` id itself).
 */
export function musicSelection({
  info,
  label,
  canvas,
  artboardId,
  fps,
  onClipVerb,
  onSelect,
  probeSources,
  changeSong,
}) {
  const ref = { stableId: info.stableId, bed: !!info.loose };
  return {
    kind: 'music',
    canvas,
    artboardId,
    fps,
    stableId: info.stableId,
    label,
    loose: !!info.loose,
    seq: {
      from: info.from,
      duration: info.durationInFrames,
      label,
      series: false,
      mediaTag: 'Audio',
      mediaSrc: info.src,
      mediaProps: { volume: info.volume },
      rowKind: 'audio',
    },
    transitionAfter: null,
    onVerb: (verb, params) => onClipVerb(ref, verb, params),
    onOp: (op, params, opts) => onClipVerb(ref, `video.${op}`, params, opts),
    probeSources,
    changeSong,
    deselect: () => onSelect?.(null),
  };
}
