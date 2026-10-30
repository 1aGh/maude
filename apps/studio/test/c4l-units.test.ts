// gate-b-c4l — round 6 (ethical hacker M, defender M1 + L-b). Three halves, all pure here:
//   1. STRUCTURAL — a grant whose import walk refuses anything (another canvas, a file that is never a
//      module, an import that resolves to nothing) contributes ONLY its owned files to `read`: none of
//      the helpers it walked, no design system, no assets. The marker can miss; this cannot.
//   2. THE MARKER errs to "canvas": the raw word `DesignCanvas` anywhere in a `.tsx`, a namespace /
//      dynamic / require / escaped import of the lib, a computed import, an import from a module
//      that carries DesignCanvas (a lib proxy / barrel / wrapper, any extension), and every non-`_`
//      `.tsx` under `system/*/preview/` or `system/*/ui_kits/` (specimens and kits).
//   3. A long comment between `from` and the specifier no longer hides an import.
// Booted halves: c4l-frame-refusals.test.ts. Hub file plane: apps/hub/test/access-c4l-*.

import { describe, expect, test } from 'bun:test';

import {
  canvasImportsReport,
  closureFor,
  type ProjectReader,
  relativeImportCandidates,
} from '../access/closure.ts';
import { narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { isCanvasSource } from '../skip-dirs.ts';

const project = (files: Record<string, string>): ProjectReader => ({
  list: () => Object.keys(files),
  text: (r) => files[r] ?? null,
  head: () => 'h1',
});
const member = (...canvases: string[]) =>
  resolveAccess({ v: 1, role: null, grants: canvases.map((c) => ({ c, r: 'member' as const })) });
const ownerFrame = (c: string) => narrowToFrame(resolveAccess({ v: 1, role: 'owner' }), [c]);

const A = 'ui/a.tsx';
const B = 'ui/b.tsx';
const BASE: Record<string, string> = {
  [A]: "import B from './b.tsx';\nimport H from './helper.ts';\nexport default () => <B />;\n",
  'ui/a.meta.json': '{}',
  'ui/helper.ts': 'export const H = 1;\n',
};
const SECRET = 'export default () => <Shell><p>B-SECRET</p></Shell>;\n';

describe('2 — the marker errs to canvas', () => {
  test('the raw word anywhere in the file (comment, string, type import, any specifier)', () => {
    for (const src of [
      '// renders a DesignCanvas\nexport default () => <p />;',
      'const s = "DesignCanvas";',
      "import type { DesignCanvas } from '@maude/canvas-lib';",
      "import { DesignCanvas } from './local-lib';",
      "import{DesignCanvas}from'@maude/canvas-lib';",
    ])
      expect(isCanvasSource(src)).toBe(true);
  });

  test('namespace / dynamic / require / escaped imports of the lib, without the word', () => {
    for (const src of [
      "import * as CL from '@maude/canvas-lib';\nconst C = CL['Design' + 'Canvas'];",
      "import * as CL from '@maude/canvas-lib';\nconst { [k]: C } = CL;",
      "const m = await import('@maude/canvas-lib');",
      "const m = require('@maude/canvas-lib');",
      "import * as CL from '@maude/canvas\\u002dlib';\nconst C = CL[k];",
      "import { Design\\u0043anvas as C } from '@maude/canvas-lib';",
      "import { 'Design\\u0043anvas' as C } from '@maude/canvas-lib';",
      'const m = await import(spec);',
    ])
      expect(isCanvasSource(src)).toBe(true);
  });

  test('not a canvas: a plain component, another lib export by name or as NS.member', () => {
    expect(isCanvasSource('export default () => <button>OK</button>;')).toBe(false);
    expect(isCanvasSource("import { MotionDemo } from '@maude/canvas-lib';\n<MotionDemo />")).toBe(
      false
    );
    expect(isCanvasSource("import * as CL from '@maude/canvas-lib';\n<CL.DCPostIt />")).toBe(false);
  });

  const viaProxy: Array<[string, Record<string, string>]> = [
    [
      'a renamed re-export (kit.ts)',
      {
        'ui/kit.ts': "export { DesignCanvas as Shell } from '@maude/canvas-lib';\n",
        [B]: `import { Shell } from './kit.ts';\n${SECRET}`,
      },
    ],
    [
      'a star re-export, imported as a namespace (extensionless)',
      {
        'ui/kit.ts': "export * from '@maude/canvas-lib';\n",
        [B]: "import * as K from './kit';\nconst Shell = K[k];\n" + SECRET,
      },
    ],
    [
      'a chain of proxies',
      {
        'ui/kit.ts': "export { DesignCanvas as Shell } from '@maude/canvas-lib';\n",
        'ui/kit2.ts': "export * from './kit.ts';\n",
        [B]: `import { Shell } from './kit2.ts';\n${SECRET}`,
      },
    ],
    [
      'a local alias exported from a .ts',
      {
        'ui/kit.ts': "import * as CL from '@maude/canvas-lib';\nexport const Shell = CL[k];\n",
        [B]: `import { Shell } from './kit.ts';\n${SECRET}`,
      },
    ],
    [
      'a .jsx wrapper (not a canvas itself: only .tsx is)',
      {
        'ui/Shell.jsx':
          "import { DesignCanvas } from '@maude/canvas-lib';\nexport default (p) => <DesignCanvas>{p.children}</DesignCanvas>;\n",
        [B]: `import Shell from './Shell.jsx';\n${SECRET}`,
      },
    ],
  ];
  for (const [label, extra] of viaProxy) {
    test(`B through ${label}: a canvas — refused to A, never read`, () => {
      const files = { ...BASE, ...extra };
      expect(canvasImportsReport(project(files), [A]).get(A)).toEqual([B]);
      for (const who of [member(A), ownerFrame(A)]) {
        const c = closureFor(who, project(files));
        expect(c.read.has(B)).toBe(false);
        expect(c.read.has('ui/helper.ts')).toBe(false);
      }
    });
  }

  test('a barrel that also re-exports DesignCanvas still serves its other names', () => {
    const files = {
      ...BASE,
      'ui/kit.ts':
        "export { DesignCanvas } from '@maude/canvas-lib';\nexport { default as Button } from './button.tsx';\n",
      'ui/button.tsx': 'export default () => <button>OK</button>;\n',
      [B]: "import { Button } from './kit.ts';\nexport default () => <Button />;\n",
    };
    expect(canvasImportsReport(project(files), [A]).has(A)).toBe(false);
    const c = closureFor(member(A), project(files));
    for (const rel of [B, 'ui/kit.ts', 'ui/button.tsx', 'ui/helper.ts'])
      expect(c.read.has(rel)).toBe(true);
  });

  test('DS specimens and ui-kit files are canvases; `_` modules and the system styles are not', () => {
    const files: Record<string, string> = {
      'config.json': JSON.stringify({
        designSystems: [{ name: 'x', path: 'system/x' }],
        defaultDesignSystem: 'x',
      }),
      [A]: "import P from '../system/x/preview/_kit.tsx';\nimport '../system/x/preview/_layout.css';\nexport default () => <P />;\n",
      'ui/a.meta.json': '{}',
      'ui/s.tsx': "import S from '../system/x/preview/button.tsx';\nexport default () => <S />;\n",
      'ui/s.meta.json': '{}',
      'ui/k.tsx':
        "import K from '../system/x/ui_kits/web/index.tsx';\nexport default () => <K />;\n",
      'ui/k.meta.json': '{}',
      'system/x/tokens.css': ':root{--a:1}',
      'system/x/preview/_kit.tsx': 'export default () => <i>KIT</i>;\n',
      'system/x/preview/_layout.css': 'body{}',
      'system/x/preview/button.tsx':
        "import './button.css';\nexport default () => <b>SPECIMEN</b>;\n",
      'system/x/preview/button.css': '.b{}',
      'system/x/ui_kits/web/index.tsx': 'export default () => <main>KIT-INDEX</main>;\n',
    };
    const p = project(files);
    expect(canvasImportsReport(p, ['ui/s.tsx', 'ui/k.tsx', A])).toEqual(
      new Map([
        ['ui/s.tsx', ['system/x/preview/button.tsx']],
        ['ui/k.tsx', ['system/x/ui_kits/web/index.tsx']],
      ])
    );
    const a = closureFor(member(A), p);
    for (const rel of [
      'system/x/preview/_kit.tsx',
      'system/x/preview/_layout.css',
      'system/x/tokens.css',
    ])
      expect(a.read.has(rel)).toBe(true);
    // the specimen's own stylesheet belongs to the specimen, not to every DS user
    expect(a.read.has('system/x/preview/button.css')).toBe(false);
    for (const c of ['ui/s.tsx', 'ui/k.tsx']) {
      const r = closureFor(member(c), p).read;
      expect(r.has('system/x/preview/button.tsx')).toBe(false);
      expect(r.has('system/x/ui_kits/web/index.tsx')).toBe(false);
    }
    // a specimen granted itself still reads its own stylesheet
    expect(
      closureFor(member('system/x/preview/button.tsx'), p).read.has('system/x/preview/button.css')
    ).toBe(true);
  });
});

describe('1 — a grant whose walk refuses anything reads only what it owns', () => {
  const WRAPPER = {
    ...BASE,
    // B is no canvas by any marker: it renders a wrapper that is one
    [B]: "import BoardShell from './BoardShell.tsx';\nexport default () => <BoardShell><p>B-SECRET</p></BoardShell>;\n",
    'ui/BoardShell.tsx':
      "import { DesignCanvas } from '@maude/canvas-lib';\nexport default (p) => <DesignCanvas>{p.children}</DesignCanvas>;\n",
    'assets/pic.png': 'x',
  };
  WRAPPER[A] = `${WRAPPER[A]}const src = 'assets/pic.png';\n`;

  for (const [who, access] of [
    ['a canvas-only member of A', member(A)],
    ["the owner's frame on A", ownerFrame(A)],
  ] as const) {
    test(`${who}: the wrapper variant — A and its sidecars only`, () => {
      const c = closureFor(access, project(WRAPPER));
      expect([...c.read].sort()).toEqual([...c.owned].sort());
      expect(c.read.has(A)).toBe(true);
      for (const rel of [B, 'ui/BoardShell.tsx', 'ui/helper.ts', 'assets/pic.png'])
        expect(c.read.has(rel)).toBe(false);
      expect(c.blocked.has(A)).toBe(true);
    });
  }

  test('an import that resolves to nothing blocks the grant the same way', () => {
    const files = {
      ...BASE,
      [A]: "import M from './missing.tsx';\nimport H from './helper.ts';\nexport default () => <M />;\n",
    };
    const c = closureFor(member(A), project(files));
    expect(c.blocked.has(A)).toBe(true);
    expect(c.read.has('ui/helper.ts')).toBe(false);
  });

  test('another grant in the same session keeps its own closure', () => {
    const files = {
      ...WRAPPER,
      'ui/home.tsx': "import H from './helper.ts';\nexport default () => <p />;\n",
      'ui/home.meta.json': '{}',
    };
    const c = closureFor(member(A, 'ui/home.tsx'), project(files));
    expect(c.read.has('ui/helper.ts')).toBe(true);
    expect(c.read.has(B)).toBe(false);
    expect(c.blocked.has('ui/home.tsx')).toBe(false);
  });

  test('a clean canvas is not blocked and reads its helpers', () => {
    const files = { ...BASE, [A]: "import H from './helper.ts';\nexport default () => <p />;\n" };
    const c = closureFor(member(A), project(files));
    expect(c.blocked.size).toBe(0);
    expect(c.read.has('ui/helper.ts')).toBe(true);
  });
});

describe('3 — the specifier lead survives a long comment', () => {
  test('`from /* … */ "./b.tsx"` is still an import', () => {
    const src = `import B from /* ${'x'.repeat(80)} */ './b.tsx';\nconst C = import /* ${'y'.repeat(80)} */ ( './c.tsx' );\n`;
    const deps = relativeImportCandidates(src, '/r/ui/a.tsx', '/r');
    expect(deps).toContain('/r/ui/b.tsx');
    expect(deps).toContain('/r/ui/c.tsx');
  });
});
