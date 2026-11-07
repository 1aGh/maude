// 2.0.7 (#2) — the canvas frame waits for a build that outlives its request.
//
// design.studyfi.com, 2.0.6: after the hub restarted, the first open of the studyfi-v3 Design system
// canvas ended on "can't be drawn right now" with no details; Reload drew it at once. Reproduced on
// a copy with the build's request wait shortened: the module answered 503 "still being built", the
// frame's diagnose fetch answered 503 (or 200 once the build had finished) and the frame gave up
// either way. Runs the shell's own `importWhenBuilt` (lifted from the template between its markers)
// with the loader, the probe and the clock stubbed.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHELL = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
  'utf8'
);

type Probe = { ok: boolean; status: number; retryAfterS: number } | null;

function lift() {
  const begin = SHELL.indexOf('// build-wait:begin');
  const end = SHELL.indexOf('// build-wait:end');
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  // the region's own io object touches `import`/`fetch` only when called; the test passes its own
  return new Function(`${SHELL.slice(begin, end)}\nreturn importWhenBuilt;`)() as (
    url: string,
    io: unknown
  ) => Promise<unknown>;
}

function harness(outcomes: Array<'503' | '200' | 'gone'>, opts: { slowMs?: number } = {}) {
  const loads: string[] = [];
  const slept: number[] = [];
  let clock = 0;
  let built = false;
  let i = 0;
  const io = {
    load: async (u: string) => {
      loads.push(u);
      if (built) return { default: () => null };
      throw new TypeError('Failed to fetch dynamically imported module');
    },
    probe: async (): Promise<Probe> => {
      const o = outcomes[Math.min(i++, outcomes.length - 1)];
      clock += opts.slowMs ?? 20_000; // the server held the ask for its wait
      if (o === '200') {
        built = true;
        return { ok: true, status: 200, retryAfterS: 0 };
      }
      if (o === '503') return { ok: false, status: 503, retryAfterS: 5 };
      return { ok: false, status: 404, retryAfterS: 0 };
    },
    sleep: async (ms: number) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    onWaiting: () => {},
  };
  return { io, loads, slept };
}

test('a build that finished while the frame asked is imported, not reported as broken', async () => {
  const importWhenBuilt = lift();
  const h = harness(['200']);
  const mod = (await importWhenBuilt('/.design/system/a/design-system.tsx?fc=x', h.io)) as {
    default: unknown;
  };
  expect(typeof mod.default).toBe('function');
  expect(h.loads).toEqual([
    '/.design/system/a/design-system.tsx?fc=x',
    '/.design/system/a/design-system.tsx?fc=x&v=b1',
  ]);
});

test('"still being built" waits its Retry-After and asks again until the build lands', async () => {
  const importWhenBuilt = lift();
  const h = harness(['503', '503', '503', '200']);
  const mod = (await importWhenBuilt('/.design/x.tsx', h.io)) as { default: unknown };
  expect(typeof mod.default).toBe('function');
  expect(h.slept).toEqual([5000, 5000, 5000]);
  expect(h.loads.length).toBe(5);
  expect(h.loads[4]).toBe('/.design/x.tsx?v=b4');
});

test('a real failure still fails, at once', async () => {
  const importWhenBuilt = lift();
  const h = harness(['gone']);
  await expect(importWhenBuilt('/.design/x.tsx', h.io)).rejects.toThrow('Failed to fetch');
  expect(h.loads.length).toBe(1);
  expect(h.slept).toEqual([]);
});

test('the wait has a deadline: ten minutes of "still being built" ends in the error', async () => {
  const importWhenBuilt = lift();
  const h = harness(['503'], { slowMs: 60_000 });
  await expect(importWhenBuilt('/.design/x.tsx', h.io)).rejects.toThrow('Failed to fetch');
  expect(h.slept.length).toBeGreaterThan(3);
  expect(h.slept.length).toBeLessThan(12);
});

test('the frame mounts the canvas through it', () => {
  expect(SHELL).toContain('importWhenBuilt(canvasUrl, shellBuildIo)');
  expect(SHELL).not.toMatch(/\bimport\(canvasUrl\)/);
});
