// The file plane never runs inside a cell (2026-10-02, alligators).
//
// A paired cell child shares the checkout with its hub. Once the materializer
// made that disk a cache (DDR-243), the child's file plane saw every media file
// the bucket holds and the disk does not as "missing", pulled them through its
// own hub, and re-decided the whole set every 20 s poll — a multi-second stall
// per poll. The gate is the fix; this pins it.

import { describe, expect, test } from 'bun:test';

import { fileSyncEnabled } from '../sync/index.ts';

describe('fileSyncEnabled', () => {
  test('off in a paired cell, whatever the tenant config or env says', () => {
    for (const linkedHub of [{}, { syncFiles: true }, { syncFiles: false }]) {
      for (const env of [{}, { MAUDE_SYNC_FILES: '1' }, { MAUDE_SYNC_FILES: '0' }]) {
        expect(
          fileSyncEnabled({ linkedHub, cellPairing: true, env: env as NodeJS.ProcessEnv })
        ).toBe(false);
      }
    }
  });

  test("a desktop keeps today's rules: on by default, opt-out by config or env", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(fileSyncEnabled({ linkedHub: {}, cellPairing: false, env })).toBe(true);
    expect(fileSyncEnabled({ linkedHub: { syncFiles: false }, cellPairing: false, env })).toBe(
      false
    );
    const off = { MAUDE_SYNC_FILES: '0' } as NodeJS.ProcessEnv;
    expect(fileSyncEnabled({ linkedHub: {}, cellPairing: false, env: off })).toBe(false);
    expect(fileSyncEnabled({ linkedHub: { syncFiles: true }, cellPairing: false, env: off })).toBe(
      true
    );
  });
});
