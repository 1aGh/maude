// client/v2/transcript/transcript-model.js — S7.11: the Transcript panel's pure side (07 · ve-captions).
//
// The panel reads ONE answer, `GET /_api/comp-media` (routes/video.ts): the comp's clips, the words its clips
// show (`words`, already fixed), each clip's source transcript (`transcripts`) and the comp's <Captions>
// (`captions`). From it this module makes what the panel draws and what a keystroke means:
//
//   buildTranscriptModel   sections (one per source, in the order they play) → paragraphs → items. An item is a
//                          word AS SHOWN: `on` (a clip plays it), `struck` (no clip plays it any more — the
//                          words were cut), `hidden` (a clip plays it but a fix hides it), `noise` (whisper's
//                          repetition, out of the captions until the person confirms it).
//   rangeKeys / cutPlan    select → wordIds → the source range `clip.cut-source-range` removes. The numbers are
//                          the `cut-words` verb's: `transcriptCut` with the comp's fps, no energy.
//   captionFixes           typing over a word → the new `fixes` list for the comp's one <Captions> (keyed by
//                          source time, so a re-transcribe keeps it, and written into THIS video only — Q4).
//
// Pure: no DOM, no fetch. Speech is untrusted text — it is only ever data here.

import { transcriptCut } from '../../../video/transcript-cut.ts';
import { mss } from '../timeline/ruler.js';

