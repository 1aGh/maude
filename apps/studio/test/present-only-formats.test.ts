// S7.19 (07 ve-fullscreen, S7-slices Q11) — Present with a video selected plays that video and the formats that share
// its cut, and nothing else: the Present spec gains `only: 'formats'`, the stage's run is limited to the deck, the shell
// draws a format switch + the transport, and switching a format keeps the loop. The stage runs on a manual clock.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { presentSpec } from '../bridge/canvas-modes.ts';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import type { ArtboardRect } from '../canvas-lib.tsx';
import { VideoPresent } from '../client/v2/present/video-present.jsx';
import {
  carryOver,
  compOf,
  formatName,
  formatSwitch,
  loopTicks,
  seekMessage,
  seekSeconds,
  stepIndexOf,
} from '../client/v2/present/video-present-model.js';
import { presentSpecFor } from '../client/v2/shell/canvas-mode.js';
import { formatIdsOf, onlyIds, presentRun } from '../present/order.ts';
import { CAPTIONS_ATTR, createPresentMedia } from '../present/present-media.ts';
import { createPresentStage, LIFT_MS, type StageDeps } from '../present/present-stage.tsx';

// a row of three formats of one cut, then an unlinked copy and a web page below
const BOARDS: ArtboardRect[] = [
  { id: 'reels', x: 0, y: 0, w: 1080, h: 1920, kind: 'video' },
  { id: 'wide', x: 1300, y: 0, w: 1920, h: 1080, kind: 'video' },
  { id: 'square', x: 3500, y: 0, w: 1080, h: 1080, kind: 'video' },
  { id: 'copy', x: 0, y: 2300, w: 1920, h: 1080, kind: 'video' },
  { id: 'home', x: 2300, y: 2300, w: 1440, h: 900, kind: 'web' },
];
const COMPS = [
  { id: 'reels', comp: 'Recap' },
  { id: 'wide', comp: 'Recap' },
  { id: 'square', comp: 'Recap' },
  { id: 'copy', comp: 'RecapUnlinked' },
];

describe('the Present spec', () => {
  test('`only: formats` rides an artboard `from`; it needs one and is dropped otherwise', () => {
    expect(presentSpec({ kind: 'artboards', from: 'wide', only: 'formats' })).toEqual({
      kind: 'artboards',
      from: 'wide',
      only: 'formats',
    });
    expect(presentSpec({ kind: 'artboards', from: 'start', only: 'formats' })).toEqual({
      kind: 'artboards',
      from: 'start',
    });
    expect(presentSpec({ kind: 'artboards', from: 'wide', only: 'everything' })).toEqual({
      kind: 'artboards',
      from: 'wide',
    });
    expect(presentSpec({ kind: 'canvas', only: 'formats' })).toEqual({ kind: 'canvas' });
  });

  test('a SELECTED video presents its formats; an artboard in view, or a selected non-video, presents the canvas', () => {
    expect(presentSpecFor('selection', { selectedArtboard: 'wide', selectedVideo: true })).toEqual({
      kind: 'artboards',
      from: 'wide',
      only: 'formats',
    });
    expect(presentSpecFor('selection', { selectedArtboard: 'home', selectedVideo: false })).toEqual(
      {
        kind: 'artboards',
        from: 'home',
      }
    );
    expect(presentSpecFor('selection', { inViewArtboard: 'wide', selectedVideo: true })).toEqual({
      kind: 'artboards',
      from: 'wide',
    });
    expect(presentSpecFor('start', { selectedArtboard: 'wide', selectedVideo: true })).toEqual({
      kind: 'artboards',
      from: 'start',
    });
  });

  test('the dgn table carries `only` to the canvas and the transport takes the captions ops', () => {
    const setMode = DGN_TABLE.s2c['set-mode' as keyof typeof DGN_TABLE.s2c] as unknown as {
      parse(raw: unknown): Record<string, any> | null;
    };
    const m = setMode.parse({
      v: 2,
      seq: 1,
      mode: 'present',
      present: { kind: 'artboards', from: 'wide', only: 'formats' },
      caps: { edit: true, annotate: true, comment: true },
    });
    expect(m?.present).toEqual({ kind: 'artboards', from: 'wide', only: 'formats' });
    const cmd = DGN_TABLE.s2c['present-media-cmd' as keyof typeof DGN_TABLE.s2c] as unknown as {
      parse(raw: unknown): Record<string, unknown> | null;
    };
    for (const op of ['play', 'pause', 'mute', 'unmute', 'captions-on', 'captions-off'])
      expect(cmd.parse({ op })).toEqual({ op });
    expect(cmd.parse({ op: 'seek' })).toBeNull();
  });
});

