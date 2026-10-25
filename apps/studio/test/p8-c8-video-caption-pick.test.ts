// P8 C8 (07 · ve-captions) — picking a caption chip keeps the Captions inspector: the canvas's own `select` echo that
// follows the seek must not release it.

import { afterEach, describe, expect, test } from 'bun:test';

import { pickCaption } from '../client/v2/timeline/lanes/caption-lane.jsx';
import { timelineSelection } from '../client/v2/timeline/selection.js';

afterEach(() => timelineSelection.set(null));

describe('pickCaption', () => {
  test('selects the caption and survives the canvas select echo', () => {
    let released = 0;
    timelineSelection.set({ kind: 'clip', canvas: 'c', stableId: 'x', deselect: () => released++ });
    pickCaption({ canvas: 'c', artboardId: 'a', fps: 30, media: { captions: {}, words: [] }, key: 'k' });
    expect(released).toBe(1); // the clip's highlight let go
    expect(timelineSelection.get()?.kind).toBe('caption');
    timelineSelection.release(); // the canvas echo
    expect(timelineSelection.get()?.kind).toBe('caption');
  });
});
