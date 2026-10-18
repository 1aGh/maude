// _decode-chromium.mjs — the "no ffmpeg" half of video/decode.ts (S7.2, V2-1.10 §5.6 step 1).
//
// Decode ONE media file's sound to mono Float32 PCM in headless Chromium (WebAudio
// decodeAudioData + an OfflineAudioContext resample) — the footage pipeline's own
// decode-in-Chromium precedent (DDR-163), so a Mac with no ffmpeg still works. Identical output to
// ffmpeg within a sample or two (V2-1.10 §6.3 measured it on the beats corpus).
//
//   bun _decode-chromium.mjs <in> <sampleRate> <out.f32>
//
// Runs in its OWN process, so a missing browser (launchChromium exits 3) cannot take the caller
// down. The file is handed to the page as bytes (base64) — the page has no file access and no
// network. Exit: 0 ok · 2 usage · 3 no browser · 4 could not decode.

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { launchChromium } from './_pw-launch.mjs';

/** A file this big does not fit through a page.evaluate hand-over; ffmpeg handles the rest. */
const MAX_BYTES = 256 * 1024 * 1024;

/** Decode `file` → mono Float32Array at `sampleRate`. Throws on a decode failure. */
export async function decodeInChromium(file, sampleRate) {
  const abs = resolve(file);
  if (statSync(abs).size > MAX_BYTES)
    throw new Error(
      `file is larger than ${MAX_BYTES / 1024 / 1024} MB — install ffmpeg to read it`
    );
  const b64 = readFileSync(abs).toString('base64');
  const browser = await launchChromium({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body>decode</body></html>');
    const out = await page.evaluate(
      async ({ b64: data, rate }) => {
        const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const ctx = new OfflineAudioContext(1, rate, rate);
        const buf = await ctx.decodeAudioData(bin.buffer);
        const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * rate)), rate);
        const src = off.createBufferSource();
        src.buffer = buf; // a multi-channel buffer is mixed down to the mono context
        src.connect(off.destination);
        src.start();
        const rendered = await off.startRendering();
        const pcm = rendered.getChannelData(0);
        let s = '';
        const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        for (let i = 0; i < bytes.length; i += 0x8000)
          s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { b64, rate: sampleRate }
    );
    const raw = Buffer.from(out, 'base64');
    return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  const [inFile, rate, outFile] = process.argv.slice(2);
  const sr = Number(rate);
  if (!inFile || !outFile || !Number.isFinite(sr) || sr < 1000 || sr > 192000) {
    process.stderr.write('usage: _decode-chromium.mjs <in> <sampleRate> <out.f32>\n');
    process.exit(2);
  }
  try {
    const pcm = await decodeInChromium(inFile, sr);
    writeFileSync(outFile, new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  } catch (err) {
    process.stderr.write(`decode-chromium: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(4);
  }
}
