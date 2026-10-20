// video/derive.ts — S7.4 (contract V2-1.10 §5.4 + §5.6; decision maude/v2-S7-derived-not-materialised).
//
// The comp's clips (the SAME `enumerateClips` the Timeline addresses) crossed with the sidecars of
// their sources. Captions, speech regions, ducking and beat ticks are DERIVED here, on demand, never
// written to the file — so they follow every trim, split, move and speed change with no extra write.
// The route (`GET /_api/comp-media`), the canvas build (S7.5), the video export and the verbs
// (`captions`, `cut-words`, `cut-to-beat`) all call this one module.
//
// Pure and deterministic: no clock, no disk, no random. The only I/O-shaped input is the canvas
// SOURCE TEXT (the caller reads the file); transcripts and beat grids arrive as already-read values.
//
// Clocks (DDR-163): `trimBefore` is in frames of the comp's fps, `playbackRate` multiplies source
// time, so the source second playing at comp frame f inside clip c is
//   (c.trimBefore + (f − c.from) · c.playbackRate) / fps.

import { enumerateClips } from '../canvas-edit.ts';
import { transitionDurationFrames } from '../clip-ops.ts';
import { collectConsts, resolveNum } from '../ripple.ts';
import { DUCK_DEFAULTS } from './framing.ts';
import type { BeatGrid, Transcript } from './schema.ts';

export type Track = 'video' | 'video2' | 'music' | 'music2';

export interface ClipSpan {
  /** `ClipInfo.stableId` (DDR-150); a loose media bed is `loose:<cdId | index>`. */
  stableId: string;
  /** C35 derivation (V2-1.12 §5.3): storyline → video, standalone video/image → video2, audio → music. */
  track: Track;
  src: string;
  /** absolute comp frame */
  from: number;
  durationInFrames: number;
  /** source offset, in frames of the comp's fps */
  trimBefore: number;
  playbackRate: number;
  muted: boolean;
  /** a media bed outside every clip (`<Audio>` under the reel) — no clip ops address it */
  loose?: true;
}

export interface CompClips {
  fps: number;
  total: number;
  clips: ClipSpan[];
  /** ids of clips whose timing is not a literal — never guessed, never in `clips` */
  unresolved: string[];
}

export interface CompWord {
  src: string;
  wordId: string;
  /** the clip that shows it */
  clip: string;
  /** comp frames */
  f0: number;
  f1: number;
  text: string;
  p?: number;
  fixed?: boolean;
}

export interface CaptionFix {
  src: string;
  /** source seconds: replaces the word playing there */
  at: number;
  /** null hides the word */
  text: string | null;
}

const DEFAULT_FPS = 30;
const AUDIO_TAG = /Audio$/;
const MEDIA_OPEN = /<(?:Maude)?(Video|OffthreadVideo|Audio|Img|Image)\b/;
/** A fix finds the word whose [t0 − 0.05, t1 + 0.05] holds `at` (§5.3). */
const FIX_SLACK = 0.05;

// ---------------------------------------------------------------------------
// compClips

/** The text of an opening tag from its `<`: up to the first `>` outside braces and quotes. */
function openingTag(text: string, from = 0): string {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth <= 0) return text.slice(from, i + 1);
  }
  return text.slice(from);
}

/** A literal number prop (`name={0.5}` / `name="0.5"`), or null when it is absent or not a literal. */
function literalProp(tag: string, name: string): number | null {
  const m = new RegExp(
    `\\b${name}\\s*=\\s*(?:\\{\\s*(-?\\d*\\.?\\d+)\\s*\\}|"(-?\\d*\\.?\\d+)")`
  ).exec(tag);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) ? n : null;
}

interface MediaTiming {
  trimBefore: number;
  playbackRate: number;
  muted: boolean;
}

/** Trim, speed and mute from a media element's opening tag. `fallback` is the enumerator's own
 *  (integer-rounded) reading, used when the tag holds an expression rather than a literal. */
