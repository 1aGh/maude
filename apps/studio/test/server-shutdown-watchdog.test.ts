// V2-2.8 B4 — SIGTERM must end the server even when a teardown step never settles.
import { afterEach, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import type { Subprocess } from 'bun';

import { bootServer, makeSandbox, nextPort, type Sandbox } from './_helpers.ts';

let box: Sandbox | null = null;
let proc: Subprocess | null = null;
afterEach(() => {
  try {
    proc?.kill('SIGKILL');
  } catch {
    /* gone */
  }
  if (box) rmSync(box.root, { recursive: true, force: true });
});

test('a hung teardown is cut off by the shutdown watchdog', async () => {
  box = makeSandbox();
  proc = await bootServer(box.root, nextPort(), {
    MAUDE_NO_AUTOBUILD: '1',
    NO_OPEN: '1',
    MAUDE_TEST_HANG_SHUTDOWN: '1',
    MAUDE_SHUTDOWN_WATCHDOG_MS: '800',
  });
  const t0 = Date.now();
  proc.kill('SIGTERM');
  const code = await Promise.race([
    proc.exited,
    new Promise((r) => setTimeout(() => r('hung'), 6000)),
  ]);
  expect(code).not.toBe('hung');
  expect(Date.now() - t0).toBeLessThan(6000);
}, 20000);