describe('the deck: the formats that share a cut', () => {
  test('artboards mounting one comp are the deck of each of them; a lone video is a deck of one', () => {
    expect(formatIdsOf(COMPS, 'wide')).toEqual(['reels', 'wide', 'square']);
    expect(formatIdsOf(COMPS, 'copy')).toEqual(['copy']);
    expect(formatIdsOf(COMPS, 'home')).toBeNull();
  });

  test('the run keeps only the deck, in the run’s own order; an empty deck leaves it whole', () => {
    const run = presentRun(BOARDS, undefined);
    expect(run.run).toEqual(['reels', 'wide', 'square', 'copy', 'home']);
    expect(onlyIds(run, ['square', 'reels', 'wide']).run).toEqual(['reels', 'wide', 'square']);
    expect(onlyIds(run, null)).toBe(run);
    expect(onlyIds(run, ['gone'])).toBe(run);
  });
});

// ── the stage ────────────────────────────────────────────────────────────────────────────────────

function rig() {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1600 });
  Object.defineProperty(host, 'clientHeight', { value: 900 });
  const world = document.createElement('div');
  host.appendChild(world);
  for (const b of BOARDS) {
    const a = document.createElement('article');
    a.setAttribute('data-dc-screen', b.id);
    world.appendChild(a);
  }
  document.body.appendChild(host);
  let clock = 0;
  let nextId = 1;
  const frames = new Map<number, (t: number) => void>();
  let cam = { x: 0, y: 0, zoom: 0.3 };
  const deps: StageDeps = {
    win: window,
    getHost: () => host,
    getWorld: () => world,
    getArtboards: () => BOARDS,
    getCamera: () => ({ ...cam }),
    setCamera: (c) => {
      cam = { ...c };
    },
    getSelection: () => null,
    readMeta: () => undefined,
    raf: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    caf: (id) => {
      frames.delete(id);
    },
    now: () => clock,
    reducedMotion: () => false,
    liftMs: () => LIFT_MS,
    formatIds: (id) => formatIdsOf(COMPS, id),
  };
  const stage = createPresentStage(deps);
  return {
    host,
    stage,
    advance(ms: number) {
      clock += ms;
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(clock);
    },
  };
}

let rg: ReturnType<typeof rig> | null = null;
afterEach(() => {
  rg?.stage.dispose();
  rg?.host.remove();
  rg = null;
});

describe('Present · Artboards with only: formats', () => {
  test('from the 16:9 the deck is the 3 formats: 2 / 3, › goes to the 1:1, and there it stops', () => {
    rg = rig();
    rg.stage.start('wide', 'formats');
    expect(rg.stage.state()).toMatchObject({
      active: true,
      index: 1,
      total: 3,
      artboardId: 'wide',
    });
    expect(rg.stage.deck()).toEqual(['reels', 'wide', 'square']);
    rg.stage.step('next');
    expect(rg.stage.state()).toMatchObject({ index: 2, artboardId: 'square' });
    rg.stage.step('next');
    expect(rg.stage.state()).toMatchObject({ index: 2, artboardId: 'square' }); // the copy is not in the deck
    rg.stage.step(0);
    expect(rg.stage.state()).toMatchObject({ index: 0, artboardId: 'reels' });
  });

  test('without it the same Present walks every artboard', () => {
    rg = rig();
    rg.stage.start('wide');
    expect(rg.stage.state()).toMatchObject({ index: 1, total: 5 });
    expect(rg.stage.deck()).toBeNull();
  });

  test('a video with no linked format is a deck of one; the deck is forgotten when Present ends', () => {
    rg = rig();
    rg.stage.start('copy', 'formats');
    expect(rg.stage.state()).toMatchObject({ index: 0, total: 1, artboardId: 'copy' });
    rg.stage.stop();
    expect(rg.stage.deck()).toBeNull();
    rg.advance(400);
    rg.stage.start('copy');
    expect(rg.stage.state().total).toBe(5);
  });
});

describe('the captions toggle (presentation only)', () => {
  test('captions-off hides the comp’s captions with one attribute; stop() puts them back', () => {
    const media = createPresentMedia({
      win: window,
      clips: () => [],
      post: () => {},
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (h) => window.clearTimeout(h),
    });
    media.command('captions-off');
    expect(document.documentElement.getAttribute(CAPTIONS_ATTR)).toBe('off');
    expect(document.getElementById('maude-present-captions-css')?.textContent).toContain(
      '[data-maude-captions]'
    );
    media.command('captions-on');
    expect(document.documentElement.hasAttribute(CAPTIONS_ATTR)).toBe(false);
    media.command('captions-off');
    media.stop();
    expect(document.documentElement.hasAttribute(CAPTIONS_ATTR)).toBe(false);
  });
});

// ── the shell half ───────────────────────────────────────────────────────────────────────────────

