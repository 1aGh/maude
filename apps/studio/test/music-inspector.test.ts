// S7.12 — the Music inspector and the Music lane (07 · ve-music): the rows in the canvas's words and what each one
// writes, the numbers Advanced names, the defaults (Q5 duck on with speech, Q6 snap on with a clear beat, Q8 bar
// ticks only when sure), Find the beat / Half · Double / Cut to the beat through their routes, and the lane's
// overlay. Real markup, real registry; every route is a recorder. No audio is decoded, no service is called.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { timelineKindOf } from '../client/v2/inspector/kinds/clip-model.js';
import {
  beatTicks,
  bpmValue,
  BAR_CONFIDENCE as CLIENT_BAR,
  CLEAR_BEAT as CLIENT_CLEAR,
  cutToBeatParams,
  cutToBeatWords,
  duckPoints,
  duckValue,
  gainDbValue,
  halfDouble,
  laneLabel,
  shouldDuckByDefault,
  songName,
  volumePercent,
} from '../client/v2/timeline/lanes/music-model.js';
import { BAR_CONFIDENCE, CLEAR_BEAT } from '../video/derive.ts';

// ── the model (no DOM) ───────────────────────────────────────────────────────────────────────────────────
const GRID = {
  bpm: 120,
  bpmSource: 'detected',
  tempoStrength: 0.8,
  barConfidence: 0.9,
  beats: [0, 15, 30, 45, 60, 75],
  bars: [0, 60],
};
const DUCK = { db: -12, attackMs: 200, releaseMs: 400 };