function mediaTiming(
  tag: string,
  fallback: { trimBefore: number | null; playbackRate: number | null; muted: boolean } | null
): MediaTiming {
  const rate = literalProp(tag, 'playbackRate') ?? fallback?.playbackRate ?? 1;
  const trim =
    literalProp(tag, 'trimBefore') ?? literalProp(tag, 'startFrom') ?? fallback?.trimBefore ?? 0;
  const volume = literalProp(tag, 'volume');
  return {
    trimBefore: Math.max(0, Math.round(trim)),
    playbackRate: rate > 0 ? rate : 1,
    muted: /\bmuted\b/.test(tag) || volume === 0 || (fallback?.muted ?? false),
  };
}

const overlaps = (a: ClipSpan, b: ClipSpan) =>
  a.from < b.from + b.durationInFrames && b.from < a.from + a.durationInFrames;

export function compClips(canvasAbsPath: string, source: string, artboardId?: string): CompClips {
  const cc = enumerateClips(canvasAbsPath, source, artboardId);
  const consts = collectConsts(source);
  const fps = cc.fps && cc.fps > 0 ? cc.fps : DEFAULT_FPS;
  const unresolved: string[] = [];
  const spans: ClipSpan[] = [];
  // The Timeline's own walk (timeline-parse.js, clip-ops `clipAbsoluteStart`): a clip with no
  // literal `from` starts at the cursor; a transition pulls the cursor back by its overlap.
  let cursor = 0;
  let cursorKnown = true;
  let endMax = 0;

  const lane = (a: 'music' | 'music2', s: ClipSpan): Track =>
    a === 'music' && !spans.some((o) => o.track === 'music' && overlaps(o, s)) ? 'music' : 'music2';

  for (const c of cc.clips) {
    if (c.kind === 'transition') {
      const d = transitionDurationFrames(source, c, consts);
      if (d == null) {
        unresolved.push(c.stableId);
        cursorKnown = false;
      } else cursor -= d;
      continue;
    }
    const seqTag = openingTag(source, c.start);
    const series = c.tag !== 'Sequence';
    let start: number | null;
    if (!series && c.from != null) start = c.from;
    else if (!series && /\bfrom\s*=/.test(seqTag))
      start = null; // a `from` we cannot read
    else start = cursorKnown ? cursor : null;
    if (start == null || c.durationInFrames == null) {
      unresolved.push(c.stableId);
      cursorKnown = false;
      continue;
    }
    const dur = c.durationInFrames;
    start = Math.max(0, Math.round(start));
    cursor = start + dur;
    cursorKnown = true;
    endMax = Math.max(endMax, cursor);
    // A hidden clip keeps its time slot but renders nothing; a clip with no media has no sound
    // and no transcript.
    if (c.hidden || !c.mediaSrc) continue;
    const mediaText = source.slice(c.start, c.end);
    const at = mediaText.search(MEDIA_OPEN);
    const timing = mediaTiming(at >= 0 ? openingTag(mediaText, at) : '', c.mediaProps);
    const isAudio = AUDIO_TAG.test(c.mediaTag ?? '');
    const span: ClipSpan = {
      stableId: c.stableId,
      track: 'video',
      src: c.mediaSrc,
      from: start,
      durationInFrames: dur,
      ...timing,
    };
    span.track = series ? 'video' : isAudio ? lane('music', span) : 'video2';
    spans.push(span);
  }

  const total =
    cc.durationInFrames && cc.durationInFrames > 0 ? cc.durationInFrames : Math.max(0, endMax);

  // Loose beds (document order, after the clips): an <Audio> under the reel, a background <Video>.
  // Like the Timeline they span the whole comp unless the tag carries `from` / `durationInFrames`.
  cc.media.forEach((m, i) => {
    if (!m.src) return;
    const tag = openingTag(source, m.start);
    const fromRaw = /\bfrom=\{([^}]+)\}/.exec(tag)?.[1];
    const durRaw = /\bdurationInFrames=\{([^}]+)\}/.exec(tag)?.[1];
    const from = Math.max(0, fromRaw ? (resolveNum(fromRaw, consts) ?? 0) : 0);
    const dur = durRaw ? resolveNum(durRaw, consts) : null;
    const duration = Math.max(1, dur ?? total - from);
    const span: ClipSpan = {
      stableId: `loose:${m.cdId ?? i}`,
      track: 'video2',
      src: m.src,
      from,
      durationInFrames: duration,
      ...mediaTiming(tag, null),
      loose: true,
    };
    if (AUDIO_TAG.test(m.tag)) span.track = lane('music', span);
    spans.push(span);
  });

  return { fps, total: total || endMax, clips: spans, unresolved };
}

