// RC6 (rca/issue-canvas-hmr-optimistic-update-consistency) — the canvas
// freshness signature must cover every relative import Bun.build inlines
// (`.css` AND local `.tsx/.ts` modules), else editing an imported sibling is a
// cache HIT and the stale build survives even a manual hard reload.

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { localDepsFromSource } from '../access/closure.ts';

const ROOT = join('/tmp', 'freshness-root', '.design');
const CANVAS = join(ROOT, 'ui', 'Foo.tsx');

describe('localDepsFromSource', () => {
  test('collects relative css, tsx and extensionless module imports', () => {
    const deps = localDepsFromSource(
      [
        `import './foo.css';`,
        `import Card from './Card.tsx';`,
        `import { util } from '../shared/util';`,
        `export { Re } from './re.tsx';`,
        `const lazy = () => import('./Lazy.tsx');`,
      ].join('\n'),
      CANVAS,
      ROOT
    );
    expect(deps).toContain(join(ROOT, 'ui', 'foo.css'));
    expect(deps).toContain(join(ROOT, 'ui', 'Card.tsx'));
    expect(deps).toContain(join(ROOT, 'ui', 're.tsx'));
    expect(deps).toContain(join(ROOT, 'ui', 'Lazy.tsx'));
    // Extensionless → every resolution candidate rides the signature, so the
    // dep APPEARING later also changes it.
    expect(deps).toContain(join(ROOT, 'shared', 'util.tsx'));
    expect(deps).toContain(join(ROOT, 'shared', 'util.ts'));
    expect(deps).toContain(join(ROOT, 'shared', 'util', 'index.tsx'));
  });

  test('skips bare / virtual specifiers', () => {
    const deps = localDepsFromSource(
      `import { DesignCanvas } from '@maude/canvas-lib';\nimport React from 'react';`,
      CANVAS,
      ROOT
    );
    expect(deps).toEqual([]);
  });

  test('clamps traversal outside designRoot (DDR-054)', () => {
    const deps = localDepsFromSource(
      `import evil from '../../../../etc/passwd.ts';\nimport ok from './Ok.tsx';`,
      CANVAS,
      ROOT
    );
    expect(deps).toEqual([join(ROOT, 'ui', 'Ok.tsx')]);
  });

  test('dedupes repeated specifiers', () => {
    const deps = localDepsFromSource(
      `import a from './X.tsx';\nimport b from './X.tsx';`,
      CANVAS,
      ROOT
    );
    expect(deps).toEqual([join(ROOT, 'ui', 'X.tsx')]);
  });
});
