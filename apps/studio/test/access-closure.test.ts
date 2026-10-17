// S9.1 — the server-computed canvas closure (V2-1.7 §5.3, rules G2–G4).
//
// What a canvas-only session may read: the granted canvas's own sidecars
// (`owned`), its transitive relative import graph, its design system minus the
// specimens, and the assets it references statically (plus their sidecars).
// Proven on a hand fixture (one shared module, one DS, assets used by A only, B
// only and both) and on the V2-1.12 Alligators-scale fixture.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import {
  closureFor,
  createClosureCache,
  localDepsFromSource,
  type ProjectReader,
} from '../access/closure.ts';
import { resolveAccess } from '../access/scope.ts';
import { generateFormatFixture } from './fixtures/gen-format-fixture.mjs';

function reader(files: Record<string, string>, head = 'h1'): ProjectReader {
  return {
    list: () => Object.keys(files),
    text: (rel) => files[rel] ?? null,
    head: () => head,
  };
}

const grant = (c: string, r: 'observer' | 'viewer' | 'member' = 'viewer') =>
  resolveAccess({ v: 1, role: null, grants: [{ c, r }] });

const CONFIG = JSON.stringify({
  designSystems: [
    { name: 'brand', path: 'system/brand' },
    { name: 'other', path: 'system/other' },
  ],
  defaultDesignSystem: 'other',
});

const FILES: Record<string, string> = {
  'config.json': CONFIG,
  'ui/A.tsx': [
    `import { Card } from '../shared/Card';`,
    `import './A.css';`,
    `import { Button } from '@maude/ds';`,
    `import React from 'react';`,
    `export default () => <><Card /><img src="assets/a1b2c3d4.png" /><img src='assets/0000beef.png' /></>;`,
  ].join('\n'),
  'ui/A.meta.json': JSON.stringify({ designSystem: 'brand' }),
  'ui/A.css': '.a {}',
  'ui-a.annotations.json': JSON.stringify({ v: 2, elements: [{ href: 'assets/c0ffee00.png' }] }),
  '_comments/ui-a.json': '[]',
  'ui/B.tsx': `export default () => <><img src="assets/b1b2c3d4.png" /><img src="assets/0000beef.png" /></>;`,
  'ui/B.meta.json': JSON.stringify({ designSystem: 'other' }),
  'ui-b.annotations.json': '{}',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a canvas source that computes its asset path
  'ui/D.tsx': 'export default ({ n }) => <img src={`assets/${n}.png`} />;',
  'shared/Card.tsx': `import './card.css';\nimport { Icon } from './Icon.tsx';\nimport x from '../../outside';\nexport const Card = () => <img src="../assets/5ade0001.svg" />;`,
  'shared/card.css': '.card {}',
  'shared/Icon.tsx': 'export const Icon = () => null;',
  'shared/Unused.tsx': 'export const Unused = 1;',
  'system/brand/colors_and_type.css': ':root{}',
  'system/brand/README.md': '# brand',
  'system/brand/preview/_ds.tsx': `export * from './_parts.tsx';`,
  'system/brand/preview/_parts.tsx': 'export const Button = () => null;',
  'system/brand/preview/_layout.css': '.l {}',
  'system/brand/preview/buttons.tsx': 'export default () => null;',
  'system/brand/ui_kits/web/index.tsx': 'export default () => null;',
  'system/brand/assets/fonts/display.woff2': 'font',
  'system/other/colors_and_type.css': ':root{}',
  'assets/a1b2c3d4.png': 'png',
  'assets/a1b2c3d4.photo.json': '{}',
  'assets/a1b2c3d4.srt': '1',
  'assets/b1b2c3d4.png': 'png',
  'assets/b1b2c3d4.photo.json': '{}',
  'assets/0000beef.png': 'png',
  'assets/c0ffee00.png': 'png',
  'assets/5ade0001.svg': 'svg',
  'assets/a1b2c3d4.5.png': 'not a sidecar',
};

