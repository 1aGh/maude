// p8-sweep-leftovers item 1: on a video with no clip, Split and "Captions from speech" rest and say why.
//
// The crawler clicked both on a just-created video artboard and saw nothing happen (Split's "Nothing under the
// playhead" toast is the shell's, captions ended on a notice inside the closed Transcript panel). With no clip there
// is nothing to split or caption, so both are disabled with their own existing lines; with a clip they act.

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
import { NO_SPEECH_TEXT } from '../client/v2/transcript/captions-api.js';

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
  mediaProps: {},
  from,
  duration: 120,
  keyframes: [],
});

function mount(sequences: unknown[]) {
  let splits = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <TimelineIslandContext.Provider value={{ size: 'full' }}>
        <TimelinePanel
          comps={[{ id: 'c1', fps: 30, durationInFrames: 240, width: 270, height: 480 }]}
          compId="c1"
          sequences={sequences}
          audio={[]}
          total={240}
          frame={0}
          height={300}
          onSelect={() => {}}
          onSplitAtPlayhead={() => {
            splits += 1;
          }}
        />
      </TimelineIslandContext.Provider>
    );
  });
  const q = (id: string) =>
    host?.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
  return {
    split: q('timeline-split'),
    captions: q('timeline-captions-tool'),
    splits: () => splits,
  };
}

describe('timeline tools on a video with no clip', () => {
  test('no clip: Split and Captions are disabled with their own lines', () => {
    const { split, captions, splits } = mount([]);
    expect(split).not.toBeNull();
    expect(captions).not.toBeNull();
    expect(split?.disabled).toBe(true);
    expect(split?.getAttribute('aria-description')).toBe('Nothing under the playhead to split.');
    expect(captions?.disabled).toBe(true);
    expect(captions?.getAttribute('aria-description')).toBe(NO_SPEECH_TEXT);
    act(() => split?.click());
    expect(splits()).toBe(0);
  });

  test('a clip: both act', () => {
    const { split, captions, splits } = mount([beat('a', 0)]);
    expect(split?.disabled).toBe(false);
    expect(split?.hasAttribute('aria-description')).toBe(false);
    expect(captions?.disabled).toBe(false);
    act(() => split?.click());
    expect(splits()).toBe(1);
  });
});
