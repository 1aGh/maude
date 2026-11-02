// S3.3 (md-present-video) — the shell's transport mirrors the clip on the presented artboard.
//   pause · 0:06 / 0:15 · sound, in the controls' transport slot, only while the artboard holds a clip
//   · the canvas's `present-media` is the store's `media`; a move to another artboard clears it
//   · the buttons post `present-media-cmd` through the mode lane (play / pause / mute / unmute)
//   · hidden, never greyed, when the artboard has no clip
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { ShellStoreContext } from '../client/stores/shell-store.jsx';
import { ShellPresentChrome } from '../client/v2/present/present-chrome-host.jsx';
import { PresentTransport } from '../client/v2/present/present-controls.jsx';
import {
  mediaTimeText,
  mediaToggleOp,
  soundOp,
} from '../client/v2/present/present-controls-model.js';
import { createModeLane, createShellMode } from '../client/v2/shell/canvas-mode.js';
import { shellMode, useCanvasModeLane } from '../client/v2/shell/use-canvas-mode-lane.js';

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const PLAYING = { playing: true, t: 6, duration: 15, muted: false };

describe('the model', () => {
  test('0:06 / 0:15 — minutes and seconds, tabular, hours only when there are some', () => {
    expect(mediaTimeText({ ...PLAYING })).toBe('0:06 / 0:15');
    expect(mediaTimeText({ ...PLAYING, t: 0, duration: 9.4 })).toBe('0:00 / 0:09');
    expect(mediaTimeText({ ...PLAYING, t: 75.9, duration: 600 })).toBe('1:15 / 10:00');
    expect(mediaTimeText({ ...PLAYING, t: 3725, duration: 7200 })).toBe('1:02:05 / 2:00:00');
  });

  test('a time that is not a number never prints', () => {
    expect(mediaTimeText(null)).toBeNull();
    expect(mediaTimeText({ ...PLAYING, t: Number.NaN })).toBeNull();
    expect(mediaTimeText({ ...PLAYING, duration: -1 })).toBeNull();
    expect(mediaTimeText({ ...PLAYING, duration: Number.POSITIVE_INFINITY })).toBeNull();
  });

  test('the buttons ask for the opposite of what is happening', () => {
    expect(mediaToggleOp({ ...PLAYING })).toBe('pause');
    expect(mediaToggleOp({ ...PLAYING, playing: false })).toBe('play');
    expect(soundOp({ ...PLAYING })).toBe('mute');
    expect(soundOp({ ...PLAYING, muted: true })).toBe('unmute');
  });
});

describe('the store keeps the clip while it is the presented artboard’s', () => {
  const at = (id: string) => ({ index: 0, total: 3, artboardId: id });
  test('only while presenting artboards, sanitised, and only when it changes', () => {
    const s = createShellMode();
    let n = 0;
    s.subscribe(() => {
      n += 1;
    });
    s.media({ ...PLAYING });
    expect(s.get().media).toBeNull(); // not presenting
    s.present({ kind: 'canvas' });
    s.media({ ...PLAYING });
    expect(s.get().media).toBeNull(); // Present the canvas has no clip to follow
    s.back();
    s.present({ kind: 'artboards', from: 'reel' });
    s.position(at('reel'));
    const before = n;
    s.media({ ...PLAYING });
    s.media({ ...PLAYING });
    expect(n).toBe(before + 1);
    expect(s.get().media).toEqual(PLAYING);
    s.media({ ...PLAYING, t: Number.NaN });
    s.media({ ...PLAYING, muted: 'no' as never });
    expect(s.get().media).toEqual(PLAYING); // junk is dropped whole
  });

  test('a move to another artboard clears it; the same artboard again keeps it', () => {
    const s = createShellMode();
    s.present({ kind: 'artboards', from: 'reel' });
    s.position(at('reel'));
    s.media({ ...PLAYING });
    s.position(at('reel'));
    expect(s.get().media).toEqual(PLAYING);
    s.position({ index: 1, total: 3, artboardId: 'post' });
    expect(s.get().media).toBeNull();
  });

  test('leaving Present, or choosing a mode, clears it', () => {
    const s = createShellMode();
    s.present({ kind: 'artboards', from: 'reel' });
    s.media({ ...PLAYING });
    s.back();
    expect(s.get().media).toBeNull();
    s.present({ kind: 'artboards', from: 'reel' });
    s.media({ ...PLAYING });
    s.select('preview');
    expect(s.get().media).toBeNull();
  });
});

