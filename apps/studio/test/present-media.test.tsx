// S3.3 (md-present-video · md-edge-mixed) — the Present stage plays a video-comp where it stands, and
// every kind fills the screen its own way.
//   · a 9:16 reel starts WITH SOUND when its turn comes (pillarboxed); a blocked sound falls back to muted
//   · a click on the video pauses it (and plays it again); → or space moves on mid-clip — nothing waits
//   · a 16:9 video holds its last frame when it ends; the shell hears playing / t / duration / muted
//   · the shell's present-media-cmd (transport, presenter view's `mute`) drives the clip
//   · a web artboard scrolls with the trackpad inside the stage — never the canvas camera
//   · one fit per kind (web · digital · video · print); the two new dgn rows parse and strip junk
// The engine and the stage run on a manual clock with a fake Player; the last describe mounts
// `usePresentStage` for real, LAST: the mode store turns governed for good on its first set-mode.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import type { ArtboardRect } from '../canvas-lib.tsx';
import { cameraFor, fitForKind, scrolled } from '../present/fit.ts';
import {
  type ClipRef,
  createPresentMedia,
  type PlayerLike,
  type PresentMedia,
} from '../present/present-media.ts';
import {
  type Camera,
  createPresentStage,
  LIFT_MS,
  type PresentStage,
  type StageDeps,
  usePresentStage,
} from '../present/present-stage.tsx';
import { loopFor } from '../video-comp.tsx';

// ── a fake Remotion Player ───────────────────────────────────────────────────────────────────────

class FakePlayer implements PlayerLike {
  playing = false;
  muted = false;
  frame = 0;
  calls: string[] = [];
  /** A browser that refuses sound without a gesture: play() throws while unmuted. */
  blockSound = false;
  private on = new Map<string, Set<() => void>>();
  constructor(
    readonly fps = 30,
    readonly dur = 450
  ) {}
  emit(ev: string) {
    for (const f of [...(this.on.get(ev) ?? [])]) f();
  }
  addEventListener(ev: string, f: () => void) {
    if (!this.on.has(ev)) this.on.set(ev, new Set());
    this.on.get(ev)?.add(f);
  }
  removeEventListener(ev: string, f: () => void) {
    this.on.get(ev)?.delete(f);
  }
  listeners() {
    return [...this.on.values()].reduce((n, s) => n + s.size, 0);
  }
  play() {
    this.calls.push('play');
    if (this.blockSound && !this.muted) throw new Error('NotAllowedError');
    this.playing = true;
    this.emit('play');
  }
  pause() {
    this.calls.push('pause');
    this.playing = false;
    this.emit('pause');
  }
  seekTo(f: number) {
    this.calls.push(`seek:${f}`);
    this.frame = f;
    this.emit('seeked');
  }
  isPlaying() {
    return this.playing;
  }
  getCurrentFrame() {
    return this.frame;
  }
  mute() {
    this.calls.push('mute');
    this.muted = true;
    this.emit('volumechange');
  }
  unmute() {
    this.calls.push('unmute');
    this.muted = false;
    this.emit('volumechange');
  }
  isMuted() {
    return this.muted;
  }
  /** The clip plays `n` frames. */
  advance(n: number) {
    this.frame = Math.min(this.dur - 1, this.frame + n);
    this.emit('timeupdate');
  }
  /** It reaches its end: Remotion pauses on the last frame and says `ended`. */
  finish() {
    this.frame = this.dur - 1;
    this.playing = false;
    this.emit('ended');
    this.emit('pause');
  }
}

const clipOf = (artboardId: string, p: FakePlayer): ClipRef => ({
  artboardId,
  fps: p.fps,
  durationInFrames: p.dur,
  ref: { current: p },
});

type Msg = Record<string, unknown>;
const media = (posts: Msg[]) => posts.filter((p) => p.dgn === 'present-media');

describe('the loop a Player gets (the 16:9 video holds its last frame)', () => {
  test('Present · Artboards plays once, whatever the author asked; elsewhere the loop is theirs', () => {
    expect(loopFor(true, true)).toBe(false);
    expect(loopFor(false, true)).toBe(false);
    expect(loopFor(true, false)).toBe(true);
    expect(loopFor(false, false)).toBe(false);
  });
});

// ── the media engine ─────────────────────────────────────────────────────────────────────────────

