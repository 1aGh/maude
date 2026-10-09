// Exp B2 — tune the words→regions merge (minP, gap) on the cached stems; ducker hold = gap.
import { decodePcm, frameDb, MEDIA, OUT, r2, r3, regionScore, regionsFromMask } from './lib.mjs';
import { speechRegions, transcribeWords } from './words-pipeline.mjs';

const D = `${OUT}/expB`;
const SR = 16000;
const VO = [['vo-00', 400], ['vo-10', 5700], ['vo-20', 14070], ['vo-40', 23070], ['vo-50', 30000], ['vo-60', 36970], ['vo-65', 47570], ['vo-70', 55070], ['vo-80', 63030], ['vo-92', 76330], ['vo-94', 84600], ['vo-96', 88800], ['vo-99', 98530]];
const truth = [];
for (const [f, ms] of VO) {
  const pcm = decodePcm(`${MEDIA}/vo/${f}.mp3`, SR);
  const db = frameDb(pcm, SR);
  const max = Math.max(...db);
  for (const [s, e] of regionsFromMask(Array.from(db, (v) => v > max - 35), 0.01, 0.3, 0.05)) truth.push([s + ms / 1000, e + ms / 1000]);
}
const rows = [];
for (const stem of ['S1', 'M', 'A']) {
  const wav = `${D}/${stem}.wav`;
  const { words, dur } = transcribeWords(wav, `${D}/${stem}`);
  for (const minP of [0.2, 0.35, 0.5]) for (const gapSec of [0.5, 0.8, 1.2]) {
    const regs = speechRegions(words, { minP, gapSec, pad: 0.12 });
    const sc = regionScore(stem === 'A' ? [] : truth, regs, dur);
    rows.push({ stem, minP, gapSec, recall: stem === 'A' ? '—' : r3(sc.recall), precision: stem === 'A' ? '—' : r3(sc.precision), falseDuckSec: r2(sc.fpSec), missedSec: r2(sc.fnSec), togglesPerMin: r2((regs.length * 2) / (dur / 60)) });
  }
}
console.table(rows);
