// S7.8 (07 · ve-select, ve-play) — the panel draws four tracks in order (Text · Graphics · Video · Music,
// Video 2 only when a standalone video/image is on it), a ruler that steps 3 s on a 15 s reel and reads
// m:ss, the loop band I / O draws, and the Poster flag. Every row keeps its own testid.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom has no layout: give the scroll area the width a real island has (900 less the label gutter)
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

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  playbackStore.reset();
});

const beat = (id: string, from: number, duration: number) => ({
  stableId: id,
  label: id,
  series: true,
  mediaTag: 'Video',
  mediaSrc: `assets/${id}.mp4`,
  from,
  duration,
  keyframes: [],
});
const SEQ = [
  beat('Oslava', 0, 240),
  beat('Touchdown', 240, 210),
  {
    stableId: 'dr',
    label: 'DŘINA',
    series: false,
    mediaTag: null,
    from: 45,
    duration: 60,
    keyframes: [],
  },
  {
    stableId: 'lg',
    label: 'LogoBug',
    series: false,
    mediaTag: null,
    from: 0,
    duration: 450,
    keyframes: [],
  },
  {
    stableId: 'ph',
    label: 'photo',
    series: false,
    mediaTag: 'Img',
    mediaSrc: 'assets/p.jpg',
    from: 100,
    duration: 60,
    keyframes: [],
  },
];

function mount(
  sequences: unknown[],
  { audio = [] as unknown[], island = {} as Record<string, unknown>, frame = 0 } = {}
) {
  host = document.createElement('div');
  host.style.width = '1200px';
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <TimelineIslandContext.Provider value={island}>
        <TimelinePanel
          comps={[{ id: 'c1', fps: 30, durationInFrames: 450, width: 270, height: 480 }]}
          compId="c1"
          sequences={sequences}
          audio={audio}
          total={450}
          frame={frame}
          height={300}
          onSelect={() => {}}
        />
      </TimelineIslandContext.Provider>
    );
  });
}
const q = (sel: string) => document.querySelector(sel);
const all = (sel: string) => [...document.querySelectorAll(sel)];

describe('four tracks', () => {
  test('Text · Graphics · Video · Music, in that order, each with its rows', () => {
    mount(SEQ.slice(0, 4));
    expect(all('[data-track]').map((t) => t.getAttribute('data-track'))).toEqual([
      'text',
      'gfx',
      'video',
      'music',
    ]);
    expect(q('[data-track="text"] [data-testid="timeline-row-2"]')).not.toBeNull(); // the title
    expect(q('[data-track="gfx"] [data-testid="timeline-row-3"]')).not.toBeNull(); // the logo bug
    expect(q('[data-track="video"] [data-testid="timeline-storyline"]')).not.toBeNull();
    expect(q('[data-track="video"] .tl-track-name')?.textContent).toBe('Video');
  });

  test('an image on its own lands on Video 2, directly above Video (C35)', () => {
    mount(SEQ);
    expect(all('[data-track]').map((t) => t.getAttribute('data-track'))).toEqual([
      'text',
      'gfx',
      'video2',
      'video',
      'music',
    ]);
    expect(q('[data-track="video2"] [data-testid="timeline-row-4"]')).not.toBeNull();
    expect(q('[data-track="video2"] .tl-track-name')?.textContent).toBe('Video 2');
  });

  test('a bed is Music; a second one at the same time is Music 2; an empty Music says so', () => {
    mount(SEQ.slice(0, 2));
    expect(q('[data-track="music"] .tl-track-hint')?.textContent).toBe('No sound in this video.');
    act(() => root?.unmount());
    host?.remove();
    mount(SEQ.slice(0, 2), {
      audio: [
        { kind: 'audio', label: 'bed.mp3', src: 'a.mp3', from: 0, duration: 450 },
        { kind: 'audio', label: 'sting.mp3', src: 'b.mp3', from: 30, duration: 60 },
      ],
    });
    expect(q('[data-track="music"] .tl-track-hint')).toBeNull();
    expect(q('[data-track="music2"]')).not.toBeNull();
  });
});

describe('ruler', () => {
  test('a 15 s reel steps 3 s and reads m:ss', () => {
    mount(SEQ.slice(0, 2));
    const labels = all('.tl-tick-label').map((e) => e.textContent);
    expect(labels.slice(0, 4)).toEqual(['0:00', '0:03', '0:06', '0:09']);
  });

  test('the readout is the time over the length, with the frame in its title', () => {
    mount(SEQ.slice(0, 2), { frame: 212 });
    const r = q('[data-testid="timeline-readout"]');
    expect(r?.textContent).toBe('0:07/0:14');
    expect(r?.getAttribute('title')).toBe('Frame 212 of 449');
  });

  test('stepping shows the frame; the play button names its key', () => {
    playbackStore.markStep();
    mount(SEQ.slice(0, 2), { frame: 212 });
    expect(q('[data-testid="timeline-readout"] b')?.textContent).toBe('0:07 + 2 frames');
    expect(q('[data-testid="timeline-playpause"]')?.getAttribute('title')).toBe('Play — tap space');
  });
});

describe('loop band and poster', () => {
  test('I / O draw the band on the ruler and tint the lanes; nothing without one', () => {
    mount(SEQ.slice(0, 2));
    expect(q('[data-testid="timeline-loop-band"]')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    playbackStore.setLoop('c1', { in: 105, out: 270 });
    mount(SEQ.slice(0, 2));
    expect(q('[data-testid="timeline-loop-band"]')).not.toBeNull();
    expect(q('[data-testid="timeline-loop-lane"]')).not.toBeNull();
    expect(all('.tl-inout').map((e) => e.textContent)).toEqual(['I', 'O']);
  });

  test('the poster frame flags the ruler', () => {
    mount(SEQ.slice(0, 2));
    expect(q('[data-testid="timeline-poster-flag"]')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    mount(SEQ.slice(0, 2), { island: { poster: 105 } });
    expect(q('[data-testid="timeline-poster-flag"]')?.textContent).toBe('Poster');
  });
});
