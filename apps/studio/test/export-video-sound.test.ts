// S8.6 — video in the sheet and Sound only (contract S8-export-spec.md §5.1; Gate 0 C19, C22).
//
//   · `audio` is an engine format: scope row, registry, spec → engine options (m4a | wav);
//   · Sound only carries the ARTBOARD'S MIX — the sound packets of the video render, re-wrapped, not a
//     second mixer — and a video with no sound ends with one line, never an empty file;
//   · the C22 cap is enforced on the SERVER: a comp past 3 600 frames is refused (422 `too-long`) unless
//     "Allow longer", which lets it go up to the artboard's own `maxFrames` (else the exporter ceiling);
//     the cap is stamped on every video unit so the engine holds it too; the estimate says the same;
//   · a Sound only job is a video job for the queue (timeout), and its file names itself `.m4a` / `.wav`.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BufferSource,
  BufferTarget,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';

import { resolveAccess } from '../access/scope.ts';
import { makeAudioAdapter, NO_SOUND, WAV_RATE } from '../exporters/audio.ts';
import { estimateSpec } from '../exporters/estimate.ts';
import { isScopeValidForFormat, VALID_SCOPES_BY_FORMAT } from '../exporters/format-scopes.ts';
import { FORMATS, getAdapter, isFormat } from '../exporters/index.ts';
import { resolveSpecV2, type SpecCanvas } from '../exporters/scope.ts';
import {
  capFor,
  DEFAULT_MAX_FRAMES,
  defaultVideoFacts,
  MAX_FRAMES_CEILING,
  type VideoFacts,
} from '../exporters/video-cap.ts';
import { type ExportRouteDeps, planExportV2 } from '../routes/export.ts';

const CTX = {
  designRoot: '/abs/proj/.design',
  repoRoot: '/abs/proj',
  serverOrigin: 'http://localhost:4399',
};
const TARGETS = [
  { kind: 'element', file: '.design/ui/reel.tsx', cssPath: '[data-dc-screen="reels"]' },
] as never;

/** A real MP4 whose only track is a 1 s stereo 440 Hz tone (PCM, so no encoder is needed). */
async function mixFixture(): Promise<{ bytes: Uint8Array; sine: Float32Array }> {
  const sr = 48_000;
  const sine = new Float32Array(sr);
  for (let i = 0; i < sr; i++) sine[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;
  const planar = new Float32Array(sr * 2);
  planar.set(sine, 0);
  planar.set(sine, sr);
  const out = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const src = new AudioSampleSource({ codec: 'pcm-s16' });
  out.addAudioTrack(src);
  await out.start();
  const sample = new AudioSample({
    data: planar,
    format: 'f32-planar',
    numberOfChannels: 2,
    sampleRate: sr,
    timestamp: 0,
  });
  await src.add(sample);
  sample.close();
  await out.finalize();
  return { bytes: new Uint8Array(out.target.buffer as ArrayBuffer), sine };
}

async function packetsOf(bytes: Uint8Array): Promise<Uint8Array[]> {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) return [];
  const sink = new EncodedPacketSink(track);
  const out: Uint8Array[] = [];
  for await (const p of sink.packets()) out.push(p.data);
  return out;
}

const mp4Result = (body: Uint8Array, degraded?: { audioDropped: boolean; reason: string }) => ({
  filename: 'reel.mp4',
  contentType: 'video/mp4',
  body,
  ...(degraded ? { degraded } : {}),
});

