// The auto-approved loopback helper never forges the headers only a browser sends — the studio's
// privileged writes (migrate apply) rely on them (security review, Phase 1 gate — M3).
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { homeInfoFiles, isHomePort, parseRequestArgv } from '../bin/_curl-local.mjs';

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
