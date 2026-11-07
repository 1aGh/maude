// One reading of a verified token's project role, shared by every door.
//
// The access gate reads a match through its claim (`claimForMatch`); the file
// door used to read the raw `role` column. The two disagreed on a match with no
// role column that the claim names the owner (the operator's env secret), so
// the door treated the operator as a member. These pins hold the shared helper
// equal to the claim for every match shape, and the owner bar on top of it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  claimForMatch,
  isProjectOwnerMatch,
  peerAccess,
  roleForMatch,
} from '../src/access-gate.mjs';

const ENV = { label: 'env-secret', createdAt: 0, scope: '*', source: 'env', readOnly: false };

const MATCHES = {
  env: ENV,
  owner: { label: 'o', scope: '*', source: 'file', readOnly: false, role: 'owner' },
  admin: { label: 'a', scope: '*', source: 'file', readOnly: false, role: 'admin' },
  member: { label: 'm', scope: '*', source: 'file', readOnly: false, role: 'member' },
  roleless: { label: 'r', scope: '*', source: 'file', readOnly: false },
  roleless_ro: { label: 'r2', scope: '*', source: 'file', readOnly: true },
  owner_ro: { label: 'o2', scope: '*', source: 'file', readOnly: true, role: 'owner' },
  owner_scoped: {
    label: 'o3',
    scope: 'one-canvas',
    source: 'file',
    readOnly: false,
    role: 'owner',
  },
  claim_owner: {
    label: 'c',
    scope: '*',
    source: 'file',
    readOnly: false,
    access: { v: 1, role: 'owner' },
  },
  canvas_only: {
    label: 'g',
    scope: '*',
    source: 'file',
    readOnly: true,
    access: { v: 1, role: null, grants: [{ c: 'a.tsx', r: 'member' }] },
  },
};

describe('roleForMatch is the claim, for every match shape', () => {
  for (const [name, match] of Object.entries(MATCHES)) {
    it(`${name}: the helper, the claim and the access object agree`, () => {
      const role = roleForMatch(match);
      assert.equal(role, claimForMatch(match)?.role ?? null);
      assert.equal(role, peerAccess(match).access.role);
    });
  }

  it('the operator env secret is the owner', () => {
    assert.equal(roleForMatch(ENV), 'owner');
    assert.equal(isProjectOwnerMatch(ENV), true);
  });

  it('no match holds no role', () => {
    assert.equal(roleForMatch(null), null);
    assert.equal(isProjectOwnerMatch(null), false);
  });
});

describe('the project-owner bar', () => {
  const expected = {
    env: true,
    owner: true,
    admin: true,
    claim_owner: true,
    member: false,
    roleless: false,
    roleless_ro: false,
    owner_ro: false,
    owner_scoped: false,
    canvas_only: false,
  };
  for (const [name, want] of Object.entries(expected)) {
    it(`${name} → ${want}`, () => {
      assert.equal(isProjectOwnerMatch(MATCHES[name]), want);
    });
  }
});