describe('the music model — the canvas’s words and the server’s numbers', () => {
  test('the thresholds are the server’s own (one source of truth, pinned)', () => {
    expect(CLIENT_BAR).toBe(BAR_CONFIDENCE);
    expect(CLIENT_CLEAR).toBe(CLEAR_BEAT);
  });

  test('"Hype instrumental · 120 BPM": a name, never a hash; no tempo is claimed without a clear beat', () => {
    expect(songName('assets/Hype-instrumental.mp3')).toBe('Hype instrumental');
    expect(songName('assets/2a886bcf.mp3')).toBe('Music');
    expect(laneLabel('assets/Hype-instrumental.mp3', GRID)).toBe('Hype instrumental · 120 BPM');
    expect(laneLabel('assets/Hype-instrumental.mp3', { ...GRID, tempoStrength: 0.1 })).toBe(
      'Hype instrumental'
    );
    expect(laneLabel('assets/Hype-instrumental.mp3', null)).toBe('Hype instrumental');
  });

  test('Q8: a tall tick on every bar, but only where the analysis was sure of the bar', () => {
    expect(
      beatTicks(GRID)
        .filter((t: { bar: boolean }) => t.bar)
        .map((t: { frame: number }) => t.frame)
    ).toEqual([0, 60]);
    expect(beatTicks({ ...GRID, barConfidence: 0.39 }).some((t: { bar: boolean }) => t.bar)).toBe(
      false
    );
    expect(beatTicks(null)).toEqual([]);
  });

  test('Advanced: bpm 120 (detected), duck −12 dB · 200 ms, gainDb −2', () => {
    expect(bpmValue(GRID)).toBe('120 (detected)');
    expect(bpmValue({ ...GRID, bpm: 60, bpmSource: 'set' })).toBe('60 (set)');
    expect(bpmValue({ ...GRID, tempoStrength: 0.1 })).toBe('No clear beat in this song.');
    expect(bpmValue(null)).toBe('No beat found yet.');
    expect(duckValue(DUCK)).toBe('−12 dB · 200 ms');
    expect(duckValue(null)).toBe('off');
    expect(gainDbValue(0.8)).toBe('−2');
    expect(gainDbValue(1)).toBe('0');
    expect(gainDbValue(0)).toBe('−∞');
    expect(volumePercent(0.8)).toBe(80);
    expect(volumePercent(7)).toBe(100);
  });

  test('Half · Double: the new tempo, or null when it can not be tracked', () => {
    expect(halfDouble(120)).toEqual({ half: 60, double: 240 });
    expect(halfDouble(30)).toEqual({ half: null, double: 60 });
    expect(halfDouble(250)).toEqual({ half: 125, double: null });
  });

  test('the dip: depth 0 at full volume, 1 under speech, a ramp of attack before and release after', () => {
    const pts = duckPoints({
      speech: [[60, 120]],
      duck: DUCK,
      fps: 30,
      from: 0,
      durationInFrames: 300,
    });
    expect(pts).toEqual([
      { f: 0, depth: 0 },
      { f: 54, depth: 0 },
      { f: 60, depth: 1 },
      { f: 120, depth: 1 },
      { f: 132, depth: 0 },
      { f: 300, depth: 0 },
    ]);
    // no <Duck>, or a 0 dB one, draws no line; speech outside the clip changes nothing
    expect(
      duckPoints({ speech: [[60, 120]], duck: null, fps: 30, from: 0, durationInFrames: 300 })
    ).toEqual([]);
    expect(
      duckPoints({
        speech: [[400, 500]],
        duck: DUCK,
        fps: 30,
        from: 0,
        durationInFrames: 300,
      }).every((p: { depth: number }) => p.depth === 0)
    ).toBe(true);
  });

  test('Q5: Lower under speech is on by default when the video has speech — and only for a bed that has no <Duck>', () => {
    const bare = [{ duck: null }];
    expect(shouldDuckByDefault({ speech: [[0, 30]], music: bare })).toBe(true);
    expect(shouldDuckByDefault({ speech: [], music: bare })).toBe(false);
    expect(shouldDuckByDefault({ speech: [[0, 30]], music: [] })).toBe(false);
    expect(shouldDuckByDefault({ speech: [[0, 30]], music: [{ duck: DUCK }] })).toBe(false);
  });

  test('Cut to the beat: the beats go in as comp frames, unknown source lengths are left out; the words keep the length', () => {
    const p = cutToBeatParams({
      music: [{ grid: GRID }, { grid: { ...GRID, tempoStrength: 0.05 } }],
      sources: { 'a.mp4': 8, 'b.mp4': 0, 'c.mp4': Number.NaN },
    });
    expect(p).toEqual({ beats: [0, 15, 30, 45, 60, 75], every: 1, sources: { 'a.mp4': 8 } });
    expect(cutToBeatWords({ moved: 6, kept: [] })).toBe(
      'Moved 6 cuts to the beat. The video is the same length.'
    );
    expect(cutToBeatWords({ moved: 1, kept: [{ at: 90, reason: 'no-handle' }] })).toBe(
      'Moved 1 cut to the beat. 1 stayed where it was — no footage to spare. The video is the same length.'
    );
    expect(cutToBeatWords({ moved: 0, kept: [] })).toBe('Every cut is already on a beat.');
  });

  test('an audio row is Music, a title is a title, everything else a clip', () => {
    expect(timelineKindOf({ rowKind: 'audio' })).toBe('music');
    expect(timelineKindOf({ rowKind: 'audio', series: true })).toBe('clip');
    expect(timelineKindOf({ rowKind: 'video' })).toBe('clip');
    expect(timelineKindOf({ rowKind: 'jsx' })).toBe('title');
  });
});

// ── the DOM ──────────────────────────────────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
type Req = { url: string; method: string; body: unknown };
const reqs: Req[] = [];
let media: Record<string, unknown> = {};
let analysisStatus = 200;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('.css')) return new Response(':root{--bg-1:#fff}', { status: 200 });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    reqs.push({ url: u, method: init?.method ?? 'GET', body });
    if (u.startsWith('/_api/comp-media')) return Response.json(media);
    if (u.startsWith('/_api/canvas-meta')) return Response.json({ artboardMeta: { reel: {} } });
    if (u === '/_api/media-analysis') {
      if (analysisStatus === 200 && body?.bpm) {
        // the beats verb re-tracks at the given tempo and keeps the sidecar's other numbers
        const m = media.music as Array<{ grid: { bpm: number; bpmSource: string } }>;
        for (const s of m) s.grid = { ...s.grid, bpm: body.bpm, bpmSource: 'set' };
      }
      return new Response('{}', { status: analysisStatus });
    }
    if (u === '/_api/present-meta')
      return Response.json({ ok: true, snap: body?.snap?.reel ? { reel: body.snap.reel } : {} });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});

