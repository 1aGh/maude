// p8-c4 — the open C4 (frame capability) known gaps from the wave-B gate (round 8), each pure here.
//   M  defender: `carriedPass` short-circuited its import scan (`.some`), so a module reached only
//      behind an import that STARTED to reach in a later pass kept its pass-1 approximation, and
//      the fixed point cached that stale "carries nothing" for every later grant in the closure.
//   L  attacker: a per-use photo edit (`assets/<img8>.<edit8>.photo.json`) was importable as JSON
//      by any canvas that guessed the hash — U1 / S8 §5.6 admit it only through the attribute.
//   L  attacker: the specimen-stylesheet exemption (c4m M-B) also covered a UI kit / showcase
//      canvas's own stylesheet.

import { describe, expect, test } from 'bun:test';
import { closureFor, type ProjectReader } from '../access/closure.ts';
import { resolveAccess } from '../access/scope.ts';

const project = (files: Record<string, string>): ProjectReader => ({
  list: () => Object.keys(files),
  text: (r) => files[r] ?? null,
  head: () => 'h1',
});
const member = (...canvases: string[]) =>
  resolveAccess({ v: 1, role: null, grants: canvases.map((c) => ({ c, r: 'member' as const })) });
const closureOf = (files: Record<string, string>, ...grants: string[]) =>
  closureFor(member(...grants), project(files));

describe('defender M — a short-circuited import scan never finalizes a stale proxy answer', () => {
  // p.ts imports Foo from q.ts (q re-exports p's Baz — a cycle, so q carries nothing in pass 1)
  // and Bar from c.ts. c.ts ↔ d.ts is a second cycle: c re-exports d's Bar, d re-exports c's Qux
  // (= DesignCanvas). Pass 1 leaves c/d short; pass 2 sees Foo reach, stops scanning p's imports
  // and never revisits c — the old code then cached c = {Qux}, d = {} as final. x.tsx renders
  // <Bar> from c.ts, so it IS a canvas; a grant that imports it must be refused.
  const files: Record<string, string> = {
    'ui/kit/p.ts':
      "import { Foo } from './q.ts';\nimport { Bar } from './c.ts';\nexport { DesignCanvas as Baz } from '@maude/canvas-lib';\n",
    'ui/kit/q.ts': "export { Baz as Foo } from './p.ts';\n",
    'ui/kit/c.ts':
      "export { Bar } from './d.ts';\nexport { DesignCanvas as Qux } from '@maude/canvas-lib';\n",
    'ui/kit/d.ts': "export { Qux as Bar } from './c.ts';\n",
    'ui/h.tsx': "import { Baz } from './kit/p.ts';\nexport default () => <Baz />;\n",
    'ui/x.tsx':
      "import { Bar } from './kit/c.ts';\nexport default () => <Bar><p>X-SECRET</p></Bar>;\n",
    'ui/g1.tsx': "import H from './h.tsx';\nexport default () => <H />;\n",
    'ui/g1.meta.json': '{}',
    'ui/g2.tsx': "import X from './x.tsx';\nexport default () => <X />;\n",
    'ui/g2.meta.json': '{}',
  };
  for (const order of [
    ['ui/g1.tsx', 'ui/g2.tsx'],
    ['ui/g2.tsx', 'ui/g1.tsx'],
  ])
    test(`grants ${order.join(' + ')}: x.tsx is a canvas and is never read`, () => {
      const c = closureOf(files, ...order);
      expect(c.blocked.has('ui/g1.tsx')).toBe(true);
      expect(c.blocked.has('ui/g2.tsx')).toBe(true);
      expect(c.read.has('ui/x.tsx')).toBe(false);
      expect(c.read.has('ui/h.tsx')).toBe(false);
    });
});

