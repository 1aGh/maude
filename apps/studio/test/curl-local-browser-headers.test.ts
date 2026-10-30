// The auto-approved loopback helper never forges the headers only a browser sends — the studio's
// privileged writes (migrate apply) rely on them (security review, Phase 1 gate — M3).
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  homeInfoFiles,
  isHomePort,
  isTokenBridgePort,
  parseRequestArgv,
  tokenBridgeFiles,
} from '../bin/_curl-local.mjs';

describe('curl-local refuses browser headers', () => {
  for (const h of ['Sec-Fetch-Site: same-origin', 'origin: http://localhost:4399', 'Referer: x'])
    test(h, () => {
      expect(() =>
        parseRequestArgv(['--method', 'POST', '--header', h, 'http://127.0.0.1:4399/_api/x'])
      ).toThrow(/browser header/);
    });
  test('ordinary headers still pass', () => {
    const r = parseRequestArgv([
      '--header',
      'Content-Type: application/json',
      'http://127.0.0.1:1/',
    ]);
    expect(r.headers).toEqual(['Content-Type: application/json']);
  });
});

// V2-3.6 H1 (defence in depth) — the Home server's page capability rides in `x-maude-home`; the
// loopback helper never sends it, in any case, and never targets the Home port the app-owned
// info file names.
describe('curl-local refuses the Home server', () => {
  for (const h of [
    'x-maude-home: 1',
    'X-Maude-Home: abc',
    'X-MAUDE-HOME:1',
    'x-maude-home : 1',
    'x-maude-home:',
  ])
    test(h, () => {
      expect(() => parseRequestArgv(['--header', h, 'http://127.0.0.1:4500/_home/cloud'])).toThrow(
        /Home/
      );
    });

  test('a header that merely contains the name still passes', () => {
    expect(
      parseRequestArgv(['--header', 'x-note: x-maude-home', 'http://127.0.0.1:1/']).headers
    ).toEqual(['x-note: x-maude-home']);
  });

  test('the Home port named by the info file is refused; other ports are not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-local-home-'));
    const info = join(dir, 'home-server.json');
    const rec = { pid: 1, port: 4567, url: 'http://127.0.0.1:4567', mode: 'home' };
    writeFileSync(info, JSON.stringify(rec));
    expect(isHomePort(4567, [info])).toBe(true);
    expect(isHomePort(4568, [info])).toBe(false);
    expect(isHomePort(4567, [join(dir, 'missing.json')])).toBe(false);
    writeFileSync(info, '{not json');
    expect(isHomePort(4567, [info])).toBe(false);
    writeFileSync(info, JSON.stringify({ ...rec, mode: 'project' }));
    expect(isHomePort(4567, [info])).toBe(false);
  });

  test('the default info files are the app-owned ones (prod + e2e identifiers)', () => {
    const files = homeInfoFiles();
    for (const id of ['com.maude.app', 'com.maude.app.e2e'])
      expect(files.some((f) => f.includes(`/${id}/run/home-server.json`))).toBe(true);
  });
});

// V2-3.6 M4 — the token-bridge key (`MAUDE_TOKEN_KEY`, readable with `ps -Eww` from the
// sidecar's env) is never sent by the auto-allowed helper, in any spelling, and the bridge
// port the app-owned record names is never a target. An approved ARBITRARY command can still
// do both (accepted under P3; keychain.rs `bridge_port_record`).
describe('curl-local refuses the token bridge', () => {
  for (const h of [
    'X-Maude-Token-Key: abc',
    'x-maude-token-key:abc',
    'X-MAUDE-TOKEN-KEY: 1',
    'x-maude-token-key : 1',
    ' x-maude-token-key: 1',
    'x-maude-token-key;',
    'x-note: a\r\nX-Maude-Token-Key: k', // CRLF smuggling
    'x-note: a\nx-maude-token-key: k',
  ])
    test(JSON.stringify(h), () => {
      expect(() => parseRequestArgv(['--header', h, 'http://127.0.0.1:4500/'])).toThrow(
        /token|line break/i
      );
    });

  test('no header and no user agent may carry a line break', () => {
    expect(() => parseRequestArgv(['--header', 'a: b\rc', 'http://127.0.0.1:1/'])).toThrow(
      /line break/
    );
    expect(() =>
      parseRequestArgv(['--user-agent', 'ua\r\nX-Maude-Token-Key: k', 'http://127.0.0.1:1/'])
    ).toThrow(/line break/);
  });

  test('the bridge port named by the app-owned record is refused; other ports are not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-local-bridge-'));
    const rec = join(dir, 'token-bridge.json');
    writeFileSync(rec, JSON.stringify({ mode: 'token-bridge', port: 4777, pid: 1 }));
    expect(isTokenBridgePort(4777, [rec])).toBe(true);
    expect(isTokenBridgePort(4778, [rec])).toBe(false);
    expect(isTokenBridgePort(4777, [join(dir, 'missing.json')])).toBe(false);
    writeFileSync(rec, JSON.stringify({ mode: 'home', port: 4777 }));
    expect(isTokenBridgePort(4777, [rec])).toBe(false);
  });

  test('the default bridge records are the app-owned ones (prod + e2e identifiers)', () => {
    const files = tokenBridgeFiles();
    for (const id of ['com.maude.app', 'com.maude.app.e2e'])
      expect(files.some((f) => f.includes(`/${id}/run/token-bridge.json`))).toBe(true);
  });

  test('the CLI refuses the bridge port before running curl (exit 3)', () => {
    const home = mkdtempSync(join(tmpdir(), 'curl-local-bridge-home-'));
    const run = join(home, 'Library', 'Application Support', 'com.maude.app', 'run');
    mkdirSync(run, { recursive: true });
    writeFileSync(
      join(run, 'token-bridge.json'),
      JSON.stringify({ mode: 'token-bridge', port: 4779 })
    );
    const r = Bun.spawnSync({
      cmd: [
        'node',
        join(import.meta.dir, '..', 'bin', '_curl-local.mjs'),
        'http://127.0.0.1:4779/_tauri/github-token',
      ],
      env: {
        ...process.env,
        HOME: home,
        XDG_DATA_HOME: join(home, 'Library', 'Application Support'),
      },
    });
    expect(r.exitCode).toBe(3);
    expect(r.stderr.toString()).toContain('token bridge');
  });
});