// ---------------------------------------------------------------------------
// shared mapping

/** The source seconds a clip plays: [from, to). */
function playedRange(s: ClipSpan, fps: number): [number, number] {
  return [s.trimBefore / fps, (s.trimBefore + s.durationInFrames * s.playbackRate) / fps];
}

/** Source seconds → absolute comp frame (not clamped). */
const toCompFrame = (s: ClipSpan, sec: number, fps: number) =>
  s.from + Math.round((sec * fps - s.trimBefore) / s.playbackRate);

// ---------------------------------------------------------------------------
// compWords

/** The word a fix names: the one containing `at` (± slack), the closest to `at` when several do. */
function fixTarget(t: Transcript, at: number): string | null {
  let best: { id: string; d: number } | null = null;
  for (const w of t.words) {
    if (at < w.t0 - FIX_SLACK || at > w.t1 + FIX_SLACK) continue;
    const inside = at >= w.t0 && at <= w.t1;
    const d = inside ? 0 : Math.min(Math.abs(at - w.t0), Math.abs(at - w.t1));
    if (!best || d < best.d) best = { id: w.id, d };
  }
  return best?.id ?? null;
}

interface Candidate {
  span: ClipSpan;
  order: number;
  word: CompWord;
}

export function compWords(
  c: CompClips,
  transcripts: Record<string, Transcript>,
  fixes: readonly CaptionFix[] = []
): CompWord[] {
  const fps = c.fps;
  const eps = 0.5 / fps;
  // Resolve each fix to a word once per source.
  const fixed = new Map<string, CaptionFix>();
  for (const f of fixes) {
    const t = transcripts[f.src];
    if (!t) continue;
    const id = fixTarget(t, f.at);
    if (id !== null) fixed.set(`${f.src}\u0000${id}`, f);
  }

  const byWord = new Map<string, Candidate[]>();
  c.clips.forEach((span, order) => {
    const t = transcripts[span.src];
    if (!t) return;
    const [lo, hi] = playedRange(span, fps);
    const end = span.from + span.durationInFrames;
    for (const w of t.words) {
      if (w.t0 < lo - eps || w.t1 > hi + eps) continue;
      const fix = fixed.get(`${span.src}\u0000${w.id}`);
      const loop = Array.isArray(w.flags) && w.flags.includes('loop');
      if (loop && !fix) continue; // a loop word shows only when a fix names it
      if (fix && fix.text === null) continue; // hidden
      const f0 = Math.min(end - 1, Math.max(span.from, toCompFrame(span, w.t0, fps)));
      const f1 = Math.min(end, Math.max(f0 + 1, toCompFrame(span, w.t1, fps)));
      const word: CompWord = {
        src: span.src,
        wordId: w.id,
        clip: span.stableId,
        f0,
        f1,
        text: fix ? (fix.text as string) : w.text,
      };
      if (typeof w.p === 'number') word.p = w.p;
      if (fix) word.fixed = true;
      const key = `${span.src}\u0000${w.id}`;
      const list = byWord.get(key);
      const cand = { span, order, word };
      if (list) list.push(cand);
      else byWord.set(key, [cand]);
    }
  });

  const out: CompWord[] = [];
  for (const list of byWord.values()) {
    // The same source moment used twice shows twice — unless the two shows are one moment of a
    // transition overlap, where the word belongs to the clip that holds its midpoint outside the
    // overlap, else to the earlier clip.
    list.sort((a, b) => a.span.from - b.span.from || a.order - b.order);
    const kept: Candidate[] = [];
    for (const cand of list) {
      const clash = kept.findIndex(
        (k) => cand.word.f0 < k.word.f1 && k.word.f0 < cand.word.f1 && overlaps(k.span, cand.span)
      );
      if (clash < 0) {
        kept.push(cand);
        continue;
      }
      const earlier = kept[clash] as Candidate;
      const o0 = cand.span.from; // overlap = [later.from, min(ends))
      const o1 = Math.min(
        earlier.span.from + earlier.span.durationInFrames,
        cand.span.from + cand.span.durationInFrames
      );
      const outside = (x: Candidate) => {
        const mid = (x.word.f0 + x.word.f1) / 2;
        return mid < o0 || mid >= o1;
      };
      if (!outside(earlier) && outside(cand)) kept[clash] = cand;
    }
    for (const k of kept) out.push(k.word);
  }
  return out.sort(
    (a, b) =>
      a.f0 - b.f0 ||
      a.f1 - b.f1 ||
      (a.src < b.src ? -1 : a.src > b.src ? 1 : 0) ||
      (a.wordId < b.wordId ? -1 : a.wordId > b.wordId ? 1 : 0)
  );
}

