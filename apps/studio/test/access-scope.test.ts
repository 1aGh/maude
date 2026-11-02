// S9.1 — grants and the access claim (V2-1.7 §5.3, rules G1/G2).
//
// `resolveAccess` turns a signed claim into the one `Access` object every door
// asks; `sees` / `writes` / `seesDoc` answer file- and document-level questions
// over the server-computed closure (`access/closure.ts`).

import { describe, expect, test } from 'bun:test';

import { type Closure, closureFor, type ProjectReader } from '../access/closure.ts';
import { CAPABILITIES, PROJECT_ONLY } from '../access/roles.ts';
import {
  type AccessClaim,
  legacyClaim,
  MAX_GRANTS,
  resolveAccess,
  sees,
  seesDoc,
  writes,
} from '../access/scope.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';

const slugOf = (c: string) => canvasSlugFromRel(c, '.design');

function reader(files: Record<string, string>, head = 'h1'): ProjectReader {
  return {
    list: () => Object.keys(files),
    text: (rel) => files[rel] ?? null,
    head: () => head,
  };
}

// A: imports the shared module and uses a.png + both.png; B: uses b.png + both.png.
const PROJECT = reader({
  'ui/A.tsx': `import { Card } from '../shared/Card';\nexport default () => <img src="assets/a1b2c3d4.png" /><img src="assets/0000beef.png" />;`,
  'ui/A.meta.json': '{}',
  'ui/B.tsx': `export default () => <><img src="assets/b1b2c3d4.png" /><img src="assets/0000beef.png" /></>;`,
  'shared/Card.tsx': 'export const Card = () => null;',
  'assets/a1b2c3d4.png': 'png',
  'assets/a1b2c3d4.photo.json': '{}',
  'assets/b1b2c3d4.png': 'png',
  'assets/0000beef.png': 'png',
  'assets/0000beef.photo.json': '{}',
});

const canvasOnly = (r: 'observer' | 'viewer' | 'member', c = 'ui/A.tsx') =>
  resolveAccess({ v: 1, role: null, grants: [{ c, r }] });

describe('resolveAccess', () => {
  test('a null or malformed claim holds nothing', () => {
    const bad: unknown[] = [
      null,
      undefined,
      {},
      { v: 2, role: 'owner' },
      { v: 1, role: 'owner', grants: 'ui/A.tsx' },
      'owner',
    ];
    for (const claim of bad) {
      const a = resolveAccess(claim as AccessClaim | null);
      expect(a.role).toBeNull();
      expect(a.canvasOnly).toBe(false);
      for (const cap of CAPABILITIES) {
        expect(a.can(cap, null)).toBe(false);
        expect(a.can(cap, 'ui/A.tsx')).toBe(false);
      }
      expect(a.seesCanvas('ui/A.tsx')).toBe(false);
    }
  });

  test('an unknown project role resolves to null (R1), never upward', () => {
    expect(resolveAccess({ v: 1, role: 'admin-ish' as never }).role).toBeNull();
    expect(resolveAccess({ v: 1, role: 'admin' as never }).role).toBeNull();
  });

  test('the 256-grant cap: one more than the cap and the claim holds nothing', () => {
    const grants = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ c: `ui/c${i}.tsx`, r: 'viewer' as const }));
    expect(resolveAccess({ v: 1, role: null, grants: grants(MAX_GRANTS) }).canvasOnly).toBe(true);
    const over = resolveAccess({ v: 1, role: 'viewer', grants: grants(MAX_GRANTS + 1) });
    expect(over.role).toBeNull();
    expect(over.canvasOnly).toBe(false);
    expect(over.can('read', 'ui/c0.tsx')).toBe(false);
  });

  test('a grant never carries owner; a malformed grant is dropped, not widened', () => {
    const a = resolveAccess({
      v: 1,
      role: null,
      grants: [
        { c: 'ui/A.tsx', r: 'owner' as never },
        { c: '', r: 'member' },
        { c: 'ui/B.tsx', r: 'viewer' },
      ],
    });
    expect(a.roleFor('ui/A.tsx')).toBeNull();
    expect(a.roleFor('ui/B.tsx')).toBe('viewer');
    expect(a.canvasOnly).toBe(true);
  });

  test('declaredAccess defaults to 1', () => {
    expect(resolveAccess(legacyClaim('viewer')).minted.declaredAccess).toBe(1);
    expect(resolveAccess(legacyClaim('viewer'), { declaredAccess: 2 }).minted.declaredAccess).toBe(
      2
    );
  });

  test('legacyClaim translates through projectRoleForAccount', () => {
    expect(legacyClaim('admin')).toEqual({ v: 1, role: 'owner' });
    expect(legacyClaim('viewer')).toEqual({ v: 1, role: 'viewer' });
    expect(legacyClaim('typo')).toEqual({ v: 1, role: null });
    expect(legacyClaim(null)).toEqual({ v: 1, role: null });
  });

  test('the v1 roles keep their project-wide meaning through a legacy claim', () => {
    const viewer = resolveAccess(legacyClaim('viewer'));
    expect(viewer.can('comment', 'ui/A.tsx')).toBe(true);
    expect(viewer.can('export', null)).toBe(true);
    expect(viewer.can('edit', 'ui/A.tsx')).toBe(false);
    expect(viewer.seesCanvas('ui/anything-new.tsx')).toBe(true);
    const owner = resolveAccess(legacyClaim('owner'));
    for (const cap of PROJECT_ONLY) expect(owner.can(cap, null)).toBe(true);
  });
});