describe('closure on the hand fixture', () => {
  const project = reader(FILES);
  const a = closureFor(grant('ui/A.tsx'), project);

  test('owned = the canvas and its own sidecars, existing or not', () => {
    for (const rel of [
      'ui/A.tsx',
      'ui/A.meta.json',
      'ui/A.css',
      'ui/A.registry.json',
      'ui-a.annotations.json',
      'ui-a.annotations.svg',
      'ui-a.edl.json',
      '_comments/ui-a.json',
    ]) {
      expect([rel, a.owned.has(rel)]).toEqual([rel, true]);
      expect(a.ownedBy.get(rel)).toBe('ui/A.tsx');
    }
    expect(a.owned.has('shared/Card.tsx')).toBe(false);
    for (const rel of a.owned) expect(a.read.has(rel)).toBe(true);
  });

  test('read ⊇ the transitive relative import graph, clamped to the design root', () => {
    for (const rel of ['shared/Card.tsx', 'shared/card.css', 'shared/Icon.tsx']) {
      expect([rel, a.read.has(rel)]).toEqual([rel, true]);
    }
    expect(a.read.has('shared/Unused.tsx')).toBe(false);
    for (const rel of a.read) expect(rel.startsWith('..')).toBe(false);
  });

  test("read ⊇ the canvas's design system, minus specimens and ui kits", () => {
    for (const rel of [
      'system/brand/colors_and_type.css',
      'system/brand/README.md',
      'system/brand/preview/_ds.tsx',
      'system/brand/preview/_parts.tsx',
      'system/brand/preview/_layout.css',
      'system/brand/assets/fonts/display.woff2',
    ]) {
      expect([rel, a.read.has(rel)]).toEqual([rel, true]);
    }
    expect(a.read.has('system/brand/preview/buttons.tsx')).toBe(false);
    expect(a.read.has('system/brand/ui_kits/web/index.tsx')).toBe(false);
    expect(a.read.has('system/other/colors_and_type.css')).toBe(false);
  });

  test('read ⊇ statically referenced assets and their sidecars — from the canvas, its modules and its board', () => {
    for (const rel of [
      'assets/a1b2c3d4.png',
      'assets/a1b2c3d4.photo.json',
      'assets/a1b2c3d4.srt',
      'assets/0000beef.png',
      'assets/c0ffee00.png',
      'assets/5ade0001.svg',
    ]) {
      expect([rel, a.read.has(rel)]).toEqual([rel, true]);
    }
    for (const rel of [
      'assets/b1b2c3d4.png',
      'assets/b1b2c3d4.photo.json',
      'assets/a1b2c3d4.5.png',
    ]) {
      expect([rel, a.read.has(rel)]).toEqual([rel, false]);
    }
  });

  test('nothing of another canvas leaks in', () => {
    for (const rel of a.read) {
      expect(rel.startsWith('ui/B') || rel.startsWith('ui-b') || rel === 'config.json').toBe(false);
    }
  });

  test('assetUsers names every referrer of an asset, granted or not', () => {
    expect([...(a.assetUsers.get('assets/a1b2c3d4.png') ?? [])]).toEqual(['ui/A.tsx']);
    expect([...(a.assetUsers.get('assets/0000beef.png') ?? [])].sort()).toEqual([
      'ui/A.tsx',
      'ui/B.tsx',
    ]);
    // referenced only from a shared module: the module is the referrer
    expect([...(a.assetUsers.get('assets/5ade0001.svg') ?? [])]).toEqual(['shared/Card.tsx']);
  });

  test('G3: a computed asset reference is reported, not resolved', () => {
    expect(a.dynamic.size).toBe(0);
    const d = closureFor(grant('ui/D.tsx'), project);
    expect([...d.dynamic]).toEqual(['ui/D.tsx']);
    expect([...d.read].filter((r) => r.startsWith('assets/'))).toEqual([]);
  });

  test('no grants → an empty closure at the head', () => {
    const none = closureFor(resolveAccess(null), project);
    expect(none.head).toBe('h1');
    expect(none.read.size).toBe(0);
    expect(none.owned.size).toBe(0);
  });

  test('two grants union their closures', () => {
    const both = closureFor(
      resolveAccess({
        v: 1,
        role: null,
        grants: [
          { c: 'ui/B.tsx', r: 'viewer' },
          { c: 'ui/A.tsx', r: 'member' },
        ],
      }),
      project
    );
    expect(both.read.has('assets/b1b2c3d4.png')).toBe(true);
    expect(both.read.has('shared/Card.tsx')).toBe(true);
    expect(both.read.has('system/other/colors_and_type.css')).toBe(true);
    expect(both.ownedBy.get('ui-b.annotations.json')).toBe('ui/B.tsx');
  });
});

