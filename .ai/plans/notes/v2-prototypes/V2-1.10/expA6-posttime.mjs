// Exp A6 — time of the words post-processing alone (cached whisper JSON): lag, snap, loops, regions.
import { OUT } from './lib.mjs';
import { speechRegions, transcribeWords } from './words-pipeline.mjs';
import { markLoops } from './expB4-repeat.mjs';

for (const stem of ['S1', 'M']) {
  const r = transcribeWords(`${OUT}/expB/${stem}.wav`, `${OUT}/expB/${stem}`);
  const t = performance.now();
  speechRegions(markLoops(r.words), { minP: 0.35, gapSec: 0.8 });
  console.log(`${stem}: ${Math.round(r.dur)} s audio, ${r.words.length} words — post (decode+energy+lag+snap) ${Math.round(r.postSec * 1000)} ms, loops+regions ${Math.round(performance.now() - t)} ms`);
}