describe('createPresentMedia — a clip plays where it stands', () => {
  let posts: Msg[];
  let timers: Array<{ ms: number; fn: () => void; live: boolean }>;
  let reel: FakePlayer;
  let wide: FakePlayer;
  let eng: PresentMedia;
  beforeEach(() => {
    posts = [];
    timers = [];
    reel = new FakePlayer(30, 450); // 15 s
    wide = new FakePlayer(30, 300); // 10 s
    eng = createPresentMedia({
      clips: () => [clipOf('reel', reel), clipOf('wide', wide)],
      post: (m) => posts.push(m),
      setTimer: (fn, ms) => {
        const t = { ms, fn, live: true };
        timers.push(t);
        return t as unknown as number;
      },
      clearTimer: (h) => {
        (h as unknown as { live: boolean }).live = false;
      },
    });
  });
  afterEach(() => eng.stop());

  const fire = () => {
    for (const t of timers.splice(0)) if (t.live) t.fn();
  };

  test('arriving on the reel plays it from the start, with sound, and says so', () => {
    reel.frame = 200;
    reel.muted = true; // the Timeline had it muted
    eng.arrive('reel');
    expect(reel.calls).toEqual(['seek:0', 'unmute', 'play']);
    expect(reel.playing).toBe(true);
    expect(reel.muted).toBe(false);
    expect(media(posts).at(-1)).toEqual({
      dgn: 'present-media',
      playing: true,
      t: 0,
      duration: 15,
      muted: false,
    });
  });

  test('an artboard with no clip plays nothing and says nothing', () => {
    eng.arrive('post');
    expect(reel.calls).toEqual([]);
    expect(media(posts)).toEqual([]);
    expect(eng.hasClip('post')).toBe(false);
    expect(eng.hasClip('reel')).toBe(true);
  });

  test('sound refused: it plays muted instead and the shell hears muted: true', () => {
    reel.blockSound = true;
    eng.arrive('reel');
    expect(reel.playing).toBe(true);
    expect(reel.muted).toBe(true);
    expect(media(posts).at(-1)).toMatchObject({ playing: true, muted: true });
  });

  test('sound that silently does not start is retried muted once', () => {
    // a Player that swallows the refusal: play() "works" but nothing plays
    reel.play = () => {
      reel.calls.push('play');
    };
    eng.arrive('reel');
    expect(reel.playing).toBe(false);
    reel.play = FakePlayer.prototype.play.bind(reel);
    fire(); // the check after the first play
    expect(reel.muted).toBe(true);
    expect(reel.playing).toBe(true);
  });

  test('the shell hears the time as it plays, and a pause, in seconds', () => {
    eng.arrive('reel');
    reel.advance(180); // 6 s
    expect(media(posts).at(-1)).toMatchObject({ playing: true, t: 6, duration: 15 });
    reel.pause();
    expect(media(posts).at(-1)).toMatchObject({ playing: false, t: 6 });
    // identical states are not repeated
    const n = media(posts).length;
    reel.emit('timeupdate');
    expect(media(posts).length).toBe(n);
  });

  test('a click pauses the playing clip, and plays it again', () => {
    eng.arrive('reel');
    reel.advance(60);
    expect(eng.click()).toBe(true);
    expect(reel.playing).toBe(false);
    expect(eng.click()).toBe(true);
    expect(reel.playing).toBe(true);
    expect(reel.frame).toBe(60); // from where it stopped
  });

  test('a click on an artboard with no clip is not handled (the stage moves on)', () => {
    eng.arrive('post');
    expect(eng.click()).toBe(false);
  });

  test('the 16:9 video holds its last frame when it ends; nothing seeks it back', () => {
    eng.arrive('wide');
    wide.finish();
    expect(wide.frame).toBe(299);
    expect(wide.calls.filter((c) => c.startsWith('seek'))).toEqual(['seek:0']); // only the arrival
    expect(media(posts).at(-1)).toEqual({
      dgn: 'present-media',
      playing: false,
      t: 10,
      duration: 10,
      muted: false,
    });
  });

  test('a click on an ended clip plays it again from the start', () => {
    eng.arrive('wide');
    wide.finish();
    expect(eng.click()).toBe(true);
    expect(wide.calls.at(-2)).toBe('seek:0');
    expect(wide.playing).toBe(true);
  });

  test('leaving pauses the clip and drops its listeners — no stale echo reaches the shell', () => {
    eng.arrive('reel');
    reel.advance(30);
    const n = media(posts).length;
    eng.leave();
    expect(reel.playing).toBe(false);
    expect(reel.listeners()).toBe(0);
    reel.advance(30);
    expect(media(posts).length).toBe(n);
  });

  test('the shell’s commands: pause · play · mute · unmute (presenter view mutes the Mac)', () => {
    eng.arrive('reel');
    eng.command('pause');
    expect(reel.playing).toBe(false);
    eng.command('play');
    expect(reel.playing).toBe(true);
    eng.command('mute');
    expect(reel.muted).toBe(true);
    expect(media(posts).at(-1)).toMatchObject({ muted: true });
    eng.command('unmute');
    expect(reel.muted).toBe(false);
  });

  test('a mute the presenter asked for survives the next arrival; stopping puts the clip back', () => {
    reel.frame = 77;
    eng.arrive('reel');
    eng.command('mute');
    eng.leave();
    eng.arrive('reel');
    expect(reel.muted).toBe(true);
    eng.stop();
    // as the editor left it: paused, its frame, its sound
    expect(reel.playing).toBe(false);
    expect(reel.frame).toBe(77);
    expect(reel.muted).toBe(false);
    expect(reel.listeners()).toBe(0);
  });

  test('nothing but the presented clip makes sound: another playing comp is stopped', () => {
    wide.playing = true; // an autoPlay comp elsewhere on the canvas
    eng.arrive('reel');
    expect(wide.playing).toBe(false);
    expect(reel.playing).toBe(true);
    wide.playing = true;
    eng.arrive('post'); // an artboard with no clip silences them too
    expect(wide.playing).toBe(false);
    expect(reel.playing).toBe(false);
  });

  test('a command with nothing playing is a no-op', () => {
    eng.arrive('post');
    eng.command('play');
    expect(reel.calls).toEqual([]);
  });

  test('a Player that is not mounted yet is retried a few times, then given up', () => {
    const late = new FakePlayer();
    const slot: { current: PlayerLike | null } = { current: null };
    const e2 = createPresentMedia({
      clips: () => [{ artboardId: 'reel', fps: 30, durationInFrames: 450, ref: slot }],
      post: (m) => posts.push(m),
      setTimer: (fn, ms) => {
        const t = { ms, fn, live: true };
        timers.push(t);
        return t as unknown as number;
      },
      clearTimer: (h) => {
        (h as unknown as { live: boolean }).live = false;
      },
    });
    e2.arrive('reel');
    expect(late.calls).toEqual([]);
    slot.current = late;
    fire();
    expect(late.playing).toBe(true);
    e2.stop();
  });
});

