// Exp A5 — edit-by-transcript cut points: does the computed cut point land in silence?
// For every word boundary in the 13 VO lines, cut = midpoint of the inter-word gap (≥ 60 ms) else
// word edge ± 20 ms; "clean" = the 10 ms frame at the cut is unvoiced (energy < max − 35 dB).
import { decodePcm, frameDb, MEDIA, OUT, r3 } from './lib.mjs';
import { transcribeWords, voiced } from './words-pipeline.mjs';
import { toWav, VO_TEXT, W } from './whisper-lib.mjs';

export function cutBoundary(prev, next) {
  const gap = next.start - prev.end;
  if (gap >= 0.06) return prev.end + gap / 2;
  return null; // no silence between the words: a cut here is mid-speech
}
let minClean = 0, minN = 0;
let n = 0, clean = 0, noGap = 0, cleanAtPause = 0, pauses = 0;
for (const id of Object.keys(VO_TEXT)) {
  const wav = `${W}/${id}.wav`;
  toWav(`${MEDIA}/vo/${id}.mp3`, wav);
  const v = voiced(wav);
  const db = frameDb(decodePcm(wav, 16000), 16000);
  const { words } = transcribeWords(wav, `${W}/${id}`, { model: 'base.en' });
  for (let i = 1; i < words.length; i++) {
    n++;
    const c = cutBoundary(words[i - 1], words[i]);
    // was there a real pause (≥150 ms unvoiced) between these words in the audio?
    const a = Math.floor(words[i - 1].end / 0.01), b = Math.floor(words[i].start / 0.01);
    let run = 0, best = 0;
    for (let k = Math.max(0, a - 10); k < b + 10; k++) { run = v.mask[k] ? 0 : run + 1; best = Math.max(best, run); }
    const realPause = best >= 15;
    if (realPause) pauses++;
    { // variant: cut at the quietest 10 ms frame within [prev.end-50ms, next.start+50ms]
      const lo = Math.max(0, Math.floor((words[i-1].end - 0.05) / 0.01)), hi = Math.ceil((words[i].start + 0.05) / 0.01);
      let m = lo; for (let k = lo; k <= hi; k++) if (db[k] < db[m]) m = k;
      minN++; if (!v.mask[m]) minClean++;
    }
    if (c == null) { noGap++; continue; }
    const ok = !v.mask[Math.round(c / 0.01)];
    if (ok) clean++;
    if (ok && realPause) cleanAtPause++;
  }
}
console.log(`quietest-frame variant: unvoiced at ${minClean}/${minN} (${r3(minClean/minN)}) of ALL boundaries`);
console.log(`boundaries ${n}; with a gap ≥ 60 ms ${n - noGap}; cut frame unvoiced ${clean} (${r3(clean / (n - noGap))} of gapped); real pauses ${pauses}, cut in silence at a real pause ${cleanAtPause} (${r3(cleanAtPause / pauses)})`);
