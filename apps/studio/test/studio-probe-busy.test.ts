// fix/ds-convert-hooks-cli #13 — under load `/_health` did not answer within the verbs' one 1.5 s
// probe, so `maude design history` / `trash` said "no Maude studio is running" while it ran. The
// probe now waits longer and retries, and a live studio that stays silent is reported busy.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { locateStudio, probeStudio, rootIdentity } from '../../../cli/lib/studio-locate.mjs';

const HISTORY = join(import.meta.dir, '..', 'bin', '_history.mjs');

let root: string;
let server: ReturnType<typeof Bun.serve>;
let mode: 'slow-once' | 'silent' = 'slow-once';
let hits = 0;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maude-probe-busy-')));
  mkdirSync(join(root, '.design'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), '{}');
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== '/_health') return Response.json({ entries: [] });
      hits++;
      if (mode === 'silent' || hits === 1) await Bun.sleep(1500);
      return Response.json({ app: 'design', rootId: rootIdentity(root) });
    },
  });
  writeFileSync(
    join(root, '.design', '_server.json'),
    JSON.stringify({ pid: process.pid, port: server.port })
  );
});
afterAll(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe('#13 a busy studio is not "not running"', () => {
  test('one short probe misses a slow /_health; the retrying probe finds the studio', async () => {
    mode = 'slow-once';
    hits = 0;
    expect(await locateStudio(root, { timeoutMs: 300 })).toBeNull();
    hits = 0;
    const r = await probeStudio(root, { timeoutMs: 300, attempts: 3, retryDelayMs: 50 });
    expect(r.studio?.port).toBe(server.port);
    expect(hits).toBe(2);
  });

  test('a live studio that never answers is busy; no server file is none', async () => {
    mode = 'silent';
    const busy = await probeStudio(root, { timeoutMs: 200, attempts: 2, retryDelayMs: 10 });
    expect(busy.state).toBe('busy');
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'maude-probe-none-')));
    try {
      expect((await probeStudio(empty, { timeoutMs: 200 })).state).toBe('none');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test('the verb says the studio is busy, not that none is running', async () => {
    mode = 'silent';
    const p = Bun.spawn(['node', HISTORY, 'list', 'ui/C.tsx', '--root', root], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, MAUDE_HEALTH_TIMEOUT_MS: '200', MAUDE_NO_UPDATE_CHECK: '1' },
    });
    const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
    expect(err).toContain('is busy');
    expect(err).not.toContain('no Maude studio is running');
    expect(code).toBe(3);
  });
});