// ── the stage with a clip ────────────────────────────────────────────────────────────────────────

const STAGE_W = 1600;
const STAGE_H = 900;
const BOARDS: ArtboardRect[] = [
  { id: 'post', x: 0, y: 0, w: 1080, h: 1080, kind: 'digital' },
  { id: 'reel', x: 1300, y: 0, w: 1080, h: 1920, kind: 'video' },
  { id: 'wide', x: 2600, y: 0, w: 1920, h: 1080, kind: 'video' },
  { id: 'home', x: 0, y: 2300, w: 1440, h: 3600, kind: 'web' },
];
const CAM: Camera = { x: 5, y: -7, zoom: 0.3 };

const posts: Msg[] = [];
const fakeParent = { postMessage: (m: Msg) => posts.push(m) };
let realParent: PropertyDescriptor | undefined;
beforeAll(() => {
  realParent = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
});
afterAll(() => {
  if (typeof window === 'undefined') return;
  if (realParent) Object.defineProperty(window, 'parent', realParent);
  else Reflect.deleteProperty(window, 'parent');
});
beforeEach(() => {
  posts.length = 0;
});

interface Rig {
  host: HTMLElement;
  world: HTMLElement;
  stage: PresentStage;
  engine: PresentMedia;
  reel: FakePlayer;
  wide: FakePlayer;
  cam: Camera;
  advance(ms: number): void;
  mask(): HTMLElement | null;
  press(key: string, init?: KeyboardEventInit): KeyboardEvent;
  click(): MouseEvent;
  wheel(deltaY: number, init?: WheelEventInit): WheelEvent;
}

