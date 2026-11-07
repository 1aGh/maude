// 2.0.7 — the gate must not make an artboard under the overview cut wait for the settle mid-gesture.
// Measured in Safari (mascot, 10 % full sweep, 3 interleaved rounds): that wait alone put the sweep's tail over base
// (p99 ~80 -> ~120 ms, worst second 52 -> 31 frames); the ring's mid-gesture hold, the rAF gate and the artboard
// freeze cost nothing measurable (decision v2-207-drop-undercut-midgesture-wait).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GATE = readFileSync(join(import.meta.dir, '..', 'artboard-live-gate.tsx'), 'utf8');

describe('2.0.7 overview level: no mid-gesture wait under the cut', () => {
  test('the gate installs no mayWait predicate on the registry', () => {
    expect(GATE).not.toMatch(/registry\.setMayWait\s*\(/);
  });
});
