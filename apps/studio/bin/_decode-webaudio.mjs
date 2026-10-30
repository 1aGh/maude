// _decode-webaudio.mjs — decode ONE audio/video file to mono Float32 PCM in headless Chromium (WebAudio
// `decodeAudioData`). The ffmpeg-free fallback of the beats / transcribe analysers (S7.3, V2-1.10 §5.6):
// the same detector fed these samples gives the same beats as the ffmpeg path (V2-1.10 §6.3).
//
// Reached only through `video/decode-webaudio.ts` (never a raw bin path, DDR-062); it runs under real
// node or bun like every other playwright shim (`exporters/_runtime.ts`), so the compiled server and the
// desktop bundle never need to link playwright themselves.
//
// Usage:  _decode-webaudio.mjs --in <file> --out <raw.f32le> [--rate 22050] [--max-seconds 1800]
// The audio never touches the network: the page is served from a fulfilled `.invalid` origin (no DNS, no
// real request leaves the browser), and the result is POSTed back to that same route handler.
// Exit: 0 ok · 2 usage · 3 no browser (via _pw-launch) · 4 the file cannot be decoded · 1 other.

import { readFileSync, statSync, writeFileSync } from 'node:fs';

import { launchChromium } from './_pw-launch.mjs';

const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const ORIGIN = 'http://maude-decode.invalid';

class Fail extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}
function fail(code, msg) {
  throw new Fail(code, msg);
}

function parse(argv) {
  const o = { in: null, out: null, rate: 22050, maxSeconds: 1800 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--in') o.in = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--rate') o.rate = Number(argv[++i]);
    else if (a === '--max-seconds') o.maxSeconds = Number(argv[++i]);
    else fail(2, `unknown argument ${a}`);
  }
  if (!o.in || !o.out) fail(2, '--in and --out are required');
  if (!Number.isInteger(o.rate) || o.rate < 3000 || o.rate > 96000) fail(2, '--rate out of range');
  if (!(o.maxSeconds > 0)) fail(2, '--max-seconds must be positive');
  return o;
}

async function main() {
  const o = parse(process.argv.slice(2));
  let bytes;
  try {
    if (statSync(o.in).size > MAX_INPUT_BYTES) fail(4, 'file is larger than 256 MB');
    bytes = readFileSync(o.in);
  } catch (e) {
    fail(4, `cannot read the file: ${e?.message ?? e}`);
  }

  const browser = await launchChromium({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  let result = null;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') {
        await route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>decode</title>',
        });
      } else if (url.pathname === '/in') {
        await route.fulfill({
          contentType: 'application/octet-stream',
          headers: { 'access-control-allow-origin': '*' },
          body: bytes,
        });
      } else if (url.pathname === '/out' && route.request().method() === 'POST') {
        result = route.request().postDataBuffer();
        await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      } else {
        await route.abort();
      }
    });
    await page.goto(`${ORIGIN}/`);
    const outcome = await page.evaluate(
      async ({ rate, maxSeconds }) => {
        try {
          const ab = await (await fetch('/in')).arrayBuffer();
          const ctx = new OfflineAudioContext(1, 1, rate);
          const buf = await ctx.decodeAudioData(ab);
          const length = Math.min(buf.length, Math.floor(maxSeconds * buf.sampleRate));
          const mono = new Float32Array(length);
          const chans = buf.numberOfChannels;
          for (let c = 0; c < chans; c += 1) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < length; i += 1) mono[i] += d[i] / chans;
          }
          const res = await fetch('/out', { method: 'POST', body: mono.buffer });
          return { ok: res.ok, rate: buf.sampleRate, length };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
      { rate: o.rate, maxSeconds: o.maxSeconds }
    );
    if (!outcome.ok || !result) fail(4, outcome.error || 'the browser could not decode this file');
    if (outcome.rate !== o.rate)
      fail(4, `the browser decoded at ${outcome.rate} Hz, not ${o.rate}`);
    writeFileSync(o.out, result);
  } finally {
    await browser.close().catch(() => {});
  }
}

// Every failure unwinds through `finally` first, so the browser is always closed before the process ends.
main().catch((e) => {
  process.stderr.write(`decode-webaudio: ${e?.message ?? e}\n`);
  process.exit(e instanceof Fail ? e.code : 1);
});