let restoreSlots: (() => void) | null = null;
const seated: Array<() => void> = [];
afterAll(async () => {
  for (const off of seated.splice(0)) off();
  restoreSlots?.();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
const fresh = () => ({
  fps: 30,
  clips: [],
  words: [],
  speech: [[60, 120]],
  beats: GRID.beats,
  unresolved: [],
  music: [
    {
      stableId: 'loose:0',
      src: 'assets/Hype-instrumental.mp3',
      track: 'music',
      from: 0,
      durationInFrames: 300,
      loose: true,
      volume: 0.8,
      duck: DUCK,
      grid: { ...GRID },
    },
  ],
});
beforeEach(async () => {
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
  const { resetMusicMedia } = await import('../client/v2/timeline/lanes/music-media.js');
  resetMusicMedia();
  media = fresh();
  analysisStatus = 200;
  reqs.length = 0;
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await settle();
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const must = (el: Element | null, what: string) => {
  if (!el) throw new Error(`missing ${what}`);
  return el as HTMLElement;
};
const chk = (host: HTMLElement, id: string) =>
  must(q(host, id)?.querySelector('input') ?? null, id) as HTMLInputElement;
const click = async (el: Element | null, what = 'element') => {
  await act(async () => {
    must(el, what).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};
const rowsOf = (host: HTMLElement, section: string) =>
  [...(q(host, `insp-sec-${section}`)?.querySelectorAll('[data-testid^="insp-row-"]') ?? [])].map(
    (r) =>
      `${(r.getAttribute('data-testid') ?? '').replace('insp-row-', '')} = ${r.querySelector('.insp-row-k')?.textContent}`
  );

const CANVAS = '.design/ui/Reel.tsx';
type Call = unknown[];
const calls: Call[] = [];
const selection = (extra = {}) => ({
  kind: 'music',
  canvas: CANVAS,
  artboardId: 'reel',
  fps: 30,
  stableId: 'loose:0',
  label: 'Hype instrumental',
  loose: true,
  seq: {
    from: 0,
    duration: 300,
    label: 'Hype instrumental',
    series: false,
    mediaTag: 'Audio',
    mediaSrc: 'assets/Hype-instrumental.mp3',
    mediaProps: { volume: 0.8 },
    rowKind: 'audio',
  },
  transitionAfter: null,
  onVerb: (...a: unknown[]) => calls.push(['verb', ...a]),
  onOp: async (...a: unknown[]) => {
    calls.push(['op', ...a]);
    return { ok: true, detail: { moved: 4, kept: [] } };
  },
  probeSources: async () => ({ 'a.mp4': 8 }),
  deselect: () => {},
  ...extra,
});

async function frame(sel: Record<string, unknown>) {
  if (!seated.length) {
    const music = await import('../client/v2/inspector/kinds/music.jsx');
    const { stashSlots } = await import('../client/v2/inspector/slots.js');
    restoreSlots = stashSlots();
    seated.push(music.registerMusicSlots());
  }
  const { loadCompMedia } = await import('../client/v2/timeline/lanes/music-media.js');
  await loadCompMedia(CANVAS, 'reel');
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const { timelineSelectionElement } = await import('../client/v2/timeline/selection.js');
  calls.length = 0;
  return mount(
    h(InspectorFrame, {
      selected: timelineSelectionElement(sel as never),
      layersTree: null,
      cfg: { designRel: '.design' },
      canvasFile: CANVAS,
      onOptimistic: () => {},
      onRecordEdit: () => {},
      onReplaceMedia: () => {},
      onUndoRedo: () => {},
    } as never)
  );
}
const openAdvanced = async (host: HTMLElement) => {
  const toggle = q(host, 'fold-inspector-toggle');
  if (toggle?.getAttribute('aria-expanded') !== 'true') await click(toggle, 'the Advanced fold');
};
const lastToasts: string[] = [];

describe('a song on the Music track (07 ve-music)', () => {
  test('the chip says Music, then Volume · Lower under speech · Snap to the beat · Song · Cut to the beat', async () => {
    const host = await frame(selection({ changeSong: () => calls.push(['change']) }));
    expect(q(host, 'inspector-kind')?.textContent).toBe('Music');
    expect(q(host, 'inspector-title')?.textContent).toBe('Hype instrumental');
    expect(rowsOf(host, 'music')).toEqual([
      'music-volume = Volume',
      'music-duck = Lower under speech',
      'music-snap = Snap to the beat',
      'music-song = Song',
      'music-cut-to-beat = Cut to the beat',
    ]);
    const vol = q(host, 'insp-music-volume')?.querySelector(
      'input:not([type="range"])'
    ) as HTMLInputElement;
    expect(vol.value).toBe('80');
    expect(chk(host, 'insp-music-duck').checked).toBe(true);
    expect(chk(host, 'insp-music-snap').checked).toBe(true);
    expect(q(host, 'insp-music-change')?.textContent).toBe('Change…');
  });

  test('Volume writes video.music.volume; Lower under speech writes video.music.duck (off unwraps)', async () => {
    const host = await frame(selection());
    const input = q(host, 'insp-music-volume')?.querySelector(
      'input:not([type="range"])'
    ) as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.value = '50';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      input.blur();
    });
    await settle();
    expect(calls).toEqual([['op', 'music.volume', { volume: 0.5 }]]);
    await click(q(host, 'insp-music-duck')?.querySelector('input') ?? null, 'the duck switch');
    expect(calls[1]).toEqual(['op', 'music.duck', { off: true }]);
  });

  test('a bed with no <Duck> shows the switch off and turns it on with the defaults', async () => {
    (media.music as Array<{ duck: unknown }>)[0].duck = null;
    const host = await frame(selection());
    const sw = q(host, 'insp-music-duck')?.querySelector('input') as HTMLInputElement;
    expect(sw.checked).toBe(false);
    await click(sw);
    expect(calls).toEqual([['op', 'music.duck', {}]]);
  });

  test('Snap to the beat writes artboardMeta.snap through the meta route (off, then back on)', async () => {
    const host = await frame(selection());
    await click(q(host, 'insp-music-snap')?.querySelector('input') ?? null, 'the snap switch');
    const patch = reqs.find((r) => r.url === '/_api/present-meta');
    expect(patch?.method).toBe('PATCH');
    expect(patch?.body).toEqual({ file: CANVAS, snap: { reel: 'off' } });
    expect(chk(host, 'insp-music-snap').checked).toBe(false);
  });

  test('a song with no clear beat has no Snap switch and no Cut to the beat — it says why', async () => {
    (media.music as Array<{ grid: unknown }>)[0].grid = { ...GRID, tempoStrength: 0.05 };
    const host = await frame(selection());
    expect(q(host, 'insp-music-snap')).toBeNull();
    expect(q(host, 'insp-music-snap-off')?.textContent).toBe('No clear beat in this song.');
    expect(q(host, 'insp-music-cut-to-beat')).toBeNull();
  });

  test('Cut to the beat sends the beats and the source lengths, quietly, and keeps the length', async () => {
    const host = await frame(selection());
    await click(q(host, 'insp-music-cut-to-beat'));
    expect(calls).toEqual([
      [
        'op',
        'cut-to-beat',
        { beats: GRID.beats, every: 1, sources: { 'a.mp4': 8 } },
        { quiet: true },
      ],
    ]);
  });

  test('a song with no beat sidecar yet offers Find the beat, and it posts the analysis for that song', async () => {
    (media.music as Array<{ grid: unknown }>)[0].grid = null;
    const host = await frame(selection());
    expect(rowsOf(host, 'music')).toContain('music-beat = Beat');
    // the sidecar appears once the analysis ran
    const m = media.music as Array<{ grid: unknown }>;
    const after = { ...GRID };
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url) === '/_api/media-analysis') m[0].grid = after;
      return real(url, init);
    }) as typeof fetch;
    await click(q(host, 'insp-music-find'));
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    globalThis.fetch = real;
    const post = reqs.find((r) => r.url === '/_api/media-analysis');
    expect(post?.method).toBe('POST');
    expect(post?.body).toEqual({ asset: 'assets/Hype-instrumental.mp3', kind: 'beats' });
  });

  test('Advanced: bpm 120 (detected) with Half · Double, duck −12 dB · 200 ms, gainDb −2', async () => {
    const host = await frame(selection());
    await openAdvanced(host);
    expect(q(host, 'insp-adv-music-bpm')?.textContent).toContain('120 (detected)');
    expect(q(host, 'insp-adv-music-duck')?.textContent).toContain('−12 dB · 200 ms');
    expect(q(host, 'insp-adv-music-gain')?.textContent).toContain('−2');
    expect(q(host, 'insp-music-half')?.textContent).toBe('Half');
    expect(q(host, 'insp-music-double')?.textContent).toBe('Double');
    // a loose bed has no length of its own to type
    expect(q(host, 'insp-adv-music-bed')).not.toBeNull();
  });

  test('Half re-tracks at 60: the posted bpm, then the lane shows "60 (set)"', async () => {
    const host = await frame(selection());
    await openAdvanced(host);
    await click(q(host, 'insp-music-half'));
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    const post = reqs.find((r) => r.url === '/_api/media-analysis');
    expect(post?.body).toEqual({ asset: 'assets/Hype-instrumental.mp3', kind: 'beats', bpm: 60 });
    expect(q(host, 'insp-adv-music-bpm')?.textContent).toContain('60 (set)');
  });

  test('a song that is a clip of its own (not a bed) has its length and speed under Advanced', async () => {
    const host = await frame(selection({ loose: false, stableId: 'name:vo' }));
    await openAdvanced(host);
    expect(q(host, 'insp-adv-music-clip')).not.toBeNull();
    expect(q(host, 'insp-clip-length')).not.toBeNull();
    expect(q(host, 'insp-clip-speed')).not.toBeNull();
  });
});

