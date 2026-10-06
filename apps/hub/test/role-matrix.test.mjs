// The role matrix — Cloud Phase 25 C4.
//
// ONE test suite that BOTH surfaces are held to, because the failure this
// exists to prevent is not "the table is wrong" — it is the table being right
// and one client quietly disagreeing with it.
//
// The suite therefore asserts three separate things:
//   1. the table itself (what a role means);
//   2. that the cell's session-minting paths derive read-only FROM the table
//      rather than from their own `role === 'viewer'` test;
//   3. that the cell's HTTP gate and the browser door agree with it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ACCOUNT_ROLES,
  CAPABILITIES,
  can,
  capabilitiesFor,
  isReadOnlyRole,
  matrixRows,
  projectRoleForAccount,
  ROLES,
} from '../src/role-matrix.mjs';

const HERE = join(import.meta.dirname, '..');

test('the matrix is complete — every role answers every capability', () => {
  for (const role of ROLES) {
    const caps = capabilitiesFor(role);
    for (const cap of CAPABILITIES) {
      assert.equal(typeof caps[cap], 'boolean', `${role}.${cap} must be stated`);
    }
  }
  assert.deepEqual([...ROLES], ['owner', 'member', 'viewer']);
  // `session` joined the list in Cloud Phase 27 D3: keeping your own place in a
  // project (which canvas is open, where your camera is) is per-user runtime
  // state, never versioned, and every role holds it — a reviewer who cannot pan
  // is not reviewing. Naming it as a capability is what lets the studio route
  // manifest classify those paths instead of waving them through.
  assert.deepEqual(
    [...CAPABILITIES],
    ['read', 'session', 'edit', 'comment', 'annotate', 'export', 'invite', 'delete', 'mirror']
  );
});

test('a viewer may look, comment and download — and nothing else', () => {
  assert.equal(can('viewer', 'read'), true);
  assert.equal(can('viewer', 'comment'), true);
  assert.equal(can('viewer', 'export'), true);
  assert.equal(can('viewer', 'session'), true);
  for (const cap of ['edit', 'annotate', 'invite', 'delete', 'mirror']) {
    assert.equal(can('viewer', cap), false, `viewer must not ${cap}`);
  }
});

test('an annotation is an EDIT, not a comment — it is versioned with the design', () => {
  // The distinction that is easy to get wrong: comments live in their own
  // store; annotations are a committed `*.annotations.json` beside the canvas (DDR-242).
  assert.equal(can('viewer', 'comment'), true);
  assert.equal(can('viewer', 'annotate'), false);
});

test('member edits but does not administer; owner does both', () => {
  assert.equal(can('member', 'edit'), true);
  assert.equal(can('member', 'invite'), false);
  assert.equal(can('member', 'delete'), false);
  assert.equal(can('member', 'mirror'), false);
  for (const cap of CAPABILITIES) assert.equal(can('owner', cap), true);
});

test('an unknown role gets NOTHING — a typo must not be an escalation', () => {
  for (const cap of CAPABILITIES) {
    assert.equal(can('admin-ish', cap), false);
    assert.equal(can(undefined, cap), false);
    assert.equal(can(null, cap), false);
  }
  assert.equal(isReadOnlyRole('typo'), true);
});

test('read-only is DERIVED from the table, not asserted beside it', () => {
  assert.equal(isReadOnlyRole('viewer'), true);
  assert.equal(isReadOnlyRole('member'), false);
  assert.equal(isReadOnlyRole('owner'), false);
});

test('BOTH session doors derive the capability from the matrix', () => {
  // The regression this catches: someone adds a third door (or a fourth role)
  // and writes `role === 'viewer'` again, which is right until it is not.
  // `canvas/browser-auth.mjs` moved to `src/` when DDR-209 A'3 emptied the
  // canvas directory — the door itself is unchanged.
  for (const file of ['src/auth-routes.mjs', 'src/browser-auth.mjs']) {
    const src = readFileSync(join(HERE, file), 'utf8');
    assert.ok(
      src.includes('isReadOnlyRole('),
      `${file} must derive read-only from the role matrix`
    );
    assert.ok(
      !/readOnly:\s*\w+\.role === 'viewer'/.test(src),
      `${file} must not re-derive the viewer rule locally`
    );
  }
});

