// P8 C8 (07 · ve-trim-split … ve-advanced) — the Full timeline draws the board's per-track button in each lane's
// gutter: an eye on Text / Graphics, a speaker on Video / Music. One click = ONE `clip.track` write (one undo step).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
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
import { playbackStore } from '../client/v2/timeline/playhead.js';
import TimelinePanel from '../client/v2/timeline/Timeline.jsx';
import { trackToggle } from '../client/v2/timeline/track-toggle.js';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  playbackStore.reset();
});

const beat = (id: string, from: number, muted = false) => ({
  stableId: id,
  label: id,
  series: true,
  mediaTag: 'Video',
  mediaSrc: `assets/${id}.mp4`,
  mediaProps: { muted },
  from,
  duration: 120,
  keyframes: [],
});
const title = (id: string, from: number, hidden = false) => ({
  stableId: id,
  label: id,
  series: false,
  mediaTag: null,
  hidden,
  from,
  duration: 60,
  keyframes: [],
});

type Call = [unknown, string, Record<string, unknown>];
function mount(sequences: unknown[], size: 'full' | 'compact' = 'full') {
  const calls: Call[] = [];
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
          sequences={sequences}
          audio={[]}
          total={240}
          frame={0}
          height={300}
          onSelect={() => {}}
          onClipVerb={(ref: unknown, verb: string, params: Record<string, unknown>) => {
            calls.push([ref, verb, params]);
            return Promise.resolve({ ok: true });
          }}
        />
      </TimelineIslandContext.Provider>
    );
  });
  return calls;
}
const q = (sel: string) => document.querySelector(sel) as HTMLButtonElement | null;

describe('trackToggle (pure)', () => {
  test('view: hides what is shown, shows when every clip is hidden', () => {
    const on = trackToggle('text', 'Text', { seqs: [title('a', 0), title('b', 60)] });
    expect(on).toMatchObject({ kind: 'view', off: false, label: 'Hide Text', glyph: 'view' });
    expect(on.params).toEqual({ ids: ['a', 'b'], hidden: true });
    const half = trackToggle('text', 'Text', { seqs: [title('a', 0, true), title('b', 60)] });
    expect(half.params.hidden).toBe(true); // half hidden → the rest hides
    const off = trackToggle('text', 'Text', { seqs: [title('a', 0, true), title('b', 60, true)] });
    expect(off).toMatchObject({ off: true, label: 'Show Text' });
    expect(off.params.hidden).toBe(false);
  });

  test('volume: clips with media and loose beds; the glyph turns to mute when all are muted', () => {
    const s = trackToggle('video', 'Video', { seqs: [beat('a', 0), beat('b', 120, true)] });
    expect(s).toMatchObject({ kind: 'volume', off: false, label: 'Mute Video', glyph: 'volume' });
    expect(s.params).toEqual({ ids: ['a', 'b'], muted: true });
    const m = trackToggle('music', 'Music', {
      seqs: [],
      beds: [{ stableId: 'loose:0', muted: true }],
    });
    expect(m).toMatchObject({ off: true, label: 'Unmute Music', glyph: 'mute' });
    expect(m.params).toEqual({ ids: ['loose:0'], muted: false });
    // a title has no media of its own: nothing to mute
    expect(trackToggle('video2', 'Video 2', { seqs: [title('t', 0)] }).ids).toEqual([]);
  });
});

describe('the Full timeline draws the button', () => {
  test('an eye on Text, a speaker on Video; a click sends one clip.track with the whole track', () => {
    const calls = mount([beat('one', 0), beat('two', 120), title('hello', 0), title('world', 60)]);
    const eye = q('[data-testid="timeline-track-view-text"]');
    const speaker = q('[data-testid="timeline-track-volume-video"]');
    expect(eye?.getAttribute('aria-label')).toBe('Hide Text');
    expect(speaker?.getAttribute('aria-label')).toBe('Mute Video');
    act(() => eye?.click());
    act(() => speaker?.click());
    expect(calls).toEqual([
      [null, 'clip.track', { ids: ['hello', 'world'], hidden: true }],
      [null, 'clip.track', { ids: ['one', 'two'], muted: true }],
    ]);
  });

  test('the button is a pressed toggle that reads the track back', () => {
    mount([beat('one', 0, true), beat('two', 120, true), title('hello', 0, true)]);
    expect(q('[data-testid="timeline-track-volume-video"]')?.getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(q('[data-testid="timeline-track-volume-video"]')?.getAttribute('aria-label')).toBe(
      'Unmute Video'
    );
    expect(q('[data-testid="timeline-track-view-text"]')?.getAttribute('aria-label')).toBe(
      'Show Text'
    );
  });

  test('an empty track draws the button, disabled; Compact draws none (the chip alone)', () => {
    mount([beat('one', 0)]);
    expect(q('[data-testid="timeline-track-view-text"]')?.disabled).toBe(true);
    act(() => root?.unmount());
    host?.remove();
    mount([beat('one', 0)], 'compact');
    expect(q('[data-testid="timeline-track-view-text"]')).toBeNull();
    expect(q('[data-testid="timeline-track-volume-video"]')).toBeNull();
  });
});
