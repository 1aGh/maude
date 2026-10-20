// audio.ts — S8.6 "Sound only": the mix of one video artboard as an m4a or a wav.
//
// The mix is the SAME one the video carries. The artboard is rendered through the mp4 adapter (so
// Remotion's TransitionSeries offsets, `<Audio volume={fn}>` closures and ducking are applied exactly
// once, in one place — video.ts), and the sound track is taken out of that file. There is no second
// mixer to drift from the first (the contract's "audio-only output carries the artboard's mix").
//
//   m4a  the track's own packets, re-wrapped in an audio-only MP4 (mediabunny `Conversion`, video
//        discarded). Nothing is decoded or re-encoded, so it is bit-for-bit the video's sound.
//   wav  decoded to 16-bit PCM by the one decode path the studio already has (`video/decode.ts`:
//        ffmpeg when it is installed, headless Chromium WebAudio otherwise — DDR-177, no new
//        dependency). That path is mono; the file says so in its header like any other WAV.
//
// A video with no sound track fails with one plain line, never an empty file.
//
// Both seams (`render`, `decode`) are injectable so a test drives the whole adapter with a fixture
// mix and no browser.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';

import { decodeAudio, encodeWav } from '../video/decode.ts';
import { decodeWithChromium } from '../video/decode-webaudio.ts';
import type { Adapter, ExportContext, ExportHooks, ExportOptions, ExportResult } from './index.ts';
import type { Target } from './scope.ts';
import { mp4 } from './video.ts';

export type AudioCodec = 'm4a' | 'wav';
/** Sample rate of the WAV. 48 kHz is what a video's sound is mixed at. */
export const WAV_RATE = 48_000;

export const NO_SOUND = 'This video has no sound to export.';

/** Renders the artboard's video (with its mix) and returns the file. Default: the mp4 adapter. */
export type RenderMix = (
  targets: Target[],
  options: ExportOptions,
  ctx: ExportContext,
  hooks?: ExportHooks
) => Promise<ExportResult>;

/** Decodes a media file to mono PCM at `rate`. Default: ffmpeg, else headless Chromium. */
export type DecodeMix = (file: string, rate: number) => Promise<Float32Array>;

export interface AudioDeps {
  render?: RenderMix;
  decode?: DecodeMix;
}

const defaultDecode: DecodeMix = async (file, rate) => {
  const out = await decodeAudio(file, {
    sampleRate: rate,
    wavDirect: false,
    chromium: (f, r, o) =>
      decodeWithChromium(f, {
        sampleRate: r,
        ...(o?.maxSeconds ? { maxSeconds: o.maxSeconds } : {}),
      }),
  });
  return out.pcm;
};

const codecOf = (options: ExportOptions): AudioCodec => {
  const a = options.audioCodec;
  return a === 'wav' ? 'wav' : 'm4a';
};

/** The m4a: the video's sound packets in an audio-only MP4. Throws `NO_SOUND` when there are none. */
export async function extractM4a(video: Uint8Array): Promise<Uint8Array> {
  const input = new Input({ source: new BufferSource(video), formats: ALL_FORMATS });
  let track: Awaited<ReturnType<typeof input.getPrimaryAudioTrack>>;
  try {
    track = await input.getPrimaryAudioTrack();
  } catch {
    throw new Error(NO_SOUND);
  }
  if (!track) throw new Error(NO_SOUND);
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({ input, output, video: { discard: true } });
  if (!conversion.isValid) throw new Error(NO_SOUND);
  await conversion.execute();
  const buf = output.target.buffer;
  if (!buf || buf.byteLength === 0) throw new Error(NO_SOUND);
  return new Uint8Array(buf);
}

export function makeAudioAdapter(deps: AudioDeps = {}): Adapter {
  const render: RenderMix = deps.render ?? ((t, o, c, h) => mp4.run(t, o, c, h));
  const decode: DecodeMix = deps.decode ?? defaultDecode;
  return {
    async run(targets, options, ctx, hooks): Promise<ExportResult> {
      const codec = codecOf(options);
      // the mix is the video's: same targets, same options; only the picture is cheaper (1×)
      const video = await render(targets, { ...options, scale: 1, audio: true }, ctx, hooks);
      if (video.degraded?.audioDropped) throw new Error(NO_SOUND);
      const stem = video.filename.replace(/\.[^.]+$/, '') || 'sound';
      const m4a = await extractM4a(video.body);
      if (codec === 'm4a') return { filename: `${stem}.m4a`, contentType: 'audio/mp4', body: m4a };
      // wav: decode the extracted sound (a private 0700 dir, never beside anything of the project's)
      const dir = mkdtempSync(path.join(tmpdir(), 'maude-sound-'));
      try {
        const file = path.join(dir, 'mix.m4a');
        writeFileSync(file, m4a);
        const pcm = await decode(file, WAV_RATE);
        if (!pcm.length) throw new Error(NO_SOUND);
        return {
          filename: `${stem}.wav`,
          contentType: 'audio/wav',
          body: encodeWav(pcm, WAV_RATE),
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** The registered adapter: renders through mp4, extracts, no seams. */
export const audio: Adapter = makeAudioAdapter();