test("the cell's read-only gate allows exactly what a viewer's capabilities say", () => {
  // The gate is a path allowlist; the matrix is a capability table. They are
  // different shapes, so this asserts the MAPPING between them explicitly —
  // which is what makes adding a path a deliberate act.
  const src = readFileSync(join(HERE, 'src/server.mjs'), 'utf8');
  const fn = /function readOnlyAllowedPath\(path\) \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
  assert.ok(fn.includes("'/auth/logout'"), 'a viewer must be able to sign out');
  assert.ok(fn.includes("'/api/export'"), 'a viewer must be able to download (export)');
  // Comments are the one write a viewer holds. When the comment route lands on
  // this list, this assertion is the reminder that the matrix already says so.
  assert.equal(can('viewer', 'comment'), true);
});

test('the matrix renders as rows for a docs table', () => {
  const rows = matrixRows();
  assert.equal(rows.length, 3);
  assert.equal(rows[0].role, 'owner');
  assert.equal(rows[2].edit, false);
});

// ---------------------------------------------------------------------------
// The vocabulary boundary — Cloud Phase 27.
//
// This suite's own opening comment says the failure it exists to prevent is
// "the table being right and one client quietly disagreeing with it". That is
// exactly what happened, and no test here caught it: `auth-routes.mjs` minted
// every session with `readOnly: isReadOnlyRole(user.role)` where `user.role` is
// an ACCOUNT role. For 'member' that is right by accident; for 'admin' it is an
// unknown role, which gets nothing, which reads as read-only. Every admin's
// session was read-only. Found by logging into a real cell.

test('a PROJECT role passes through — the regression that made an owner VIEW ONLY', () => {
  // The control plane vouches project roles directly on a project token. A
  // translator that only knew ACCOUNT roles returned null for `owner`, and null
  // has no capabilities — so the project's own owner opened it read-only.
  for (const r of ROLES) assert.equal(projectRoleForAccount(r), r);
  assert.equal(isReadOnlyRole(projectRoleForAccount('owner')), false);
});

test('an account role is TRANSLATED, never passed through', () => {
  assert.equal(projectRoleForAccount('admin'), 'owner');
  assert.equal(projectRoleForAccount('member'), 'member');
  // Unknown in, nothing out — and `null` is not an escalation downstream.
  assert.equal(projectRoleForAccount('wat'), null);
  assert.equal(projectRoleForAccount(undefined), null);
  assert.equal(isReadOnlyRole(projectRoleForAccount('wat')), true);
});

test('every account role maps to a real project role', () => {
  for (const account of ACCOUNT_ROLES) {
    const project = projectRoleForAccount(account);
    assert.ok(ROLES.includes(project), `account role '${account}' maps nowhere`);
  }
});

test('an admin gets an EDITING session — the bug this replaces', () => {
  assert.equal(isReadOnlyRole(projectRoleForAccount('admin')), false);
  assert.equal(isReadOnlyRole(projectRoleForAccount('member')), false);
  // And the untranslated form is still wrong, which is why the translation
  // exists rather than a special case for 'admin'.
  assert.equal(isReadOnlyRole('admin'), true);
});

test('the mint site translates rather than passing the account role through', () => {
  const src = readFileSync(join(HERE, 'src/auth-routes.mjs'), 'utf8');
  // The translation happens once, into a named value, and BOTH the stored
  // role and its read_only projection derive from it (the v0.55.0 lesson:
  // projecting without storing produced sessions browserSession refuses).
  // Behaviour is pinned end-to-end in auth-login-role.test.mjs; this guard
  // only keeps the raw account role out of the role matrix.
  assert.match(src, /const projectRole = projectRoleForAccount\(user\.role\)/);
  assert.match(src, /role: projectRole/);
  assert.match(src, /isReadOnlyRole\(projectRole\)/);
  assert.ok(
    !/isReadOnlyRole\(user\.role\)/.test(src),
    'user.role is an account role and must not reach the project-role matrix raw'
  );
});
