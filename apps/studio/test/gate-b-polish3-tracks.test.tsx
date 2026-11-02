// gate-b-polish3 (07 · C35) — a purely digital cut (three JSX beats in a TransitionSeries, a logo, a title) is drawn
// in the same four tracks as a media cut: Text · Graphics · Video · Music, top covers bottom. Before, it fell back to
// one bare lane per sequence ("beat-…"), so the build showed two track models.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TimelineIslandContext } from '../client/v2/timeline/island-context.js';
import TimelinePanel from '../client/v2/timeline/Timeline.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  document.body.innerHTML = '';
  root = null;
});

const scene = (i: number, label: string, over: Record<string, unknown> = {}) => ({
  stableId: `s${i}`,
  label,
  from: i * 60,
  duration: 60,
  mediaTag: label,
  keyframes: [],
  ...over,
});
const SEQS = [
  scene(0, 'beat-one', { series: true }),
  scene(1, 'beat-two', { series: true }),
  scene(2, 'beat-three', { series: true }),
  scene(3, 'logo', { from: 0, duration: 180 }),
  scene(4, 'title', { from: 0, duration: 90 }),
];
const AUDIO = [{ label: 'song.mp3', src: 'assets/song.mp3', from: 0, duration: 180 }];

function mount() {
  host = document.createElement('div');
  host.style.width = '1200px';
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(
        TimelineIslandContext.Provider,
        {
          value: {
            size: 'full',
            kept: false,
            onToggleSize: () => {},
            canvas: 'ui/Cut.tsx',
            canEdit: true,
            empty: null,
          },
        },
        createElement(TimelinePanel, {
          comps: [
            {
              id: 'c1',
              fps: 30,
              durationInFrames: 180,
              width: 480,
              height: 270,
              artboardId: 'cut',
            },
          ],
          compId: 'c1',
          sequences: SEQS,
          audio: AUDIO,
          total: 180,
          frame: 0,
          height: 260,
          onRetime: () => {},
          onSelect: () => {},
          onSeek: () => {},
          onClipVerb: () => {},
        })
      )
    );
  });
  return host;
}

const inTrack = (h: HTMLElement, id: string) =>
  [
    ...(h
      .querySelector(`[data-testid="timeline-track-${id}"]`)
      ?.querySelectorAll('[data-testid^="timeline-row-"], [data-testid^="timeline-audio-"]') ?? []),
  ]
    .map((e) => e.getAttribute('data-testid'))
    .filter((t) => /^timeline-(row|audio)-\d+$/.test(String(t)));

describe('07 · C35 — one track model for every cut', () => {
  test('a digital cut is drawn as Text · Graphics · Video · Music, in that order', () => {
    const h = mount();
    const order = [...h.querySelectorAll('[data-testid^="timeline-track-"]')]
      .map((e) => e.getAttribute('data-testid'))
      .filter((t) => /^timeline-track-[a-z0-9]+$/.test(String(t)));
    expect(order).toEqual([
      'timeline-track-text',
      'timeline-track-gfx',
      'timeline-track-video',
      'timeline-track-music',
    ]);
  });

  test('each row sits in its track and keeps its testid', () => {
    const h = mount();
    expect(inTrack(h, 'video')).toEqual(['timeline-row-0', 'timeline-row-1', 'timeline-row-2']);
    expect(inTrack(h, 'gfx')).toEqual(['timeline-row-3']);
    expect(inTrack(h, 'text')).toEqual(['timeline-row-4']);
    expect(inTrack(h, 'music')).toEqual(['timeline-audio-0']);
  });
});
