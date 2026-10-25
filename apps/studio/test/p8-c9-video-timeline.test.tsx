// P8 C9 (07 · ve-play, ve-music, ve-trim-split) — the timeline's loop range is "I" and "O" badges on the ruler (drag or
// ← →, the I / O keys still set the ends), the beat ticks are painted OVER the song's block, and the Full body keeps the
// ruler + four lanes in view.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 900,
  });
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TimelineIslandContext } from '../client/v2/timeline/island-context.js';
import { moveLoopEnd } from '../client/v2/timeline/loop-handle.jsx';
import { playbackStore } from '../client/v2/timeline/playhead.js';
import TimelinePanel from '../client/v2/timeline/Timeline.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  playbackStore.reset();
});

const beat = (id: string, from: number) => ({
  stableId: id,
  label: id,
  series: true,
  mediaTag: 'Video',
  mediaSrc: `assets/${id}.mp4`,
  mediaProps: { muted: false },
  from,
  duration: 120,
  keyframes: [],
});

function mount(size: 'full' | 'compact' = 'full') {
  const seeks: number[] = [];
  host = document.createElement('div');
  host.style.width = '1200px';
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <TimelineIslandContext.Provider value={{ size }}>
        <TimelinePanel
          comps={[{ id: 'c1', fps: 30, durationInFrames: 240, width: 270, height: 480 }]}
          compId="c1"
          sequences={[beat('one', 0), beat('two', 120)]}
          audio={[]}
          total={240}
          frame={0}
          height={300}
          onSeek={(f: number) => seeks.push(f)}
          onSelect={() => {}}
        />
      </TimelineIslandContext.Provider>
    );
  });
  return seeks;
}
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const key = (el: HTMLElement | null, k: string, shiftKey = false) =>
  act(() => {
    el?.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true }));
  });

describe('moveLoopEnd (pure)', () => {
  test('an end moves, the band keeps one frame and stays inside the cut', () => {
    const band = { in: 60, out: 150 };
    expect(moveLoopEnd(band, 'in', 90, 240)).toEqual({ in: 90, out: 150 });
    expect(moveLoopEnd(band, 'in', 400, 240)).toEqual({ in: 149, out: 150 });
    expect(moveLoopEnd(band, 'in', -5, 240)).toEqual({ in: 0, out: 150 });
    expect(moveLoopEnd(band, 'out', 20, 240)).toEqual({ in: 60, out: 61 });
    expect(moveLoopEnd(band, 'out', 999, 240)).toEqual({ in: 60, out: 240 });
  });
});

describe('the loop range wears "I" and "O" badges (07 · .ve-inout)', () => {
  test('no band, no badges; a band draws one of each, named for a screen reader', () => {
    mount();
    expect(q('[data-testid="timeline-loop-in"]')).toBeNull();
    act(() => playbackStore.setLoop('c1', { in: 60, out: 150 }));
    const i = q('[data-testid="timeline-loop-in"]');
    const o = q('[data-testid="timeline-loop-out"]');
    expect(i?.textContent).toBe('I');
    expect(o?.textContent).toBe('O');
    expect(i?.getAttribute('role')).toBe('slider');
    expect(i?.getAttribute('aria-label')).toBe('Loop start');
    expect(i?.getAttribute('aria-valuetext')).toBe('0:02');
    expect(o?.getAttribute('aria-label')).toBe('Loop end');
    expect(o?.getAttribute('aria-valuetext')).toBe('0:05');
    // the band itself is still drawn under them
    expect(q('[data-testid="timeline-loop-band"]')).not.toBeNull();
  });

  test('← → steps a badge one frame, ⇧ one second; the band stays valid', () => {
    mount();
    act(() => playbackStore.setLoop('c1', { in: 60, out: 150 }));
    key(q('[data-testid="timeline-loop-in"]'), 'ArrowRight');
    expect(playbackStore.loopFor('c1')).toEqual({ in: 61, out: 150 });
    key(q('[data-testid="timeline-loop-out"]'), 'ArrowLeft', true);
    expect(playbackStore.loopFor('c1')).toEqual({ in: 61, out: 120 });
    key(q('[data-testid="timeline-loop-in"]'), 'ArrowLeft', true);
    expect(playbackStore.loopFor('c1')).toEqual({ in: 31, out: 120 });
  });

  test('pressing a badge never scrubs the ruler under it', () => {
    const seeks = mount();
    act(() => playbackStore.setLoop('c1', { in: 60, out: 150 }));
    act(() => {
      q('[data-testid="timeline-loop-in"]')?.dispatchEvent(
        new window.MouseEvent('pointerdown', { bubbles: true, clientX: 300, button: 0 })
      );
    });
    expect(seeks).toEqual([]);
  });
});

describe('the gutter buttons take their own clicks (the lane press captured the pointer and ate them)', () => {
  test('a press on the eye / the speaker neither scrubs nor captures the pointer', () => {
    const seeks = mount();
    let captured = 0;
    const proto = window.HTMLElement.prototype as unknown as { setPointerCapture?: () => void };
    const before = proto.setPointerCapture;
    proto.setPointerCapture = () => {
      captured += 1;
    };
    try {
      for (const id of ['timeline-track-view-text', 'timeline-track-volume-video']) {
        act(() => {
          q(`[data-testid="${id}"]`)?.dispatchEvent(
            new window.MouseEvent('pointerdown', { bubbles: true, clientX: 40, button: 0 })
          );
        });
      }
    } finally {
      proto.setPointerCapture = before;
    }
    expect(seeks).toEqual([]);
    expect(captured).toBe(0);
  });
});

describe('what P8 C9 pinned in CSS', () => {
  const css = readFileSync(join(import.meta.dir, '../client/v2/timeline/timeline.css'), 'utf8');
  const rule = (sel: string) => {
    const at = css.indexOf(`${sel} {`);
    expect(at).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  test('the beat ticks sit above the song block (they were painted under it)', () => {
    const z = Number(/z-index:\s*(\d+)/.exec(rule('.tl-music-ov'))?.[1]);
    expect(z).toBeGreaterThan(3); // the block is 2 (3 when selected)
  });

  test('the Full body keeps the ruler and the four lanes in view at rest', () => {
    const h = Number(
      /min-height:\s*(\d+)px/.exec(rule('.tl-panel[data-size="full"] .tl-scroll'))?.[1]
    );
    // ruler 16 + 4, Text 24, Graphics 24, Video 52, Music 30, three 4 px gaps, the 3 px under the lanes
    expect(h).toBeGreaterThanOrEqual(20 + 24 + 4 + 24 + 4 + 52 + 4 + 30 + 3);
  });

  test('the Full panel is never shorter than head + body + foot (the shell default of 216 hung the foot out)', () => {
    const at = css.indexOf('max-height: calc(100vh - 80px - 72px)');
    expect(at).toBeGreaterThan(-1);
    const h = Number(/min-height:\s*(\d+)px/.exec(css.slice(at, css.indexOf('}', at)))?.[1]);
    expect(h).toBeGreaterThanOrEqual(12 + 28 + 8 + 168 + 8 + 30 + 12);
  });

  test('the badges are the board’s accent chip', () => {
    const r = rule('.tl-loop-handle');
    expect(r).toContain('background: var(--accent)');
    expect(r).toContain('color: var(--accent-fg)');
  });
});
