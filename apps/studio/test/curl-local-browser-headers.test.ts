// The auto-approved loopback helper never forges the headers only a browser sends — the studio's
// privileged writes (migrate apply) rely on them (security review, Phase 1 gate — M3).
import { describe, expect, test } from 'bun:test';

import { parseRequestArgv } from '../bin/_curl-local.mjs';

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
