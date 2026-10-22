// gate-b-c4k — "is this .tsx a canvas?" is answered by the FILE, the same on every machine and the
// hub: a `.tsx` that imports `DesignCanvas` from `@maude/canvas-lib` (comments and strings do not
// count), or that has a `.meta.json` or a board. Path rules (`components/`, `newComponentDir`, the
// per-machine canvas groups) no longer decide it for access (M1, M2); groups still decide what the
// index LISTS, but never hide a canvas that has a meta or renders DesignCanvas.
// Booted halves: c4k-frame-content-canvas.test.ts. Hub file plane: apps/hub/test/access-c4k-*.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type Closure,
  canvasImportsReport,
  closureFor,
  type ProjectReader,
} from '../access/closure.ts';
import { filterIndexData, visibilityOf } from '../access/filters.ts';
import { narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { isCanvasRel, listCanvases } from '../index/extract.ts';
import { isCanvasSource } from '../skip-dirs.ts';

const CANVAS = (mark: string) =>
  `import { DesignCanvas, DCSection, DCArtboard } from '@maude/canvas-lib';\nexport default () => <DesignCanvas><DCSection id="s"><DCArtboard id="a" width={10} height={10}><p>${mark}</p></DCArtboard></DCSection></DesignCanvas>;\n`;

describe('isCanvasSource — the content marker', () => {
  test('a named import of DesignCanvas (plain, aliased, among others, multi-line)', () => {
    expect(isCanvasSource(CANVAS('x'))).toBe(true);
    expect(isCanvasSource("import { DesignCanvas as DC } from '@maude/canvas-lib';\n<DC />")).toBe(
      true
    );
    expect(
      isCanvasSource('import {\n  DCArtboard,\n  DesignCanvas,\n} from "@maude/canvas-lib";\n')
    ).toBe(true);
    expect(isCanvasSource("import React, { DesignCanvas } from '@maude/canvas-lib';")).toBe(true);
  });

  test('a namespace import used as NS.DesignCanvas, and a dynamic import naming it', () => {
    expect(isCanvasSource("import * as CL from '@maude/canvas-lib';\n<CL.DesignCanvas />")).toBe(
      true
    );
    expect(
      isCanvasSource("const { DesignCanvas } = await import('@maude/canvas-lib');\n<DesignCanvas/>")
    ).toBe(true);
  });

  test('not a canvas: other canvas-lib exports by name or as NS.member', () => {
    expect(isCanvasSource("import { MotionDemo } from '@maude/canvas-lib';\n<MotionDemo />")).toBe(
      false
    );
    expect(isCanvasSource("import * as CL from '@maude/canvas-lib';\n<CL.DCPostIt />")).toBe(false);
  });

  // gate-b-c4l — the marker errs to "canvas": the raw word anywhere (a type import, a comment, a
  // string, any specifier) makes the file one; a false positive only refuses an import.
  test('the raw word anywhere is a canvas (c4l: err to canvas)', () => {
    for (const src of [
      "import type { DesignCanvas } from '@maude/canvas-lib';",
      "import { type DesignCanvas } from '@maude/canvas-lib';",
      "// import { DesignCanvas } from '@maude/canvas-lib';\n",
      'const s = "import { DesignCanvas } from \'@maude/canvas-lib\'";',
      "import { DesignCanvas } from './local-lib';",
      "import { DesignCanvas } from './mine'; import { DCArtboard } from '@maude/canvas-lib';",
    ])
      expect(isCanvasSource(src)).toBe(true);
    expect(isCanvasSource('export default () => <button>OK</button>;')).toBe(false);
  });
});

function project(files: Record<string, string>): ProjectReader {
  return { list: () => Object.keys(files), text: (r) => files[r] ?? null, head: () => 'h1' };
}

// A imports three meta-less DesignCanvas files at paths c4j called components (M2) or that sit in
// a group this machine does not know (M1), plus a real component.
const A = 'ui/a.tsx';
const FILES: Record<string, string> = {
  // a config that knows NO extra group and names a component dir — none of it may matter
  'config.json': JSON.stringify({ newComponentDir: 'ui/kit' }),
  [A]: "import C1 from './components/Secret.tsx';\nimport C2 from '../system/x/Board.tsx';\nimport C3 from '../elsewhere/Plan.tsx';\nimport K from './kit/Panel.tsx';\nimport Button from './components/Button.tsx';\nexport default () => <Button />;\n",
  'ui/a.meta.json': '{}',
  'ui/components/Secret.tsx': CANVAS('CANARY-COMPONENTS'),
  'system/x/Board.tsx': CANVAS('CANARY-SYSTEM'),
  'elsewhere/Plan.tsx': CANVAS('CANARY-UNKNOWN-GROUP'),
  'ui/kit/Panel.tsx': CANVAS('CANARY-KIT'),
  'ui/components/Button.tsx': 'export default () => <button>BUTTON-OK</button>;\n',
};
const REFUSED = [
  'elsewhere/Plan.tsx',
  'system/x/Board.tsx',
  'ui/components/Secret.tsx',
  'ui/kit/Panel.tsx',
];

const OWNER = resolveAccess({ v: 1, role: 'owner' });
const member = (...canvases: string[]) =>
  resolveAccess({ v: 1, role: null, grants: canvases.map((c) => ({ c, r: 'member' as const })) });

describe('a canvas by content is never importable, wherever it sits (M1, M2)', () => {
  for (const [who, access] of [
    ['a canvas-only member of A', member(A)],
    ["the owner's frame on A", narrowToFrame(OWNER, [A])],
  ] as const) {
    test(`${who}: none of the meta-less DesignCanvas files is in the closure, nor Button (c4l)`, () => {
      const c = closureFor(access, project(FILES));
      for (const rel of REFUSED) expect(c.read.has(rel)).toBe(false);
      // gate-b-c4l — A's walk refused them: A reads only what it owns, its component included
      expect(c.read.has('ui/components/Button.tsx')).toBe(false);
    });
  }

  test('the per-machine config does not change the answer (no config, another config)', () => {
    const { 'config.json': _drop, ...bare } = FILES;
    const other = {
      ...FILES,
      'config.json': JSON.stringify({ canvasGroups: [{ path: 'elsewhere', label: 'E' }] }),
    };
    for (const files of [bare, other]) {
      const c = closureFor(member(A), project(files));
      for (const rel of REFUSED) expect(c.read.has(rel)).toBe(false);
      expect(c.blocked.has(A)).toBe(true);
    }
  });

  test('the imports report names exactly the refused canvases', () => {
    expect(canvasImportsReport(project(FILES), [A]).get(A)).toEqual(REFUSED);
  });

  test('a frame holding the imported canvas reads it (inside its grant)', () => {
    const c = closureFor(member(A, 'ui/components/Secret.tsx'), project(FILES));
    expect(c.read.has('ui/components/Secret.tsx')).toBe(true);
  });
});

describe('the index lists what groups hold, and never hides a canvas by content or meta (M2)', () => {
  test('a meta canvas and a DesignCanvas file under components/ are listed; a component is not', () => {
    const root = mkdtempSync(join(tmpdir(), 'c4k-index-'));
    try {
      const files: Record<string, string> = {
        'ui/home.tsx': CANVAS('home'),
        'ui/components/Button.tsx': 'export default () => <button />;\n',
        'ui/components/Card.tsx': 'export default () => <div />;\n',
        'ui/components/Card.meta.json': '{}',
        'ui/components/Board.tsx': CANVAS('board'),
        'system/ds/kit/Sheet.tsx': CANVAS('sheet'),
      };
      for (const [rel, text] of Object.entries(files)) {
        mkdirSync(join(root, rel, '..'), { recursive: true });
        writeFileSync(join(root, rel), text);
      }
      const ctx = {
        designRoot: root,
        groups: [
          { path: 'system', label: 'System' },
          { path: 'ui', label: 'UI' },
        ],
        defaultDs: null,
        designSystems: [],
      };
      expect(listCanvases(ctx)).toEqual([
        'system/ds/kit/Sheet.tsx',
        'ui/components/Board.tsx',
        'ui/components/Card.tsx',
        'ui/home.tsx',
      ]);
      expect(isCanvasRel(ctx, 'ui/components/Card.tsx')).toBe(true);
      expect(isCanvasRel(ctx, 'ui/components/Board.tsx')).toBe(true);
      expect(isCanvasRel(ctx, 'ui/components/Button.tsx')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the imports card names nothing a reader cannot see (LOW — probe oracle)', () => {
  const closure = {
    head: '0',
    owned: new Set(['ui/a.tsx', 'ui/c.tsx']),
    ownedBy: new Map([
      ['ui/a.tsx', 'ui/a.tsx'],
      ['ui/c.tsx', 'ui/c.tsx'],
    ]),
    read: new Set(['ui/a.tsx', 'ui/c.tsx', 'ui/b.tsx']),
    assetUsers: new Map(),
    assetStems: new Set(),
    dynamic: new Set(),
  } as unknown as Closure;
  const vis = visibilityOf(
    resolveAccess({
      v: 1,
      role: null,
      grants: [
        { c: 'ui/a.tsx', r: 'member' },
        { c: 'ui/c.tsx', r: 'member' },
      ],
    }),
    () => closure
  );
  test('an entry whose every name is hidden is dropped; a visible name keeps its entry', () => {
    const out = filterIndexData(
      {
        groups: [],
        canvasDesignSystems: {},
        canvasKinds: {},
        canvasImportsCanvases: {
          '.design/ui/a.tsx': ['ui/secret.tsx'],
          '.design/ui/c.tsx': ['ui/b.tsx', 'ui/secret.tsx'],
        },
      },
      vis,
      '.design'
    );
    expect(out.canvasImportsCanvases).toEqual({ '.design/ui/c.tsx': ['ui/b.tsx'] });
  });
});
