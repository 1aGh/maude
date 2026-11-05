// Maude 2.0.4 task O — the occluded-insets seed ladder must not keep a canvas window alive after its run.
//
// Measured on 2.0.3 (Chromium heap snapshot after 8 in-app canvas switches, GC forced): every canvas the person had
// opened was still in memory, held by ONE path — window.fetch's closure → the insets lane → the hook's `cancels`
// Set → one ladder-cancel closure per canvas load → that canvas's window. The Set only ever grew, so each open kept
// a whole canvas page (~14 MB in WebKit, uninstrumented) for the life of the tab: ~2 GB over a 160-canvas project.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createInsetsPump,
  SEED_LADDER_MS,
  seedOnLadder,
} from '../client/v2/shell/occlusion-insets.js';

const Z = { top: 0, right: 0, bottom: 0, left: 0 };
const rig = () => {
  const sent: unknown[] = [];
  const pump = createInsetsPump({
    measure: () => Z,
    send: (...a: unknown[]) => sent.push(a),
    schedule: () => 1,
  });
  const timers: Array<{ fn: () => void; live: boolean }> = [];
  const opts = {
    setTimer: (fn: () => void) => {
      const t = { fn, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (t: { live: boolean }) => {
      t.live = false;
    },
  };
  return { pump, sent, timers, opts };
};

describe('seed ladder lets go of its window', () => {
  test('onDone fires once, after the last rung', () => {
    const r = rig();
    let done = 0;
    seedOnLadder(r.pump, 'win', { ...r.opts, onDone: () => done++ });
    expect(r.timers).toHaveLength(SEED_LADDER_MS.length);
    for (const t of r.timers.slice(0, -1)) t.fn();
    expect(done).toBe(0);
    r.timers[r.timers.length - 1].fn();
    expect(done).toBe(1);
  });

  test('a cancelled ladder is done too (once)', () => {
    const r = rig();
    let done = 0;
    const cancel = seedOnLadder(r.pump, 'win', { ...r.opts, onDone: () => done++ });
    cancel();
    cancel();
    expect(done).toBe(1);
    expect(r.timers.every((t) => !t.live)).toBe(true);
  });

  test("the insets hook drops a ladder's cancel from its set when the ladder is done", () => {
    const src = readFileSync(
      join(import.meta.dir, '../client/v2/shell/use-occluded-insets.js'),
      'utf8'
    );
    expect(src).toMatch(/onDone: \(\) => cancels\.delete\(cancel\)/);
  });
});