describe('Find the beat (video.music.beats)', () => {
  test('a refusal is said in words and leaves the song as it was', async () => {
    const { findBeats } = await import('../client/v2/timeline/lanes/music-media.js');
    analysisStatus = 403;
    const r = await findBeats({ canvas: CANVAS, artboardId: 'reel', src: 'assets/x.mp3' });
    expect(r).toEqual({ ok: false, message: 'Your role can’t find the beat.' });
    analysisStatus = 404; // an older studio has no such route
    const r2 = await findBeats({ canvas: CANVAS, artboardId: 'reel', src: 'assets/x.mp3' });
    expect(r2.ok).toBe(false);
    expect(r2.message).toBe('Couldn’t find the beat. The song stays as it is.');
  });

  test('it waits for the sidecar to show up in the comp’s media, then reports ok', async () => {
    const { findBeats, isFinding } = await import('../client/v2/timeline/lanes/music-media.js');
    (media.music as Array<{ grid: unknown }>)[0].grid = null;
    let waits = 0;
    const done = findBeats({
      canvas: CANVAS,
      artboardId: 'reel',
      src: 'assets/Hype-instrumental.mp3',
      wait: async () => {
        waits += 1;
        if (waits === 2) (media.music as Array<{ grid: unknown }>)[0].grid = { ...GRID };
      },
    });
    expect(isFinding(CANVAS, 'assets/Hype-instrumental.mp3')).toBe(true);
    expect(await done).toEqual({ ok: true, message: '' });
    expect(waits).toBe(2);
    expect(isFinding(CANVAS, 'assets/Hype-instrumental.mp3')).toBe(false);
  });

  test('if the beat never turns up it gives up after its tries, in words', async () => {
    const { findBeats } = await import('../client/v2/timeline/lanes/music-media.js');
    (media.music as Array<{ grid: unknown }>)[0].grid = null;
    const r = await findBeats({
      canvas: CANVAS,
      artboardId: 'reel',
      src: 'assets/Hype-instrumental.mp3',
      tries: 3,
      wait: async () => {},
    });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Couldn’t find the beat. The song stays as it is.');
  });
});

