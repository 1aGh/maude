// 2.0.7 (design.studyfi.com, 2.0.6) — a project with two design systems, where the cell's
// `config.json` names only the first. `config.json` never travels on the file plane
// (file-membership `never`), and the owner's project-config push fills it in only when the owner's
// desktop reconnects — so a system converted on a desktop reaches the cell as files only. The second
// system's Design system canvas then resolved to the DEFAULT system:
//   - the import walk read its `<Specimen src="preview/logo.tsx">` inside the default system's folder
//     and refused the board: "imports another canvas (system/a/preview/logo.tsx, …/motion.tsx)";
//   - the board build inlined the default system's specimens and model;
//   - the shell framed it with the default system's tokens (`canvasUrl` fell back to designSystems[0]).
// Now a canvas under `system/<ds>/` whose folder holds its Design system canvas belongs to that folder
// even when the config does not list it. The default system still applies to every other canvas.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { projectVisibility } from '../access/filters.ts';
import { narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { canvasUrl } from '../client/canvas-url.js';
import { createBus } from '../context.ts';
import { designSystemCanvasSource } from '../ds/board/template.ts';
import { canvasSystemFor, dsBoardModuleSource } from '../ds/ds-resolver.ts';

const A_BOARD = 'system/a/design-system.tsx';
const B_BOARD = 'system/b/design-system.tsx';
const own = [
  { id: 'ds-own-logo', label: 'Logo', src: 'preview/logo.tsx' },
  { id: 'ds-own-motion', label: 'Motion', src: 'preview/motion.tsx' },
];
const specimen = (name: string, ds: string) =>
  `import './${name}.css';\nexport default () => <p>${ds.toUpperCase()}-${name}</p>;\n`;
const THEMED_CSS = (cls: string) =>
  `.${cls}[data-theme="dark"], .ds[data-theme="dark"] { --bg-0: #000; }\n.${cls}[data-theme="light"], .ds[data-theme="light"] { --bg-0: #fff; }\n`;

// The cell's config.json: it knows only system `a` (the default).
const CELL_CONFIG = {
  canvasGroups: [{ label: 'Design system', path: 'system' }],
  designSystems: [{ name: 'a', path: 'system/a', themeDefault: 'dark', themes: ['dark', 'light'] }],
  defaultDesignSystem: 'a',
};

const FILES: Record<string, string> = {
  [A_BOARD]: designSystemCanvasSource('a', 'A', own),
  'system/a/design-system.meta.json': '{"designSystem":"a"}',
  'system/a/colors_and_type.css': THEMED_CSS('a'),
  'system/a/preview/logo.tsx': specimen('logo', 'a'),
  'system/a/preview/logo.css': '.a{}',
  'system/a/preview/motion.tsx': specimen('motion', 'a'),
  'system/a/preview/motion.css': '.a{}',
  [B_BOARD]: designSystemCanvasSource('b', 'B', own),
  'system/b/design-system.meta.json': '{"designSystem":"b"}',
  'system/b/colors_and_type.css': THEMED_CSS('b'),
  'system/b/preview/logo.tsx': specimen('logo', 'b'),
  'system/b/preview/logo.css': '.b{}',
  'system/b/preview/motion.tsx': specimen('motion', 'b'),
  'system/b/preview/motion.css': '.b{}',
  'ui/home.tsx':
    "import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas />;\n",
  'ui/home.meta.json': '{}',
};

const ownerFrame = (c: string) => narrowToFrame(resolveAccess({ v: 1, role: 'owner' }), [c]);

function withProject(
  extra: Record<string, string>,
  fn: (v: ReturnType<typeof projectVisibility>, designRoot: string) => void
) {
  const root = mkdtempSync(join(tmpdir(), 'p207-folder-ds-'));
  try {
    const designRoot = join(root, '.design');
    const all = { ...FILES, 'config.json': JSON.stringify(CELL_CONFIG), ...extra };
    for (const [rel, text] of Object.entries(all)) {
      mkdirSync(join(designRoot, rel, '..'), { recursive: true });
      writeFileSync(join(designRoot, rel), text);
    }
    const ctx = {
      paths: { designRoot, designRel: '.design', repoRoot: root },
      bus: createBus(),
      cfg: CELL_CONFIG,
    } as unknown as Parameters<typeof projectVisibility>[0];
    fn(projectVisibility(ctx), designRoot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('a system the config does not list: its own folder owns its canvases', () => {
  test('its Design system canvas draws its OWN specimens, with no refusal', () => {
    withProject({}, (v) => {
      expect(v.canvasImports([B_BOARD]).get(B_BOARD) ?? []).toEqual([]);
      const c = v.closureOf(ownerFrame(B_BOARD));
      expect(c?.blocked.has(B_BOARD)).toBe(false);
      expect(c?.read.has('system/b/preview/logo.tsx')).toBe(true);
      expect(c?.read.has('system/b/preview/motion.css')).toBe(true);
      expect(c?.read.has('system/b/colors_and_type.css')).toBe(true);
      // nothing of the default system
      expect(c?.read.has('system/a/preview/logo.tsx')).toBe(false);
      expect(c?.read.has('system/a/colors_and_type.css')).toBe(false);
    });
  });

  test('its board build registers ITS model and inlines ITS specimens', () => {
    withProject({}, (_v, designRoot) => {
      const sys = canvasSystemFor(designRoot, join(designRoot, B_BOARD));
      expect(sys?.name).toBe('b');
      expect(sys?.path).toBe('system/b');
      expect(sys?.tokensCssRel).toBe('system/b/colors_and_type.css');
      expect(sys?.themes).toEqual(['dark', 'light']);
      expect(sys?.rootClass).toBe('b');
      const mod = dsBoardModuleSource(designRoot, join(designRoot, B_BOARD));
      expect(mod).toContain(join(designRoot, 'system/b/preview/logo.tsx'));
      expect(mod).not.toContain(join(designRoot, 'system/a/preview/logo.tsx'));
    });
  });

  test('the default system is unchanged: its board, and a canvas that declares nothing', () => {
    withProject({}, (v, designRoot) => {
      expect(canvasSystemFor(designRoot, join(designRoot, 'ui/home.tsx'))?.name).toBe('a');
      expect(canvasSystemFor(designRoot, join(designRoot, A_BOARD))?.name).toBe('a');
      const a = v.closureOf(ownerFrame(A_BOARD));
      expect(a?.blocked.has(A_BOARD)).toBe(false);
      expect(a?.read.has('system/a/preview/logo.tsx')).toBe(true);
      expect(a?.read.has('system/b/preview/logo.tsx')).toBe(false);
      const home = v.closureOf(ownerFrame('ui/home.tsx'));
      expect(home?.read.has('system/a/colors_and_type.css')).toBe(true);
      expect(home?.read.has('system/b/colors_and_type.css')).toBe(false);
      expect(home?.read.has('system/b/preview/logo.tsx')).toBe(false);
    });
  });

  test('a folder without its Design system canvas is not a system: the default still applies', () => {
    withProject(
      {
        'system/legacy/colors_and_type.css': THEMED_CSS('legacy'),
        'system/legacy/preview/card.tsx': specimen('card', 'legacy'),
      },
      (_v, designRoot) => {
        expect(
          canvasSystemFor(designRoot, join(designRoot, 'system/legacy/preview/card.tsx'))?.name
        ).toBe('a');
      }
    );
  });

  test('a real cross-system import is still refused', () => {
    withProject(
      {
        'system/b/preview/motion.tsx':
          "import Logo from '../../a/preview/logo.tsx';\nexport default () => <Logo />;\n",
      },
      (v) => {
        expect(v.canvasImports([B_BOARD]).get(B_BOARD)).toEqual(['system/a/preview/logo.tsx']);
        expect(v.closureOf(ownerFrame(B_BOARD))?.blocked.has(B_BOARD)).toBe(true);
      }
    );
  });
});

describe('the shell frames a folder-owned system with its own files', () => {
  const cfg = {
    designRel: '.design',
    designSystems: [{ name: 'a', path: 'system/a', tokensCssRel: 'system/a/colors_and_type.css' }],
    defaultDesignSystem: 'a',
    canvasDesignSystems: {
      '.design/system/b/design-system.tsx': 'b',
      '.design/system/a/design-system.tsx': 'a',
      '.design/ui/home.tsx': 'a',
    },
  };
  const params = (p: string) => new URL(canvasUrl(p, cfg), 'http://x').searchParams;

  test("the second system's board gets its own tokens and components", () => {
    const q = params('.design/system/b/design-system.tsx');
    expect(q.get('tokens')).toBe('system/b/colors_and_type.css');
    expect(q.get('components')).toBe('system/b/preview/_components.css');
  });

  test('the default system and a plain canvas are unchanged', () => {
    expect(params('.design/system/a/design-system.tsx').get('tokens')).toBe(
      'system/a/colors_and_type.css'
    );
    const home = params('.design/ui/home.tsx');
    expect(home.get('tokens')).toBe('system/a/colors_and_type.css');
    expect(home.get('components')).toBe('system/a/preview/_components.css');
  });

  test('a name outside its own folder never invents a path', () => {
    const q = new URL(
      canvasUrl('.design/ui/x.tsx', {
        ...cfg,
        canvasDesignSystems: { '.design/ui/x.tsx': 'b' },
      }),
      'http://x'
    ).searchParams;
    expect(q.get('tokens')).toBe('system/a/colors_and_type.css');
  });
});
