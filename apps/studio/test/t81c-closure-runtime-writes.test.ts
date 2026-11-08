// #169 T8.1c — a runtime-state write (the build's own `_locator.json`, a camera in `_canvas-state/`)
// must not throw away every frame's cached closure. Each canvas build rewrote `_locator.json`, each
// write bumped the closure generation, and every following frame request re-walked the whole design
// root on the event loop (20–35 ms each on a large project): the version pictures' first wave waited
// on it. The closure never reads a first-segment `_` path (the listing skips them), except the two
// local harness modules (`_draw/`, `_photo/`), whose own text a harness grant walks.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { projectVisibility } from '../access/filters.ts';
import { narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { createBus } from '../context.ts';

const FILES: Record<string, string> = {
  'config.json': '{}',
  'ui/home.tsx':
    "import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas />;\n",
  'ui/home.meta.json': '{}',
};

const frame = (c: string) => narrowToFrame(resolveAccess({ v: 1, role: 'owner' }), [c]);

function withProject(
  fn: (v: ReturnType<typeof projectVisibility>, emit: (rel: unknown) => void) => void
) {
  const root = mkdtempSync(join(tmpdir(), 't81c-closure-'));
  try {
    const designRoot = join(root, '.design');
    for (const [rel, text] of Object.entries(FILES)) {
      mkdirSync(join(designRoot, rel, '..'), { recursive: true });
      writeFileSync(join(designRoot, rel), text);
    }
    const bus = createBus();
    const ctx = {
      paths: { designRoot, designRel: '.design', repoRoot: root },
      bus,
      cfg: {},
    } as unknown as Parameters<typeof projectVisibility>[0];
    fn(projectVisibility(ctx), (rel) => bus.emit('fs:any', rel));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('closure cache vs runtime-state writes', () => {
  test('the build writing _locator.json keeps the cached closure', () => {
    withProject((v, emit) => {
      const before = v.closureOf(frame('ui/home.tsx'));
      emit('_locator.json.tmp.6r4f32vc');
      emit('_locator.json');
      emit('_canvas-state/ui-home.view.json');
      emit('_comments/ui-home.json');
      expect(v.closureOf(frame('ui/home.tsx'))).toBe(before);
    });
  });

  test('a project file write still recomputes it', () => {
    withProject((v, emit) => {
      const before = v.closureOf(frame('ui/home.tsx'));
      emit('ui/home.tsx');
      const after = v.closureOf(frame('ui/home.tsx'));
      expect(after).not.toBe(before);
      expect(after?.head).not.toBe(before?.head);
    });
  });

  test('a local harness module write still recomputes it (a harness grant walks its text)', () => {
    withProject((v, emit) => {
      for (const rel of ['_draw/mark.proof.tsx', '_photo/hero.bgremove.tsx']) {
        const before = v.closureOf(frame('ui/home.tsx'));
        emit(rel);
        expect(v.closureOf(frame('ui/home.tsx'))).not.toBe(before);
      }
    });
  });

  test('a non-string event (unknown shape) still recomputes it — fail closed', () => {
    withProject((v, emit) => {
      const before = v.closureOf(frame('ui/home.tsx'));
      emit(undefined);
      expect(v.closureOf(frame('ui/home.tsx'))).not.toBe(before);
    });
  });
});
