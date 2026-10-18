// V2-5 suite-fix A3: nextPort() never hands out a port something on this machine already listens on
// (acl-l21-capture drew 8384 — Syncthing's GUI — and bootServer timed out after 15 s).
import { expect, test } from 'bun:test';
import { nextPort } from './_helpers.ts';

test('nextPort skips a port that is already held', () => {
  const p = nextPort();
  const held = Bun.listen({ hostname: '127.0.0.1', port: p + 1, socket: { data() {} } });
  try {
    const q = nextPort();
    expect(q).not.toBe(p + 1);
    expect(q).toBeGreaterThan(p + 1);
  } finally {
    held.stop(true);
  }
});