// ---------------------------------------------------------------------------
// captionFixesOf — the `fixes` JSON literal of the comp's <Captions>

/** Read `<Captions fixes={[…]}>` out of canvas source text. Anything unreadable is `[]`. */
export function captionFixesOf(source: string): CaptionFix[] {
  const at = source.indexOf('<Captions');
  if (at < 0) return [];
  const tag = openingTag(source, at);
  const m = /\bfixes\s*=\s*\{\s*\[/.exec(tag);
  if (!m) return [];
  const open = m.index + m[0].length - 1;
  // Bracket-match over the JSON, ignoring brackets inside strings.
  let depth = 0;
  let inStr = false;
  let end = -1;
  for (let i = open; i < tag.length; i++) {
    const ch = tag[i] as string;
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(tag.slice(open, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: CaptionFix[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const { src, at: a, text } = f as { src?: unknown; at?: unknown; text?: unknown };
    if (typeof src !== 'string' || typeof a !== 'number' || !Number.isFinite(a)) continue;
    if (text !== null && typeof text !== 'string') continue;
    out.push({ src, at: a, text });
  }
  return out;
}

/** The comp's one `<Captions>` as the file says it (S7.11: the Captions inspector and the Transcript
 *  panel read it; the writer is `video.captions.add`). Null when there is none. */
export interface CaptionsProps {
  words: 1 | 3 | 'line';
  position: 'top' | 'middle' | 'bottom';
  font: string | null;
  highlight: string | null;
  maxChars: number | null;
  fixes: CaptionFix[];
}

function stringProp(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*"([^"]*)"\\s*\\})`).exec(
    tag
  );
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

export function captionsOf(source: string): CaptionsProps | null {
  const at = source.search(/<Captions\b/);
  if (at < 0) return null;
  const tag = openingTag(source, at);
  const n = literalProp(tag, 'words');
  const word = stringProp(tag, 'words');
  const words: CaptionsProps['words'] =
    n === 1 || n === 3 ? n : word === '1' ? 1 : word === '3' ? 3 : 'line';
  const pos = stringProp(tag, 'position');
  const position: CaptionsProps['position'] = pos === 'top' || pos === 'middle' ? pos : 'bottom';
  const max = literalProp(tag, 'maxChars');
  return {
    words,
    position,
    font: stringProp(tag, 'font'),
    highlight: stringProp(tag, 'highlight'),
    maxChars: max !== null && Number.isInteger(max) ? max : null,
    fixes: captionFixesOf(source),
  };
}

// ---------------------------------------------------------------------------
// compSpeech + duckGain

/** The `src` of the `<Audio>` the comp's first `<Duck>` wraps — the bed whose own speech must not
 *  duck it. Null when there is no `<Duck>` or its child is not a literal-src `<Audio>`. */
export function duckedSrcOf(source: string): string | null {
  const at = source.search(/<Duck\b/);
  if (at < 0) return null;
  const rest = source.slice(at + openingTag(source, at).length);
  const lead = rest.length - rest.trimStart().length;
  if (!/^<(?:Maude)?Audio\b/.test(rest.slice(lead))) return null;
  const m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(openingTag(rest, lead));
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/** What a `<Duck>` says, with the component's defaults for a prop it leaves out (V2-1.10 §5.3). */
export interface DuckInfo {
  db: number;
  attackMs: number;
  releaseMs: number;
}

/** Every `<Duck>` that wraps a literal-src `<Audio>`, by that src: the dip each music bed carries.
 *  (S7.12: the Music lane draws the line and the inspector names the numbers from this.) */
export function ducksBySrc(source: string): Map<string, DuckInfo> {
  const out = new Map<string, DuckInfo>();
  for (const m of source.matchAll(/<Duck\b/g)) {
    const at = m.index ?? 0;
    const tag = openingTag(source, at);
    const rest = source.slice(at + tag.length);
    const lead = rest.length - rest.trimStart().length;
    if (!/^<(?:Maude)?Audio\b/.test(rest.slice(lead))) continue;
    const s = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(openingTag(rest, lead));
    const src = s ? (s[1] ?? s[2]) : undefined;
    if (!src || out.has(src)) continue;
    out.set(src, {
      db: literalProp(tag, 'db') ?? DUCK_DEFAULTS.db,
      attackMs: literalProp(tag, 'attackMs') ?? DUCK_DEFAULTS.attackMs,
      releaseMs: literalProp(tag, 'releaseMs') ?? DUCK_DEFAULTS.releaseMs,
    });
  }
  return out;
}

export interface SpeechOptions {
  /** the ducked bed: its own speech never ducks itself */
  exceptSrc?: string;
  /** merge regions closer than this many frames (attack + release); touching ones always merge */
  mergeGapFrames?: number;
}

/** Speech regions of every non-muted clip (Video, Video 2 and the other Music clips), as merged,
 *  sorted comp-frame pairs. A source with no transcript contributes nothing. */
export function compSpeech(
  c: CompClips,
  transcripts: Record<string, Transcript>,
  opts: SpeechOptions = {}
): Array<[number, number]> {
  const fps = c.fps;
  const raw: Array<[number, number]> = [];
  for (const span of c.clips) {
    if (span.muted || (opts.exceptSrc !== undefined && span.src === opts.exceptSrc)) continue;
    const t = transcripts[span.src];
    if (!t) continue;
    const [lo, hi] = playedRange(span, fps);
    const end = span.from + span.durationInFrames;
    for (const [r0, r1] of t.speech.regions) {
      const a = Math.max(r0, lo);
      const b = Math.min(r1, hi);
      if (b <= a) continue;
      const f0 = Math.max(span.from, toCompFrame(span, a, fps));
      const f1 = Math.min(end, toCompFrame(span, b, fps));
      if (f1 > f0) raw.push([f0, f1]);
    }
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const gap = opts.mergeGapFrames ?? 0;
  const out: Array<[number, number]> = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && (r[0] - last[1] <= 0 || r[0] - last[1] < gap)) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

// duckGain (pure, frame → gain) lives in ./framing.ts: the canvas's <Duck> runs it every frame.
export { duckGain } from './framing.ts';

// ---------------------------------------------------------------------------
// compBeats

/** The beat ticks of the comp, as sorted unique comp frames: each Music clip's grid, inside the
 *  source range that clip plays, shifted by its trim and speed. */
export function compBeats(c: CompClips, grids: Record<string, BeatGrid>): number[] {
  const fps = c.fps;
  const seen = new Set<number>();
  for (const span of c.clips) {
    if (span.track !== 'music' && span.track !== 'music2') continue;
    const g = grids[span.src];
    if (!g) continue;
    const lo = span.trimBefore;
    const hi = span.trimBefore + span.durationInFrames * span.playbackRate;
    for (const b of g.beats) {
      const sf = b * fps;
      if (sf < lo || sf >= hi) continue;
      seen.add(span.from + Math.round((sf - span.trimBefore) / span.playbackRate));
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** One music clip with what the Music lane and inspector read: its grid in COMP frames and its dip. */
export interface MusicInfo {
  stableId: string;
  src: string;
  track: 'music' | 'music2';
  from: number;
  durationInFrames: number;
  loose?: true;
  /** literal `volume` of the `<Audio>`, 0..1 (1 when absent) */
  volume: number;
  /** the `<Duck>` around it, or null */
  duck: DuckInfo | null;
  /** null = no beat sidecar for this song yet (the lane offers to find the beat) */
  grid: null | {
    bpm: number;
    bpmSource: string;
    tempoStrength: number;
    barConfidence: number;
    /** comp frames, ascending */
    beats: number[];
    /** the downbeats among `beats` (comp frames); empty below bar confidence 0.4 (Q8) */
    bars: number[];
  };
}

/** Bar ticks are drawn only at or above this confidence (Q8): below it every tick is the same height. */
export const BAR_CONFIDENCE = 0.4;
/** A grid with a tempo strength under this has no clear pulse (V2-1.10 §5.2): no snap, no Cut to the beat. */
export const CLEAR_BEAT = 0.15;

/** The literal `volume` of the first `<Audio src="…">` with this src (1 when absent or an expression). */
function audioVolume(source: string, src: string): number {
  for (const m of source.matchAll(/<(?:Maude)?Audio\b/g)) {
    const tag = openingTag(source, m.index ?? 0);
    const s = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag);
    if ((s ? (s[1] ?? s[2]) : null) !== src) continue;
    const v = literalProp(tag, 'volume');
    return v !== null && v >= 0 && v <= 1 ? v : 1;
  }
  return 1;
}

/** Every Music-track clip with its beats, bars, volume and dip. Same placement maths as `compBeats`. */
export function compMusic(
  c: CompClips,
  grids: Record<string, BeatGrid>,
  source: string
): MusicInfo[] {
  const ducks = ducksBySrc(source);
  const out: MusicInfo[] = [];
  for (const span of c.clips) {
    if (span.track !== 'music' && span.track !== 'music2') continue;
    const g = grids[span.src];
    const info: MusicInfo = {
      stableId: span.stableId,
      src: span.src,
      track: span.track,
      from: span.from,
      durationInFrames: span.durationInFrames,
      volume: audioVolume(source, span.src),
      duck: ducks.get(span.src) ?? null,
      grid: null,
    };
    if (span.loose) info.loose = true;
    if (g) {
      const lo = span.trimBefore;
      const hi = span.trimBefore + span.durationInFrames * span.playbackRate;
      const barsOn = g.bar.confidence >= BAR_CONFIDENCE;
      const beats: number[] = [];
      const bars: number[] = [];
      g.beats.forEach((b, i) => {
        const sf = b * c.fps;
        if (sf < lo || sf >= hi) return;
        const f = span.from + Math.round((sf - span.trimBefore) / span.playbackRate);
        beats.push(f);
        if (barsOn && i >= g.bar.phase && (i - g.bar.phase) % 4 === 0) bars.push(f);
      });
      info.grid = {
        bpm: g.bpm,
        bpmSource: g.bpmSource,
        tempoStrength: g.tempoStrength,
        barConfidence: g.bar.confidence,
        beats,
        bars,
      };
    }
    out.push(info);
  }
  return out;
}

// transcriptCut (§5.6) lives in ./transcript-cut.ts (S7.6c: the cut-words verb imports it alone).
export { type TranscriptCut, transcriptCut } from './transcript-cut.ts';

// ---------------------------------------------------------------------------
// framing (§5.3, §5.8) — pure, shared with the canvas's <Reframe> / <Place> (S7.5): ./framing.ts.

export { aspectKey, focusAt, placeAt, reframeWindow } from './framing.ts';
