// apps/studio/video/schema.ts — S7.1: the two per-asset sidecars of V2-1.10 §5.1–§5.2.
//
//   assets/<sha8>.transcript.json   `maude.transcript` v1 — the words (and speech regions) of a clip
//   assets/<sha8>.beats.json        `maude.beats` v1      — the beat grid of a music asset
//
// Dependency-free (footage/schema.ts house style), erasable TypeScript only (gen-actions imports it
// through format-ids.ts under Node's type stripping). Unlike footage/schema.ts this one is
// PRESERVING — the lesson of `assertKeys` (V2-1.12 R8): v1's EDL reader treats a file with any
// unknown key as missing, so a newer peer's field gets the file re-analysed and overwritten. Here:
//
//   - TOLERANT for readers (`readTranscript`, `readBeats`): never throws. Unknown keys — top level,
//     on a word, in `engine`, `speech`, `analyzer`, `bar` — are accepted and kept on the value. An
//     unknown enum member a newer writer added (a new engine id, timing, decode) reads as a string.
//     Only the required fields, their types, ranges and the caps are judged.
//   - STRICT for our own writers (`serializeTranscript`, `serializeBeats`): the same plus the
//     enums this build knows, sorted + unique word ids, t1 > t0, sorted non-overlapping regions,
//     ascending beats, and the asset ↔ file-name match. A write that fails is refused, never fixed
//     up. The output is the value's own key order (unknown keys included), 2-space JSON + "\n" —
//     so read → serialize of a canonical file is the same bytes (test #11).
//
// Text in a word is UNTRUSTED (speech can say anything, including instructions). It is data: it
// never becomes TSX source; the build injects it as JSON (S7.5).

export const TRANSCRIPT_FORMAT = 'maude.transcript';
export const TRANSCRIPT_VERSION = 1;
export const BEATS_FORMAT = 'maude.beats';
export const BEATS_VERSION = 1;

/** V2-1.10 §5.1 caps. */
export const TRANSCRIPT_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_WORDS = 50_000;
export const MAX_REGIONS = 20_000;
export const MAX_WORD_TEXT = 64;
/** V2-1.10 §5.2 cap. A beats file is bounded by its beat list; the byte cap follows from it. */
export const MAX_BEATS = 20_000;
export const BEATS_MAX_BYTES = 1024 * 1024;
/** One source never runs longer than a day (footage/schema.ts uses the same bound). */
export const MAX_SECONDS = 24 * 3600;

export const ENGINE_IDS = [
  'whisper.cpp',
  'elevenlabs-scribe',
  'groq-whisper',
  'energy',
  'srt-import',
] as const;
export const ENGINE_TIMINGS = ['dtw+energy', 'segment', 'provider', 'cue', 'none'] as const;
export const WORD_FLAGS = ['loop'] as const;
export const SPEECH_SOURCES = ['words', 'energy'] as const;
export const BEATS_DECODERS = ['ffmpeg', 'chromium'] as const;
export const BPM_SOURCES = ['detected', 'set'] as const;
export const BPM_RANGE: readonly [number, number] = [20, 400];

export type EngineId = (typeof ENGINE_IDS)[number];
export type EngineTiming = (typeof ENGINE_TIMINGS)[number];

/** Every shape below also carries whatever keys a newer writer added — kept, never judged. */
type Open = { [key: string]: unknown };

export interface TranscriptWord extends Open {
  /** "w0", "w1", … unique in the file, never reused after removal */
  id: string;
  /** seconds in the SOURCE, 3 decimals */
  t0: number;
  /** > t0 */
  t1: number;
  /** UNTRUSTED text; ≤ 64 chars */
  text: string;
  /** 0..1, the word's lowest token probability (absent = the provider gave none) */
  p?: number;
  /** 'loop' = part of a run of ≥ 3 identical consecutive words */
  flags?: string[];
}

export interface Transcript extends Open {
  format: 'maude.transcript';
  v: 1;
  /** "assets/<sha8>.<ext>" — the source; must match the sidecar's file name */
  asset: string;
  durationSec?: number;
  /** ISO 639-1; absent = unknown */
  lang?: string;
  engine: Open & {
    id: string;
    model?: string;
    version?: string;
    timing: string;
    lagMs?: number;
  };
  /** sorted by t0; [] when engine.id === 'energy' */
  words: TranscriptWord[];
  speech: Open & { source: string; regions: Array<[number, number]> };
  createdAt: string;
}

