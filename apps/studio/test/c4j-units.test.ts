// gate-b-c4j — a frame never inlines a canvas outside its own grant (supersedes c4h's read-only frame),
// and "a component" is defined once (M1): unit halves. Booted halves: c4j-frame-no-foreign-canvas.test.ts.
//
// Mallory edits A but cannot see B; she adds `import B from './b.tsx'`; V (who reads B — the desktop
// owner, or a teammate syncing A) opens A. A's frame no longer builds B in: B is not in the frame's
// closure, so the serve-time inputs gate refuses A's module and the shell says why. A component, a
// helper or the design system still comes along — and a component is: a `.tsx` under the config's
// `newComponentDir`, under any `components` segment, or under `system/**` outside `preview/` and
// `ui_kits/` (the DS board `design-system.tsx` stays a canvas).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closureConfigOf, closureFor, type ProjectReader } from '../access/closure.ts';
import { projectVisibility } from '../access/filters.ts';
import { narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { createBus } from '../context.ts';
import { isCanvasRel, listCanvases } from '../index/extract.ts';
import { isCanvasRelInGroups, isComponentRel } from '../skip-dirs.ts';

function project(files: Record<string, string>): ProjectReader {
  return { list: () => Object.keys(files), text: (r) => files[r] ?? null, head: () => 'h1' };
}

const FILES: Record<string, string> = {
  'config.json': JSON.stringify({
    designSystems: [{ name: 'ds', path: 'system/ds' }],
    defaultDesignSystem: 'ds',
  }),
  'ui/home.tsx':
    "import Button from './components/Button.tsx';\nimport Card from '../system/ds/kit/Card.tsx';\nexport default () => <Button />;\n",
  'ui/home.meta.json': '{}',
  'ui/components/Button.tsx': 'export default () => <button>OK</button>;\n',
  'ui/a.tsx':
    "import B from './b.tsx';\nimport './b.css';\nimport W from './components/Wrap.tsx';\nexport default () => <B />;\n",
  'ui/a.meta.json': '{}',
  'ui/b.tsx': 'export default () => <p>CANARY-B</p>;\n',
  'ui/b.meta.json': '{}',
  'ui/b.css': '.b{}',
  // a component that imports a canvas: the canvas is still refused, the component still comes
  'ui/components/Wrap.tsx': "import B from '../b.tsx';\nexport default () => <B />;\n",
  'system/ds/kit/Card.tsx': 'export default () => <div />;\n',
  'system/ds/preview/buttons.tsx': 'export default () => <p>SPECIMEN</p>;\n',
  'system/ds/design-system.tsx': 'export default () => <p>DS-BOARD</p>;\n',
  'system/ds/design-system.meta.json': '{}',
  'system/ds/colors_and_type.css': ':root{}',
};

const OWNER = resolveAccess({ v: 1, role: 'owner' });
const member = (...canvases: string[]) =>
  resolveAccess({ v: 1, role: null, grants: canvases.map((c) => ({ c, r: 'member' as const })) });

describe('a frame never inlines a canvas outside its own grant', () => {
  for (const [who, opener] of [
    ['the desktop owner', OWNER],
    ['a teammate who sees A and B', member('ui/a.tsx', 'ui/b.tsx')],
  ] as const) {
    test(`${who}: A's frame reads neither B nor B's stylesheet`, () => {
      const c = closureFor(narrowToFrame(opener, ['ui/a.tsx']), project(FILES));
      expect(c.read.has('ui/b.tsx')).toBe(false);
      expect(c.read.has('ui/b.css')).toBe(false);
      // gate-b-c4l — A's walk refused B, so A reads only what it owns: not the component on the way
      expect(c.read.has('ui/components/Wrap.tsx')).toBe(false);
      expect(c.blocked.has('ui/a.tsx')).toBe(true);
    });
  }

  test('a frame holding both canvases reads both (B is inside its grant)', () => {
    const c = closureFor(narrowToFrame(OWNER, ['ui/a.tsx', 'ui/b.tsx']), project(FILES));
    expect(c.read.has('ui/b.tsx')).toBe(true);
  });
});

describe('a component is importable, for the owner and a canvas-only member (M1)', () => {
  for (const [who, access] of [
    ["the owner's frame", narrowToFrame(OWNER, ['ui/home.tsx'])],
    ['a member of home only', member('ui/home.tsx')],
  ] as const) {
    test(`${who}: ui/home.tsx reads ui/components/Button.tsx and the DS kit`, () => {
      const c = closureFor(access, project(FILES));
      expect(c.read.has('ui/components/Button.tsx')).toBe(true);
      expect(c.read.has('system/ds/kit/Card.tsx')).toBe(true);
    });
  }

  test('the one predicate: newComponentDir, a `components` segment, system/** outside preview + ui_kits', () => {
    expect(isComponentRel('ui/components/Button.tsx')).toBe(true); // the default newComponentDir
    expect(isComponentRel('ui/screens/components/Row.tsx')).toBe(true);
    expect(isComponentRel('ui/kit/Chip.tsx', 'ui/kit')).toBe(true);
    expect(isComponentRel('ui/kit/Chip.tsx')).toBe(false);
    expect(isComponentRel('system/ds/kit/Card.tsx')).toBe(true);
    expect(isComponentRel('system/ds/preview/buttons.tsx')).toBe(false);
    expect(isComponentRel('system/ds/ui_kits/web/showcase.tsx')).toBe(false);
    expect(isComponentRel('system/ds/design-system.tsx')).toBe(false); // the DS board is a canvas
    expect(isComponentRel('ui/home.tsx')).toBe(false);
    expect(isComponentRel('ui/components.tsx')).toBe(false); // a file, not a segment
  });

  test('a component is never a canvas, in any group', () => {
    const groups = ['system', 'ui'];
    expect(isCanvasRelInGroups(groups, 'ui/components/Button.tsx')).toBe(false);
    expect(isCanvasRelInGroups(groups, 'ui/kit/Chip.tsx', 'ui/kit')).toBe(false);
    expect(isCanvasRelInGroups(groups, 'system/ds/kit/Card.tsx')).toBe(false);
    expect(isCanvasRelInGroups(groups, 'system/ds/preview/buttons.tsx')).toBe(true);
    expect(isCanvasRelInGroups(groups, 'system/ds/design-system.tsx')).toBe(true);
    expect(isCanvasRelInGroups(groups, 'ui/home.tsx')).toBe(true);
  });

  test('the index uses it too: listCanvases / isCanvasRel skip components', () => {
    const root = mkdtempSync(join(tmpdir(), 'c4j-index-'));
    try {
      for (const rel of ['ui/home.tsx', 'ui/components/Button.tsx', 'ui/kit/Chip.tsx']) {
        mkdirSync(join(root, rel, '..'), { recursive: true });
        writeFileSync(join(root, rel), 'export default () => null;\n');
      }
      const ctx = {
        designRoot: root,
        groups: [{ path: 'ui', label: 'UI' }],
        defaultDs: null,
        designSystems: [],
      };
      expect(listCanvases(ctx)).toEqual(['ui/home.tsx', 'ui/kit/Chip.tsx']);
      expect(listCanvases({ ...ctx, componentDir: 'ui/kit' })).toEqual(['ui/home.tsx']);
      expect(isCanvasRel(ctx, 'ui/components/Button.tsx')).toBe(false);
      expect(isCanvasRel(ctx, 'ui/home.tsx')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the DS folder in a canvas's closure holds no canvas (LOW)", () => {
  test('a member of home reads the DS stylesheet, not the DS board or its meta', () => {
    const c = closureFor(member('ui/home.tsx'), project(FILES));
    expect(c.read.has('system/ds/colors_and_type.css')).toBe(true);
    expect(c.read.has('system/ds/design-system.tsx')).toBe(false);
    expect(c.read.has('system/ds/design-system.meta.json')).toBe(false);
    expect(c.read.has('system/ds/preview/buttons.tsx')).toBe(false);
  });
});

describe("the closure judges with the studio's effective config (LOW)", () => {
  const NO_CONFIG: Record<string, string> = {
    'screens/a.tsx':
      "import S from './s.tsx';\nimport C from '../ui/kit/Chip.tsx';\nexport default () => <S />;\n",
    // gate-b-c4k — a canvas by its own source; the config passed in no longer decides that
    'screens/s.tsx':
      "import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas />;\n",
    'ui/kit/Chip.tsx': 'export default () => <i />;\n',
  };
  const cfg = closureConfigOf({
    canvasGroups: [{ label: 'Screens', path: 'screens' }],
    newComponentDir: 'ui/kit',
  });

  test('passed in: a configured group is a canvas group, the configured component dir is components', () => {
    const c = closureFor(member('screens/a.tsx'), project(NO_CONFIG), undefined, cfg);
    expect(c.read.has('screens/s.tsx')).toBe(false);
    // gate-b-c4l — a's walk refused s: a reads only what it owns, the component included
    expect(c.read.has('ui/kit/Chip.tsx')).toBe(false);
  });

  test('projectVisibility passes ctx.cfg (a custom designRoot has no <designRoot>/config.json)', () => {
    const root = mkdtempSync(join(tmpdir(), 'c4j-cfg-'));
    try {
      const designRoot = join(root, 'design');
      for (const [rel, text] of Object.entries(NO_CONFIG)) {
        mkdirSync(join(designRoot, rel, '..'), { recursive: true });
        writeFileSync(join(designRoot, rel), text);
      }
      const ctx = {
        paths: { designRoot, designRel: 'design', repoRoot: root },
        bus: createBus(),
        cfg: {
          canvasGroups: [{ label: 'Screens', path: 'screens' }],
          newComponentDir: 'ui/kit',
          designSystems: [],
        },
      } as unknown as Parameters<typeof projectVisibility>[0];
      const c = projectVisibility(ctx).closureOf(member('screens/a.tsx'));
      expect(c?.read.has('screens/s.tsx')).toBe(false);
      // gate-b-c4l — a's walk refused s: a reads only what it owns, the component included
      expect(c?.read.has('ui/kit/Chip.tsx')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('read from the project (the hub, a test reader): the same normalizer, the same answer', () => {
    const withConfig = {
      ...NO_CONFIG,
      'config.json': JSON.stringify({
        canvasGroups: [{ label: 'Screens', path: 'screens' }],
        newComponentDir: 'ui/kit',
      }),
    };
    const c = closureFor(member('screens/a.tsx'), project(withConfig));
    expect(c.read.has('screens/s.tsx')).toBe(false);
    // gate-b-c4l — a's walk refused s: a reads only what it owns, the component included
    expect(c.read.has('ui/kit/Chip.tsx')).toBe(false);
  });
});
