// V2-3.3 — `maude-server --home` (V2-1.1 decision 1, §5.3): boots with no `.design/` anywhere,
// binds loopback, writes its info file (0600, mode:'home') and no `_server.json`; project mode
// without `.design/` still fails loud.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';

const SERVER = join(import.meta.dir, '..', 'server.ts');
const TOKEN = 'ef'.repeat(32);

async function waitFor(file: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    await Bun.sleep(50);
  }
  throw new Error(`no info file after ${ms} ms`);
}

describe('Home mode boot', () => {
  test('boots with no .design/, answers as Home, writes only its info file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'maude-home-boot-')); // empty: no .design/
    const state = mkdtempSync(join(tmpdir(), 'maude-home-bootstate-'));
    const info = join(state, 'shell', 'home.json');
    const proc = spawn({
      cmd: ['bun', 'run', SERVER, '--home'],
      cwd,
      env: {
        ...process.env,
        NO_OPEN: '1',
        MAUDE_NO_AUTOBUILD: '1',
        CLAUDE_PROJECT_DIR: cwd,
        MAUDE_HOME_STATE_DIR: state,
        MAUDE_INDEX_DIR: join(state, 'index'),
        MAUDE_HOME_TOKEN: TOKEN,
        MAUDE_SHELL_INFO_FILE: info,
        MAUDE_CLOUD_URL: 'http://127.0.0.1:9',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const rec = await waitFor(info);
      expect(rec).toMatchObject({ mode: 'home', pid: proc.pid });
      expect(rec.url).toBe(`http://127.0.0.1:${rec.port}`);
      expect(typeof rec.started).toBe('string');
      expect(statSync(info).mode & 0o777).toBe(0o600);

      const health = await fetch(`${rec.url}/_health`, { headers: { 'x-maude-home': '1' } });
      expect(await health.json()).toMatchObject({ ok: true, mode: 'home' });
      const cfg = (await (
        await fetch(`${rec.url}/_config`, { headers: { 'x-maude-home': '1' } })
      ).json()) as Record<string, unknown>;
      expect(cfg).toMatchObject({ mode: 'home', shell: 'home', cloudOrigin: 'http://127.0.0.1:9' });
      // a project route does not exist here
      expect(
        (await fetch(`${rec.url}/_api/ui-prefs`, { headers: { 'x-maude-home': '1' } })).status
      ).toBe(404);
      // the page loads (static lane)
      expect((await fetch(`${rec.url}/`)).headers.get('content-type')).toContain('text/html');

      expect(readdirSync(cwd)).toEqual([]); // no .design/, no _server.json, nothing
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
    expect(existsSync(info)).toBe(false); // its own record is removed on a clean stop
  }, 30_000);

  test('project mode without .design/ still fails loud', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'maude-home-noproj-'));
    const proc = spawn({
      cmd: ['bun', 'run', SERVER, '--root', cwd, '--port', '0'],
      cwd,
      env: { ...process.env, NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1', CLAUDE_PROJECT_DIR: cwd },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const code = await proc.exited;
    const err = await new Response(proc.stderr).text();
    expect(code).toBe(1);
    expect(err).toContain('no .design/ directory');
  }, 30_000);
});
