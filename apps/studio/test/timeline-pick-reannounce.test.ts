// P8 (V2-8.3 e2e r3) — a clip picked on the Timeline is edited in the right-hand inspector until the person picks
// something on the CANVAS (S7.10). A canvas that reloads (a file it depends on changed) re-announces the selection it
// already had: that is not a new pick (the same rule the Inspector follows, decision v2-p8-c6-ask-scope-pick-no-
// inspector), so it must not take the inspector back from the clip. Found by video-music / video-clip-inspector /
// video-edit-basics: the Music card vanished ~100 ms after it opened, between two WebDriver commands.
import { describe, expect, test } from 'bun:test';
import { createAnchorLane } from '../client/v2/timeline/anchor-lane.js';
import { createTimelineStore } from '../client/v2/timeline/timeline-store.js';

const win = {} as Window;
const msg = (data: Record<string, unknown>, source: unknown = win, origin = 'http://c.test') =>
  ({ data, source, origin }) as unknown as MessageEvent;
const reel = { file: '.design/ui/V.tsx', selector: '[data-dc-screen="reel"]', artboardId: 'reel' };
const title = { file: '.design/ui/V.tsx', selector: '[data-cd-id="title"]' };

function lane() {
  let released = 0;
  const l = createAnchorLane({
    canvasOrigin: () => 'http://c.test',
    activePath: () => '.design/ui/V.tsx',
    frameOf: () => ({ contentWindow: win }),
    store: createTimelineStore(),
    onCanvasSelect: () => released++,
  });
  return { l, released: () => released };
}

describe('a canvas pick lets go of the Timeline clip; a re-announced one does not', () => {
  test('the same selection announced again (a reload) releases nothing', () => {
    const { l, released } = lane();
    l.onMessage(msg({ dgn: 'select-set', selection: reel }));
    expect(released()).toBe(1); // the person's pick of the video
    // the person picks the music bed on the Timeline; the canvas reloads and says "reel" twice
    l.onMessage(msg({ dgn: 'select-set', selection: { ...reel } }));
    l.onMessage(msg({ dgn: 'select-set', selection: { ...reel } }));
    expect(released()).toBe(1);
  });

  test('a different pick, a cleared selection and a multi-selection each release', () => {
    const { l, released } = lane();
    l.onMessage(msg({ dgn: 'select-set', selection: reel }));
    l.onMessage(msg({ dgn: 'select-set', selection: title }));
    l.onMessage(msg({ dgn: 'select-set', selection: null }));
    l.onMessage(msg({ dgn: 'select-set', selection: [reel, title] }));
    l.onMessage(msg({ dgn: 'clear-select' }));
    expect(released()).toBe(5);
  });

  test('picking the same thing again after a deselect is a new pick', () => {
    const { l, released } = lane();
    l.onMessage(msg({ dgn: 'select-set', selection: reel }));
    l.onMessage(msg({ dgn: 'select-set', selection: null }));
    l.onMessage(msg({ dgn: 'select-set', selection: reel }));
    expect(released()).toBe(3);
  });

  test('another window or origin never releases, and does not move the memory', () => {
    const { l, released } = lane();
    l.onMessage(msg({ dgn: 'select-set', selection: reel }));
    l.onMessage(msg({ dgn: 'select-set', selection: title }, {} as Window));
    l.onMessage(msg({ dgn: 'select-set', selection: title }, win, 'http://evil.test'));
    l.onMessage(msg({ dgn: 'select-set', selection: reel }));
    expect(released()).toBe(1);
  });
});
