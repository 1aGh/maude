// `cpuMs` (#169 T8.1 item 5): a timing budget read in CPU time, so a loaded machine (the Mac mini lane
// running another suite) does not turn a wait for the scheduler into a fake regression. These pin the
// property that makes it load-independent: time spent NOT running is not counted, time spent working is.

import { describe, expect, test } from 'bun:test';
import { cpuMs } from './_perf-budget.ts';

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

describe('cpuMs', () => {
  test('time spent off the CPU is not counted', () => {
    const t0 = performance.now();
    const r = cpuMs(() => sleep(80));
    const wall = performance.now() - t0;
    expect(wall).toBeGreaterThanOrEqual(75);
    expect(r.ms).toBeLessThan(20);
    expect(r.result).toBe('timed-out');
  });

  test("another thread's work is not counted (GC/JIT helpers, a worker)", async () => {
    const w = new Worker(
      URL.createObjectURL(
        new Blob(
          [
            'self.onmessage = () => { const end = performance.now() + 150; while (performance.now() < end) {} postMessage(1); };',
          ],
          { type: 'application/javascript' }
        )
      )
    );
    const done = new Promise((r) => {
      w.onmessage = r;
    });
    w.postMessage(0);
    await Bun.sleep(20); // the worker is spinning now
    const r = cpuMs(() => sleep(80));
    await done;
    w.terminate();
    expect(r.ms).toBeLessThan(20);
  });

  test('time spent working is counted', () => {
    const r = cpuMs(() => {
      const end = performance.now() + 60;
      let n = 0;
      while (performance.now() < end) n++;
      return n;
    });
    expect(r.result).toBeGreaterThan(0);
    // Process CPU time can also carry a GC/JIT helper thread, never much less than the busy wall time.
    expect(r.ms).toBeGreaterThan(40);
  });
});
