// p8-boundary-harden — the final-3 security pair over the hub folder boundary
// (decision maude/v2-michal-hub-is-the-folder-boundary-before-config).
//
// M1 / attacker L3: while undeclared groups are allowed (a hub's own studio under the boundary, a
// desktop's one fresh-link boot), the shared validator took a first folder starting with `_` or `-`,
// or `node_modules` — so a teammate's document could land a body in `_state/`, `_history/<slug>/`
// (a fake rollback snapshot) or `node_modules/`, and wedge its pull pin forever (the scan never lists
// those folders). The first component of an undeclared-group path must now match the classifier's
// directory rule: start with a letter or digit, never `node_modules` (any case). Kernel and studio
// share the validator, so both get it.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isUndeclaredGroupName, validateCanvasPath } from '../sync/canvas-path.ts';
import { resolvePulledTarget } from '../sync/remote-docs.ts';

let root = '';
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'p8-boundary-harden-')));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const slugOf = (rel: string) => rel.replace(/\.tsx$/, '').replace(/\//g, '-').toLowerCase();

/** A pull under the undeclared-group relaxation (the hub boundary / a fresh link). */
function pull(rel: string) {
  const refused: string[] = [];
  const target = resolvePulledTarget({
    slug: slugOf(rel),
    path: rel,
    designRoot: root,
    designRel: '.design',
    allowUndeclaredGroup: true,
    join: path.join,
    resolve: path.resolve,
    sep: path.sep,
    realpath: (p) => p,
    onRefused: (r) => refused.push(r),
  });
  return { target, refused };
}

describe('M1 — an undeclared group must be a folder the classifier calls a folder', () => {
  const runtime = [
    '_state/x.tsx',
    '_history/s/x.tsx',
    '_comments/x.tsx',
    '_untrusted/x.tsx',
    '_trash/x.tsx',
    '-x/y.tsx',
    'node_modules/p/index.tsx',
    'Node_Modules/p/index.tsx',
  ];

  for (const rel of runtime) {
    test(`a pull of ${rel} is refused, not written`, () => {
      const { target, refused } = pull(rel);
      expect(target).toBeNull();
      expect(refused.length).toBe(1);
      expect(refused[0]).toContain('outside every declared canvas group');
    });
  }

  test('ordinary undeclared folders are still taken (the boundary itself is unchanged)', () => {
    for (const rel of ['screens/home.tsx', 'components/card.tsx', '2026/launch.tsx', 'Brand/x.tsx']) {
      const { target, refused } = pull(rel);
      expect(refused).toEqual([]);
      expect(target?.bodyAbs).toBe(path.join(root, rel));
    }
  });

  test('a declared group is unaffected by the first-component rule', () => {
    // The relaxation is the only thing that tightened; declared groups rule exactly as before.
    const v = validateCanvasPath({
      path: 'ui/_parts/x.tsx',
      slug: 'ui-_parts-x',
      canvasGroups: [{ path: 'ui' }],
    });
    expect(v.ok).toBe(true);
  });

  test('the shape predicate agrees with the classifier directory rule', () => {
    for (const ok of ['screens', 'Brand', '2026', 'a b', 'x_y', 'x-y']) {
      expect(isUndeclaredGroupName(ok)).toBe(true);
    }
    for (const bad of ['_state', '-x', 'node_modules', 'NODE_MODULES', '', 'a.b', '.git', 'x ']) {
      expect(isUndeclaredGroupName(bad)).toBe(false);
    }
  });
});

describe('M1 — a desktop fresh link never declares a runtime folder', () => {
  test('noteLearnedGroup refuses a group that is not undeclared-group shaped', () => {
    const src = readFileSync(path.join(import.meta.dir, '../sync/index.ts'), 'utf8');
    const at = src.indexOf('const noteLearnedGroup = (group: string): void => {');
    expect(at).toBeGreaterThan(0);
    const head = src.slice(at, at + 400);
    expect(head).toMatch(/isUndeclaredGroupName\(group\)/);
  });
});
