// Exp B3 — false ducking on the ambient Alligators stem with the multilingual model in Czech.
import { OUT, r2, regionScore } from './lib.mjs';
import { speechRegions, transcribeWords } from './words-pipeline.mjs';

const D = `${OUT}/expB`;
const { words, dur, whisperSec } = transcribeWords(`${D}/A.wav`, `${D}/A`, { model: 'base', lang: 'cs' });
console.log(`A (ambient, ${Math.round(dur)} s) base -l cs: ${words.length} words, whisper ${r2(whisperSec)} s`);
for (const minP of [0.2, 0.35, 0.5, 0.7]) {
  const regs = speechRegions(words, { minP, gapSec: 0.8 });
  console.log(`  minP ${minP}: ${regs.length} regions, false duck ${r2(regionScore([], regs, dur).fpSec)} s, words kept ${words.filter((w) => w.p >= minP && w.voiced).length}: ${words.filter((w) => w.p >= minP && w.voiced).map((w) => w.text).join(' ').slice(0, 120)}`);
}
