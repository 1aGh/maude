// A viewer can look and cannot change — Cloud Phase 25 C1.
//
// The role has existed since Phase 22 and enforced nothing: `viewer` lived in
// invites and membership, and the cell refused those tokens at the door rather
// than admit a session it could not restrain. This is the enforcement that
// lets the door open.
//
// THE PROPERTY UNDER TEST IS "CANNOT", NOT "IS NOT SHOWN". Hiding the editing
// UI is the last layer; these tests are about the layers underneath, because a
// viewer with a patched client, a stale build, or curl is the case that
// matters.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { fileURLToPath } from 'node:url';

import { can } from '../src/role-matrix.mjs';
import { HUB_ROUTE_ROWS } from '../src/routes-v2/index.mjs';
import { addToken, rotateToken, verifyToken } from '../src/tokens.mjs';

const SERVER_SRC = readFileSync(
  fileURLToPath(new URL('../src/server.mjs', import.meta.url)),
  'utf8'
);

const dirs = [];
function freshDir() {
  const d = mkdtempSync(join(tmpdir(), 'maude-readonly-'));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('the capability lives on the token, not in the UI', () => {
  it('a read-only token verifies as read-only', () => {
    const dir = freshDir();
    const minted = addToken(dir, { label: 'viewer-1', owner: 'v@example.com', readOnly: true });
    assert.equal(minted.readOnly, true);
    const seen = verifyToken(dir, minted.value);
    assert.equal(seen.readOnly, true);
    assert.equal(seen.owner, 'v@example.com');
  });

  it('an ordinary token is write-capable, and says so explicitly', () => {
    const dir = freshDir();
    const minted = addToken(dir, { label: 'member-1', owner: 'm@example.com' });
    assert.equal(minted.readOnly, undefined, 'the common case carries no extra field');
    assert.equal(verifyToken(dir, minted.value).readOnly, false);
  });

  it('a token minted before this shipped reads as write-capable, not read-only', () => {
    // The additive-migration promise: an operator upgrading a live hub loses
    // nothing, and nobody silently becomes a viewer.
    const dir = freshDir();
    const minted = addToken(dir, { label: 'legacy', owner: 'old@example.com' });
    assert.equal(verifyToken(dir, minted.value).readOnly, false);
  });

  it('ROTATION PRESERVES IT — otherwise rotate is a silent promotion', () => {
    // The escalation this file exists to prevent: rotate a viewer's token and
    // hand them an editor's session, with no audit trail and no UI change.
    const dir = freshDir();
    addToken(dir, { label: 'viewer-2', owner: 'v@example.com', readOnly: true });
    const rotated = rotateToken(dir, 'viewer-2');
    assert.equal(rotated.readOnly, true);
    assert.equal(verifyToken(dir, rotated.value).readOnly, true);
  });

  it('the env-secret escape hatch is never read-only — it is the operator', () => {
    const dir = freshDir();
    const seen = verifyToken(dir, 'the-hub-secret', 'the-hub-secret');
    assert.equal(seen.source, 'env');
    assert.equal(seen.readOnly, false);
  });
});

// ---------------------------------------------------------------------------
// A GUARD FOR THE NEXT CHANGE, not for this one.
//
// Phase 25 C3 adds comments, and a comment is a WRITE — the first one a viewer
// legitimately holds a credential for. It has to reach the allowlist below,
// and whoever adds it will be adding the only sanctioned mutation a read-only
// session can perform. The adversarial review named that as the place the
// whole read-only model gets undone: a comment channel that can carry a Yjs
// update, or a route that isn't tightly shape-checked, reopens the hole three
// layers were built to close.
//
// So the allowlist is pinned. Growing it fails here, loudly, with the
// constraint attached — the point is not to forbid the change, it is to make
// nobody make it by accident.
describe('the read-only allowlist is a decision, not a convenience', () => {
  // S9.3: the allowlist is no longer a path list in server.mjs — it is every row
  // of the hub route table whose WRITE half names a capability a viewer holds.
  // (`/auth/browser/signout` was on the old list too; the old 400-character
  // source scrape simply never reached it.)
  const ALLOWED = ['/api/export', '/auth/browser/signout', '/auth/logout'];
  // Doors that authenticate with something other than a peer token answer for
  // themselves, so the gate checks nothing on their write half. Pinned the same way.
  const SELF_AUTHENTICATING = [
    '/_materialize',
    '/admin',
    '/admin/*',
    '/auth/browser',
    '/auth/login',
    '/auth/oidc/callback',
    '/auth/oidc/start',
    '/auth/session',
    '/internal/revocation-sweep',
    '/join',
    '/join/*',
    '/studio/signin',
  ];

  it('has nothing added to it without reading this', () => {
    const viewerWrites = HUB_ROUTE_ROWS.filter(
      (row) => row.cap.unsafe !== null && can('viewer', row.cap.unsafe) && row.cap.unsafe !== 'edit'
    ).map((row) => row.path ?? String(row.pattern));
    assert.deepEqual(
      HUB_ROUTE_ROWS.filter((row) => row.cap.unsafe === null)
        .map((row) => row.path)
        .sort(),
      SELF_AUTHENTICATING
    );
    const paths = viewerWrites.sort();
    assert.deepEqual(
      paths,
      [...ALLOWED].sort(),
      'A mutating path became reachable by a READ-ONLY session.\n' +
        'If this is Phase 25 C3 (comments): the comment channel must be\n' +
        'structurally incapable of carrying a Yjs document update — a separate\n' +
        'store, a server-authored envelope, and a shape-checked body — because\n' +
        'this is the one write a viewer is meant to perform and therefore the\n' +
        'one place the read-only guarantee can be undone by a scope bug.\n' +
        'Add it to ALLOWED here together with a test proving a comment POST\n' +
        'cannot mutate a document.'
    );
  });

  it('allows each path for a reason that still holds', () => {
    // /auth/logout ends the caller's OWN session — not a change to the project.
    assert.ok(SERVER_SRC.includes("'/auth/logout'"));
    // /api/export carries its own OWNER-only project-token gate, so a viewer's
    // peer token cannot actually use the exception it is granted here.
    const cellOps = readFileSync(
      fileURLToPath(new URL('../src/cell-ops.mjs', import.meta.url)),
      'utf8'
    );
    assert.match(cellOps, /role !== 'owner'/);
  });
});
