// S9.1 — the control plane reads THE role table (V2-1.7 §5.2), not a copy.
//
// `project-access.mjs` and `membership.mjs` each carried their own `ROLES` (and
// project-access its own `CAPABILITIES`, with no `export` row) beside the cell's
// `apps/hub/src/role-matrix.mjs`. Two tables drift, and the weaker one becomes
// the way in. Both now import `apps/studio/access/roles.ts`; this file pins
// that (grep), and pins that the answers for today's three roles did not move.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ROLES as MATRIX_ROLES, V1_ROLES } from '../studio/access/roles.ts';
import { decideMembershipChange, ROLES as MEMBER_ROLES } from './membership.mjs';
import { ROLES as ACCESS_ROLES, CAPABILITIES, can, decideAccess } from './project-access.mjs';

const HERE = import.meta.dirname;
const src = (f) => readFileSync(join(HERE, f), 'utf8');

describe('one matrix — no local copy', () => {
  for (const file of ['project-access.mjs', 'membership.mjs']) {
    it(`${file} imports the role table`, () => {
      assert.match(src(file), /from '\.\.\/studio\/access\/roles\.ts'/);
    });
    it(`${file} holds no ROLES / CAPABILITIES literal of its own`, () => {
      const s = src(file);
      assert.ok(!/\bROLES\s*=\s*(Object\.freeze\()?\[/.test(s), 'local ROLES literal');
      assert.ok(
        !/\bCAPABILITIES\s*=\s*(Object\.freeze\()?[[{]/.test(s),
        'local CAPABILITIES literal'
      );
      assert.ok(
        !/\[\s*'viewer'\s*,\s*'member'\s*,\s*'owner'\s*\]/.test(s),
        'a hand-written role list'
      );
    });
  }

  it('both modules expose the stored roles — the matrix order, without observer until D1 allows it', () => {
    // D1 `project_members.role CHECK (role IN ('viewer','member','owner'))` (migrate.mjs v4/v5):
    // the control plane offers and stores observer only after its v2 migration (V2-1.7 §5.8).
    assert.deepEqual([...ACCESS_ROLES], [...V1_ROLES]);
    assert.equal(MEMBER_ROLES, ACCESS_ROLES);
    for (const r of ACCESS_ROLES) assert.ok(MATRIX_ROLES.includes(r));
  });
});

describe('the answers for owner · member · viewer did not move', () => {
  // The control plane's pre-S9.1 table, frozen here.
  const PRE = {
    view: ['viewer', 'member', 'owner'],
    edit: ['member', 'owner'],
    comment: ['viewer', 'member', 'owner'],
    invite: ['owner'],
    billing: ['owner'],
    mirror: ['owner'],
    share: ['owner'],
    delete: ['owner'],
  };

  it('every control-plane word, every v1 role', () => {
    for (const [word, roles] of Object.entries(PRE)) {
      for (const role of ['viewer', 'member', 'owner']) {
        assert.equal(can(role, word), roles.includes(role), `${role} ${word}`);
      }
      assert.deepEqual([...CAPABILITIES[word]], roles, word);
    }
  });

  it('unknown role, unknown word, and observer hold nothing at the control plane', () => {
    for (const word of Object.keys(PRE)) {
      assert.equal(can('admin', word), false);
      assert.equal(can(null, word), false);
    }
    assert.equal(can('owner', 'launch-missiles'), false);
    // observer is a cell role the control plane does not store yet; its `view` is the matrix's
    // `read`, but no D1 row can name it — decideAccess refuses such a row.
    assert.deepEqual(
      decideAccess({
        accountId: 'a2',
        project: { account_id: 'a1', state: 'active' },
        members: [{ account_id: 'a2', role: 'observer' }],
      }),
      { ok: false, reason: 'no-access' }
    );
  });

  it('a membership change to observer is refused as unknown, as before', () => {
    const r = decideMembershipChange({
      actorRole: 'owner',
      targetAccountId: 'a2',
      targetRole: 'viewer',
      newRole: 'observer',
      ownerId: 'a1',
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unknown-role');
  });

  it('a demotion still revokes, a promotion does not', () => {
    const change = (targetRole, newRole) =>
      decideMembershipChange({
        actorRole: 'owner',
        targetAccountId: 'a2',
        targetRole,
        newRole,
        ownerId: 'a1',
      });
    assert.equal(change('member', 'viewer').revokeSessions, true);
    assert.equal(change('viewer', 'member').revokeSessions, false);
    assert.equal(change(null, 'viewer').action, 'add');
  });
});