describe('attacker L — a per-use photo edit is never importable', () => {
  const files: Record<string, string> = {
    'assets/a1b2c3d4.png': 'PNG',
    'assets/a1b2c3d4.0f0f0f0f.photo.json': '{"secret":"OTHER-CANVAS-EDIT"}',
    'ui/other.tsx':
      '<img src="assets/a1b2c3d4.png" data-photo-edit="0f0f0f0f" />\nexport default 1;\n',
    'ui/other.meta.json': '{}',
    'ui/a.meta.json': '{}',
  };
  test('an import of another canvas’s per-use edit blocks the grant — owned files only', () => {
    const f = {
      ...files,
      'ui/a.tsx':
        "import E from '../assets/a1b2c3d4.0f0f0f0f.photo.json';\nexport default () => <p>{String(E)}</p>;\n",
    };
    const c = closureOf(f, 'ui/a.tsx');
    expect(c.blocked.has('ui/a.tsx')).toBe(true);
    expect(c.read.has('assets/a1b2c3d4.0f0f0f0f.photo.json')).toBe(false);
  });
  test('the attribute on the canvas’s own element still admits it (S8 §5.6)', () => {
    const f = {
      ...files,
      'ui/a.tsx':
        'export default () => <img src="assets/a1b2c3d4.png" data-photo-edit="0f0f0f0f" />;\n',
    };
    const c = closureOf(f, 'ui/a.tsx');
    expect(c.blocked.size).toBe(0);
    expect(c.read.has('assets/a1b2c3d4.0f0f0f0f.photo.json')).toBe(true);
  });
  test('ordinary JSON data under assets/ stays importable', () => {
    const f = {
      ...files,
      'assets/data.json': '{"rows":[]}',
      'ui/a.tsx': "import D from '../assets/data.json';\nexport default () => <p>{D.rows}</p>;\n",
    };
    const c = closureOf(f, 'ui/a.tsx');
    expect(c.blocked.size).toBe(0);
    expect(c.read.has('assets/data.json')).toBe(true);
  });
});

describe('attacker L — the specimen-stylesheet exemption stops at UI kits and showcases', () => {
  const DS: Record<string, string> = {
    'config.json': JSON.stringify({
      designSystems: [{ name: 'x', path: 'system/x' }],
      defaultDesignSystem: 'x',
    }),
    'system/x/tokens.css': ':root{--a:1}',
    'system/x/preview/empty-state.tsx':
      "import './empty-state.css';\nexport default () => <b />;\n",
    'system/x/preview/empty-state.css': '.empty{}',
    'system/x/preview/ui_kits-desktop-showcase.tsx':
      "import './ui_kits-desktop-showcase.css';\nexport default () => <main />;\n",
    'system/x/preview/ui_kits-desktop-showcase.css': '.sc{/* SHOWCASE-LAYOUT */}',
    'system/x/ui_kits/web/shell.tsx': "import './shell.css';\nexport default () => <main />;\n",
    'system/x/ui_kits/web/shell.css': '.shell{/* KIT-LAYOUT */}',
    'ui/a.meta.json': '{}',
  };
  for (const css of [
    '../system/x/preview/ui_kits-desktop-showcase.css',
    '../system/x/ui_kits/web/shell.css',
  ])
    test(`importing ${css.slice(3)} blocks the grant`, () => {
      const f = { ...DS, 'ui/a.tsx': `import '${css}';\nexport default () => <p />;\n` };
      const c = closureOf(f, 'ui/a.tsx');
      expect(c.blocked.has('ui/a.tsx')).toBe(true);
      expect(c.read.has(css.slice(3))).toBe(false);
    });
  test('a specimen’s stylesheet stays importable (c4m M-B)', () => {
    const f = {
      ...DS,
      'ui/a.tsx': "import '../system/x/preview/empty-state.css';\nexport default () => <p />;\n",
    };
    const c = closureOf(f, 'ui/a.tsx');
    expect(c.blocked.size).toBe(0);
    expect(c.read.has('system/x/preview/empty-state.css')).toBe(true);
  });
  test('a granted kit still reads its own stylesheet', () => {
    const c = closureOf(DS, 'system/x/ui_kits/web/shell.tsx');
    expect(c.read.has('system/x/ui_kits/web/shell.css')).toBe(true);
  });
});