describe('<PresentTransport>', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  const cmds: string[] = [];
  const mount = (media: unknown) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<PresentTransport media={media as never} onCommand={(op) => cmds.push(op)} />);
    });
  };
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    cmds.length = 0;
  });

  test('pause · 0:06 / 0:15 · sound', () => {
    mount(PLAYING);
    expect(q('present-transport')).not.toBeNull();
    expect(q('present-media-time')?.textContent).toBe('0:06 / 0:15');
    expect(q('present-media-toggle')?.getAttribute('aria-label')).toBe('Pause');
    // one label, a pressed state: the name does not flip under a screen reader
    expect(q('present-media-sound')?.getAttribute('aria-label')).toBe('Sound');
    expect(q('present-media-sound')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('paused and muted read the other way round', () => {
    mount({ ...PLAYING, playing: false, muted: true });
    expect(q('present-media-toggle')?.getAttribute('aria-label')).toBe('Play');
    expect(q('present-media-sound')?.getAttribute('aria-label')).toBe('Sound');
    expect(q('present-media-sound')?.getAttribute('aria-pressed')).toBe('false');
  });

  test('the buttons send play / pause / mute / unmute', () => {
    mount(PLAYING);
    act(() => q('present-media-toggle')?.click());
    act(() => q('present-media-sound')?.click());
    expect(cmds).toEqual(['pause', 'mute']);
  });

  test('nothing to show without a clip', () => {
    mount(null);
    expect(q('present-transport')).toBeNull();
  });
});

describe('the lane posts the command', () => {
  test('mediaCmd posts a parsed present-media-cmd to the frame; an unknown op posts nothing', () => {
    const log: Array<Record<string, unknown>> = [];
    const win = { postMessage: (m: Record<string, unknown>) => log.push(m) } as unknown as Window;
    const lane = createModeLane({ frames: () => [win], active: () => win });
    for (const op of ['play', 'pause', 'mute', 'unmute']) lane.media(win, op);
    lane.media(win, 'seek');
    lane.media(win, undefined);
    expect(log.map((m) => m.op)).toEqual(['play', 'pause', 'mute', 'unmute']);
    for (const m of log) expect(DGN_TABLE.s2c['present-media-cmd'].parse(m)).toEqual({ op: m.op });
  });
});

// ── the wired shell: a canvas message in, the transport out, a click back to the canvas ───────────

const ORIGIN = 'http://canvas.test';
describe('the wired shell', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  const frameLog: Array<Record<string, unknown>> = [];
  const frameWin = { postMessage: (m: Record<string, unknown>) => frameLog.push(m) };

  function Lane() {
    const iframesRef = { current: new Map([['ui/Campaign.tsx', { contentWindow: frameWin }]]) };
    useCanvasModeLane({
      activePath: 'ui/Campaign.tsx',
      iframesRef,
      cfg: { canvasOrigin: ORIGIN },
      canEdit: true,
      role: undefined,
    });
    return null;
  }
  const store = {
    shellCore: { activePath: 'ui/Campaign.tsx', cfg: { designRel: '.design' } },
    photoAndTimeline: { exitPresent: () => {} },
  };
  const fromCanvas = (data: Record<string, unknown>, source: unknown = frameWin) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { origin: ORIGIN, source: source as Window, data })
      );
    });

  beforeEach(() => {
    shellMode.back();
    frameLog.length = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <ShellStoreContext.Provider value={store as never}>
          <Lane />
          <ShellPresentChrome />
        </ShellStoreContext.Provider>
      );
    });
  });
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    act(() => {
      shellMode.back();
    });
  });

  test('the transport appears with the clip, follows it, drives it, and goes with the artboard', () => {
    act(() => {
      shellMode.present({ kind: 'artboards', from: 'reel' });
    });
    fromCanvas({ dgn: 'present-position', index: 8, total: 14, artboardId: 'reel' });
    expect(q('present-controls')).not.toBeNull();
    expect(q('present-transport')).toBeNull(); // no clip heard yet
    expect(q('present-slot-transport')).toBeNull();

    fromCanvas({ dgn: 'present-media', ...PLAYING });
    expect(q('present-slot-transport')).not.toBeNull();
    expect(q('present-media-time')?.textContent).toBe('0:06 / 0:15');

    fromCanvas({ dgn: 'present-media', ...PLAYING, t: 7 });
    expect(q('present-media-time')?.textContent).toBe('0:07 / 0:15');

    frameLog.length = 0;
    act(() => q('present-media-toggle')?.click());
    act(() => q('present-media-sound')?.click());
    expect(frameLog).toEqual([
      { dgn: 'present-media-cmd', op: 'pause' },
      { dgn: 'present-media-cmd', op: 'mute' },
    ]);

    // the next artboard has no clip: the transport leaves, it is not greyed out
    fromCanvas({ dgn: 'present-position', index: 9, total: 14, artboardId: 'post' });
    expect(q('present-transport')).toBeNull();
    expect(q('present-slot-transport')).toBeNull();
  });

  test('junk from the canvas, or a clip message from a canvas that is not the active one, is ignored', () => {
    act(() => {
      shellMode.present({ kind: 'artboards', from: 'reel' });
    });
    fromCanvas({ dgn: 'present-position', index: 8, total: 14, artboardId: 'reel' });
    fromCanvas({ dgn: 'present-media', playing: true, t: -4, duration: 15, muted: false });
    fromCanvas({ dgn: 'present-media', playing: 'yes', t: 1, duration: 15, muted: false });
    fromCanvas({ dgn: 'present-media', ...PLAYING }, { postMessage() {} });
    expect(shellMode.get().media).toBeNull();
    expect(q('present-transport')).toBeNull();
  });
});
