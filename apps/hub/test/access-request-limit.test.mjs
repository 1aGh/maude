// S9.21 — Ask to edit cannot be spammed on a self-hosted hub: at most ACCESS_REQUEST_LIMIT.max asks
// per person per rolling window, whatever the scope or the owner's answer (a declined ask asked again
// counts; one ask per canvas counts). Each ask is a toast on every owner's screen.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import {
  ACCESS_REQUEST_LIMIT,
  closeInvites,
  createAccessRequest,
  decideAccessRequest,
} from '../src/invites.mjs';

let dataDir;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'maude-ask-limit-'));
});
afterEach(() => {
  closeInvites(dataDir);
  rmSync(dataDir, { recursive: true, force: true });
});

test('three asks per day; a declined ask asked again counts; a fourth is rate-limited', () => {
  assert.equal(ACCESS_REQUEST_LIMIT.max, 3);
  const t0 = 1_000_000_000;
  const petra = 'petra@alligators.cz';
  for (let i = 0; i < 2; i++) {
    const r = createAccessRequest(dataDir, { email: petra }, t0 + i);
    assert.equal(r.ok, true);
    assert.equal(
      decideAccessRequest(dataDir, r.request.id, { decision: 'declined' }, t0 + i),
      true
    );
  }
  assert.equal(createAccessRequest(dataDir, { email: petra, canvas: 'ui/a.tsx' }, t0 + 5).ok, true);
  assert.deepEqual(createAccessRequest(dataDir, { email: petra, canvas: 'ui/b.tsx' }, t0 + 6), {
    ok: false,
    reason: 'rate-limited',
  });
  // case does not buy another allowance
  assert.equal(
    createAccessRequest(dataDir, { email: 'PETRA@alligators.cz', canvas: 'ui/c.tsx' }, t0 + 7)
      .reason,
    'rate-limited'
  );
  // somebody else is not limited by Petra
  assert.equal(createAccessRequest(dataDir, { email: 'vojta@x.test' }, t0 + 8).ok, true);
  // a window later Petra may ask again
  const later = t0 + ACCESS_REQUEST_LIMIT.windowMs + 10;
  assert.equal(createAccessRequest(dataDir, { email: petra, canvas: 'ui/b.tsx' }, later).ok, true);
});

test('an open ask asked again is still `pending`, not a second request', () => {
  const r = createAccessRequest(dataDir, { email: 'p@x.test' }, 1);
  assert.equal(r.ok, true);
  assert.deepEqual(createAccessRequest(dataDir, { email: 'p@x.test' }, 2), {
    ok: false,
    reason: 'pending',
  });
});