describe('audio is an engine format', () => {
  test('a scope row, a registered adapter, and the spec reaches it (m4a by default)', () => {
    expect(VALID_SCOPES_BY_FORMAT.audio).toEqual(['artboard']);
    expect(isScopeValidForFormat('audio', 'artboard')).toBe(true);
    expect(isScopeValidForFormat('audio', 'canvas-as-separate')).toBe(false);
    expect(FORMATS).toContain('audio');
    expect(isFormat('audio')).toBe(true);
    expect(getAdapter('audio')).not.toBeNull();
  });

  test('options.audio.codec becomes the engine’s audioCodec; a video unit has none', () => {
    const canvases: SpecCanvas[] = [
      {
        rel: 'ui/reel.tsx',
        artboards: [{ id: 'reels', label: 'Reels', kind: 'video', w: 1080, h: 1920 }],
      },
    ];
    const run = (format: string, options?: object) => {
      const r = resolveSpecV2(
        {
          v: 2,
          scope: 'selection',
          canvas: 'ui/reel.tsx',
          selection: { artboards: ['reels'] },
          format,
          ...(options ? { options } : {}),
        } as never,
        { designRel: '.design', canvases, activeCanvas: 'ui/reel.tsx' }
      );
      expect(r.ok).toBe(true);
      return r.ok ? (r.units[0]?.options ?? {}) : {};
    };
    expect(run('audio').audioCodec).toBe('m4a');
    expect(run('audio', { audio: { codec: 'wav' } }).audioCodec).toBe('wav');
    expect(run('mp4').audioCodec).toBeUndefined();
  });
});

describe('Sound only carries the artboard’s mix', () => {
  test('m4a: the video’s own sound packets, re-wrapped — bit for bit, nothing else', async () => {
    const { bytes } = await mixFixture();
    const seen: Array<Record<string, unknown>> = [];
    const adapter = makeAudioAdapter({
      render: async (_t, options) => {
        seen.push(options);
        return mp4Result(bytes);
      },
    });
    const res = await adapter.run(TARGETS, {}, CTX as never);
    expect(res.filename).toBe('reel.m4a');
    expect(res.contentType).toBe('audio/mp4');
    // the video was rendered with sound on, at the cheap size
    expect(seen[0]).toMatchObject({ audio: true, scale: 1 });
    // the artboard's mix: the very packets the video carried
    const [before, after] = [await packetsOf(bytes), await packetsOf(res.body)];
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++)
      expect(
        Buffer.compare(Buffer.from(after[i] as Uint8Array), Buffer.from(before[i] as Uint8Array))
      ).toBe(0);
    // and it is sound only
    const input = new Input({ source: new BufferSource(res.body), formats: ALL_FORMATS });
    expect(await input.getPrimaryVideoTrack()).toBeNull();
    expect(await input.getPrimaryAudioTrack()).not.toBeNull();
  });

  test('wav: 16-bit PCM at 48 kHz made from that same extracted sound', async () => {
    const { bytes, sine } = await mixFixture();
    let decoded = '';
    const adapter = makeAudioAdapter({
      render: async () => mp4Result(bytes),
      decode: async (file, rate) => {
        decoded = file;
        expect(rate).toBe(WAV_RATE);
        return sine; // what a decoder reads back from the m4a
      },
    });
    const res = await adapter.run(TARGETS, { audioCodec: 'wav' }, CTX as never);
    expect(decoded.endsWith('mix.m4a')).toBe(true);
    expect(res.filename).toBe('reel.wav');
    expect(res.contentType).toBe('audio/wav');
    const dv = new DataView(res.body.buffer, res.body.byteOffset, res.body.byteLength);
    expect(String.fromCharCode(...res.body.subarray(0, 4))).toBe('RIFF');
    expect(dv.getUint32(24, true)).toBe(WAV_RATE);
    expect(dv.getUint16(34, true)).toBe(16);
    expect(dv.getUint32(40, true)).toBe(sine.length * 2);
    // the tone is in there: the 100th sample is the sine's, at 16 bit
    expect(dv.getInt16(44 + 100 * 2, true)).toBe(Math.round((sine[100] as number) * 32767));
  });

  test('a video with no sound ends with one line — never an empty file', async () => {
    const dropped = makeAudioAdapter({
      render: async () => mp4Result(new Uint8Array([1, 2, 3]), { audioDropped: true, reason: 'x' }),
    });
    await expect(dropped.run(TARGETS, {}, CTX as never)).rejects.toThrow(NO_SOUND);
    const garbage = makeAudioAdapter({ render: async () => mp4Result(new Uint8Array([1, 2, 3])) });
    await expect(garbage.run(TARGETS, {}, CTX as never)).rejects.toThrow(NO_SOUND);
  });
});

