// S4.16 (an-video) — a sticky on a video belongs to a moment. Pure parts: the pin a new sticky gets, the chip,
// the fade off range, and S7's `timeMarks` selector; plus the read-only `playheadOf` the layer reads.

import { afterEach, describe, expect, test } from 'bun:test';
import { validateElement } from '../annotations/registry.ts';
import {
  formatTime,
  inRange,
  OFF_RANGE_OPACITY,
  PIN_SECONDS,
  pinFor,
  pinOpacity,
  readTimeRange,
  timeChip,
  timeMarks,
  withTimePins,
} from '../annotations/time-marks.ts';
import type { AnnotationElement } from '../annotations/types.ts';

const sticky = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'sticky',
    index: 'a0',
    x: 10,
    y: 10,
    w: 150,
    h: 120,
    text: 'Logo naskočí moc brzo',
    fill: '#f4a28c',
    ...over,
  }) as AnnotationElement;

describe('the chip and the pin', () => {
  test('0:12 reads as the moment the note starts at', () => {
    expect(formatTime(12)).toBe('0:12');
    expect(formatTime(12.9)).toBe('0:12');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3723)).toBe('1:02:03');
    expect(formatTime(-4)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(timeChip({ start: 12 })).toBe('0:12');
  });

  test('placed at 0:12 on a 30 s clip: 0:12–0:15, and the registry accepts it', () => {
    const pin = pinFor('reel', 12, 30);
    expect(pin).toEqual({ artboard: 'reel', start: 12, end: 12 + PIN_SECONDS });
    const v = validateElement(sticky('s1', { timeRange: pin }));
    expect(v.ok).toBe(true);
    expect(v.ok && v.el.timeRange).toEqual(pin);
  });

  test('near the end the range is clamped, never earlier than the playhead', () => {
    expect(pinFor('reel', 29, 30)).toEqual({ artboard: 'reel', start: 29, end: 30 });
    expect(pinFor('reel', 30, 30)).toEqual({ artboard: 'reel', start: 30, end: 30 });
    expect(pinFor('reel', 99, 30)).toEqual({ artboard: 'reel', start: 30, end: 30 });
    expect(pinFor('reel', -3, 30).start).toBe(0);
  });

  test('a stored range reads back only when it is one', () => {
    expect(readTimeRange({ artboard: 'a', start: 1, end: 2 })).toEqual({
      artboard: 'a',
      start: 1,
      end: 2,
    });
    expect(readTimeRange({ artboard: 'a', start: 5, end: 2 })).toBeUndefined();
    expect(readTimeRange({ artboard: '', start: 1, end: 2 })).toBeUndefined();
    expect(readTimeRange('0:12')).toBeUndefined();
    expect(readTimeRange(null)).toBeUndefined();
  });
});

describe('the fade', () => {
  const r = { artboard: 'reel', start: 12, end: 15 };
  test('full inside the range (both ends count), about a third outside', () => {
    expect(inRange(r, 12)).toBe(true);
    expect(inRange(r, 15)).toBe(true);
    expect(pinOpacity(r, 13)).toBe(1);
    expect(pinOpacity(r, 21)).toBe(OFF_RANGE_OPACITY);
    expect(OFF_RANGE_OPACITY).toBeCloseTo(0.32, 2);
    expect(pinOpacity(r, 11.99)).toBe(OFF_RANGE_OPACITY);
  });
  test('an unpinned note, or a video with no playhead yet, is never dimmed', () => {
    expect(pinOpacity(undefined, 21)).toBe(1);
    expect(pinOpacity(r, null)).toBe(1);
  });
});

describe('withTimePins — only a NEW sticky on a video gets a pin', () => {
  const head = (id: string) => (id === 'reel' ? { t: 12, duration: 30 } : null);
  const prev = new Map<string, AnnotationElement>([
    ['old', sticky('old', { parentArtboard: 'reel' })],
  ]);

  test('a new sticky over the video is pinned at the playhead', () => {
    const next = new Map(prev).set('s1', sticky('s1', { parentArtboard: 'reel' }));
    const out = withTimePins(prev, next, head);
    expect(out.get('s1')?.timeRange).toEqual({ artboard: 'reel', start: 12, end: 15 });
  });

  test('an old sticky, a sticky off any video, an already-pinned sticky and other types keep what they have', () => {
    const own = { artboard: 'reel', start: 1, end: 2 };
    const next = new Map(prev)
      .set('old', { ...(prev.get('old') as AnnotationElement), text: 'edited' })
      .set('plain', sticky('plain'))
      .set('other', sticky('other', { parentArtboard: 'poster' }))
      .set('pinned', sticky('pinned', { parentArtboard: 'reel', timeRange: own }))
      .set('txt', {
        id: 'txt',
        type: 'text',
        index: 'a1',
        x: 0,
        y: 0,
        text: 'x',
        parentArtboard: 'reel',
      } as AnnotationElement);
    const out = withTimePins(prev, next, head);
    expect(out).toBe(next); // nothing to add: the very same map comes back
    expect(out.get('old')?.timeRange).toBeUndefined();
    expect(out.get('pinned')?.timeRange).toEqual(own);
  });
});

describe('timeMarks — S7’s selector', () => {
  const board = [
    sticky('b', { timeRange: { artboard: 'reel', start: 21, end: 24 }, fill: '#fce8a6' }),
    sticky('a', { timeRange: { artboard: 'reel', start: 12, end: 15 } }),
    sticky('wide', { timeRange: { artboard: '169', start: 1, end: 2 } }),
    sticky('plain'),
    sticky('bad', { timeRange: { artboard: 'reel', start: 9, end: 3 } }),
  ];
  test('the notes of one video artboard, earliest first, as { id, t0, t1, colour }', () => {
    expect(timeMarks(board, 'reel')).toEqual([
      { id: 'a', t0: 12, t1: 15, colour: '#f4a28c' },
      { id: 'b', t0: 21, t1: 24, colour: '#fce8a6' },
    ]);
    expect(timeMarks(board, '169').map((m) => m.id)).toEqual(['wide']);
    expect(timeMarks(board, 'nothing')).toEqual([]);
  });
});

describe('playheadOf — the layer’s read-only view of a clip', () => {
  const w = globalThis as unknown as { window?: unknown };
  const had = 'window' in w;
  afterEach(() => {
    if (!had) w.window = undefined;
    else (w.window as { __maudeVideoComps?: unknown }).__maudeVideoComps = undefined;
  });

  test('seconds from the Player’s frame; null for an artboard with no clip', async () => {
    if (!had) w.window = globalThis;
    const win = w.window as {
      __maudeVideoComps?: Map<string, unknown>;
    };
    win.__maudeVideoComps = new Map([
      [
        'videocomp-1',
        {
          id: 'videocomp-1',
          artboardId: 'reel',
          fps: 30,
          durationInFrames: 900,
          ref: { current: { getCurrentFrame: () => 360 } },
        },
      ],
    ]);
    const { playheadOf } = await import('../video-comp.tsx');
    expect(playheadOf('reel')).toEqual({ t: 12, duration: 30 });
    expect(playheadOf('reel')).toBe(playheadOf('reel')); // stable identity until it moves
    expect(playheadOf('poster')).toBeNull();
    expect(playheadOf(null)).toBeNull();
  });
});
