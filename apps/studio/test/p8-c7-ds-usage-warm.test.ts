// V2-8.5 round 7 — the first Design system board shows "Used in N canvases": the usage index is
// warmed after boot for a project that has systems, never for one that has none.
import { describe, expect, test } from 'bun:test';
import { warmDsUsage } from '../index/ds-usage.ts';

const noFile = () => ({}) as never;

describe('warmDsUsage', () => {
  test('builds the index once the scheduled tick runs, when the project has a system', () => {
    let built = 0;
    let tick: () => void = () => {};
    warmDsUsage(
      { file: () => (built++, noFile()) },
      () => true,
      (fn) => {
        tick = fn;
        return {};
      }
    );
    expect(built).toBe(0); // deferred, never on the boot path
    tick();
    expect(built).toBe(1);
  });
  test('a project with no design system is never scanned', () => {
    let built = 0;
    let tick: () => void = () => {};
    warmDsUsage(
      { file: () => (built++, noFile()) },
      () => false,
      (fn) => {
        tick = fn;
        return {};
      }
    );
    tick();
    expect(built).toBe(0);
  });
  test('a failing build is swallowed (the lazy path stays)', () => {
    let tick: () => void = () => {};
    warmDsUsage(
      {
        file: () => {
          throw new Error('x');
        },
      },
      () => true,
      (fn) => {
        tick = fn;
        return {};
      }
    );
    expect(() => tick()).not.toThrow();
  });
});