export interface BeatGrid extends Open {
  format: 'maude.beats';
  v: 1;
  asset: string;
  durationSec: number;
  analyzer: Open & { id: 'maude-beats'; version: 1; decode: string };
  /** 2 decimals */
  bpm: number;
  bpmSource: string;
  /** 0..1 — < 0.15 means "no clear beat" */
  tempoStrength: number;
  /** source seconds, ascending, 3 decimals */
  beats: number[];
  /** beats[phase + 4k] are downbeats; tall bar ticks only when confidence ≥ 0.4 */
  bar: Open & { phase: 0 | 1 | 2 | 3; confidence: number };
  createdAt: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface ValidateOptions {
  /** Writer mode: known enums, ordering, uniqueness. Readers leave it off. */
  strict?: boolean;
  /** The sidecar's designRoot-relative path; checks `asset` names the same `<sha8>`. */
  rel?: string;
}

export type ReadResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** "assets/<base>.<ext>" — the same base grammar the migrator and the asset store use. */
export const SIDECAR_ASSET_RE = /^assets\/([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9]{1,8})$/;
const SIDECAR_REL_RE = /^assets\/([A-Za-z0-9_-]{1,64})\.(transcript|beats)\.json$/;
const WORD_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const SHORT = 64;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The sidecar path for a source asset: `assets/<base>.transcript.json` / `.beats.json`. */
export function sidecarRelFor(asset: string, kind: 'transcript' | 'beats'): string | null {
  const m = SIDECAR_ASSET_RE.exec(asset);
  return m ? `assets/${m[1]}.${kind}.json` : null;
}

class Errors {
  list: string[] = [];
  push(msg: string): void {
    if (this.list.length < 50) this.list.push(msg);
  }
}

function reqNum(
  e: Errors,
  o: Record<string, unknown>,
  k: string,
  lo: number,
  hi: number,
  w: string
) {
  if (!isNum(o[k])) e.push(`${w}.${k}: required finite number`);
  else if ((o[k] as number) < lo || (o[k] as number) > hi)
    e.push(`${w}.${k}: ${o[k]} out of range [${lo}, ${hi}]`);
}
function optNum(
  e: Errors,
  o: Record<string, unknown>,
  k: string,
  lo: number,
  hi: number,
  w: string
) {
  if (o[k] !== undefined) reqNum(e, o, k, lo, hi, w);
}
function reqStr(e: Errors, o: Record<string, unknown>, k: string, max: number, w: string) {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0) e.push(`${w}.${k}: required string`);
  else if (v.length > max) e.push(`${w}.${k}: exceeds ${max} chars`);
}
function optStr(e: Errors, o: Record<string, unknown>, k: string, max: number, w: string) {
  if (o[k] !== undefined) reqStr(e, o, k, max, w);
}
function member(
  e: Errors,
  o: Record<string, unknown>,
  k: string,
  known: readonly string[],
  strict: boolean,
  w: string
) {
  reqStr(e, o, k, SHORT, w);
  if (strict && typeof o[k] === 'string' && !known.includes(o[k] as string))
    e.push(`${w}.${k}: must be one of ${known.join(', ')}`);
}

function head(
  e: Errors,
  o: Record<string, unknown>,
  format: string,
  opts: ValidateOptions,
  kind: 'transcript' | 'beats'
) {
  if (o.format !== format) e.push(`format: must be "${format}"`);
  if (o.v !== 1) e.push('v: must be 1 (a newer version is not this reader’s file)');
  if (typeof o.asset !== 'string' || !SIDECAR_ASSET_RE.test(o.asset))
    e.push('asset: must be a relative assets/<sha8>.<ext> path');
  else if (opts.rel !== undefined) {
    const m = SIDECAR_REL_RE.exec(opts.rel);
    const base = SIDECAR_ASSET_RE.exec(o.asset)?.[1];
    if (!m || m[2] !== kind) e.push(`file: not an assets/<sha8>.${kind}.json path`);
    else if (m[1] !== base) e.push(`asset: ${o.asset} does not match the file name ${opts.rel}`);
  }
  reqStr(e, o, 'createdAt', SHORT, 'root');
}

