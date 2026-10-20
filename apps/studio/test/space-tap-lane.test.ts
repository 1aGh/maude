// S7.8 — the canvas says `space-tap` (Space up inside 200 ms, no drag) and the shell plays the followed video —
// but only from the ACTIVE canvas's own window and origin (DDR-054), like every canvas → shell message.
import { describe, expect, test } from 'bun:test';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { createAnchorLane } from '../client/v2/timeline/anchor-lane.js';
import { createTimelineStore } from '../client/v2/timeline/timeline-store.js';

const win = {} as Window;
const msg = (data: Record<string, unknown>, source: unknown = win, origin = 'http://c.test') =>
  ({ data, source, origin }) as unknown as MessageEvent;
const lane = (onSpaceTap: () => void) =>
  createAnchorLane({
    canvasOrigin: () => 'http://c.test',
    activePath: () => '.design/a.tsx',
    frameOf: () => ({ contentWindow: win }),
    store: createTimelineStore(),
    onSpaceTap,
  });

describe('space-tap into the shell', () => {
  test('from the active canvas it plays once per tap', () => {
    let taps = 0;
    const l = lane(() => taps++);
    l.onMessage(msg({ dgn: 'space-tap' }));
    l.onMessage(msg({ dgn: 'space-tap' }));
    expect(taps).toBe(2);
  });

  test('another window, another origin: nothing plays', () => {
    let taps = 0;
    const l = lane(() => taps++);
    l.onMessage(msg({ dgn: 'space-tap' }, {} as Window));
    l.onMessage(msg({ dgn: 'space-tap' }, win, 'http://evil.test'));
    expect(taps).toBe(0);
  });

  test('a lane with no listener ignores it, and an anchor still reaches the store', () => {
    const store = createTimelineStore();
    const l = createAnchorLane({
      canvasOrigin: () => 'http://c.test',
      activePath: () => '.design/a.tsx',
      frameOf: () => ({ contentWindow: win }),
      store,
    });
    l.onMessage(msg({ dgn: 'space-tap' }));
    l.onMessage(
      msg({
        dgn: 'artboard-anchor',
        artboardId: 'r',
        kind: 'video',
        rect: { x: 1, y: 2, w: 3, h: 4 },
      })
    );
    expect(store.get().visible).toBe(true);
  });

  test('the protocol row is live, carries nothing, and the canvas wires the discriminator', async () => {
    const row = (
      DGN_TABLE.c2s as Record<string, { parse: (v: unknown) => unknown; status: string }>
    )['space-tap'];
    expect(row.status).toBe('live');
    expect(row.parse({})).toBeTruthy();
    const src = await Bun.file(new URL('../canvas-lib.tsx', import.meta.url)).text();
    expect(src).toContain("createSpaceTap, sendSpaceTap } from './editing/space-tap.ts'");
    expect(src).toContain('if (spaceTap.up(e.timeStamp)) sendSpaceTap(window);');
  });
});
