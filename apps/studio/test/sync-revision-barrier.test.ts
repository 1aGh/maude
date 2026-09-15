// Plan T14 — a multi-document revision shows whole on a receiving checkout.

import { describe, expect, test } from 'bun:test';

import { createRevisionBarrier } from '../sync/revision-barrier.ts';

const quiet = { warn() {} };

describe('revision barrier', () => {
  test('holds every document of a revision until the last arrives, then writes them in one tick', () => {
    const b = createRevisionBarrier({ timeoutMs: 10_000, log: quiet });
    const wrote: string[] = [];
    expect(b.arrive(7, 3, 'a', () => wrote.push('a'))).toBe(true);
    expect(b.arrive(7, 3, 'b', () => wrote.push('b'))).toBe(true);
    expect(wrote).toEqual([]);
    expect(b.arrive(7, 3, 'c', () => wrote.push('c'))).toBe(true);
    expect(wrote).toEqual(['a', 'b', 'c']);
    expect(b.waiting()).toEqual([]);
    // A late arrival for a released revision writes straight through.
    expect(b.arrive(7, 3, 'a', () => wrote.push('late'))).toBe(false);
    b.stop();
  });

  test('a single-document revision is never held', () => {
    const b = createRevisionBarrier({ log: quiet });
    expect(b.arrive(3, 1, 'a', () => {})).toBe(false);
    expect(b.waiting()).toEqual([]);
  });

  test('a document already on disk counts — before or after the others start waiting', () => {
    const b = createRevisionBarrier({ timeoutMs: 10_000, log: quiet });
    const wrote: string[] = [];
    b.present(9, 2, 'new'); // pulled and written before its sibling's update flushed
    expect(b.waiting()).toEqual([]); // presence never opens a wait on its own
    expect(b.arrive(9, 2, 'old', () => wrote.push('old'))).toBe(true);
    expect(wrote).toEqual(['old']);

    b.arrive(10, 2, 'x', () => wrote.push('x'));
    expect(wrote).toEqual(['old']);
    b.present(10, 2, 'y');
    expect(wrote).toEqual(['old', 'x']);
    b.stop();
  });

  test('a document this peer never gets does not wedge the rest', async () => {
    const warnings: string[] = [];
    const b = createRevisionBarrier({ timeoutMs: 30, log: { warn: (m: string) => warnings.push(m) } });
    const wrote: string[] = [];
    b.arrive(4, 3, 'a', () => wrote.push('a'));
    await new Promise((r) => setTimeout(r, 80));
    expect(wrote).toEqual(['a']);
    expect(warnings[0]).toContain('1 of 3');
    b.stop();
  });
});
