// gate-b-c4m — ethical hacker round 7. `.html` canvases bypassed the structural rule: the closure's
// canvas predicate knew only `.tsx`, and the import walk admitted any file, so a canvas-only editor
// of A who adds `import './B.html'` (or `with { type: 'text' }`) got B.html — and its static asset
// refs — into `read`, and the hub file plane served it. Three halves, all pure here:
//   1. the import walk admits only module / style / data extensions (`.tsx .ts .jsx .js .mjs .cjs
//      .css .json`); ANY other import (`.html`, `.md`, `.txt`, unknown) blocks the grant;
//   2. the closure's `isCanvas` knows `.html` canvases by the index's own predicate (`isCanvasFile`,
//      one function shared with activity.ts) — a DS-folder `.html` board is not in a grantee's read;
//   3. `.html` DS specimens (`system/<ds>/preview/*.html`) are DS surfaces and not in a grantee's read.
// Booted halves: c4m-frame-refusals.test.ts. Hub file plane: apps/hub/test/access-c4m-html-import.test.mjs.

import { describe, expect, test } from 'bun:test';
import {
  canvasImportsReport,
  closureFor,
  type ProjectReader,
  relativeImportCandidates,
} from '../access/closure.ts';
import { resolveAccess } from '../access/scope.ts';
import { isCanvasFile as activityIsCanvasFile } from '../activity.ts';
import { isCanvasFile, isCanvasSource, isDsSurfaceRel, moduleLinks } from '../skip-dirs.ts';

const project = (files: Record<string, string>): ProjectReader => ({
  list: () => Object.keys(files),
  text: (r) => files[r] ?? null,
  head: () => 'h1',
});
const member = (...canvases: string[]) =>
  resolveAccess({ v: 1, role: null, grants: canvases.map((c) => ({ c, r: 'member' as const })) });

const A = 'ui/a.tsx';
const DS = {
  'config.json': JSON.stringify({
    designSystems: [{ name: 'x', path: 'system/x' }],
    defaultDesignSystem: 'x',
  }),
  'system/x/tokens.css': ':root{--a:1}',
  'system/x/preview/_layout.css': 'body{}',
  'system/x/preview/colors.html': '<html><body>CANARY-SPECIMEN-HTML</body></html>',
  'system/x/board.html': '<html><body>CANARY-DS-BOARD</body></html>',
};
const BASE: Record<string, string> = {
  ...DS,
  'ui/a.meta.json': '{}',
  'ui/helper.ts': 'export const H = 1;\n',
  'ui/b.html': '<html><body>CANARY-B-HTML<img src="../assets/b-only.png"></body></html>',
  'assets/b-only.png': 'PNG',
  'ui/notes.md': '# CANARY-NOTES',
  'ui/notes.txt': 'CANARY-TXT',
};

const closureOf = (files: Record<string, string>, ...grants: string[]) =>
  closureFor(member(...(grants.length ? grants : [A])), project(files));

describe('1 — the import walk admits only module / style / data extensions', () => {
  for (const [label, line] of [
    ['an .html canvas', "import B from './b.html';"],
    ['an .html canvas as text', "import B from './b.html' with { type: 'text' };"],
    ['a markdown file as text', "import N from './notes.md' with { type: 'text' };"],
    ['a .txt file', "import N from './notes.txt';"],
  ] as const)
    test(`${label} blocks the grant — owned files only`, () => {
      const files = {
        ...BASE,
        [A]: `${line}\nimport H from './helper.ts';\nexport default () => <p />;\n`,
      };
      const c = closureOf(files);
      expect(c.blocked.has(A)).toBe(true);
      for (const rel of [
        'ui/b.html',
        'assets/b-only.png',
        'ui/notes.md',
        'ui/notes.txt',
        'ui/helper.ts',
        'system/x/tokens.css',
      ])
        expect(c.read.has(rel)).toBe(false);
      expect(c.read.has(A)).toBe(true);
      expect(c.read.has('ui/a.meta.json')).toBe(true);
    });

  test('a normal canvas (helpers, components, JSON data, styles, .mjs/.cjs, DS) is not blocked', () => {
    const files = {
      ...BASE,
      [A]: [
        "import H from './helper.ts';",
        "import Btn from '../components/button.tsx';",
        "import W from './widget.jsx';",
        "import u from './util.js';",
        "import m from './m.mjs';",
        "import cj from './c.cjs';",
        "import d from './data.json';",
        "import './a.css';",
        "import '../system/x/preview/_layout.css';",
        'export default () => <img src="../assets/logo.svg" />;',
      ].join('\n'),
      'components/button.tsx': 'export default () => <button />;\n',
      'ui/widget.jsx': 'export default () => <i />;\n',
      'ui/util.js': 'export default 1;\n',
      'ui/m.mjs': 'export default 1;\n',
      'ui/c.cjs': 'module.exports = 1;\n',
      'ui/data.json': '{"l":"x"}',
      'ui/a.css': '.a{}',
      'assets/logo.svg': '<svg/>',
    };
    const c = closureOf(files);
    expect(c.blocked.size).toBe(0);
    for (const rel of [
      'ui/helper.ts',
      'components/button.tsx',
      'ui/widget.jsx',
      'ui/util.js',
      'ui/m.mjs',
      'ui/c.cjs',
      'ui/data.json',
      'ui/a.css',
      'system/x/tokens.css',
      'system/x/preview/_layout.css',
      'assets/logo.svg',
    ])
      expect(c.read.has(rel)).toBe(true);
  });

  test('the shell’s imports card names an imported .html canvas', () => {
    const files = { ...BASE, [A]: "import B from './b.html';\nexport default () => <p />;\n" };
    expect(canvasImportsReport(project(files), [A]).get(A)).toEqual(['ui/b.html']);
  });
});

