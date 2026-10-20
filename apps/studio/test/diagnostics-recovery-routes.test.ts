// S11.17 (C37) — routes/diagnostics.ts: the crash line's last-work time, the full-disk hold, Retry.
// Main origin only (in neither canvas allowlist); the GETs are reads a read-only session may make,
// Retry writes canvas files and is refused read-only.

import { describe, expect, test } from 'bun:test';

import { CANVAS_SAFE_API } from '../http.ts';
import { createDiagnosticsRoutes, lastWorkAt } from '../routes/diagnostics.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes } from '../routes/table.ts';
import { createWriteHold } from '../sync/write-hold.ts';
import { stubDeps } from './_route-stubs.ts';

const PATHS = [
  '/_api/diagnostics/last-work',
  '/_api/diagnostics/disk',
  '/_api/diagnostics/disk-retry',
];

describe('the recovery routes in the one table', () => {
  test('main origin only; the reads are allowed read-only, Retry is refused', () => {
    const specs = allSpecs(stubDeps()).filter((s) => PATHS.includes(s.path));
    expect(specs.map((s) => [s.method, s.path, s.origin, s.readOnly])).toEqual([
      ['GET', '/_api/diagnostics/last-work', 'main', 'allowed'],
      ['GET', '/_api/diagnostics/disk', 'main', 'allowed'],
      ['POST', '/_api/diagnostics/disk-retry', 'main', 'refused'],
    ]);
    const mounted = mountRoutes(allSpecs(stubDeps()));
    for (const p of PATHS) {
      expect(mounted.canvasPaths).not.toContain(p);
      expect(CANVAS_SAFE_API.has(p)).toBe(false);
    }
    expect(mounted.readOnlyAllowed.exact).not.toContain('/_api/diagnostics/disk-retry');
  });
});

describe('last-work', () => {
  test("this person's newest accepted action", async () => {
    const asked: unknown[] = [];
    const rt = {
      acceptedHistory: async (q: unknown) => {
        asked.push(q);
        return [{ committedAt: 1_760_000_000_000 }];
      },
    };
    const [spec] = createDiagnosticsRoutes({ control: () => rt });
    const r = await spec.handle(new Request('http://localhost/_api/diagnostics/last-work'), {});
    expect(await r.json()).toEqual({ lastWorkAt: 1_760_000_000_000 });
    expect(asked).toEqual([{ limit: 1, mine: true }]);
  });

  test('no home, no rows, a refusal or a home that does not answer → null (never a hung relaunch)', async () => {
    expect(await lastWorkAt(null)).toBeNull();
    expect(await lastWorkAt({ acceptedHistory: async () => [] })).toBeNull();
    expect(await lastWorkAt({ acceptedHistory: async () => null })).toBeNull();
    expect(
      await lastWorkAt({
        acceptedHistory: async () => {
          throw new Error('offline');
        },
      })
    ).toBeNull();
    const t0 = Date.now();
    expect(await lastWorkAt({ acceptedHistory: () => new Promise(() => {}) }, 30)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('disk + disk-retry', () => {
  test('the hold is reported while held; Retry lands it once and says so', async () => {
    let room = false;
    const landed: string[] = [];
    const hold = createWriteHold({
      now: () => 42,
      write: async (key) => {
        if (!room) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
        landed.push(key);
      },
    });
    const specs = createDiagnosticsRoutes({ control: () => null, hold });
    const disk = specs.find((s) => s.path === '/_api/diagnostics/disk');
    const retry = specs.find((s) => s.path === '/_api/diagnostics/disk-retry');
    const get = async () =>
      (await disk?.handle(new Request('http://localhost/_api/diagnostics/disk'), {}))?.json();
    const post = async () =>
      (
        await retry?.handle(
          new Request('http://localhost/_api/diagnostics/disk-retry', { method: 'POST' }),
          {}
        )
      )?.json();

    expect(await get()).toEqual({ full: false, held: 0, since: null });
    await hold.put('/p/A.tsx', 'v1');
    expect(await get()).toEqual({ full: true, held: 1, since: 42 });
    expect(await post()).toEqual({ landed: 0, held: 1, full: true });
    room = true;
    expect(await post()).toEqual({ landed: 1, held: 0, full: false });
    expect(await post()).toEqual({ landed: 0, held: 0, full: false });
    expect(landed).toEqual(['/p/A.tsx']);
    hold.close();
  });
});
