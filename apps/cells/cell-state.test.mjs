// The park probe and the change signal (2026-10-05, "an idle desktop lets its
// cloud cell sleep").
//
// A parked desktop asks `GET /_cell/state` every minute. The whole design rests
// on the DO answering that ALONE — a probe that reached the container, or
// renewed its activity timer, would keep the cell up exactly as an open
// desktop did. Pinned here:
//
//   - the gate: only the sync client's shape is answered; anything else is
//     today's behaviour, unchanged;
//   - the answer: `running`/`asleep` from the platform flag, `changedAt` and
//     `at` floored to the minute on the DO's own clock;
//   - the DO path never calls `containerFetch`, `renewActivityTimeout` or a
//     start, and runs before `wakePolicy` (every `/_*` path wakes);
//   - the change signal reaches the cell the RUNTIME names, never one the
//     container chose, and the hub and cell agree on its path.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { CHANGE_SIGNAL_PATH as HUB_CHANGE_SIGNAL_PATH } from '../hub/src/cell-change-signal.mjs';
import {
  CELL_STATE_PATH,
  cellStateAnswer,
  floorToMinute,
  isCellStateProbe,
  SYNC_PARK_HEADER,
  wakesWithoutAsking,
} from './cell-config.mjs';
import { CHANGE_SIGNAL_PATH, projectStoreOutbound } from './project-store.mjs';

const URL_ = 'https://alligators.cloud.maude.sh/_cell/state';
const probe = (over = {}) => ({
  method: 'GET',
  url: URL_,
  headers: new Headers({ authorization: 'Bearer mau_x', [SYNC_PARK_HEADER]: '1' }),
  canvas: false,
  ...over,
});

describe('isCellStateProbe — the gate', () => {
  it('the sync client shape is answered', () => {
    assert.equal(isCellStateProbe(probe()), true);
  });

  it('anything else falls through to today', () => {
    const cases = [
      probe({ method: 'POST' }),
      probe({ canvas: true }),
      probe({ url: 'https://alligators.cloud.maude.sh/_cell/states' }),
      probe({ url: 'https://alligators.cloud.maude.sh/' }),
      probe({ headers: new Headers({ authorization: 'Bearer mau_x' }) }),
      probe({ headers: new Headers({ [SYNC_PARK_HEADER]: '1' }) }),
      probe({ headers: new Headers({ authorization: 'Bearer ', [SYNC_PARK_HEADER]: '1' }) }),
      probe({ headers: new Headers({ authorization: 'Basic eDp5', [SYNC_PARK_HEADER]: '1' }) }),
      probe({ headers: new Headers({ authorization: 'Bearer t', [SYNC_PARK_HEADER]: 'true' }) }),
      probe({ url: 'not a url' }),
    ];
    for (const c of cases) assert.equal(isCellStateProbe(c), false, JSON.stringify(c.url));
  });

  it('is a `/_*` path, so without this branch it would wake the cell', () => {
    // The reason the DO handles it BEFORE `wakePolicy`, like `/_cell/wake`.
    assert.equal(CELL_STATE_PATH, '/_cell/state');
    assert.equal(wakesWithoutAsking(URL_), true);
  });
});

describe('cellStateAnswer — the contract', () => {
  const now = Date.UTC(2026, 9, 5, 7, 12, 45);
  it('running vs asleep, from the platform flag only', () => {
    assert.equal(cellStateAnswer({ running: true, changedAt: null, now }).state, 'running');
    for (const r of [false, undefined, null, 'yes']) {
      assert.equal(cellStateAnswer({ running: r, changedAt: null, now }).state, 'asleep');
    }
  });

  it('times are floored to the minute — a coarse oracle by design', () => {
    const changedAt = Date.UTC(2026, 9, 5, 6, 59, 31, 400);
    assert.deepEqual(cellStateAnswer({ running: false, changedAt, now }), {
      state: 'asleep',
      changedAt: Date.UTC(2026, 9, 5, 6, 59),
      at: Date.UTC(2026, 9, 5, 7, 12),
    });
  });

  it('no change ever reported → null, never a guess', () => {
    assert.equal(cellStateAnswer({ running: false, changedAt: undefined, now }).changedAt, null);
    assert.equal(floorToMinute(Number.NaN), null);
    assert.equal(floorToMinute(-5), null);
  });
});

describe('the DO answers the probe alone', () => {
  const src = readFileSync(new URL('./cell-do.mjs', import.meta.url), 'utf8');

  it('the probe branch runs before wakePolicy and touches no container path', () => {
    // The code, not the comment above it (which names what it must not do).
    const start = src.indexOf('isCellStateProbe({');
    const policy = src.indexOf('const policy = wakePolicy(');
    assert.ok(start > 0 && policy > start, 'probe branch must precede wakePolicy');
    const block = src.slice(start, src.indexOf('\n    }\n', start));
    assert.match(block, /isCellStateProbe\(/);
    assert.match(block, /cellStateAnswer\(/);
    for (const banned of [
      'containerFetch',
      'renewActivityTimeout',
      'ensureStarted',
      'startAndWaitForPorts',
      'proxyThroughTunnel',
      'fetchTenantConfig',
    ]) {
      assert.equal(block.includes(banned), false, `${banned} in the probe branch`);
    }
  });

  it('noteChange keeps a monotonic max and never touches the container', () => {
    const start = src.indexOf('async noteChange()');
    const block = src.slice(start, src.indexOf('\n  }\n', start));
    assert.match(block, /if \(now > prev && now - prev >= CHANGE_WRITE_FLOOR_MS\)/);
    for (const banned of ['containerFetch', 'renewActivityTimeout', 'container']) {
      assert.equal(block.includes(`this.${banned}`) || block.includes(`.${banned}?`), false);
    }
  });
});

describe('the change signal route', () => {
  it('hub and cell agree on the path', () => {
    assert.equal(HUB_CHANGE_SIGNAL_PATH, CHANGE_SIGNAL_PATH);
  });

  it('reaches the cell the runtime names, not one the request names', async () => {
    const calls = [];
    const env = {
      MAUDE_CELL: {
        idFromString: (s) => `id:${s}`,
        get: (id) => ({
          noteChange: async () => {
            calls.push(id);
            return { ok: true };
          },
        }),
      },
    };
    const res = await projectStoreOutbound(
      new Request(`http://project-store.internal${CHANGE_SIGNAL_PATH}?cell=other`, {
        method: 'POST',
        body: '{}',
        headers: { 'x-maude-internal-tenant': 'evil' },
      }),
      env,
      { containerId: 'abc' }
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(calls, ['id:abc']);
  });

  it('no runtime id → refused, nothing called', async () => {
    const res = await projectStoreOutbound(
      new Request(`http://project-store.internal${CHANGE_SIGNAL_PATH}`, { method: 'POST' }),
      { MAUDE_CELL: { get: () => assert.fail('called') } },
      {}
    );
    assert.equal(res.status, 503);
  });

  it('GET is refused like every other outbound call', async () => {
    const res = await projectStoreOutbound(
      new Request(`http://project-store.internal${CHANGE_SIGNAL_PATH}`),
      {},
      { containerId: 'abc' }
    );
    assert.equal(res.status, 405);
  });
});
