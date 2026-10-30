// S7.8 (07 · ve-play) — the controls on the video artboard: a centred play button that plays in place WITH
// sound, and a scrub bar ("0:07 / 0:15") once it has started. The Player's own events keep them honest.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { clock, VideoPlayChrome } from '../video-play-chrome.tsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

/** The slice of PlayerRef the chrome uses, with the events it listens to. */
function fakePlayer(frame = 0) {
  const l = new Map<string, Set<() => void>>();
  const calls: string[] = [];
  const p = {
    playing: false,
    frame,
    isPlaying: () => p.playing,
    getCurrentFrame: () => p.frame,
    play: () => {
      calls.push('play');
      p.playing = true;
      emit('play');
    },
    pause: () => {
      calls.push('pause');
      p.playing = false;
      emit('pause');
    },
    unmute: () => calls.push('unmute'),
    seekTo: (f: number) => {
      calls.push(`seek ${f}`);
      p.frame = f;
      emit('frameupdate');
    },
    addEventListener: (e: string, fn: () => void) => {
      if (!l.has(e)) l.set(e, new Set());
      l.get(e)?.add(fn);
    },
    removeEventListener: (e: string, fn: () => void) => l.get(e)?.delete(fn),
  };
  const emit = (e: string) => act(() => void l.get(e)?.forEach((fn) => fn()));
  return { p, calls, emit };
}

function mount(player: ReturnType<typeof fakePlayer>, durationInFrames = 450) {
  const ref = createRef<never>();
  (ref as { current: unknown }).current = player.p;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(<VideoPlayChrome playerRef={ref} fps={30} durationInFrames={durationInFrames} />);
  });
}
const q = (t: string) => document.querySelector(`[data-testid="${t}"]`) as HTMLElement | null;

describe('the clock', () => {
  test('m:ss', () => {
    expect(clock(0, 30)).toBe('0:00');
    expect(clock(212, 30)).toBe('0:07');
    expect(clock(450, 30)).toBe('0:15');
    expect(clock(1830, 30)).toBe('1:01');
  });
});

describe('paused, never started', () => {
  test('a centred play button, no scrub bar', () => {
    mount(fakePlayer());
    expect(q('video-play-button')).not.toBeNull();
    expect(q('video-scrub-bar')).toBeNull();
  });

  test('07 ve-play: parked on the poster frame (frame > 0) is still "never started": no scrub bar', () => {
    mount(fakePlayer(106));
    expect(q('video-play-button')).not.toBeNull();
    expect(q('video-scrub-bar')).toBeNull();
  });

  test('the button unmutes, then plays — in place, with sound', () => {
    const pl = fakePlayer();
    mount(pl);
    act(() => q('video-play-button')?.click());
    expect(pl.calls).toEqual(['unmute', 'play']);
  });

  test('it carries no cd-id: the inspector never selects it', () => {
    mount(fakePlayer());
    expect(document.querySelector('[data-cd-id]')).toBeNull();
    expect(q('video-play-button')?.getAttribute('data-dc-video-chrome')).toBe('play');
  });
});

describe('playing', () => {
  test('the centre button gives way to the scrub bar with the time', () => {
    const pl = fakePlayer(212);
    mount(pl);
    act(() => q('video-play-button')?.click());
    expect(q('video-play-button')).toBeNull();
    expect(q('video-scrub-bar')).not.toBeNull();
    expect(q('video-scrub-time')?.textContent).toBe('0:07 / 0:15');
  });

  test('the bar’s button pauses; the centre button comes back', () => {
    const pl = fakePlayer(212);
    mount(pl);
    act(() => q('video-play-button')?.click());
    const pause = q('video-scrub-bar')?.querySelector('button') as HTMLElement;
    expect(pause.getAttribute('aria-label')).toBe('Pause');
    act(() => pause.click());
    expect(pl.calls.at(-1)).toBe('pause');
    expect(q('video-play-button')).not.toBeNull();
    expect(q('video-scrub-bar')).not.toBeNull(); // it has started: the bar stays
  });

  test('the fill follows the frame', () => {
    const pl = fakePlayer(0);
    mount(pl);
    act(() => q('video-play-button')?.click());
    pl.p.frame = 224;
    pl.emit('frameupdate');
    expect(q('video-scrub-fill')?.style.width).toBe(`${(224 / 449) * 100}%`);
  });

  test('parked on the last frame, play starts again from the top', () => {
    const pl = fakePlayer(449);
    mount(pl);
    act(() => q('video-play-button')?.click());
    expect(pl.calls).toEqual(['unmute', 'seek 0', 'play']);
  });
});

describe('the protocol', () => {
  test('timeline-playing is a live canvas → shell row: a boolean and an optional id', () => {
    const row = (
      DGN_TABLE.c2s as Record<string, { parse: (v: unknown) => unknown; status: string }>
    )['timeline-playing'];
    expect(row.status).toBe('live');
    expect(row.parse({ id: 'reels', playing: true })).toBeTruthy();
    expect(row.parse({ playing: false })).toBeTruthy();
    expect(row.parse({ id: 'reels', playing: 'yes' })).toBeNull();
    expect(row.parse({ id: 'reels' })).toBeNull();
  });
});