// ── C22: the cap is the server's ──────────────────────────────────────────────────────────────────
const OWNER = resolveAccess({ v: 1, role: 'owner' });
const CANVASES: SpecCanvas[] = [
  {
    rel: 'ui/reel.tsx',
    artboards: [
      { id: 'reels', label: 'Recap Reels', kind: 'video', w: 1080, h: 1920 },
      { id: 'wide', label: 'Recap 16:9', kind: 'video', w: 1920, h: 1080 },
      { id: 'post', label: 'Post', kind: 'digital', w: 1080, h: 1350 },
    ],
  },
];
function deps(facts: Record<string, VideoFacts | null>): ExportRouteDeps {
  return {
    designRel: '.design',
    projectName: () => 'Alligators',
    canvases: () => CANVASES,
    activeCanvas: () => 'ui/reel.tsx',
    access: () => OWNER,
    history: () => [],
    renderLane: () => 'local',
    retry: async () => ({ ok: false, reason: 'missing' }) as never,
    videoFacts: (_c, id) => facts[id] ?? null,
  };
}
const facts = (frames: number | null, stored: number | null = null): VideoFacts => ({
  frames,
  fps: 30,
  stored,
  clips: [{ track: 'video', from: 0, frames: frames ?? 0 }],
});
const spec = (format: string, board: string, video?: object) => ({
  v: 2,
  scope: 'selection',
  canvas: 'ui/reel.tsx',
  selection: { artboards: [board] },
  format,
  ...(video ? { options: { video } } : {}),
});