function rig(): Rig {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: STAGE_W });
  Object.defineProperty(host, 'clientHeight', { value: STAGE_H });
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
  const reel = new FakePlayer(30, 450);
  const wide = new FakePlayer(30, 300);
  const engine = createPresentMedia({
    clips: () => [clipOf('reel', reel), clipOf('wide', wide)],
    post: (m) => posts.push(m),
    setTimer: () => 0,
    clearTimer: () => {},
  });
  const r = { host, world, cam: { ...CAM }, reel, wide, engine } as Rig;
  const deps: StageDeps = {
    win: window,
    getHost: () => host,
    getWorld: () => world,
    getArtboards: () => BOARDS,
    getCamera: () => ({ ...r.cam }),
    setCamera: (c) => {
      r.cam = { ...c };
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
    media: engine,
  };
  r.stage = createPresentStage(deps);
  r.advance = (ms) => {
    clock += ms;
    const due = [...frames.entries()];
    frames.clear();
    for (const [, cb] of due) cb(clock);
  };
  r.mask = () => host.querySelector('[data-maude-present-stage]');
  r.press = (key, init = {}) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    host.dispatchEvent(e);
    return e;
  };
  r.click = () => {
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    host.dispatchEvent(e);
    return e;
  };
  r.wheel = (deltaY, init = {}) => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ...init });
    // happy-dom's WheelEvent drops the modifier keys of its init: a pinch is a ctrl + wheel in a browser
    if (init.ctrlKey) Object.defineProperty(e, 'ctrlKey', { value: true });
    host.dispatchEvent(e);
    return e;
  };
  return r;
}

let rg: Rig | null = null;
afterEach(() => {
  rg?.stage.dispose();
  rg?.host.remove();
  rg = null;
});
const at = () => rg?.stage.state().artboardId;

describe('Present with a video: it plays where it stands (md-present-video)', () => {
  test('the reel starts with sound when its turn comes, and the shell hears it after the position', () => {
    rg = rig();
    rg.stage.start('reel');
    expect(rg.reel.playing).toBe(true);
    expect(rg.reel.muted).toBe(false);
    const order = posts.map((p) => p.dgn);
    expect(order.indexOf('present-position')).toBeLessThan(order.indexOf('present-media'));
    expect(media(posts).at(-1)).toMatchObject({ playing: true, duration: 15, muted: false });
  });

  test('it is pillarboxed, never cropped', () => {
    rg = rig();
    rg.stage.start('reel');
    rg.advance(400);
    const s = 900 / 1920;
    expect(rg.cam.zoom).toBeCloseTo(s, 9);
    expect(rg.cam.x).toBeCloseTo((1600 - 1080 * s) / 2 - 1300 * s, 6);
  });

  test('a click on the video pauses it and does not move on', () => {
    rg = rig();
    rg.stage.start('reel');
    const e = rg.click();
    expect(rg.reel.playing).toBe(false);
    expect(at()).toBe('reel');
    expect(e.defaultPrevented).toBe(true);
    rg.click();
    expect(rg.reel.playing).toBe(true);
  });

  test('→ moves on mid-clip: the clip stops, the next artboard has its turn', () => {
    rg = rig();
    rg.stage.start('reel');
    rg.reel.advance(90);
    rg.press('ArrowRight');
    expect(at()).toBe('wide');
    expect(rg.reel.playing).toBe(false);
    expect(rg.wide.playing).toBe(true); // the next clip starts at once
  });

  test('space moves on mid-clip, ⇧space goes back and replays the first from its start', () => {
    rg = rig();
    rg.stage.start('reel');
    rg.reel.advance(90);
    rg.press(' ', { code: 'Space' });
    expect(at()).toBe('wide');
    expect(rg.reel.playing).toBe(false);
    rg.press(' ', { code: 'Space', shiftKey: true });
    expect(at()).toBe('reel');
    expect(rg.reel.frame).toBe(0);
    expect(rg.reel.playing).toBe(true);
  });

  test('a click on an artboard with no clip still moves on', () => {
    rg = rig();
    rg.stage.start('post');
    rg.click();
    expect(at()).toBe('reel');
  });

  test('the shell hears nothing from the artboard it just left', () => {
    rg = rig();
    rg.stage.start('reel');
    rg.press('ArrowLeft');
    expect(at()).toBe('post');
    const n = media(posts).length;
    rg.reel.advance(30);
    expect(media(posts).length).toBe(n);
  });

  test('16:9 fills the stage and holds its last frame; → then moves on', () => {
    rg = rig();
    rg.stage.start('wide');
    rg.advance(400);
    expect(rg.cam.zoom).toBeCloseTo(1600 / 1920, 9);
    rg.wide.finish();
    expect(rg.wide.frame).toBe(299);
    expect(rg.stage.state().artboardId).toBe('wide');
    expect(media(posts).at(-1)).toMatchObject({ playing: false, t: 10, duration: 10 });
    rg.press('ArrowRight');
    expect(at()).toBe('home');
    expect(rg.wide.frame).toBe(299); // it was not rewound under the audience
  });

  test('leaving Present stops the clip and puts it back as the editor had it', () => {
    rg = rig();
    rg.reel.frame = 40;
    rg.stage.start('reel');
    rg.reel.advance(90);
    rg.stage.stop();
    expect(rg.reel.playing).toBe(false);
    expect(rg.reel.frame).toBe(40);
    expect(rg.reel.listeners()).toBe(0);
  });
});