describe('defender M-B — a specimen’s stylesheet is DS styling, importable', () => {
  // mirrors `.design/ui/v2/01 Create Flow.tsx`, which lifts `preview/empty-state.css`
  const files: Record<string, string> = {
    ...DS,
    'ui/v2/01 Create Flow.tsx':
      "import { DesignCanvas } from '@maude/canvas-lib';\nimport '../../system/x/preview/empty-state.css';\nimport '../../system/x/ui_kits/web/shell.css';\nexport default () => <DesignCanvas />;\n",
    'system/x/preview/empty-state.tsx':
      "import './empty-state.css';\nexport default () => <b>CANARY-SPECIMEN</b>;\n",
    'system/x/preview/empty-state.css': '.empty{}',
    'system/x/ui_kits/web/shell.tsx': 'export default () => <main>KIT</main>;\n',
    'system/x/ui_kits/web/shell.css': '.shell{}',
  };
  test('the importer is not blocked and reads the stylesheets, never the specimen', () => {
    const c = closureOf(files, 'ui/v2/01 Create Flow.tsx');
    expect(c.blocked.size).toBe(0);
    expect(c.read.has('system/x/preview/empty-state.css')).toBe(true);
    expect(c.read.has('system/x/ui_kits/web/shell.css')).toBe(true);
    expect(c.read.has('system/x/preview/empty-state.tsx')).toBe(false);
    expect(c.read.has('system/x/ui_kits/web/shell.tsx')).toBe(false);
  });
  test('the specimen itself is still refused', () => {
    const f = {
      ...files,
      [A]: "import S from '../system/x/preview/empty-state.tsx';\nexport default () => <S />;\n",
    };
    expect(closureOf(f).blocked.has(A)).toBe(true);
  });
});

describe('2 + 3 — .html canvases and specimens are canvases to the closure', () => {
  test('one predicate: the closure’s isCanvasFile IS activity.ts’s', () => {
    expect(activityIsCanvasFile).toBe(isCanvasFile);
    expect(isCanvasFile('ui/legacy.html')).toBe(true);
  });

  test('isDsSurfaceRel covers .html specimens and kits (not `_` helpers)', () => {
    expect(isDsSurfaceRel('system/x/preview/colors.html')).toBe(true);
    expect(isDsSurfaceRel('system/x/ui_kits/web/index.html')).toBe(true);
    expect(isDsSurfaceRel('system/x/preview/_shell.html')).toBe(false);
    expect(isDsSurfaceRel('system/x/tokens.css')).toBe(false);
  });

  test('a grantee under the DS reads its styles, never an .html specimen or an .html DS board', () => {
    const files = { ...BASE, [A]: "import H from './helper.ts';\nexport default () => <p />;\n" };
    const c = closureOf(files);
    expect(c.blocked.size).toBe(0);
    expect(c.read.has('system/x/tokens.css')).toBe(true);
    expect(c.read.has('system/x/preview/colors.html')).toBe(false);
    expect(c.read.has('system/x/board.html')).toBe(false);
  });

  test('a granted .html DS board is still the grantee’s own', () => {
    const files = { ...BASE };
    const c = closureOf(files, 'system/x/board.html');
    expect(c.read.has('system/x/board.html')).toBe(true);
  });
});