describe('the lane: ticks, the tempo, the dip', () => {
  const info = () => ({
    ...(fresh().music[0] as Record<string, unknown>),
    grid: { ...GRID, bars: [0, 60] },
  });
  async function overlay(props: Record<string, unknown>) {
    const { MusicLaneOverlay } = await import('../client/v2/timeline/lanes/music-lane.jsx');
    return mount(
      h(MusicLaneOverlay as never, {
        x: (f: number) => f * 2,
        speech: [[60, 120]],
        fps: 30,
        ...props,
      })
    );
  }
  const segs = (d: string | null | undefined) => (d?.match(/M/g) ?? []).length;

  test('a tick on every beat, a tall one on each bar, "120 BPM" on the clip', async () => {
    const host = await overlay({ info: info() });
    expect(segs(q(host, 'timeline-beat-ticks')?.getAttribute('d'))).toBe(4); // beats that are not bars
    expect(segs(q(host, 'timeline-bar-ticks')?.getAttribute('d'))).toBe(2);
    expect(q(host, 'timeline-music-bpm')?.textContent).toBe('120 BPM');
  });

  test('Q8: below bar confidence 0.4 every tick is the same — no tall ones', async () => {
    const host = await overlay({
      info: { ...info(), grid: { ...GRID, barConfidence: 0.3, bars: [] } },
    });
    expect(q(host, 'timeline-bar-ticks')).toBeNull();
    expect(segs(q(host, 'timeline-beat-ticks')?.getAttribute('d'))).toBe(6);
  });

  test('a song in a <Duck> draws the volume line dipping under speech, labelled "Lower under speech"', async () => {
    const host = await overlay({ info: info() });
    const pts = (q(host, 'timeline-duck-line')?.getAttribute('points') ?? '').split(' ');
    expect(pts.length).toBe(6);
    expect(q(host, 'timeline-duck-label')?.textContent).toBe('Lower under speech');
    // the line is at the top at full volume and 15 units lower in the dip (y = 3 + depth·15)
    expect(pts[0]?.endsWith(',3')).toBe(true);
    expect(pts[2]?.endsWith(',18')).toBe(true);
  });

  test('no <Duck>, no line; no clear beat, no tempo; a song being listened to says so', async () => {
    const plain = await overlay({ info: { ...info(), duck: null } });
    expect(q(plain, 'timeline-duck-line')).toBeNull();
    expect(q(plain, 'timeline-duck-label')).toBeNull();
    const weak = await overlay({ info: { ...info(), grid: { ...GRID, tempoStrength: 0.05 } } });
    expect(q(weak, 'timeline-music-bpm')).toBeNull();
    const none = await overlay({ info: { ...info(), grid: null }, finding: true });
    expect(q(none, 'timeline-beat-ticks')).toBeNull();
    expect(q(none, 'timeline-music-finding')?.textContent).toBe('Finding the beat…');
  });

  test('nothing is drawn for a row that is not a song of the media', async () => {
    const host = await overlay({ info: null });
    expect(host.querySelector('.tl-music-ov')).toBeNull();
  });
});

void lastToasts;