describe('G4 — cache by (sorted grants, head)', () => {
  test('same grants + head → the same closure; the head moves → recomputed', () => {
    const cache = createClosureCache();
    let head = 'h1';
    const files = { ...FILES };
    const project: ProjectReader = {
      list: () => Object.keys(files),
      text: (rel) => files[rel] ?? null,
      head: () => head,
    };
    const g1 = resolveAccess({
      v: 1,
      role: null,
      grants: [
        { c: 'ui/A.tsx', r: 'viewer' },
        { c: 'ui/B.tsx', r: 'viewer' },
      ],
    });
    const g2 = resolveAccess({
      v: 1,
      role: null,
      grants: [
        { c: 'ui/B.tsx', r: 'viewer' },
        { c: 'ui/A.tsx', r: 'viewer' },
      ],
    });
    const first = closureFor(g1, project, cache);
    expect(closureFor(g2, project, cache)).toBe(first);
    files['ui/B.tsx'] = 'export default () => <img src="assets/a1b2c3d4.png" />;';
    expect(closureFor(g1, project, cache)).toBe(first); // head unchanged → cached
    head = 'h2';
    const second = closureFor(g1, project, cache);
    expect(second).not.toBe(first);
    expect(second.head).toBe('h2');
    expect(second.read.has('assets/b1b2c3d4.png')).toBe(false);
  });
});

describe('closure on the Alligators fixture (V2-1.12)', () => {
  let dir = '';
  let project: ProjectReader;
  let canvases: string[] = [];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'access-closure-'));
    generateFormatFixture(dir);
    const root = join(dir, '.design');
    const files: string[] = [];
    const walk = (abs: string) => {
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        const p = join(abs, e.name);
        if (e.isDirectory()) walk(p);
        else files.push(relative(root, p).split(sep).join('/'));
      }
    };
    walk(root);
    project = {
      list: () => files,
      text: (rel) => {
        try {
          return readFileSync(join(root, rel), 'utf8');
        } catch {
          return null;
        }
      },
      head: () => 'alligators',
    };
    canvases = files.filter((f) => f.startsWith('ui/') && f.endsWith('.tsx')).sort();
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('93 canvases; a grant on one sees none of the other 92', () => {
    expect(canvases.length).toBe(93);
    const target = canvases.find((c) => c.endsWith('/c01.tsx')) as string;
    const cl = closureFor(grant(target), project);
    for (const c of canvases) expect([c, cl.read.has(c)]).toEqual([c, c === target]);
    // its board and comments come with it (fixture i=1 has both)
    const slug = target.replace(/\.tsx$/, '').replace(/\//g, '-');
    expect(cl.read.has(`${slug}.annotations.json`)).toBe(true);
    expect(cl.read.has(`_comments/${slug}.json`)).toBe(true);
    // c01's meta names the `alligators` system: tokens, components css, font, readme — no specimens
    expect(cl.read.has('system/alligators/colors_and_type.css')).toBe(true);
    expect(cl.read.has('system/alligators/preview/_components.css')).toBe(true);
    expect(cl.read.has('system/alligators/assets/fonts/display.woff2')).toBe(true);
    expect(cl.read.has('system/alligators/preview/buttons.tsx')).toBe(false);
    expect(cl.read.has('system/private-ds/colors_and_type.css')).toBe(false);
    // runtime state and project config never ride a closure
    for (const rel of cl.read) {
      expect(rel === 'config.json' || rel.startsWith('_chat/') || rel.startsWith('_history/')).toBe(
        false
      );
    }
  });

  test('a private-ds canvas gets the private system, not the alligators one', () => {
    const target = canvases.find((c) => c.endsWith('/c02.tsx')) as string;
    const cl = closureFor(grant(target), project);
    expect(cl.read.has('system/private-ds/colors_and_type.css')).toBe(true);
    expect(cl.read.has('system/alligators/colors_and_type.css')).toBe(false);
  });
});

describe('localDepsFromSource has one home (access/closure.ts)', () => {
  test('http.ts imports it from access/closure.ts and defines no copy', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
    expect(/function localDepsFromSource\s*\(/.test(src)).toBe(false);
    expect(
      /import \{[^}]*\blocalDepsFromSource\b[^}]*\} from '\.\/access\/closure\.ts'/.test(src)
    ).toBe(true);
  });

  test('it still resolves relative imports to absolute candidates', () => {
    const root = join('/tmp', 'x', '.design');
    const deps = localDepsFromSource(`import './a.css';`, join(root, 'ui', 'A.tsx'), root);
    expect(deps).toEqual([join(root, 'ui', 'a.css')]);
  });
});