describe('Present with a web artboard: the trackpad scrolls the page (md-edge-mixed)', () => {
  const FIT = fitForKind({
    kind: 'web',
    art: { w: 1440, h: 3600 },
    stage: { w: STAGE_W, h: STAGE_H },
    minScale: 0.02,
    maxScale: 4,
  });

  test('it fills the width and starts at the top', () => {
    rg = rig();
    rg.stage.start('home');
    rg.advance(400);
    expect(rg.cam).toEqual({
      x: FIT.place.x - 0,
      y: FIT.place.y - 2300 * FIT.scale,
      zoom: FIT.scale,
    });
    expect(FIT.maxScroll).toBeGreaterThan(0);
  });

  test('wheel scrolls the page by the artboard px under the finger, not the canvas camera', () => {
    rg = rig();
    rg.stage.start('home');
    rg.advance(400);
    const before = { ...rg.cam };
    const e = rg.wheel(120);
    expect(e.defaultPrevented).toBe(true);
    expect(rg.cam.zoom).toBe(before.zoom);
    expect(rg.cam.x).toBe(before.x);
    // 120 screen px down = 120 / scale artboard px; the page moves up by exactly 120 screen px
    expect(rg.cam.y).toBeCloseTo(before.y - 120, 6);
    // the mask window follows: it shows the part now in view
    const m = rg.mask();
    expect(Number.parseFloat(m?.style.top ?? 'NaN')).toBeCloseTo(2300 + 120 / FIT.scale, 4);
  });

  test('it stops at the end of the page, and at the top', () => {
    rg = rig();
    rg.stage.start('home');
    rg.advance(400);
    const top = { ...rg.cam };
    rg.wheel(-500);
    expect(rg.cam).toEqual(top);
    rg.wheel(1e7);
    const bottom = scrolled(FIT, FIT.maxScroll);
    expect(rg.cam.y).toBeCloseTo(bottom.place.y - 2300 * FIT.scale, 6);
    rg.wheel(300);
    expect(rg.cam.y).toBeCloseTo(bottom.place.y - 2300 * FIT.scale, 6);
  });

  test('a pinch (ctrl + wheel) and a sideways swipe do not move the page or the canvas', () => {
    rg = rig();
    rg.stage.start('home');
    rg.advance(400);
    const before = { ...rg.cam };
    expect(rg.wheel(80, { ctrlKey: true }).defaultPrevented).toBe(true);
    rg.wheel(0, { deltaX: 90 });
    expect(rg.cam).toEqual(before);
  });

  test('wheel lines count as 16 px; on a fitted artboard the wheel moves nothing', () => {
    rg = rig();
    rg.stage.start('home');
    rg.advance(400);
    const before = { ...rg.cam };
    rg.wheel(3, { deltaMode: 1 });
    expect(rg.cam.y).toBeCloseTo(before.y - 48, 6);
    rg.press('ArrowLeft');
    rg.advance(400);
    const post = { ...rg.cam };
    rg.wheel(300);
    expect(rg.cam).toEqual(post);
  });

  test('each visit to the page starts at the top again', () => {
    rg = rig();
    rg.stage.start('home');
    rg.advance(400);
    const top = { ...rg.cam };
    rg.wheel(400);
    rg.press('ArrowLeft');
    rg.press('ArrowRight');
    rg.advance(400);
    expect(rg.cam).toEqual(top);
  });
});