describe('video-present-model', () => {
  const cells = [
    { id: 'reels', label: 'Recap · Reels', w: 1080, h: 1920 },
    { id: 'wide', label: 'Recap · 16:9', w: 1920, h: 1080 },
    { id: 'square', label: 'Recap · 1:1', w: 1080, h: 1080 },
  ];
  test('the formats are named by their shape: Reels 9:16 · 16:9 · 1:1', () => {
    expect(cells.map(formatName)).toEqual(['Reels 9:16', '16:9', '1:1']);
    expect(formatName({ id: 'odd', label: 'Banner', w: 970, h: 250 })).toBe('Banner');
  });
  test('the switch lists the deck with the current one marked, and is absent for a deck of one', () => {
    expect(formatSwitch(cells, 'wide')).toEqual([
      { id: 'reels', name: 'Reels 9:16', current: false },
      { id: 'wide', name: '16:9', current: true },
      { id: 'square', name: '1:1', current: false },
    ]);
    expect(formatSwitch(cells.slice(0, 1), 'reels')).toEqual([]);
    expect(stepIndexOf(cells, 'square')).toBe(2);
    expect(stepIndexOf(cells, 'nope')).toBe(-1);
  });
  test('the loop ticks are where the cut’s picture clips begin', () => {
    const clips = [
      { track: 'video', from: 0 },
      { track: 'video', from: 90 },
      { track: 'music', from: 45 },
      { track: 'video2', from: 270 },
    ];
    expect(loopTicks(clips, 30, 15)).toEqual([0.2, 0.6]);
    expect(loopTicks([], 30, 15)).toEqual([]);
    expect(loopTicks(clips, 30, 0)).toEqual([]);
  });
  test('seek and carry-over speak the Timeline’s own messages, to the comp on the presented artboard', () => {
    const comp = compOf([{ id: 'c-wide', artboardId: 'wide', fps: 24 }], 'wide');
    expect(comp).toEqual({ id: 'c-wide', fps: 24 });
    expect(compOf([], 'wide')).toBeNull();
    expect(seekMessage(comp, 2.5)).toEqual({ dgn: 'timeline-seek', frame: 60, id: 'c-wide' });
    expect(seekMessage(null, 2)).toBeNull();
    expect(seekSeconds(0.5, 15)).toBe(7.5);
    expect(seekSeconds(2, 15)).toBe(15);
    expect(seekSeconds(0.5, 0)).toBeNull();
    // the loop comes along to the next format
    expect(carryOver(comp, { loop: true, volume: 0.4 })).toEqual([
      { dgn: 'timeline-loop', loop: true, id: 'c-wide' },
      { dgn: 'timeline-volume', volume: 0.4, id: 'c-wide' },
    ]);
    expect(carryOver(null, { loop: true, volume: 1 })).toEqual([]);
  });
});

describe('<VideoPresent>', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });
  function mount(props: Record<string, unknown>) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(createElement(VideoPresent, props as never)));
    return host;
  }
  const FORMATS = formatSwitch(
    [
      { id: 'reels', label: 'R', w: 1080, h: 1920 },
      { id: 'wide', label: 'W', w: 1920, h: 1080 },
    ],
    'reels'
  );
  const MEDIA = { playing: true, t: 10, duration: 15, muted: false };

  test('the switch, "esc Back to the canvas", the transport — and the words', () => {
    const calls: unknown[] = [];
    const el = mount({
      formats: FORMATS,
      media: MEDIA,
      ticks: [0.2, 0.6],
      loop: true,
      onFormat: (id: string) => calls.push(['format', id]),
      onLoop: (v: boolean) => calls.push(['loop', v]),
      onCaptions: (v: boolean) => calls.push(['captions', v]),
      onToggle: (op: string) => calls.push(['op', op]),
      onLeave: () => calls.push('leave'),
    });
    const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    expect(q('video-present-leave').textContent).toContain('Back to the canvas');
    expect(q('video-present-format-reels').getAttribute('aria-checked')).toBe('true');
    expect(q('video-present-time').textContent).toBe('0:10 / 0:15');
    expect(el.querySelectorAll('[data-testid="video-present-tick"]')).toHaveLength(2);
    expect(q('video-present-loop').getAttribute('aria-pressed')).toBe('true');
    act(() => q('video-present-format-wide').click());
    act(() => q('video-present-loop').click());
    act(() => q('video-present-captions').click());
    act(() => q('video-present-toggle').click());
    act(() => q('video-present-leave').click());
    expect(calls).toEqual([
      ['format', 'wide'],
      ['loop', false],
      ['captions', false],
      ['op', 'pause'],
      'leave',
    ]);
  });

  test('a deck of one has no switch; before the clip reports there is no bar', () => {
    const el = mount({ formats: [], media: null });
    expect(el.querySelector('[data-testid="video-present-formats"]')).toBeNull();
    expect(el.querySelector('[data-testid="video-present-bar"]')).toBeNull();
    expect(el.querySelector('[data-testid="video-present-leave"]')).not.toBeNull();
  });
});
