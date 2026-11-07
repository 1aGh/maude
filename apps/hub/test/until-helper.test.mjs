// The one run-time wait helper for hub tests (issue #171). A wall-clock
// deadline also charges time the process spent frozen (a starved runner, a
// stopped process), so it fires before the socket data queued behind the
// freeze is read — a fabricated "hub never answered". `_until.mjs` counts the
// time the process RAN; every hub test waits through it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { until } from './_until.mjs';

describe('the wait helper charges only the time the process ran', () => {
  // The same process that serves the hub runs the wait, so a freeze stops both:
  // what was queued behind it (here a flag, on a real hub the socket's answer)
  // is read one tick after the freeze, and the wait must still be waiting then.
  const freeze = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

  test('a freeze longer than the deadline is not a hang', async () => {
    let ready = false;
    setTimeout(() => {
      freeze(900);
      // Queued after the wait's own overdue tick, as a socket's data would be.
      setTimeout(() => {
        ready = true;
      }, 1);
    }, 30);
    await until(() => ready, 300, 'the flag set behind the freeze');
  });

  test('a condition that never holds still fails, and says how long it ran', async () => {
    await assert.rejects(
      until(() => false, 200, 'never'),
      /^Error: never not reached before deadline \(ran \d+ ms, frozen 0 ms\)$/
    );
  });

  test('the failure carries the caller explanation', async () => {
    await assert.rejects(
      until(
        () => false,
        60,
        'never',
        () => 'the trail'
      ),
      /— the trail$/
    );
  });
});

describe('no hub test keeps its own wall-clock wait', () => {
  test('every test file waits through _until.mjs', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const own = readdirSync(dir)
      .filter((f) => f.endsWith('.mjs') && f !== '_until.mjs' && f !== 'until-helper.test.mjs')
      .filter((f) => {
        const text = readFileSync(join(dir, f), 'utf8');
        return /(?:async\s+function|function)\s+until\b/.test(text);
      });
    assert.deepEqual(own, [], 'these files define their own until(); import it from ./_until.mjs');
  });
});