// ── one rule per kind (fit snapshot) ─────────────────────────────────────────────────────────────

describe('md-edge-mixed — each kind fills the screen its own way', () => {
  const stage = { w: 1600, h: 900 };
  // `+ 0` turns a -0 from rounding a hair below zero into 0 (toEqual tells them apart)
  const r = (n: number, d = 2) => Number(n.toFixed(d)) + 0;
  const snap = (kind: 'web' | 'digital' | 'video' | 'print', w: number, h: number, bleedPx = 0) => {
    const f = fitForKind({ kind, art: { w, h }, stage, bleedPx });
    return {
      scale: r(f.scale, 4),
      place: { x: r(f.place.x), y: r(f.place.y) },
      window: { x: f.window.x, y: f.window.y, w: r(f.window.w), h: r(f.window.h) },
      fill: f.fill,
      maxScroll: r(f.maxScroll),
    };
  };

  test('web 1440 × 3600: fills the width, from the top, scrolls', () => {
    expect(snap('web', 1440, 3600)).toEqual({
      scale: 1.1111,
      place: { x: 0, y: 0 },
      window: { x: 0, y: 0, w: 1440, h: 810 },
      fill: 'none',
      maxScroll: 2790,
    });
  });

  test('post 1:1: fits the height, centred', () => {
    expect(snap('digital', 1080, 1080)).toEqual({
      scale: 0.8333,
      place: { x: 350, y: 0 },
      window: { x: 0, y: 0, w: 1080, h: 1080 },
      fill: 'pillarbox',
      maxScroll: 0,
    });
  });

  test('reel 9:16: pillarboxed', () => {
    const f = snap('video', 1080, 1920);
    expect(f.fill).toBe('pillarbox');
    expect(f.scale).toBe(0.4688);
  });

  test('A4 print at the trim: the bleed stays off screen', () => {
    // A4 + 3 mm bleed at 96 dpi: 11 px a side
    expect(snap('print', 816, 1143, 11)).toMatchObject({
      window: { x: 11, y: 11, w: 794, h: 1121 },
      fill: 'pillarbox',
    });
  });

  test('banner 1200 × 300: letterboxed', () => {
    expect(snap('digital', 1200, 300).fill).toBe('letterbox');
  });

  test('16:9 video: edge to edge', () => {
    expect(snap('video', 1920, 1080)).toMatchObject({ fill: 'none', scale: 0.8333 });
  });

  test('scrolled() moves the page and its window together, and clamps', () => {
    const f = fitForKind({ kind: 'web', art: { w: 1440, h: 3600 }, stage });
    const s = scrolled(f, 1000);
    expect(s.place.y).toBeCloseTo(-1000 * f.scale, 9);
    expect(s.window.y).toBe(1000);
    expect(s.window.h).toBe(f.window.h);
    expect(scrolled(f, 1e9).window.y).toBe(f.maxScroll);
    expect(scrolled(f, -5)).toEqual(f);
    expect(scrolled(f, Number.NaN)).toEqual(f);
    const cam = cameraFor(s, { x: 0, y: 2300 });
    expect(cam.y).toBeCloseTo(-1000 * f.scale - 2300 * f.scale, 6);
    const digital = fitForKind({ kind: 'digital', art: { w: 1080, h: 1080 }, stage });
    expect(scrolled(digital, 100)).toEqual(digital); // only a web page scrolls
  });
});

// ── the wire ─────────────────────────────────────────────────────────────────────────────────────

