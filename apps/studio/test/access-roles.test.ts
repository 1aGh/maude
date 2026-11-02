// S9.1 — the ONE role table (V2-1.7 §5.1–§5.2, invariants R1–R6).
//
// `apps/studio/access/roles.ts` is the single matrix the hub (re-export in
// `apps/hub/src/role-matrix.mjs`), the control plane (`apps/cloud/*`) and the
// studio (`sync/hubs-config.ts`) all read. These tests pin what each role means,
// and — R3 — that the three pre-v2 roles mean exactly what they meant before.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACCOUNT_ROLES,
  CAPABILITIES,
  can,
  capabilitiesFor,
  FLOOR_ROLE,
  isReadOnlyRole,
  levelOf,
  matrixRows,
  maxRole,
  PROJECT_ONLY,
  projectRoleForAccount,
  ROLES,
  rankOf,
  V1_ROLES,
} from '../access/roles.ts';
import { isEditRole } from '../sync/hubs-config.ts';

/** The pre-v2 matrix, frozen here as it shipped in v1.9.x (`apps/hub/src/role-matrix.mjs`). */
const PRE_V2 = {
  owner: {
    read: true,
    session: true,
    edit: true,
    comment: true,
    annotate: true,
    export: true,
    invite: true,
    delete: true,
    mirror: true,
  },
  member: {
    read: true,
    session: true,
    edit: true,
    comment: true,
    annotate: true,
    export: true,
    invite: false,
    delete: false,
    mirror: false,
  },
  viewer: {
    read: true,
    session: true,
    edit: false,
    comment: true,
    annotate: false,
    export: true,
    invite: false,
    delete: false,
    mirror: false,
  },
} as const;

describe('the vocabulary (§5.1)', () => {
  test('four roles, weakest first; thirteen capabilities', () => {
    expect([...ROLES]).toEqual(['observer', 'viewer', 'member', 'owner']);
    expect([...CAPABILITIES]).toEqual([
      'read',
      'session',
      'request',
      'comment',
      'vote',
      'export',
      'annotate',
      'edit',
      'trash',
      'summon',
      'invite',
      'delete',
      'mirror',
    ]);
    expect([...V1_ROLES]).toEqual(['viewer', 'member', 'owner']);
    expect([...ACCOUNT_ROLES]).toEqual(['admin', 'member']);
    expect(FLOOR_ROLE).toBe('observer');
    expect([...PROJECT_ONLY]).toEqual(['invite', 'delete', 'mirror']);
  });

  test('the table is frozen — no caller can widen a role at runtime', () => {
    expect(Object.isFrozen(ROLES)).toBe(true);
    expect(Object.isFrozen(CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(capabilitiesFor('viewer'))).toBe(true);
    expect(Object.isFrozen(capabilitiesFor('nobody'))).toBe(true);
  });

  test('every role answers every capability with a boolean', () => {
    for (const role of ROLES) {
      const row = capabilitiesFor(role);
      for (const cap of CAPABILITIES) expect(typeof row[cap]).toBe('boolean');
      expect(Object.keys(row).sort()).toEqual([...CAPABILITIES].sort());
    }
  });
});

describe('R1–R6 (§5.2)', () => {
  test('R1: an unknown role or null holds nothing', () => {
    for (const role of [null, undefined, '', 'admin', 'Owner', 'VIEWER', 'typo', 'request']) {
      for (const cap of CAPABILITIES) expect(can(role, cap)).toBe(false);
      expect(isReadOnlyRole(role)).toBe(true);
      expect(rankOf(role)).toBe(-1);
    }
    // an unknown capability is denied for every role too
    for (const role of ROLES) expect(can(role, 'launch-missiles' as never)).toBe(false);
  });

  test('R2: observer holds only read, session and request', () => {
    const held = CAPABILITIES.filter((c) => can('observer', c));
    expect(held).toEqual(['read', 'session', 'request']);
  });

  test('R3: the pre-v2 rows are unchanged for every pre-existing capability', () => {
    for (const role of V1_ROLES) {
      for (const [cap, want] of Object.entries(PRE_V2[role])) {
        expect([role, cap, can(role, cap as never)]).toEqual([role, cap, want]);
      }
    }
    expect(isReadOnlyRole('viewer')).toBe(true);
    expect(isReadOnlyRole('member')).toBe(false);
    expect(isReadOnlyRole('owner')).toBe(false);
  });

  test('R4: trash only where edit is held; delete only for the owner', () => {
    for (const role of ROLES) {
      if (can(role, 'trash')) expect(can(role, 'edit')).toBe(true);
      expect(can(role, 'delete')).toBe(role === 'owner');
    }
  });

  test('R5: request is held exactly by the roles without edit', () => {
    for (const role of ROLES) expect(can(role, 'request')).toBe(!can(role, 'edit'));
  });

  test('R6: summon sits with edit; project-only capabilities are owner-only', () => {
    for (const role of ROLES) expect(can(role, 'summon')).toBe(can(role, 'edit'));
    for (const cap of PROJECT_ONLY) {
      expect(CAPABILITIES).toContain(cap);
      for (const role of ROLES) expect(can(role, cap)).toBe(role === 'owner');
    }
  });
});

describe('rank, max, level, rows', () => {
  test('rankOf orders weakest → strongest', () => {
    expect(ROLES.map(rankOf)).toEqual([0, 1, 2, 3]);
  });

  test('maxRole takes the higher, ignores unknown', () => {
    expect(maxRole('viewer', 'member')).toBe('member');
    expect(maxRole('owner', 'observer')).toBe('owner');
    expect(maxRole(null, 'viewer')).toBe('viewer');
    expect(maxRole('typo', 'observer')).toBe('observer');
    expect(maxRole('typo', null)).toBeNull();
    expect(maxRole(null, null)).toBeNull();
  });

  test('levelOf bridges to the V2-1.2 Role level', () => {
    expect(levelOf('owner')).toBe('edit');
    expect(levelOf('member')).toBe('edit');
    expect(levelOf('viewer')).toBe('comment');
    expect(levelOf('observer')).toBe('view');
    expect(levelOf(null)).toBeNull();
    expect(levelOf('typo' as never)).toBeNull();
  });

  test('matrixRows: strongest first, one row per role', () => {
    const rows = matrixRows();
    expect(rows.map((r) => r.role)).toEqual(['owner', 'member', 'viewer', 'observer']);
    expect(rows[2]?.comment).toBe(true);
    expect(rows[3]?.comment).toBe(false);
  });

  test('projectRoleForAccount: project roles pass through, admin → owner, else null', () => {
    for (const role of ROLES) expect(projectRoleForAccount(role)).toBe(role);
    expect(projectRoleForAccount('admin')).toBe('owner');
    expect(projectRoleForAccount('member')).toBe('member');
    for (const r of [null, undefined, '', 'Admin', 'typo'])
      expect(projectRoleForAccount(r)).toBeNull();
  });
});

describe('the studio reads the same table (sync/hubs-config.ts isEditRole)', () => {
  test('isEditRole is can(projectRoleForAccount(role), edit) — no local role list', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'sync', 'hubs-config.ts'), 'utf8');
    expect(/from '\.\.\/access\/roles\.ts'/.test(src)).toBe(true);
    expect(/new Set\(\[\s*'owner'/.test(src)).toBe(false);
    for (const r of ['owner', 'member', 'admin']) expect([r, isEditRole(r)]).toEqual([r, true]);
    for (const r of ['viewer', 'observer', 'Owner', 'typo', '', null, undefined, 1, {}]) {
      expect([r, isEditRole(r)]).toEqual([r, false]);
    }
  });
});