/** Structurally validate an untrusted value as a `Transcript` (lenient on unknown keys). */
export function validateTranscript(input: unknown, opts: ValidateOptions = {}): ValidationResult {
  const e = new Errors();
  const strict = opts.strict === true;
  if (!isObj(input)) return { ok: false, errors: ['root: must be an object'] };
  head(e, input, TRANSCRIPT_FORMAT, opts, 'transcript');
  optNum(e, input, 'durationSec', 0, MAX_SECONDS, 'root');
  if (
    input.lang !== undefined &&
    (typeof input.lang !== 'string' || !/^[a-z]{2,3}$/.test(input.lang))
  )
    e.push('root.lang: must be an ISO 639 code');

  const eng = input.engine;
  if (!isObj(eng)) e.push('engine: required object');
  else {
    member(e, eng, 'id', ENGINE_IDS, strict, 'engine');
    member(e, eng, 'timing', ENGINE_TIMINGS, strict, 'engine');
    optStr(e, eng, 'model', SHORT, 'engine');
    optStr(e, eng, 'version', SHORT, 'engine');
    optNum(e, eng, 'lagMs', -10_000, 10_000, 'engine');
  }

  const words = input.words;
  if (!Array.isArray(words)) e.push('words: required array');
  else if (words.length > MAX_WORDS) e.push(`words: more than ${MAX_WORDS} items`);
  else {
    const ids = new Set<string>();
    let prev = -Infinity;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const at = `words[${i}]`;
      if (!isObj(w)) {
        e.push(`${at}: must be an object`);
        continue;
      }
      if (typeof w.id !== 'string' || !WORD_ID_RE.test(w.id)) e.push(`${at}.id: required word id`);
      reqNum(e, w, 't0', 0, MAX_SECONDS, at);
      reqNum(e, w, 't1', 0, MAX_SECONDS, at);
      if (typeof w.text !== 'string') e.push(`${at}.text: required string`);
      else if (w.text.length > MAX_WORD_TEXT) e.push(`${at}.text: exceeds ${MAX_WORD_TEXT} chars`);
      optNum(e, w, 'p', 0, 1, at);
      if (w.flags !== undefined) {
        if (
          !Array.isArray(w.flags) ||
          w.flags.length > 8 ||
          !w.flags.every((f) => typeof f === 'string')
        )
          e.push(`${at}.flags: must be an array of strings`);
        else if (strict && !w.flags.every((f) => (WORD_FLAGS as readonly string[]).includes(f)))
          e.push(`${at}.flags: must be one of ${WORD_FLAGS.join(', ')}`);
      }
      if (!strict) continue;
      if (typeof w.id === 'string') {
        if (ids.has(w.id)) e.push(`${at}.id: "${w.id}" is used twice`);
        ids.add(w.id);
      }
      if (isNum(w.t0) && isNum(w.t1) && !(w.t1 > w.t0)) e.push(`${at}: t1 must be > t0`);
      if (isNum(w.t0)) {
        if (w.t0 < prev) e.push(`${at}: words must be sorted by t0`);
        prev = w.t0;
      }
    }
    if (strict && isObj(eng) && eng.id === 'energy' && words.length > 0)
      e.push('words: must be [] when engine.id is "energy"');
  }

  const sp = input.speech;
  if (!isObj(sp)) e.push('speech: required object');
  else {
    member(e, sp, 'source', SPEECH_SOURCES, strict, 'speech');
    regions(e, sp.regions, MAX_REGIONS, strict, 'speech.regions');
  }
  return { ok: e.list.length === 0, errors: e.list };
}

function regions(e: Errors, v: unknown, max: number, strict: boolean, at: string) {
  if (!Array.isArray(v)) {
    e.push(`${at}: required array`);
    return;
  }
  if (v.length > max) {
    e.push(`${at}: more than ${max} items`);
    return;
  }
  let prevEnd = -Infinity;
  for (let i = 0; i < v.length; i++) {
    const r = v[i];
    if (!Array.isArray(r) || r.length !== 2 || !isNum(r[0]) || !isNum(r[1])) {
      e.push(`${at}[${i}]: must be [start, end] seconds`);
      continue;
    }
    if (Math.min(r[0], r[1]) < 0 || Math.max(r[0], r[1]) > MAX_SECONDS)
      e.push(`${at}[${i}]: out of range`);
    if (!strict) continue;
    if (!(r[1] > r[0])) e.push(`${at}[${i}]: end must be > start`);
    if (r[0] < prevEnd) e.push(`${at}[${i}]: regions must be sorted and not overlap`);
    prevEnd = r[1];
  }
}

