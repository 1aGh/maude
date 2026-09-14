import { describe, expect, test } from 'bun:test';
import { createDocumentDiscovery } from '../sync/document-discovery.ts';

function clock() {
  let now = 0;
  let timer: { cb: () => void; due: number } | null = null;
  return {
    now: () => now,
    setTimer: (cb: () => void, ms: number) => {
      timer = { cb, due: now + ms };
      return { unref() {} } as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      timer = null;
    },
    async tick(ms: number) {
      now += ms;
      if (timer && timer.due <= now) {
        const cb = timer.cb;
        timer = null;
        cb();
      }
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('document discovery queue', () => {
  test('coalesces a burst and retains a notification arriving during an old read', async () => {
    const time = clock();
    let runs = 0;
    let release = () => {};
    const queue = createDocumentDiscovery({
      ...time,
      onError: () => {},
      run: async () => {
        runs++;
        if (runs === 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      },
    });
    for (let i = 0; i < 100; i++) queue.schedule();
    await time.tick(50);
    expect(runs).toBe(1);
    for (let i = 0; i < 100; i++) queue.schedule();
    await time.tick(1000);
    expect(runs).toBe(1); // no concurrent fetch/materialization
    release();
    await Promise.resolve();
    await Promise.resolve();
    await time.tick(50);
    expect(runs).toBe(2); // dirty signal is not lost behind the first response
    await time.tick(1000);
    expect(runs).toBe(2);
    queue.stop();
  });

  test('bounds sustained invalidation and flush shares the same serialized queue', async () => {
    const time = clock();
    let runs = 0;
    const queue = createDocumentDiscovery({
      ...time,
      onError: () => {},
      run: async () => {
        runs++;
      },
    });
    queue.schedule();
    await time.tick(50);
    queue.schedule();
    const done = queue.flush();
    await time.tick(249);
    expect(runs).toBe(1);
    await time.tick(1);
    await done;
    expect(runs).toBe(2);
    queue.stop();
  });

  test('failure does not poison later reads and stopping resolves queued waiters', async () => {
    const time = clock();
    let runs = 0;
    const errors: unknown[] = [];
    const queue = createDocumentDiscovery({
      ...time,
      onError: (e) => errors.push(e),
      run: async () => {
        if (++runs === 1) throw new Error('offline');
      },
    });
    queue.schedule();
    await time.tick(50);
    expect(errors).toHaveLength(1);
    const done = queue.flush();
    await time.tick(250);
    await done;
    expect(runs).toBe(2);
    const pending = queue.flush();
    queue.stop();
    await pending;
    await time.tick(1000);
    expect(runs).toBe(2);
  });
});
