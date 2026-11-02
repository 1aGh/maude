// V2-1.1 decision 8 + §5.8 item 6 — authenticated shell ↔ server probes.
//
// The desktop shell reads a project server's port only from the app-owned info file
// (MAUDE_SHELL_INFO_FILE) and asks `GET /_api/shell/status` with the per-spawn
// MAUDE_SHELL_TOKEN. This file pins every gate of that route (token, wrong token, no env,
// browser headers, shape, canvas origin) and the info file itself, in a real boot.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { guardTableRoute } from '../http.ts';
import { createShellRoutes, type ShellRouteDeps, tokenMatches } from '../routes/shell.ts';
import { mountRoutes } from '../routes/table.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const TOKEN = 'a'.repeat(64);
const URL_ = 'http://127.0.0.1:4999/_api/shell/status';

function deps(over: Partial<ShellRouteDeps> = {}): ShellRouteDeps {
  return {
    token: () => TOKEN,
    version: () => '9.9.9',
    activity: () => [
      { chatId: 'c1', state: 'running' },
      { chatId: 'c2', state: 'awaiting-input' },
      { chatId: 'c3', state: 'idle' },
    ],
    runs: {
      openRuns: () =>
        [{ actor: 'claude-code' }, { actor: 'maude-chat' }] as ReturnType<
          NonNullable<ShellRouteDeps['runs']>['openRuns']
        >,
    },
    outbox: {
      content: () => ({ pending: 2 }),
      store: {
        list: () => [{ state: 'queued' }, { state: 'needs-you' }, { state: 'done' }],
      },
    } as unknown as ShellRouteDeps['outbox'],
    exportJobs: { list: () => [{ status: 'running' }, { status: 'done' }] },
    generateJobs: { list: () => [{ status: 'queued' }, { status: 'failed' }] },
    ...over,
  };
}

/** The route as http.ts mounts it: behind `guardTableRoute`. */
function call(d: ShellRouteDeps, headers: Record<string, string> = {}) {
  const [spec] = createShellRoutes(d).map(guardTableRoute);
  return spec?.handle(new Request(URL_, { headers: { host: '127.0.0.1:4999', ...headers } }), {});
}

describe('GET /_api/shell/status — gates', () => {
  test('the right token answers 200 with the four counts', async () => {
    const r = await call(deps(), { 'x-maude-shell': TOKEN });
    expect(r?.status).toBe(200);
    expect(r?.headers.get('cache-control')).toBe('no-store');
    expect(await r?.json()).toEqual({
      version: '9.9.9',
      // c1 running + the terminal Claude Code run (the Maude-chat run is c1/c2's own bracket)
      ai: { running: 2, awaiting: 1 },
      // 2 content-lane entries + queued + needs-you (done is final)
      unsent: 4,
      // running export + queued generation
      jobs: 2,
    });
  });

  test('a wrong token is 401', async () => {
    expect((await call(deps(), { 'x-maude-shell': `${TOKEN}x` }))?.status).toBe(401);
    expect((await call(deps(), { 'x-maude-shell': 'b'.repeat(64) }))?.status).toBe(401);
  });

  test('a missing token is 401', async () => {
    expect((await call(deps()))?.status).toBe(401);
  });

  test('no MAUDE_SHELL_TOKEN in this process: the route does not exist (404)', async () => {
    expect((await call(deps({ token: () => undefined }), { 'x-maude-shell': TOKEN }))?.status).toBe(
      404
    );
    expect((await call(deps({ token: () => '' }), { 'x-maude-shell': '' }))?.status).toBe(404);
  });

  test('the default token source is MAUDE_SHELL_TOKEN, read per request', async () => {
    const prior = process.env.MAUDE_SHELL_TOKEN;
    try {
      delete process.env.MAUDE_SHELL_TOKEN;
      const d = deps({ token: undefined });
      expect((await call(d, { 'x-maude-shell': TOKEN }))?.status).toBe(404);
      process.env.MAUDE_SHELL_TOKEN = TOKEN;
      expect((await call(d, { 'x-maude-shell': TOKEN }))?.status).toBe(200);
    } finally {
      if (prior === undefined) delete process.env.MAUDE_SHELL_TOKEN;
      else process.env.MAUDE_SHELL_TOKEN = prior;
    }
  });

  test('a browser never gets in, even with the token: Origin → 403', async () => {
    const r = await call(deps(), {
      'x-maude-shell': TOKEN,
      origin: 'http://127.0.0.1:4999',
    });
    expect(r?.status).toBe(403);
  });

  test('a browser never gets in, even with the token: Sec-Fetch-Site → 403', async () => {
    for (const site of ['same-origin', 'none', 'cross-site', 'same-site']) {
      const r = await call(deps(), { 'x-maude-shell': TOKEN, 'sec-fetch-site': site });
      expect(r?.status).toBe(403);
    }
  });

  test('a foreign Host (DNS rebinding) is refused before the token is looked at', async () => {
    const [spec] = createShellRoutes(deps()).map(guardTableRoute);
    const r = await spec?.handle(
      new Request(URL_, { headers: { host: 'evil.example:4999', 'x-maude-shell': TOKEN } }),
      {}
    );
    expect(r?.status).toBe(403);
  });

  test('a failing source reads as 0, never a 500', async () => {
    const boom = () => {
      throw new Error('boom');
    };
    const r = await call(
      deps({
        activity: boom,
        runs: { openRuns: boom },
        exportJobs: { list: boom },
        outbox: { content: boom, store: { list: boom } } as unknown as ShellRouteDeps['outbox'],
      }),
      { 'x-maude-shell': TOKEN }
    );
    expect(r?.status).toBe(200);
    expect(await r?.json()).toEqual({
      version: '9.9.9',
      ai: { running: 0, awaiting: 0 },
      unsent: 0,
      jobs: 0,
    });
  });

  test('tokenMatches is exact', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(null, TOKEN)).toBe(false);
    expect(tokenMatches('', TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN.slice(1), TOKEN)).toBe(false);
  });

  test('main origin only: never a canvas path', () => {
    const specs = createShellRoutes(deps());
    expect(specs.every((s) => s.origin === 'main')).toBe(true);
    expect(mountRoutes(specs).canvasPaths).toEqual([]);
  });
});