const PARA_GAP_SEC = 1.2;
const SENTENCE_GAP_SEC = 0.5;
const SENTENCE_END = /[.!?…]["”')\]]*$/;
const LOW_CONFIDENCE = 0.5;
/** The window a fix matches a word in — video/derive.ts `FIX_SLACK`. */
const FIX_SLACK = 0.05;
/** The key of a word AS SHOWN by one clip — the panel's and the caption lane's shared name for it. */
export const wordKey = (w) => `${w.src}|${w.wordId}|${w.clip}`;
export const NOISE_NOTE = 'May be noise, not speech';
const round3 = (n) => Math.round(n * 1000) / 1000;
const fpsOf = (media) => Math.max(1, Math.round(media?.fps || 30));
const assetBase = (src) => String(src).replace(/^.*\//, '');

/**
 * @param {any} media the comp-media answer, or null before it is read
 * @param {{ nameOf?: (src: string) => string }} [opts] how a source is called in its heading
 */
export function buildTranscriptModel(media, opts = {}) {
  const empty = { fps: 30, sections: [], missing: [], rates: {}, hasWords: false, captions: null };
  if (!media || typeof media !== 'object') return empty;
  const fps = fpsOf(media);
  const eps = 0.5 / fps;
  const clips = Array.isArray(media.clips) ? media.clips : [];
  const shown = Array.isArray(media.words) ? media.words : [];
  const transcripts =
    media.transcripts && typeof media.transcripts === 'object' ? media.transcripts : {};

  const occurrences = new Map(); // src\0wordId → CompWord[]
  for (const w of shown) {
    const k = `${w.src}\u0000${w.wordId}`;
    const list = occurrences.get(k);
    if (list) list.push(w);
    else occurrences.set(k, [w]);
  }

  // the sources, in the order they first play
  const firstFrame = new Map();
  for (const w of shown) firstFrame.set(w.src, Math.min(firstFrame.get(w.src) ?? Infinity, w.f0));
  const srcs = Object.keys(transcripts).filter((s) => (transcripts[s]?.words?.length ?? 0) > 0);
  srcs.sort((a, b) => (firstFrame.get(a) ?? Infinity) - (firstFrame.get(b) ?? Infinity));

  const playedBy = (src, w) =>
    clips.find((c) => {
      if (c.src !== src) return false;
      const lo = c.trimBefore / fps;
      const hi = (c.trimBefore + c.durationInFrames * (c.playbackRate || 1)) / fps;
      return w.t0 >= lo - eps && w.t1 <= hi + eps;
    });

  const sections = srcs.map((src) => {
    const t = transcripts[src];
    const items = [];
    for (const w of t.words) {
      const base = {
        wordId: w.id,
        src,
        original: w.text,
        t0: w.t0,
        t1: w.t1,
        p: w.p,
        loop: Array.isArray(w.flags) && w.flags.includes('loop'),
      };
      const seen = occurrences.get(`${src}\u0000${w.id}`);
      if (seen?.length) {
        for (const o of seen) {
          items.push({
            ...base,
            key: wordKey(o),
            text: o.text,
            state: 'on',
            clip: o.clip,
            f0: o.f0,
            f1: o.f1,
            fixed: !!o.fixed,
            lowConfidence: typeof w.p === 'number' && w.p < LOW_CONFIDENCE && !o.fixed,
            note: null,
          });
        }
        continue;
      }
      const by = playedBy(src, w);
      const state = !by ? 'struck' : base.loop ? 'noise' : 'hidden';
      items.push({
        ...base,
        key: `${src}|${w.id}|${by?.stableId ?? '-'}`,
        text: w.text,
        state,
        clip: by?.stableId ?? null,
        f0: null,
        f1: null,
        fixed: false,
        lowConfidence: false,
        note: state === 'noise' ? NOISE_NOTE : null,
      });
    }
    // paragraphs: a pause, or a sentence's end followed by a breath
    const paragraphs = [];
    let cur = null;
    let prev = null;
    for (const it of items) {
      const gap = prev ? it.t0 - prev.t1 : 0;
      if (
        !cur ||
        gap >= PARA_GAP_SEC ||
        (SENTENCE_END.test(prev.text) && gap >= SENTENCE_GAP_SEC)
      ) {
        cur = { id: `${src}|p${paragraphs.length}`, time: null, items: [] };
        paragraphs.push(cur);
      }
      if (cur.time === null && it.f0 !== null) cur.time = mss(it.f0 / fps);
      cur.items.push(it);
      prev = it;
    }
    const name = opts.nameOf?.(src) || assetBase(src);
    return { src, name, lang: t.lang ?? null, paragraphs };
  });

  const missing = [];
  for (const c of clips) {
    if (c.track === 'music' || c.track === 'music2' || c.muted) continue;
    if (!transcripts[c.src] && !missing.includes(c.src)) missing.push(c.src);
  }
  return {
    fps,
    sections,
    missing,
    rates: Object.fromEntries(clips.map((c) => [c.stableId, c.playbackRate || 1])),
    hasWords: sections.some((s) => s.paragraphs.length > 0),
    captions: media.captions ?? null,
  };
}

/** Every item, in reading order. */
export function flatItems(model) {
  return model.sections.flatMap((s) => s.paragraphs.flatMap((p) => p.items));
}

/** The keys from `a` to `b` inclusive, whichever comes first. */
export function rangeKeys(model, a, b) {
  const keys = flatItems(model).map((i) => i.key);
  const i = keys.indexOf(a);
  const j = keys.indexOf(b);
  if (i < 0 || j < 0) return i >= 0 ? [a] : j >= 0 ? [b] : [];
  return keys.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/**
 * What ⌫ does with a selection: the ONE `clip.cut-source-range` it runs, or the line that says why not.
 * @returns {null | { refusal: string } | { clip: string, src: string, wordIds: string[], srcStart: number,
 *   srcEnd: number, inPause: boolean, removedSec: number, text: string }}
 */
export function cutPlan(model, keys) {
  const wanted = new Set(keys);
  const picked = flatItems(model).filter((i) => wanted.has(i.key));
  if (picked.length === 0) return null;
  const live = picked.filter((i) => i.state !== 'struck' && i.clip);
  if (live.length === 0) return { refusal: 'Those words are already cut.' };
  const clip = live[0].clip;
  const src = live[0].src;
  if (live.some((i) => i.clip !== clip || i.src !== src))
    return { refusal: 'Pick words from one clip to cut them.' };
  const sec = model.sections.find((s) => s.src === src);
  if (!sec) return null;
  const wordIds = [...new Set(live.map((i) => i.wordId))];
  // the transcript the cut is measured on: every word of the source, as the sidecar has them
  const all = flatItems({ sections: [sec] }).filter(
    (i, n, a) => a.findIndex((x) => x.wordId === i.wordId) === n
  );
  const cut = transcriptCut(
    { words: all.map((i) => ({ id: i.wordId, t0: i.t0, t1: i.t1, text: i.original })) },
    wordIds,
    undefined,
    { fps: model.fps }
  );
  const rate = model.rates?.[clip] || 1;
  return {
    clip,
    src,
    wordIds,
    srcStart: cut.srcStart,
    srcEnd: cut.srcEnd,
    inPause: cut.inPause,
    removedSec: Math.round(((cut.srcEnd - cut.srcStart) / rate) * 10) / 10,
    text: live.map((i) => i.text).join(' '),
  };
}

/** "Struck “Ehm…” — cut 0.4 s from the interview" — the line over the transcript after a cut. */
export function cutTipText(plan, from) {
  return `Struck “${plan.text}” — cut ${plan.removedSec.toFixed(1)} s from ${from}`;
}

/**
 * The comp's new `fixes` after the person typed `text` over `item`. A fix names a word by SOURCE time (the
 * middle of the word), so it survives a re-transcription; typing the transcript's own text takes the fix
 * away again — except for a loop word, where the fix IS the confirmation. Empty text hides the word.
 */
export function captionFixes(fixes, item, text) {
  const lo = item.t0 - FIX_SLACK;
  const hi = item.t1 + FIX_SLACK;
  const kept = (Array.isArray(fixes) ? fixes : []).filter(
    (f) => !(f.src === item.src && f.at >= lo && f.at <= hi)
  );
  const typed = String(text ?? '').trim();
  if (typed === item.original && !item.loop) return kept;
  return [
    ...kept,
    {
      src: item.src,
      at: round3((item.t0 + item.t1) / 2),
      text: typed === '' ? null : typed.slice(0, 64),
    },
  ];
}

/** The line a landed "Captions from speech" says: "Captions added — 15 words from the interview." */
export function captionsAddedText(count, from) {
  const n = Math.max(0, Math.round(count));
  return `Captions added — ${n} ${n === 1 ? 'word' : 'words'} from ${from}.`;
}
