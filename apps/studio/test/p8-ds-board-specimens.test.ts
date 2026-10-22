// Phase 8 (G5 fidelity regression) — a converted Design system canvas and its OWN system's
// specimens are one unit. The board (`system/<ds>/design-system.tsx`) draws `<Specimen src>` pages
// that the generated `@maude/ds/board` module imports; gate-b-c4l made every specimen a canvas by
// path and c4j refuses a canvas outside the frame's grant, so the board's frame got 403 (a blank
// page). Now the board's walk follows its own `<Specimen>` sources inside its own system; every other
// direction stays refused (a ui/ canvas importing a specimen — by a relative import or through
// `@maude/ds/board` — and a specimen's own canvas imports).
// Booted halves: p8-ds-board-specimens-frame.test.ts.

import { describe, expect, test } from 'bun:test';

import { canvasImportsReport, closureFor, type ProjectReader } from '../access/closure.ts';
import { narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { designSystemCanvasSource } from '../ds/board/template.ts';

const project = (files: Record<string, string>): ProjectReader => ({
  list: () => Object.keys(files),
  text: (r) => files[r] ?? null,
  head: () => 'h1',
});
const member = (...canvases: string[]) =>
  resolveAccess({ v: 1, role: null, grants: canvases.map((c) => ({ c, r: 'member' as const })) });
const ownerFrame = (c: string) => narrowToFrame(resolveAccess({ v: 1, role: 'owner' }), [c]);

const BOARD = 'system/x/design-system.tsx';
const INDEX = 'system/x/preview/ui_kits-desktop-index.tsx';
const SHOW = 'system/x/preview/ui_kits-desktop-showcase.tsx';
const KIT = 'system/x/ui_kits/web/index.tsx';

function files(extra: Record<string, string> = {}): Record<string, string> {
  const board = designSystemCanvasSource('x', 'X', [
    {
      id: 'ds-own-ui-kits-desktop-index',
      label: 'Desktop index',
      src: 'preview/ui_kits-desktop-index.tsx',
    },
    {
      id: 'ds-own-ui-kits-desktop-showcase',
      label: 'Desktop showcase',
      src: 'preview/ui_kits-desktop-showcase.tsx',
    },
  ]);
  return {
    'config.json': JSON.stringify({
      designSystems: [
        { name: 'x', path: 'system/x' },
        { name: 'y', path: 'system/y' },
      ],
      defaultDesignSystem: 'x',
    }),
    [BOARD]: board,
    'system/x/design-system.meta.json': '{"designSystem":"x"}',
    'system/x/tokens.css': ':root{--a:1}',
    'system/x/preview/_layout.css': 'body{}',
    'system/x/preview/_specimen-controls.tsx': 'export const SpecimenHeader = () => <h1 />;\n',
    [INDEX]:
      "import './_layout.css';\nimport './ui_kits-desktop-index.css';\nimport { SpecimenHeader } from './_specimen-controls';\nexport default () => <main><SpecimenHeader />INDEX</main>;\n",
    'system/x/preview/ui_kits-desktop-index.css': '.i{}',
    [SHOW]:
      "import './ui_kits-desktop-showcase.css';\nexport default () => <main>SHOWCASE</main>;\n",
    'system/x/preview/ui_kits-desktop-showcase.css': '.s{}',
    'system/x/preview/button.tsx': "import './button.css';\nexport default () => <b>BTN</b>;\n",
    'system/x/preview/button.css': '.b{}',
    [KIT]: 'export default () => <main>KIT</main>;\n',
    'system/y/preview/secret.tsx': 'export default () => <p>Y-SECRET</p>;\n',
    'ui/b.tsx':
      "import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas />;\n",
    'ui/b.meta.json': '{}',
    ...extra,
  };
}

describe('the DS board and its own specimens are one unit', () => {
  for (const [who, access] of [
    ['a member granted the board', member(BOARD)],
    ['the owner’s frame on the board', ownerFrame(BOARD)],
  ] as const)
    test(`${who}: not blocked; reads every specimen it draws and their files`, () => {
      const c = closureFor(access, project(files()));
      expect(c.blocked.has(BOARD)).toBe(false);
      for (const rel of [
        INDEX,
        SHOW,
        'system/x/preview/ui_kits-desktop-index.css',
        'system/x/preview/ui_kits-desktop-showcase.css',
        'system/x/preview/_specimen-controls.tsx',
        'system/x/preview/_layout.css',
        'system/x/tokens.css',
      ])
        expect(c.read.has(rel)).toBe(true);
      // a specimen the board does not draw stays out
      expect(c.read.has('system/x/preview/button.tsx')).toBe(false);
      expect(c.read.has(KIT)).toBe(false);
    });

  test('the shell reports no foreign canvas on the board', () => {
    expect(canvasImportsReport(project(files()), [BOARD]).has(BOARD)).toBe(false);
  });

  test('a <Specimen> outside the board’s own system is not followed', () => {
    const p = project(
      files({
        [BOARD]: `${designSystemCanvasSource('x', 'X')}\nconst _y = <Specimen src="../y/preview/secret.tsx" />;\n`,
      })
    );
    const c = closureFor(member(BOARD), p);
    expect(c.read.has('system/y/preview/secret.tsx')).toBe(false);
  });

  test('a specimen the board draws that imports another canvas blocks the board (c4j holds)', () => {
    const p = project(
      files({
        [SHOW]: "import B from '../../../ui/b.tsx';\nexport default () => <B />;\n",
      })
    );
    const c = closureFor(member(BOARD), p);
    expect(c.blocked.has(BOARD)).toBe(true);
    expect(c.read.has('ui/b.tsx')).toBe(false);
    expect(canvasImportsReport(p, [BOARD]).get(BOARD)).toEqual(['ui/b.tsx']);
  });
});

describe('every other direction stays refused', () => {
  test('a ui/ canvas importing a specimen relatively is refused (c4l)', () => {
    const p = project(
      files({
        'ui/s.tsx':
          "import S from '../system/x/preview/ui_kits-desktop-index.tsx';\nexport default () => <S />;\n",
        'ui/s.meta.json': '{}',
      })
    );
    const c = closureFor(member('ui/s.tsx'), p);
    expect(c.blocked.has('ui/s.tsx')).toBe(true);
    expect(c.read.has(INDEX)).toBe(false);
  });

  test('a ui/ canvas drawing <Specimen> through @maude/ds/board is refused', () => {
    const p = project(
      files({
        'ui/s.tsx':
          'import { Specimen } from "@maude/ds/board";\nexport default () => <Specimen src="preview/ui_kits-desktop-index.tsx" />;\n',
        'ui/s.meta.json': '{"designSystem":"x"}',
      })
    );
    const c = closureFor(member('ui/s.tsx'), p);
    expect(c.blocked.has('ui/s.tsx')).toBe(true);
    expect(c.read.has(INDEX)).toBe(false);
    expect(canvasImportsReport(p, ['ui/s.tsx']).get('ui/s.tsx')).toEqual([INDEX]);
  });

  test('a member granted an unrelated canvas reads no specimen, board or not', () => {
    const p = project(
      files({
        'ui/plain.tsx': 'export default () => <p />;\n',
        'ui/plain.meta.json': '{}',
      })
    );
    const r = closureFor(member('ui/plain.tsx'), p).read;
    for (const rel of [BOARD, INDEX, SHOW, 'system/x/preview/ui_kits-desktop-index.css'])
      expect(r.has(rel)).toBe(false);
  });

  test('a specimen granted on its own does not reach the board', () => {
    const r = closureFor(member(INDEX), project(files())).read;
    expect(r.has(BOARD)).toBe(false);
    expect(r.has(SHOW)).toBe(false);
  });
});
