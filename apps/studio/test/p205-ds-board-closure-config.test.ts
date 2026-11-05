// 2.0.5 (design.studyfi.com) — a Design system canvas renders in a cell whose in-memory config is
// stale. The C4 closure judged a board's `<Specimen src>` pages with the studio's in-memory config
// (`ctx.cfg`), while the board build resolves the system from the design root's own `config.json`
// (ds-resolver `canvasSystemFor`). A cell child reloads `ctx.cfg` only on a watcher `fs:json`, which
// a container never sends (the journal heal emits `fs:any`), so after a synced config change the two
// disagreed and the board failed closed:
//   - a system missing from `ctx.cfg` → its board resolved to the DEFAULT system, so the walk named
//     the other system's specimens: "This canvas imports another canvas (system/a/preview/motion.tsx)";
//   - no systems in `ctx.cfg` → the walk admitted no specimen, the build inlined them all, and the
//     module came back 403 not-in-scope after the build ("can't be drawn right now").
// Now the closure reads the systems from the same `config.json` the build reads.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { projectVisibility } from '../access/filters.ts';
import { narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { createBus } from '../context.ts';
import { designSystemCanvasSource } from '../ds/board/template.ts';

const A_BOARD = 'system/a/design-system.tsx';
const B_BOARD = 'system/b/design-system.tsx';
const own = [{ id: 'ds-own-motion', label: 'Motion', src: 'preview/motion.tsx' }];

const FILES: Record<string, string> = {
  'config.json': JSON.stringify({
    designSystems: [
      { name: 'a', path: 'system/a' },
      { name: 'b', path: 'system/b' },
    ],
    defaultDesignSystem: 'a',
  }),
  [A_BOARD]: designSystemCanvasSource('a', 'A', own),
  'system/a/design-system.meta.json': '{"designSystem":"a"}',
  'system/a/preview/motion.tsx': "import './motion.css';\nexport default () => <p>A-MOTION</p>;\n",
  'system/a/preview/motion.css': '.a{}',
  [B_BOARD]: designSystemCanvasSource('b', 'B', own),
  'system/b/design-system.meta.json': '{"designSystem":"b"}',
  'system/b/preview/motion.tsx': "import './motion.css';\nexport default () => <p>B-MOTION</p>;\n",
  'system/b/preview/motion.css': '.b{}',
  'ui/home.tsx':
    "import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas />;\n",
  'ui/home.meta.json': '{}',
};

const ownerFrame = (c: string) => narrowToFrame(resolveAccess({ v: 1, role: 'owner' }), [c]);

function withProject(
  staleSystems: Array<{ name: string; path: string }>,
  fn: (v: ReturnType<typeof projectVisibility>) => void
) {
  const root = mkdtempSync(join(tmpdir(), 'p205-ds-cfg-'));
  try {
    const designRoot = join(root, '.design');
    for (const [rel, text] of Object.entries(FILES)) {
      mkdirSync(join(designRoot, rel, '..'), { recursive: true });
      writeFileSync(join(designRoot, rel), text);
    }
    const ctx = {
      paths: { designRoot, designRel: '.design', repoRoot: root },
      bus: createBus(),
      // the config the child booted with, before the synced config.json landed
      cfg: {
        canvasGroups: [{ label: 'Design system', path: 'system' }],
        designSystems: staleSystems,
        defaultDesignSystem: 'a',
      },
    } as unknown as Parameters<typeof projectVisibility>[0];
    fn(projectVisibility(ctx));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('a DS board is judged with the config.json its build reads', () => {
  test('a system the in-memory config does not know yet: its board draws its OWN specimens', () => {
    withProject([{ name: 'a', path: 'system/a' }], (v) => {
      const c = v.closureOf(ownerFrame(B_BOARD));
      expect(c?.blocked.has(B_BOARD)).toBe(false);
      expect(c?.read.has('system/b/preview/motion.tsx')).toBe(true);
      expect(c?.read.has('system/a/preview/motion.tsx')).toBe(false);
      expect(v.canvasImports([B_BOARD]).get(B_BOARD) ?? []).toEqual([]);
    });
  });

  test('an in-memory config with no systems: the board still reads its specimens (no 403 after the build)', () => {
    withProject([], (v) => {
      const c = v.closureOf(ownerFrame(A_BOARD));
      expect(c?.blocked.has(A_BOARD)).toBe(false);
      expect(c?.read.has('system/a/preview/motion.tsx')).toBe(true);
      expect(c?.read.has('system/a/preview/motion.css')).toBe(true);
    });
  });

  test('C4 holds: a canvas granted alone still never reads a specimen or another board', () => {
    withProject([{ name: 'a', path: 'system/a' }], (v) => {
      const c = v.closureOf(ownerFrame('ui/home.tsx'));
      expect(c?.read.has('system/b/preview/motion.tsx')).toBe(false);
      expect(c?.read.has(B_BOARD)).toBe(false);
      // and one board never reads the other system's specimens
      const a = v.closureOf(ownerFrame(A_BOARD));
      expect(a?.read.has('system/b/preview/motion.tsx')).toBe(false);
    });
  });
});
