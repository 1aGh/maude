// V2-8.5 c4-video (07 ve-text): "+ Title" selects the clip it inserted so the Title inspector opens. The insert rewrites the
// canvas file, the canvas reloads and posts its own `select` — which used to release the clip 200 ms later (measured).
// The Timeline's selection takes a short shield after a programmatic pick: a canvas select inside the window does not
// clear it; a real pick after the window does.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timelineSelection } from '../client/v2/timeline/selection.js';

const snap = (stableId: string, deselect = () => {}) =>
  ({ kind: 'title', canvas: 'c.tsx', artboardId: 'a', fps: 30, label: 'Title', stableId, seq: {}, transitionAfter: null, deselect }) as never;

describe('timelineSelection.shield', () => {
  test('a canvas select inside the shield leaves the clip selected', () => {
    let deselected = 0;
    timelineSelection.set(snap('Comp#3', () => deselected++));
    timelineSelection.shield(10_000);
    timelineSelection.release();
    expect(timelineSelection.get()?.stableId).toBe('Comp#3');
    expect(deselected).toBe(0);
    timelineSelection.shield(0);
    timelineSelection.release();
    expect(timelineSelection.get()).toBeNull();
    expect(deselected).toBe(1);
  });

  test('app.jsx shields the selection when "+ Title" picks the inserted clip', () => {
    const app = readFileSync(join(import.meta.dir, '../client/app.jsx'), 'utf8');
    const at = app.indexOf("shellToast('Title added.', true)");
    expect(app.slice(at, at + 800)).toMatch(/timelineSelection\.shield\(/);
  });
});