describe('G1 — a grant never lowers', () => {
  test('effective role is max(project role, grant)', () => {
    const a = resolveAccess({ v: 1, role: 'member', grants: [{ c: 'ui/A.tsx', r: 'observer' }] });
    expect(a.roleFor('ui/A.tsx')).toBe('member');
    expect(a.can('edit', 'ui/A.tsx')).toBe(true);
    expect(a.canvasOnly).toBe(false);
  });

  test('a grant raises on its canvas only', () => {
    const a = resolveAccess({ v: 1, role: 'viewer', grants: [{ c: 'ui/A.tsx', r: 'member' }] });
    expect(a.can('edit', 'ui/A.tsx')).toBe(true);
    expect(a.can('edit', 'ui/B.tsx')).toBe(false);
    expect(a.can('edit', null)).toBe(false);
  });

  test('duplicate grants for one canvas keep the higher', () => {
    const a = resolveAccess({
      v: 1,
      role: null,
      grants: [
        { c: 'ui/A.tsx', r: 'member' },
        { c: 'ui/A.tsx', r: 'observer' },
      ],
    });
    expect(a.roleFor('ui/A.tsx')).toBe('member');
  });
});

describe('G2 — canvas-only sessions', () => {
  test('a canvas grant never confers a project-only capability', () => {
    const a = canvasOnly('member');
    for (const cap of PROJECT_ONLY) {
      expect(a.can(cap, 'ui/A.tsx')).toBe(false);
      expect(a.can(cap, null)).toBe(false);
    }
    expect(a.can('edit', 'ui/A.tsx')).toBe(true);
    expect(a.can('trash', 'ui/A.tsx')).toBe(true);
  });

  test('sees only the granted canvas', () => {
    const a = canvasOnly('viewer');
    expect(a.seesCanvas('ui/A.tsx')).toBe(true);
    expect(a.seesCanvas('ui/B.tsx')).toBe(false);
    expect(a.can('read', 'ui/B.tsx')).toBe(false);
    expect(a.can('read', null)).toBe(false);
  });

  test('an observer grant is look-only on its canvas', () => {
    const a = canvasOnly('observer');
    expect(a.can('read', 'ui/A.tsx')).toBe(true);
    expect(a.can('request', 'ui/A.tsx')).toBe(true);
    expect(a.can('comment', 'ui/A.tsx')).toBe(false);
    expect(a.can('export', 'ui/A.tsx')).toBe(false);
  });

  test('sees: the closure and nothing else; no closure → nothing', () => {
    const a = canvasOnly('viewer');
    const cl = closureFor(a, PROJECT);
    expect(sees(a, cl, 'ui/A.tsx')).toBe(true);
    expect(sees(a, cl, 'shared/Card.tsx')).toBe(true);
    expect(sees(a, cl, 'assets/a1b2c3d4.png')).toBe(true);
    expect(sees(a, cl, 'ui/B.tsx')).toBe(false);
    expect(sees(a, cl, 'assets/b1b2c3d4.png')).toBe(false);
    expect(sees(a, null, 'ui/A.tsx')).toBe(false);
  });

  test('a project role sees every file without a closure', () => {
    const a = resolveAccess(legacyClaim('observer'));
    expect(sees(a, null, 'ui/B.tsx')).toBe(true);
  });

  test('writes: owned files of an edit-granted canvas only', () => {
    const a = canvasOnly('member');
    const cl = closureFor(a, PROJECT);
    expect(writes(a, cl, 'ui/A.tsx', { exists: true })).toBe(true);
    expect(writes(a, cl, 'ui/A.meta.json', { exists: true })).toBe(true);
    expect(writes(a, cl, 'ui-a.annotations.json', { exists: false })).toBe(true);
    // the closure is readable, not writable
    expect(writes(a, cl, 'shared/Card.tsx', { exists: true })).toBe(false);
    expect(writes(a, cl, 'ui/B.tsx', { exists: true })).toBe(false);
    // a viewer grant writes nothing
    const v = canvasOnly('viewer');
    expect(writes(v, closureFor(v, PROJECT), 'ui/A.tsx', { exists: true })).toBe(false);
  });

  test('writes: new files under assets/ are create-only', () => {
    const a = canvasOnly('member');
    const cl = closureFor(a, PROJECT);
    expect(writes(a, cl, 'assets/new12345.png', { exists: false })).toBe(true);
    expect(writes(a, cl, 'assets/a1b2c3d4.png', { exists: true })).toBe(false);
    expect(writes(a, cl, 'assets/b1b2c3d4.png', { exists: true })).toBe(false);
    const v = canvasOnly('viewer');
    expect(writes(v, closureFor(v, PROJECT), 'assets/new12345.png', { exists: false })).toBe(false);
  });

  test('writes: a photo sidecar needs edit on EVERY canvas that references the asset', () => {
    const a = canvasOnly('member');
    const cl = closureFor(a, PROJECT);
    // a1b2c3d4.png is used by A only
    expect(writes(a, cl, 'assets/a1b2c3d4.photo.json', { exists: true })).toBe(true);
    // 0000beef.png is used by A and B — B is not granted
    expect(writes(a, cl, 'assets/0000beef.photo.json', { exists: true })).toBe(false);
    expect(writes(a, cl, 'assets/0000beef.photo.json', { exists: false })).toBe(false);
    // both granted with edit → allowed
    const both = resolveAccess({
      v: 1,
      role: null,
      grants: [
        { c: 'ui/A.tsx', r: 'member' },
        { c: 'ui/B.tsx', r: 'member' },
      ],
    });
    expect(
      writes(both, closureFor(both, PROJECT), 'assets/0000beef.photo.json', { exists: true })
    ).toBe(true);
    // b1b2c3d4.png is not in A's closure at all
    expect(writes(a, cl, 'assets/b1b2c3d4.photo.json', { exists: true })).toBe(false);
  });

  test('writes: a project editor writes anywhere (the existing gates still apply)', () => {
    const a = resolveAccess(legacyClaim('member'));
    expect(writes(a, null, 'shared/Card.tsx', { exists: true })).toBe(true);
    const v = resolveAccess(legacyClaim('viewer'));
    expect(writes(v, null, 'ui/A.tsx', { exists: true })).toBe(false);
  });
});

describe('seesDoc', () => {
  test('a project role sees every document', () => {
    const a = resolveAccess(legacyClaim('observer'));
    expect(seesDoc(a, 'ws/w/b/ui-b', slugOf)).toBe(true);
  });

  test('a canvas-only session sees its canvas document by slug, nothing else', () => {
    const a = canvasOnly('viewer', 'ui/2026/Combine-kampan.tsx');
    expect(seesDoc(a, `ws/w/b/${slugOf('ui/2026/Combine-kampan.tsx')}`, slugOf)).toBe(true);
    expect(seesDoc(a, 'ws/w/b/ui-b', slugOf)).toBe(false);
    expect(seesDoc(a, slugOf('ui/2026/Combine-kampan.tsx'), slugOf)).toBe(false);
    expect(seesDoc(a, '', slugOf)).toBe(false);
  });

  test('no access sees no document', () => {
    expect(seesDoc(resolveAccess(null), 'ws/w/b/ui-a', slugOf)).toBe(false);
  });
});

test('closure type is exported for doors', () => {
  const cl: Closure = closureFor(canvasOnly('viewer'), PROJECT);
  expect(cl.head).toBe('h1');
});
