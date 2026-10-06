// The studio child's loopback credential (MAUDE_CELL_PAIRING, now on by
// default for self-host) edits documents and proposes as a MEMBER. Unroled it
// read as admin on the accepted routes — the owner's mode switch, parity
// (security review A8).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { mintLoopbackSyncToken } from '../src/server.mjs';
import { verifyToken } from '../src/tokens.mjs';

const dir = mkdtempSync(join(tmpdir(), 'loopback-token-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('the loopback credential is a member, not an admin', () => {
  const value = mintLoopbackSyncToken(dir, { MAUDE_CELL_PAIRING: '1' });
  assert.ok(value);
  const m = verifyToken(dir, value, 'secret');
  assert.equal(m.role, 'member');
  assert.equal(!!m.readOnly, false);
  assert.equal(m.owner ?? null, null);
});
