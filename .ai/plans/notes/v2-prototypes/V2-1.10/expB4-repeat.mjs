// Exp B4 — whisper repetition-loop filter on the ambient stem (Czech, multilingual base):
// a run of ≥ 3 identical consecutive words is marked `loop` and leaves the speech regions.
import { OUT, r2, regionScore } from './lib.mjs';
import { speechRegions, transcribeWords } from './words-pipeline.mjs';

export function markLoops(words, minRun = 3) {
  const key = (w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const out = words.map((w) => ({ ...w }));
  let i = 0;
  while (i < out.length) {
    let j = i;
    while (j + 1 < out.length && key(out[j + 1]) === key(out[i]) && key(out[i])) j++;
    if (j - i + 1 >= minRun) for (let k = i; k <= j; k++) out[k].loop = true;
    i = j + 1;
  }
  return out;
}
const D = `${OUT}/expB`;
for (const [stem, model, lang] of [['A', 'base', 'cs'], ['A', 'base.en', 'en'], ['S1', 'base.en', 'en']]) {
  const { words, dur } = transcribeWords(`${D}/${stem}.wav`, `${D}/${stem}`, { model, lang });
  const marked = markLoops(words).filter((w) => !w.loop);
  const before = speechRegions(words, { minP: 0.5, gapSec: 0.8 });
  const after = speechRegions(marked, { minP: 0.5, gapSec: 0.8 });
  console.log(`${stem} ${model}/${lang}: words ${words.length} → ${marked.length} after loop filter; false/regions before ${r2(before.reduce((s, [a, b]) => s + b - a, 0))} s, after ${r2(after.reduce((s, [a, b]) => s + b - a, 0))} s of ${Math.round(dur)} s`);
}
