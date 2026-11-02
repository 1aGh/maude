// Exp C2 — the same JS beat detector, but decoding in headless Chromium (WebAudio decodeAudioData)
// instead of ffmpeg: the no-new-dependency path for a Mac without ffmpeg (DDR-163 decode-in-Chromium precedent).
// Compares beats/tempo with the ffmpeg-decoded run and times both.
import { readFileSync } from 'node:fs';
import { fMeasure, jsBeats } from './beats.mjs';
import { MEDIA, r2, r3 } from './lib.mjs';

const { chromium } = await import('/Users/iagh/git/personal/maude/apps/studio/node_modules/playwright/index.mjs');
const src = readFileSync(new URL('./beats.mjs', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')
  .replace(/const TEMPO_PRIOR_SD = Number\(process\.env\.PRIOR_SD \?\? 0\.9\);/, 'const TEMPO_PRIOR_SD = 0.7;');
const t0 = performance.now();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<html><body>beats</body></html>');
await page.addScriptTag({ content: `${src}\nwindow.__beats = { onsetEnvelope, tempoOf, trackBeats, barPhase };` });
const launchMs = performance.now() - t0;
const rows = [];
for (const f of ['all-2a886bcf.mp3', 'all-55986008.mp3', 'all-9ec69178.mp3', 'all-bdbd77bb.mp3', 'bed.mp3', 'repo-5087c59a.mp3']) {
  const b64 = readFileSync(`${MEDIA}/music/${f}`).toString('base64');
  const t1 = performance.now();
  const res = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const t = performance.now();
    const ctx = new OfflineAudioContext(1, 22050, 22050);
    const buf = await ctx.decodeAudioData(bin.buffer);
    // resample to mono 22050 via an offline render
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 22050), 22050);
    const s = off.createBufferSource();
    s.buffer = buf;
    s.connect(off.destination);
    s.start();
    const r = await off.startRendering();
    const pcm = r.getChannelData(0);
    const decodeMs = performance.now() - t;
    const { env, low } = window.__beats.onsetEnvelope(pcm);
    const tempo = window.__beats.tempoOf(env);
    const beats = window.__beats.trackBeats(env, tempo.period);
    return { bpm: tempo.bpm, beats, decodeMs, totalMs: performance.now() - t, dur: buf.duration };
  }, b64);
  const wall = performance.now() - t1;
  process.env.PRIOR_SD = '0.7';
  const ff = jsBeats(`${MEDIA}/music/${f}`);
  const agree = fMeasure(ff.beats, res.beats, 0.07);
  // constant offset between the two decoders (median nearest-beat difference)
  const diffs = res.beats.map((t) => { let best = 1; for (const u of ff.beats) if (Math.abs(u - t) < Math.abs(best)) best = t - u; return best; }).filter((d) => Math.abs(d) < 0.1).sort((a, b) => a - b);
  rows.push({ track: f, sec: Math.round(res.dur), chromiumBpm: r2(res.bpm), ffmpegBpm: r2(ff.bpm), beatAgreementF: r3(agree.f), medianOffsetMs: Math.round((diffs[diffs.length >> 1] ?? 0) * 1000), chromiumMs: Math.round(wall), ffmpegMs: Math.round(ff.decodeMs + ff.analyseMs) });
}
await browser.close();
console.log(`Chromium launch ${Math.round(launchMs)} ms (once per run)`);
console.table(rows);