/** Structurally validate an untrusted value as a `BeatGrid` (lenient on unknown keys). */
export function validateBeats(input: unknown, opts: ValidateOptions = {}): ValidationResult {
  const e = new Errors();
  const strict = opts.strict === true;
  if (!isObj(input)) return { ok: false, errors: ['root: must be an object'] };
  head(e, input, BEATS_FORMAT, opts, 'beats');
  reqNum(e, input, 'durationSec', 0, MAX_SECONDS, 'root');
  const an = input.analyzer;
  if (!isObj(an)) e.push('analyzer: required object');
  else {
    if (an.id !== 'maude-beats') e.push('analyzer.id: must be "maude-beats"');
    if (an.version !== 1) e.push('analyzer.version: must be 1');
    member(e, an, 'decode', BEATS_DECODERS, strict, 'analyzer');
  }
  reqNum(e, input, 'bpm', BPM_RANGE[0], BPM_RANGE[1], 'root');
  member(e, input, 'bpmSource', BPM_SOURCES, strict, 'root');
  reqNum(e, input, 'tempoStrength', 0, 1, 'root');
  const beats = input.beats;
  if (!Array.isArray(beats)) e.push('beats: required array');
  else if (beats.length > MAX_BEATS) e.push(`beats: more than ${MAX_BEATS} items`);
  else {
    let prev = -Infinity;
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      if (!isNum(b) || b < 0 || b > MAX_SECONDS) {
        e.push(`beats[${i}]: must be a source time in seconds`);
        continue;
      }
      if (strict && !(b > prev)) e.push(`beats[${i}]: beats must be strictly ascending`);
      prev = b;
    }
  }
  const bar = input.bar;
  if (!isObj(bar)) e.push('bar: required object');
  else {
    if (![0, 1, 2, 3].includes(bar.phase as number)) e.push('bar.phase: must be 0, 1, 2 or 3');
    reqNum(e, bar, 'confidence', 0, 1, 'bar');
  }
  return { ok: e.list.length === 0, errors: e.list };
}

function read<T>(
  text: string,
  maxBytes: number,
  validate: (v: unknown, o: ValidateOptions) => ValidationResult,
  rel: string | undefined
): ReadResult<T> {
  if (typeof text !== 'string') return { ok: false, errors: ['not text'] };
  // UTF-16 length ≤ UTF-8 bytes, so this pre-check never refuses a file under the cap.
  if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes)
    return { ok: false, errors: [`file: larger than ${maxBytes} bytes`] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['file: not JSON'] };
  }
  const r = validate(value, rel === undefined ? {} : { rel });
  return r.ok ? { ok: true, value: value as T } : { ok: false, errors: r.errors };
}

/** Read a `.transcript.json` from any writer, any build. Never throws. */
export function readTranscript(text: string, rel?: string): ReadResult<Transcript> {
  return read<Transcript>(text, TRANSCRIPT_MAX_BYTES, validateTranscript, rel);
}

/** Read a `.beats.json` from any writer, any build. Never throws. */
export function readBeats(text: string, rel?: string): ReadResult<BeatGrid> {
  return read<BeatGrid>(text, BEATS_MAX_BYTES, validateBeats, rel);
}

export class SidecarWriteError extends Error {
  readonly errors: string[];
  constructor(kind: string, errors: string[]) {
    super(`refusing to write an invalid ${kind}: ${errors.slice(0, 3).join('; ')}`);
    this.name = 'SidecarWriteError';
    this.errors = errors;
  }
}

function write(
  value: unknown,
  kind: 'transcript' | 'beats',
  maxBytes: number,
  validate: (v: unknown, o: ValidateOptions) => ValidationResult,
  rel: string | undefined
): string {
  const r = validate(value, rel === undefined ? { strict: true } : { strict: true, rel });
  if (!r.ok) throw new SidecarWriteError(kind, r.errors);
  const out = `${JSON.stringify(value, null, 2)}\n`;
  if (new TextEncoder().encode(out).length > maxBytes)
    throw new SidecarWriteError(kind, [`file: larger than ${maxBytes} bytes`]);
  return out;
}

/** The bytes of a transcript our writers emit. Throws `SidecarWriteError` on an invalid value;
 *  every key the value carries — a newer peer's included — is written in its order. */
export function serializeTranscript(t: Transcript, rel?: string): string {
  return write(t, 'transcript', TRANSCRIPT_MAX_BYTES, validateTranscript, rel);
}

/** The bytes of a beat grid our writers emit. Same rules as `serializeTranscript`. */
export function serializeBeats(b: BeatGrid, rel?: string): string {
  return write(b, 'beats', BEATS_MAX_BYTES, validateBeats, rel);
}

/** Seconds rounded to the formats' 3 decimals. */
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;
