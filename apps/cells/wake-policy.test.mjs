// The no-wake probe (feature-cloud-cost-and-cold-start-ux, Task 1).
//
// The control plane's hourly telemetry read used to START every sleeping cell,
// and each start re-hydrated the whole project from R2. The header may only
// ever SUPPRESS a start — these cases pin both halves of that.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WAKE_HEADER, wakePolicy } from './cell-config.mjs';

const h = (o = {}) => new Headers(o);

test('a no-wake probe to a sleeping cell is answered without a start', () => {
  assert.equal(
    wakePolicy({ headers: h({ [WAKE_HEADER]: 'never' }), running: false, authorized: true }),
    'asleep-reply'
  );
});

test('a no-wake probe to a running cell is proxied as today', () => {
  assert.equal(
    wakePolicy({ headers: h({ [WAKE_HEADER]: 'never' }), running: true, authorized: true }),
    'proxy'
  );
});

test('an ordinary request to a sleeping cell still wakes it', () => {
  assert.equal(wakePolicy({ headers: h(), running: false, authorized: true }), 'block-and-start');
});

test('only the literal value suppresses a start', () => {
  for (const v of ['', 'no', 'NEVER', 'false', '0']) {
    assert.equal(
      wakePolicy({ headers: h({ [WAKE_HEADER]: v }), running: false, authorized: true }),
      'block-and-start',
      v
    );
  }
});

test('an unknown running flag is treated as not running (the safe side)', () => {
  assert.equal(wakePolicy({ headers: h(), running: undefined }), 'block-and-start');
  assert.equal(
    wakePolicy({ headers: h({ [WAKE_HEADER]: 'never' }), running: 'yes', authorized: true }),
    'asleep-reply'
  );
});

test('without the cell secret the header is ignored — no awake/asleep oracle', () => {
  assert.equal(
    wakePolicy({ headers: h({ [WAKE_HEADER]: 'never' }), running: false, authorized: false }),
    'block-and-start'
  );
  assert.equal(
    wakePolicy({ headers: h({ [WAKE_HEADER]: 'never' }), running: false }),
    'block-and-start'
  );
});

// Scanner paths on a cold cell (feature-cells-no-wake-for-scanners). The policy
// may refuse a START, never change what a running cell answers.
const scan = new URL('https://alligators.cloud.maude.sh/wp-login.php');
const page = new URL('https://alligators.cloud.maude.sh/');

test('a scanner path to a sleeping cell is refused without a start', () => {
  assert.equal(wakePolicy({ headers: h(), running: false, url: scan }), 'refuse-cold');
  assert.equal(wakePolicy({ headers: h(), running: undefined, url: scan }), 'refuse-cold');
});

test('a scanner path to a running cell is proxied as today', () => {
  assert.equal(wakePolicy({ headers: h(), running: true, url: scan }), 'proxy');
});

test('a scanner path carrying an owner signal still wakes the cell', () => {
  assert.equal(
    wakePolicy({ headers: h({ authorization: 'Bearer t' }), running: false, url: scan }),
    'block-and-start'
  );
  assert.equal(
    wakePolicy({ headers: h({ cookie: 'maude_studio=s' }), running: false, url: scan }),
    'block-and-start'
  );
});

test('a legitimate path to a sleeping cell still wakes it', () => {
  assert.equal(wakePolicy({ headers: h(), running: false, url: page }), 'block-and-start');
});

test('the no-wake probe is unchanged by the scanner rule', () => {
  assert.equal(
    wakePolicy({
      headers: h({ [WAKE_HEADER]: 'never' }),
      running: false,
      authorized: true,
      url: new URL('https://alligators.cloud.maude.sh/health'),
    }),
    'asleep-reply'
  );
});
