// apps/studio/video/whisper-parse.ts — S7.2, V2-1.10 §5.6 steps 2–3.
//
// whisper.cpp `-ojf -ml 1 -sow -dtw <model> -nfa` JSON → whole words with a start taken from the
// DTW time of the word's first text token. Pure: no fs, no spawn, never throws (a file that is not
// whisper's JSON is an empty parse — the caller decides what an empty transcript means).
//
// `-sow` makes each `transcription[]` entry one WORD (sub-word pieces and attached punctuation
// stay inside it: "SaaS,"), where today's `-oj -ml 1` splits on tokens ("S" "aa" "S" ","; §6.1).
// `-nfa` is load-bearing: with flash attention on, whisper.cpp 1.9.2 returns `t_dtw = -1` for every
// token — then the file has no DTW clock and `timing` says "segment", never "dtw" (test #2).
//
// The text is UNTRUSTED (spoken text can say anything): it is returned as data and truncated to the
// schema cap by the caller; nothing here evaluates it.

import { MAX_WORDS } from './schema.ts';

/** A word as whisper heard it, before lag calibration and the energy snap. Seconds. */
export interface RawWord {
  text: string;
  start: number;
  end: number;
  /** the lowest token probability of the word; absent = whisper gave none */
  p?: number;
  /** the start came from a DTW time (false = the segment's own start) */
  dtw: boolean;
}

export interface WhisperParse {
  words: RawWord[];
  /** 'dtw' only when EVERY kept word has a DTW start; one clock per file */
  timing: 'dtw' | 'segment';
  lang?: string;
}

/** Hard ceiling on how long one word may last — a word whose "next word" is far away is held here. */
export const MAX_WORD_SEC = 1.2;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A special token: `[_BEG_]`, `[_TT_150]`, … — carries no text and no usable probability. */
const isSpecialToken = (t: string): boolean => t.startsWith('[_');
/** Non-speech tags whisper emits on noise and music: `[MUSIC]`, `(laughs)`, `*click*`, `♪`. */
const NON_SPEECH = /^[[(*♪]/;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

interface Seg {
  text: string;
  segFrom: number;
  segTo: number;
  dtwStart: number | null;
  p?: number;
}

function readSegment(s: unknown): Seg | null {
  if (!isObj(s) || typeof s.text !== 'string') return null;
  const text = s.text.trim();
  if (!text || !HAS_LETTER_OR_DIGIT.test(text) || NON_SPEECH.test(text)) return null;
  const off = isObj(s.offsets) ? s.offsets : {};
  const from = num(off.from);
  const to = num(off.to);
  if (from === null || to === null) return null;
  const toks = (Array.isArray(s.tokens) ? s.tokens : []).filter(
    (t): t is Record<string, unknown> =>
      isObj(t) && typeof t.text === 'string' && !isSpecialToken(t.text)
  );
  const first = toks.find((t) => (num(t.t_dtw) ?? -1) >= 0);
  const probs = toks.map((t) => num(t.p)).filter((p): p is number => p !== null);
  return {
    text,
    segFrom: from / 1000,
    segTo: to / 1000,
    dtwStart: first ? (num(first.t_dtw) as number) / 100 : null,
    ...(probs.length ? { p: Math.min(...probs) } : {}),
  };
}

export function parseWhisperFull(jsonText: string): WhisperParse {
  let doc: unknown;
  try {
    doc = JSON.parse(jsonText);
  } catch {
    return { words: [], timing: 'segment' };
  }
  const segsRaw = isObj(doc) && Array.isArray(doc.transcription) ? doc.transcription : [];
  const lang =
    isObj(doc) && isObj(doc.result) && typeof doc.result.language === 'string'
      ? doc.result.language
      : undefined;

  const segs: Seg[] = [];
  for (const s of segsRaw) {
    const seg = readSegment(s);
    if (seg) segs.push(seg);
    if (segs.length >= MAX_WORDS) break;
  }
  // One clock per file: DTW only when every word has it (a mixed file would put two clocks in one
  // timeline). Otherwise every word starts at its segment start.
  const timing: 'dtw' | 'segment' =
    segs.length > 0 && segs.every((s) => s.dtwStart !== null) ? 'dtw' : 'segment';

  const words: RawWord[] = segs.map((s) => ({
    text: s.text,
    start: timing === 'dtw' ? (s.dtwStart as number) : s.segFrom,
    end: 0,
    ...(s.p !== undefined ? { p: s.p } : {}),
    dtw: timing === 'dtw',
  }));
  // end = the next word's start, capped by the segment end (floored at start + 0.1 s) and
  // start + 1.2 s
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const segTo = segs[i].segTo;
    w.end = Math.min(
      words[i + 1]?.start ?? segTo,
      w.start + MAX_WORD_SEC,
      Math.max(segTo, w.start + 0.1)
    );
    if (w.end <= w.start) w.end = w.start + 0.05;
  }
  return { words, timing, ...(lang ? { lang } : {}) };
}