describe('dgn: present-media (c2s) and present-media-cmd (s2c)', () => {
  const c2s = DGN_TABLE.c2s['present-media' as keyof typeof DGN_TABLE.c2s] as unknown as {
    gate: string;
    parse(raw: unknown): Record<string, unknown> | null;
  };
  const s2c = DGN_TABLE.s2c['present-media-cmd' as keyof typeof DGN_TABLE.s2c] as unknown as {
    gate: string;
    parse(raw: unknown): Record<string, unknown> | null;
  };

  test('present-media is gated to the active canvas and keeps only its four fields', () => {
    expect(c2s.gate).toBe('active');
    expect(c2s.parse({ playing: true, t: 6, duration: 15, muted: false, evil: '<x>' })).toEqual({
      playing: true,
      t: 6,
      duration: 15,
      muted: false,
    });
  });

  test('a bad time or flag drops the whole message', () => {
    const ok = { playing: true, t: 6, duration: 15, muted: false };
    expect(c2s.parse({ ...ok, t: -1 })).toBeNull();
    expect(c2s.parse({ ...ok, t: 86401 })).toBeNull();
    expect(c2s.parse({ ...ok, duration: Number.NaN })).toBeNull();
    expect(c2s.parse({ ...ok, duration: Number.POSITIVE_INFINITY })).toBeNull();
    expect(c2s.parse({ ...ok, playing: 'yes' })).toBeNull();
    expect(c2s.parse({ playing: true, t: 1, duration: 2 })).toBeNull();
  });

  test('present-media-cmd comes from the parent and takes four ops', () => {
    expect(s2c.gate).toBe('parent');
    for (const op of ['play', 'pause', 'mute', 'unmute'])
      expect(s2c.parse({ op, x: 1 })).toEqual({ op });
    expect(s2c.parse({ op: 'seek' })).toBeNull();
    expect(s2c.parse({})).toBeNull();
  });
});

// ── the React mount — LAST: the store turns governed for good ────────────────────────────────────

describe('usePresentStage with a clip', () => {
  let root: Root | null = null;
  let host: HTMLElement;
  const camera = { current: { ...CAM } };
  const reel = new FakePlayer(30, 450);

  function Probe() {
    usePresentStage({
      hostRef: { current: host },
      worldRef: { current: host.firstElementChild as HTMLElement },
      artboards: BOARDS,
      controller: {
        viewport: camera.current,
        setViewport: (v) => {
          camera.current = { ...v };
        },
      },
      selection: null,
    });
    return null;
  }

  const setMode = (mode: string, present: unknown = null) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: fakeParent as unknown as Window,
          data: {
            dgn: 'set-mode',
            v: 2,
            seq: canvasModeStore(window).get().modeSeq + 1,
            mode,
            present,
            caps: { edit: true, annotate: true, comment: true },
          },
        })
      );
    });
  const fromShell = (data: Msg, source: unknown = fakeParent) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: source as Window, data }));
    });

  beforeAll(() => {
    host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: STAGE_W });
    Object.defineProperty(host, 'clientHeight', { value: STAGE_H });
    host.appendChild(document.createElement('div'));
    document.body.appendChild(host);
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true });
    // the registry video-comp.tsx fills: the stage finds the clip by its artboard
    (window as unknown as { __maudeVideoComps?: Map<string, unknown> }).__maudeVideoComps = new Map(
      [
        [
          'clip',
          {
            id: 'clip',
            artboardId: 'reel',
            artboardLabel: 'Reels',
            fps: 30,
            durationInFrames: 450,
            width: 1080,
            height: 1920,
            ref: { current: reel },
          },
        ],
      ]
    );
  });
  afterAll(() => {
    act(() => root?.unmount());
    host.remove();
    (window as unknown as { __maudeVideoComps?: unknown }).__maudeVideoComps = undefined;
  });

  test('Present from the reel plays it; the shell’s commands drive it; leaving pauses it', () => {
    root = createRoot(document.createElement('div'));
    act(() => root?.render(createElement(Probe)));
    setMode('present', { kind: 'artboards', from: 'reel' });
    expect(reel.playing).toBe(true);
    expect(media(posts).at(-1)).toMatchObject({ playing: true, muted: false, duration: 15 });

    fromShell({ dgn: 'present-media-cmd', op: 'pause' });
    expect(reel.playing).toBe(false);
    fromShell({ dgn: 'present-media-cmd', op: 'mute' });
    expect(reel.muted).toBe(true);
    fromShell({ dgn: 'present-media-cmd', op: 'play' });
    expect(reel.playing).toBe(true);

    // not from the parent: ignored (the canvas is untrusted, the shell is not)
    fromShell({ dgn: 'present-media-cmd', op: 'pause' }, window);
    expect(reel.playing).toBe(true);
    // not a valid op: ignored
    fromShell({ dgn: 'present-media-cmd', op: 'seek' });
    expect(reel.playing).toBe(true);

    setMode('edit');
    expect(reel.playing).toBe(false);
    expect(reel.listeners()).toBe(0);
    // a command after Present ended means nothing
    fromShell({ dgn: 'present-media-cmd', op: 'play' });
    expect(reel.playing).toBe(false);
  });
});