describe('the C22 cap', () => {
  test('capFor: 3 600; with Allow longer the artboard’s own number, else the exporter ceiling', () => {
    expect(capFor(false, null)).toBe(DEFAULT_MAX_FRAMES);
    expect(capFor(false, 9000)).toBe(DEFAULT_MAX_FRAMES); // stored is a ceiling, not a switch
    expect(capFor(true, 5400)).toBe(5400);
    expect(capFor(true, null)).toBe(MAX_FRAMES_CEILING);
    expect(capFor(true, 100)).toBe(DEFAULT_MAX_FRAMES); // never below the default
  });

  test('a comp past 3 600 frames is refused with 422, naming the field and the way out', async () => {
    for (const format of ['mp4', 'webm', 'gif', 'audio']) {
      const p = planExportV2(spec(format, 'reels'), deps({ reels: facts(4800) }));
      expect(p.ok).toBe(false);
      if (p.ok) continue;
      expect(p.response.status).toBe(422);
      const body = (await p.response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        error: 'too-long',
        field: 'options.video.allowLonger',
        frames: 4800,
        cap: 3600,
      });
      expect(String(body.message)).toContain('Allow longer');
      expect(String(body.message)).toContain('2:40');
    }
  });

  test('Allow longer goes up to the artboard’s maxFrames — and no further', () => {
    const f = { reels: facts(4800, 5400) };
    const ok = planExportV2(spec('mp4', 'reels', { allowLonger: true }), deps(f));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.group.units[0]?.options.maxFrames).toBe(5400);
    const tooLong = planExportV2(
      spec('mp4', 'reels', { allowLonger: true }),
      deps({ reels: facts(6000, 5400) })
    );
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.response.status).toBe(422);
    // no stored number: the exporter's ceiling
    const open = planExportV2(
      spec('mp4', 'reels', { allowLonger: true }),
      deps({ reels: facts(12_000) })
    );
    expect(open.ok).toBe(true);
    if (open.ok) expect(open.group.units[0]?.options.maxFrames).toBe(MAX_FRAMES_CEILING);
    expect(
      planExportV2(spec('mp4', 'reels', { allowLonger: true }), deps({ reels: facts(18_001) })).ok
    ).toBe(false);
  });

  test('every video unit carries the cap it was held to, even when its length is unknown', () => {
    const under = planExportV2(spec('mp4', 'reels'), deps({ reels: facts(900) }));
    expect(under.ok).toBe(true);
    if (under.ok) expect(under.group.units[0]?.options.maxFrames).toBe(3600);
    const unknown = planExportV2(spec('audio', 'reels'), deps({ reels: null }));
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.group.units[0]?.options.maxFrames).toBe(3600);
    // a picture is not a video: no cap is stamped on it
    const png = planExportV2(spec('png', 'post'), deps({}));
    expect(png.ok).toBe(true);
    if (png.ok) expect(png.group.units[0]?.options.maxFrames).toBeUndefined();
  });

  test('the sheet cannot raise it: maxFrames is not a spec key', () => {
    const p = planExportV2(
      { ...spec('mp4', 'reels'), options: { video: { maxFrames: 18_000 } } },
      deps({ reels: facts(900) })
    );
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.response.status).toBe(400);
  });

  test('the estimate tells the sheet the same numbers the server will hold it to', () => {
    const r = resolveSpecV2(
      {
        v: 2,
        scope: 'selection',
        canvas: 'ui/reel.tsx',
        selection: { artboards: ['reels', 'wide'] },
        format: 'mp4',
      } as never,
      { designRel: '.design', canvases: CANVASES, activeCanvas: 'ui/reel.tsx' }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const est = estimateSpec(
      {
        v: 2,
        scope: 'selection',
        canvas: 'ui/reel.tsx',
        selection: { artboards: ['reels', 'wide'] },
        format: 'mp4',
      },
      r,
      {
        canvases: CANVASES,
        canvas: 'ui/reel.tsx',
        canvasOnly: false,
        history: [],
        renderLane: 'local',
        video: (_c, id) => (id === 'reels' ? facts(4800) : facts(900)),
      }
    );
    expect(est.video.map((v) => [v.artboard, v.frames, v.cap, v.over])).toEqual([
      ['reels', 4800, 3600, true],
      ['wide', 900, 3600, false],
    ]);
    expect(est.video[0]).toMatchObject({ label: 'Recap Reels', w: 1080, h: 1920, fps: 30 });
  });
});

describe('the canvas is where the length comes from', () => {
  test('defaultVideoFacts reads the comp length and the artboard’s stored maxFrames', () => {
    const root = mkdtempSync(join(tmpdir(), 'video-cap-'));
    try {
      mkdirSync(join(root, 'ui'));
      const src = [
        "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
        "import { Sequence } from 'remotion';",
        'const Comp = () => (<Sequence name="a" durationInFrames={4800}><div /></Sequence>);',
        'export default function Canvas() {',
        '  return (<DesignCanvas>',
        '    <DCArtboard id="reels" label="Reels" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={4800} fps={30} width={1080} height={1920} /></DCArtboard>',
        '  </DesignCanvas>);',
        '}',
        '',
      ].join('\n');
      writeFileSync(join(root, 'ui/reel.tsx'), src);
      writeFileSync(
        join(root, 'ui/reel.meta.json'),
        JSON.stringify({ artboardMeta: { reels: { maxFrames: 5400 } } })
      );
      const read = defaultVideoFacts(root);
      expect(read('ui/reel.tsx', 'reels')).toMatchObject({ frames: 4800, fps: 30, stored: 5400 });
      // outside the root, or not a canvas: unknown, never an error
      expect(read('../x.tsx', 'reels')).toBeNull();
      expect(read('ui/missing.tsx', 'reels')).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