describe('defender L-A — a namespace name that is no identifier is unreadable, not a crash', () => {
  test('moduleLinks / isCanvasSource do not throw, and a lib namespace errs to canvas', () => {
    expect(() => moduleLinks("import * as X( from './h';\n")).not.toThrow();
    expect(() => moduleLinks("import * as a[b from './h';\n")).not.toThrow();
    expect(isCanvasSource("import * as X( from '@maude/canvas-lib';\nexport default 1;\n")).toBe(
      true
    );
  });
  test('a closure reaching such a module still computes', () => {
    const files = {
      ...BASE,
      [A]: "import H from './h.tsx';\nexport default () => <H />;\n",
      'ui/h.tsx': "import * as X( from './helper.ts';\nexport default () => <i />;\n",
    };
    expect(() => closureOf(files)).not.toThrow();
  });
});

describe('defender M-A — a re-export cycle never caches a wrong "carries nothing"', () => {
  // a.ts re-exports DesignCanvas as Foo and everything of b.ts; b.ts re-exports Foo from a.ts. Walking
  // a.ts first used to cache b.ts as carrying nothing (a.ts was still in progress), so x.tsx — which
  // renders <Foo> from b.ts — was "not a canvas" for every later grant in the same closure.
  const files: Record<string, string> = {
    'ui/kit/a.ts':
      "export { DesignCanvas as Foo } from '@maude/canvas-lib';\nexport * from './b.ts';\n",
    'ui/kit/b.ts': "export { Foo } from './a.ts';\n",
    'ui/y.tsx': "import { Foo } from './kit/a.ts';\nexport default () => <Foo />;\n",
    'ui/x.tsx':
      "import { Foo } from './kit/b.ts';\nexport default () => <Foo><p>X-SECRET</p></Foo>;\n",
    'ui/g1.tsx': "import Y from './y.tsx';\nexport default () => <Y />;\n",
    'ui/g1.meta.json': '{}',
    'ui/g2.tsx': "import X from './x.tsx';\nexport default () => <X />;\n",
    'ui/g2.meta.json': '{}',
  };
  for (const order of [
    ['ui/g1.tsx', 'ui/g2.tsx'],
    ['ui/g2.tsx', 'ui/g1.tsx'],
  ])
    test(`grants ${order.join(' + ')}: both proxies are canvases, x.tsx is not read`, () => {
      const c = closureOf(files, ...order);
      expect(c.blocked.has('ui/g1.tsx')).toBe(true);
      expect(c.blocked.has('ui/g2.tsx')).toBe(true);
      expect(c.read.has('ui/x.tsx')).toBe(false);
      expect(c.read.has('ui/y.tsx')).toBe(false);
    });
});

describe('defender L-B — the scanner sees a template-literal import() and a CSS @import url()', () => {
  const R = '/r/.design';
  test('both forms are import candidates', () => {
    expect(
      relativeImportCandidates('const m = import(`./x.tsx`);\n', `${R}/ui/a.tsx`, R)
    ).toContain(`${R}/ui/x.tsx`);
    expect(
      relativeImportCandidates('const m = require( `./y.js` );\n', `${R}/ui/a.tsx`, R)
    ).toContain(`${R}/ui/y.js`);
    for (const css of [
      '@import url(./t.css);\n',
      '@import url("./t.css");\n',
      "@import url( './t.css' ) screen;\n",
    ])
      expect(relativeImportCandidates(css, `${R}/ui/a.css`, R)).toContain(`${R}/ui/t.css`);
  });
  test('a computed template, a plain template string and a background url() are not imports', () => {
    expect(relativeImportCandidates('import(`./x/$' + '{n}.tsx`);\n', `${R}/ui/a.tsx`, R)).toEqual(
      []
    );
    expect(relativeImportCandidates('const s = `./x.tsx`;\n', `${R}/ui/a.tsx`, R)).toEqual([]);
    expect(
      relativeImportCandidates('.a { background: url(./bg.css); }\n', `${R}/ui/a.css`, R)
    ).toEqual([]);
  });
  test('a template-literal import of a canvas, or of a missing file, blocks the grant', () => {
    for (const line of ['const m = import(`./b.tsx`);', 'const m = import(`./absent.tsx`);']) {
      const files = {
        ...BASE,
        [A]: `${line}\nimport H from './helper.ts';\nexport default () => <p />;\n`,
        'ui/b.tsx': "import { DesignCanvas } from '@maude/canvas-lib';\nexport default 1;\n",
      };
      expect(closureOf(files).blocked.has(A)).toBe(true);
    }
  });
  test('a CSS @import url() of a canvas’s stylesheet blocks the grant', () => {
    const files = {
      ...BASE,
      [A]: "import './a.css';\nexport default () => <p />;\n",
      'ui/a.css': '@import url(./b.css);\n',
      'ui/b.tsx': "import { DesignCanvas } from '@maude/canvas-lib';\nexport default 1;\n",
      'ui/b.css': '.b{}',
    };
    expect(closureOf(files).blocked.has(A)).toBe(true);
  });
});
