// The canvas iframe's module graph may reach npm packages ONLY through the
// prebuilt `/_canvas-runtime/` externals. A packaged sidecar or a cloud cell
// has no node_modules next to canvas-lib.tsx, so any other bare import is a
// 422 on EVERY canvas: v1.5.0 shipped `Could not resolve: "diff"` because
// annotations/ops.ts statically imported sync/source-merge.ts. Locally the
// import resolves from node_modules, so only this graph walk catches it.

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { applyOps, hasTextMerge } from '../annotations/ops.ts';
import { validateElements } from '../annotations/schema.ts';
import { RUNTIME_PACKAGES } from '../runtime-bundle.ts';

const STUDIO = join(import.meta.dir, '..');

describe('canvas-lib import graph', () => {
  test('reaches no npm package outside the canvas runtime externals', async () => {
    const externals = new Set<string>(RUNTIME_PACKAGES);
    const strays = new Set<string>();
    const r = await Bun.build({
      entrypoints: [join(STUDIO, 'canvas-lib.tsx')],
      target: 'browser',
      format: 'esm',
      throw: false,
      plugins: [
        {
          name: 'trace-bare',
          setup(b) {
            b.onResolve({ filter: /^[^./]/ }, (args) => {
              if (externals.has(args.path)) return { path: args.path, external: true };
              if (args.path.startsWith('bun:') || args.path.startsWith('node:')) return null;
              strays.add(`${args.path} <- ${args.importer.replace(`${STUDIO}/`, '')}`);
              return { path: args.path, external: true };
            });
          },
        },
      ],
    });
    expect(r.success).toBe(true);
    expect([...strays]).toEqual([]);
  });

  test('ops.ts alone (the browser) has no text merge; server entry points wire it', async () => {
    // Order matters: the bare-module check must run before any server import.
    expect(hasTextMerge()).toBe(false);
    await import('../annotations/ops-merge.ts');
    expect(hasTextMerge()).toBe(true);
    // The wired merge keeps both people's words on a same-field race.
    const s1 = {
      id: 's1',
      type: 'sticky',
      index: 'a0',
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      text: 'hello world',
    };
    const base = new Map(validateElements([s1]).elements.map((e) => [e.id, e]));
    const first = applyOps(base, [
      { op: 'patch', id: 's1', set: { text: 'Hello world' }, expect: { text: 'hello world' } },
    ]);
    const r = applyOps(first.state, [
      { op: 'patch', id: 's1', set: { text: 'hello world!!' }, expect: { text: 'hello world' } },
    ]);
    expect(r.state.get('s1')?.text).toBe('Hello world!!');
  });
});
