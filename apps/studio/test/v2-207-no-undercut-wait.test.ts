// 2.0.7 — the gate must not make an artboard under the overview cut wait for the settle mid-gesture.
// Measured in Safari (mascot, 10 % full sweep, 3 interleaved rounds): that wait alone put the sweep's tail over base
// (p99 ~80 -> ~120 ms, worst second 52 -> 31 frames); the ring's mid-gesture hold, the rAF gate and the artboard
// freeze cost nothing measurable (decision v2-207-drop-undercut-midgesture-wait).
// #169 T8.1b (lead decision A) narrows what may wait: mid-ZOOM, only an artboard that HAS a kept still (its
// placeholder shows it, so nothing blank is on screen) — the controller's `holdsForSettle`. Being under the cut is
// never the reason; an artboard with no still and every pure pan mount as before (v2-169-zoom-settle-handover).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GATE = readFileSync(join(import.meta.dir, '..', 'artboard-live-gate.tsx'), 'utf8');

describe('2.0.7 overview level: no mid-gesture wait under the cut', () => {
  test('the gate installs only the zoom-settle still hold as its mayWait predicate', () => {
    const calls = GATE.match(/registry\.setMayWait\s*\([^\n]*/g) ?? [];
    expect(calls).toEqual(['registry.setMayWait((id) => st.holdsForSettle(id));']);
    expect(GATE).not.toMatch(/setMayWait\([^)]*inOverviewCut/);
  });
});
