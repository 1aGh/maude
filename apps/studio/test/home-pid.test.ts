// V2-3.3 — the project id (V2-1.1 §5.2). Rust pins the same vector (`cargo test windows`), so a
// change to the derivation on either side is a red test on that side.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isPid, PID_RE, pidOf } from '../home/pid.ts';

describe('pidOf (V2-1.1 §5.2)', () => {
  test('the TS ↔ Rust parity vector', () => {
    expect(pidOf('/Users/x/Maude/alligators')).toBe('l6ff9cde02f1b516d');
  });

  test('hashes the realpath: a symlink to a project is the same project', () => {
    const real = realpathSync(mkdtempSync(join(tmpdir(), 'maude-pid-')));
    const link = `${real}-link`;
    symlinkSync(real, link);
    expect(pidOf(link)).toBe(pidOf(real));
  });

  test('every pid has the one shape the routes accept', () => {
    expect(PID_RE.test(pidOf('/anything'))).toBe(true);
    expect(isPid('l6ff9cde02f1b516d')).toBe(true);
    for (const bad of [
      '',
      'L6ff9cde02f1b516d',
      'l6ff9cde02f1b516',
      '../etc',
      'l6ff9cde02f1b516d/x',
      42,
    ])
      expect(isPid(bad)).toBe(false);
  });
});
