// killProc must END a server, not wait on it forever (V2-2.13).
//
// `figma-routes.test.ts` failed in 26 CI runs of the full studio suite between
// 2026-09-11 and 09-21 with the same signature: every test passed, then bun
// printed "killed 1 dangling process" and `(fail) (unnamed)` — its `afterAll`
// (`killProc(proc)`) timed out at 20 s because the server took SIGTERM and never
// exited. The studio's `shutdown()` awaits teardown steps with no bound, so one
// stuck step keeps `process.exit(0)` from ever running. A test that is not about
// shutdown must not fail on it, so killProc escalates to SIGKILL after a grace.

import { expect, test } from 'bun:test';
import { spawn } from 'bun';
import { killProc } from './_helpers.ts';

/** A child that prints "ready" once its SIGTERM behaviour is installed. */
async function child(ignoreSigterm: boolean) {
  const src = `${ignoreSigterm ? "process.on('SIGTERM', () => {});" : ''} setInterval(() => {}, 1000); console.log('ready');`;
  const proc = spawn({ cmd: [process.execPath, '-e', src], stdout: 'pipe', stderr: 'ignore' });
  await proc.stdout.getReader().read();
  return proc;
}

test('a process that ignores SIGTERM is SIGKILLed after the grace', async () => {
  const proc = await child(true);
  const t0 = Date.now();
  await killProc(proc, 300);
  expect(Date.now() - t0).toBeLessThan(5000);
  expect(proc.signalCode).toBe('SIGKILL');
}, 10000);

test('a process that honours SIGTERM exits on it, with no escalation', async () => {
  const proc = await child(false);
  await killProc(proc, 5000);
  expect(proc.signalCode).toBe('SIGTERM');
});

test('an already-exited process returns at once', async () => {
  const proc = spawn({ cmd: [process.execPath, '-e', '0'], stdout: 'ignore' });
  await proc.exited;
  const t0 = Date.now();
  await killProc(proc, 5000);
  expect(Date.now() - t0).toBeLessThan(1000);
});
