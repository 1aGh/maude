// S7.12 — what the Music lane and the Music inspector read (V2-1.10 §5.2, §5.3, §5.5, Q5/Q6/Q8):
// `compMusic` (a clip's grid in comp frames, bars only at confidence ≥ 0.4, volume, the dip), `ducksBySrc`,
// and the one write the Volume row makes (`video.music.volume`, a clip or a loose bed). Fixtures only: no
// audio is decoded, no service is called.

import { describe, expect, test } from 'bun:test';

import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { BAR_CONFIDENCE, compClips, compMusic, ducksBySrc } from './derive.ts';
import { DUCK_DEFAULTS } from './framing.ts';
import type { BeatGrid } from './schema.ts';

const FILE = 'ui/Reel.tsx';
const M = 'assets/dddddddd.mp3';
const A = 'assets/aaaaaaaa.mp4';

const SRC = [
  'const TOTAL = 140;',
  'const Reel = () => (',
  '  <>',
  `    <Sequence name="a" from={0} durationInFrames={140}><OffthreadVideo src="${A}" /></Sequence>`,
  `    <Duck db={-9} attackMs={100}><Audio src="${M}" volume={0.8} trimBefore={15} /></Duck>`,
  '  </>',
  ');',
  'function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reel" kind="video" width={1080} height={1920}><VideoComp component={Reel} durationInFrames={TOTAL} fps={30} width={1080} height={1920} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
].join('\n');

const grid = (over: Partial<BeatGrid['bar']> = {}, extra: Partial<BeatGrid> = {}): BeatGrid =>
  ({
    format: 'maude.beats',
    v: 1,
    asset: M,
    durationSec: 10,
    analyzer: { id: 'maude-beats', version: 1, decode: 'ffmpeg' },
    bpm: 120,
    bpmSource: 'detected',
    tempoStrength: 0.8,
    beats: [0.25, 0.5, 1, 1.5, 2, 30],
    bar: { phase: 0, confidence: 0.9, ...over },
    createdAt: '2026-10-18T09:00:00.000Z',
    ...extra,
  }) as BeatGrid;

const clips = () => compClips(FILE, SRC, 'reel');

describe('compMusic — the bed with its grid in comp frames', () => {
  test('beats shift by the trim; bars are every 4th from the bar phase; the dip and volume ride along', () => {
    const [m] = compMusic(clips(), { [M]: grid() }, SRC);
    expect(m?.src).toBe(M);
    expect(m?.loose).toBe(true);
    expect(m?.volume).toBe(0.8);
    expect(m?.duck).toEqual({ db: -9, attackMs: 100, releaseMs: DUCK_DEFAULTS.releaseMs });
    // the bed trims 15 frames (0.5 s): 0.25 s is before it, 30 s is past its end
    expect(m?.grid?.beats).toEqual([0, 15, 30, 45]);
    // beats[0] is the downbeat but sits before the trim; beats[4] (2 s) is the next one
    expect(m?.grid?.bars).toEqual([45]);
    expect(m?.grid?.bpm).toBe(120);
  });

  test('the bar phase moves the tall ticks', () => {
    const [m] = compMusic(clips(), { [M]: grid({ phase: 1 }) }, SRC);
    expect(m?.grid?.bars).toEqual([0]);
  });

  test('below bar confidence 0.4 every tick is the same height: no bars (Q8)', () => {
    const [m] = compMusic(clips(), { [M]: grid({ confidence: BAR_CONFIDENCE - 0.01 }) }, SRC);
    expect(m?.grid?.beats.length).toBe(4);
    expect(m?.grid?.bars).toEqual([]);
  });

  test('a song with no beat sidecar yet has no grid (the lane offers to find the beat)', () => {
    const [m] = compMusic(clips(), {}, SRC);
    expect(m?.grid).toBeNull();
  });

  test('a bed with no <Duck> carries no dip, and full volume when it names none', () => {
    const plain = SRC.replace(/<Duck[^>]*>(<Audio[^>]*\/>)<\/Duck>/, (_m, a: string) =>
      a.replace(' volume={0.8}', '')
    );
    const [m] = compMusic(compClips(FILE, plain, 'reel'), {}, plain);
    expect(m?.duck).toBeNull();
    expect(m?.volume).toBe(1);
  });
});

describe('ducksBySrc', () => {
  test('a <Duck> that wraps a literal-src <Audio> is read with the defaults for what it leaves out', () => {
    expect(ducksBySrc(SRC).get(M)).toEqual({ db: -9, attackMs: 100, releaseMs: 400 });
    expect(ducksBySrc(`<Duck><Audio src="x.mp3" /></Duck>`).get('x.mp3')).toEqual(DUCK_DEFAULTS);
  });
  test('a <Duck> around anything else names no bed', () => {
    expect(ducksBySrc('<Duck><div /></Duck>').size).toBe(0);
  });
});

describe('video.music.volume', () => {
  const run = (source: string, params: Record<string, unknown>) => {
    const o = EDIT_OPS.find((x) => x.id === 'video.music.volume');
    if (!o) throw new Error('no op video.music.volume');
    return o.apply(source, {
      file: FILE,
      op: 'video.music.volume',
      targets: [],
      params: { artboard: 'reel', ...params },
    }).source;
  };
  const bedId = () => clips().clips.find((c) => c.src === M)?.stableId;

  test('a loose bed (inside its <Duck>) takes a literal volume; 1 removes the prop', () => {
    const a = run(SRC, { stableId: bedId(), volume: 0.5 });
    expect(a).toContain(`<Audio src="${M}" volume={0.5} trimBefore={15} />`);
    const b = run(a, { stableId: bedId(), volume: 1 });
    expect(b).toContain(`<Audio src="${M}" trimBefore={15} />`);
    expect(b).toContain('<Duck db={-9} attackMs={100}>'); // the dip is untouched
  });

  test('out-of-range volume and a picture clip are refused', () => {
    expect(() => run(SRC, { stableId: bedId(), volume: 1.4 })).toThrow('Volume is between');
    expect(() => run(SRC, { stableId: bedId(), volume: 'loud' })).toThrow('Volume is between');
    const pic = clips().clips.find((c) => c.src === A)?.stableId;
    expect(() => run(SRC, { stableId: pic, volume: 0.5 })).toThrow('Only a music track');
  });
});