// ── a real boot: the info file, the route on both origins, /_config.profile ─────────────────

describe('a shell-spawned project server', () => {
  let proc: Subprocess | null = null;
  let root = '';
  let infoDir = '';
  let port = 0;

  beforeAll(async () => {
    root = makeSandbox().root;
    infoDir = mkdtempSync(join(tmpdir(), 'maude-shell-info-'));
    port = nextPort();
    proc = await bootServer(root, port, {
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_SHELL_TOKEN: TOKEN,
      MAUDE_SHELL_INFO_FILE: join(infoDir, 'p-1.json'),
      MAUDE_PROFILE_ID: 'work',
      MAUDE_PROFILE_LABEL: 'Work‮ account',
    });
    // /_health can answer a beat before the boot sequence writes the two files.
    for (let i = 0; i < 50 && !existsSync(join(infoDir, 'p-1.json')); i++) await Bun.sleep(50);
  });

  afterAll(async () => {
    if (proc) await killProc(proc);
    rmSync(root, { recursive: true, force: true });
    rmSync(infoDir, { recursive: true, force: true });
  });

  const serverJson = () => JSON.parse(readFileSync(join(root, '.design', '_server.json'), 'utf8'));
  const info = () => JSON.parse(readFileSync(join(infoDir, 'p-1.json'), 'utf8'));

  test('writes the info file (0600) with the same facts as _server.json, plus mode', () => {
    const s = serverJson();
    const i = info();
    expect(statSync(join(infoDir, 'p-1.json')).mode & 0o777).toBe(0o600);
    expect(i).toEqual({
      pid: s.pid,
      port: s.port,
      url: s.url,
      ...(s.canvasOrigin ? { canvasOrigin: s.canvasOrigin } : {}),
      started: s.started,
      mode: 'project',
    });
    expect(i.port).toBe(port);
    // _server.json keeps its own shape (no `mode`), and the token is in neither file.
    expect('mode' in s).toBe(false);
    expect(readFileSync(join(infoDir, 'p-1.json'), 'utf8')).not.toContain(TOKEN);
  });

  test('the main origin answers the token, refuses everything else', async () => {
    const base = `http://127.0.0.1:${port}/_api/shell/status`;
    const ok = await fetch(base, { headers: { 'x-maude-shell': TOKEN } });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(Object.keys(body).sort()).toEqual(['ai', 'jobs', 'unsent', 'version']);
    expect(body.ai).toEqual({ running: 0, awaiting: 0 });
    expect(typeof body.version).toBe('string');
    expect((await fetch(base)).status).toBe(401);
    expect(
      (
        await fetch(base, {
          headers: { 'x-maude-shell': TOKEN, origin: `http://localhost:${port}` },
        })
      ).status
    ).toBe(403);
  });

  test('the canvas origin does not serve it, token or not', async () => {
    const canvasOrigin = info().canvasOrigin as string | undefined;
    expect(canvasOrigin).toBeTruthy();
    const r = await fetch(`${canvasOrigin}/_api/shell/status`, {
      headers: { 'x-maude-shell': TOKEN },
    });
    expect(r.status).not.toBe(200);
    expect([403, 404]).toContain(r.status);
    expect(await r.text()).not.toContain('"unsent"');
  });

  test('/_config names the profile, sanitized', async () => {
    const cfg = await (await fetch(`http://127.0.0.1:${port}/_config`)).json();
    expect(cfg.profile).toEqual({ id: 'work', label: 'Work account' });
  });
});
