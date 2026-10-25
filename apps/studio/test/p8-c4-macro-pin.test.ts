// p8-c4 — the two c4n leftovers from the wave-B gate (round 8):
//   L     read-then-load race: `macroGuard` read a file, checked it and returned nothing, so Bun
//         READ IT AGAIN to parse it — a file swapped on disk between the reads was parsed unchecked.
//         `macroPinnedLoad` (the build's LAST plugin) hands Bun exactly the bytes it checked.
//   note  the sandbox worker flagged `transpile` (a failure the host keeps legible to a frame) on
//         `err.name === 'TranspileError'` — a string; now only the pipeline's own class counts.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCanvasModule, macroPinnedLoad } from '../canvas-build.ts';
import { makeSandbox } from './_helpers.ts';

type OnLoad = (args: {
  path: string;
  namespace?: string;
  loader?: string;
}) => { contents: string | Uint8Array; loader: string } | undefined;

/** The plugin's onLoad callback, captured from a fake builder. */
function onLoadOf(refusals: string[], designRoot: string): OnLoad {
  let cb: OnLoad | null = null;
  const plugin = macroPinnedLoad(refusals, designRoot);
  plugin.setup({
    onLoad: (_opts: unknown, fn: OnLoad) => {
      cb = fn;
    },
    onResolve: () => {},
  } as never);
  if (!cb) throw new Error('no onLoad registered');
  return cb;
}

describe('macroPinnedLoad — Bun parses exactly the bytes that were checked', () => {
  const { designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  const helper = join(designRoot, 'ui', 'helper.ts');
  const txt = join(designRoot, 'ui', 'notes.txt');

  test('a module answers with its checked text and the loader Bun chose (no second read)', () => {
    writeFileSync(helper, "export const v = 'checked';\n");
    const load = onLoadOf([], designRoot);
    const got = load({ path: helper, namespace: 'file', loader: 'ts' });
    expect(got).toEqual({ contents: "export const v = 'checked';\n", loader: 'ts' });
  });

  test('a macro in the bytes it read is refused and recorded', () => {
    writeFileSync(
      helper,
      "import { readFileSync } from 'node:fs' with { type: 'macro' };\nexport const v = 1;\n"
    );
    const refusals: string[] = [];
    const load = onLoadOf(refusals, designRoot);
    expect(() => load({ path: helper, namespace: 'file', loader: 'ts' })).toThrow(
      /macro imports are not allowed/
    );
    expect(refusals.length).toBe(1);
  });

  test('a .txt Bun will parse as TSX (import attribute; args.loader says text) is pinned too', () => {
    writeFileSync(txt, "import x from 'y' with { type: 'macro' };\n");
    expect(() =>
      onLoadOf([], designRoot)({ path: txt, namespace: 'file', loader: 'text' })
    ).toThrow(/macro imports are not allowed/);
    writeFileSync(txt, 'plain words');
    expect(onLoadOf([], designRoot)({ path: txt, namespace: 'file', loader: 'text' })).toEqual({
      contents: 'plain words',
      loader: 'text',
    });
  });

  test('a virtual module (another namespace) is left to its own loader', () => {
    expect(
      onLoadOf([], designRoot)({ path: helper, namespace: 'maude-virtual', loader: 'tsx' })
    ).toBeUndefined();
  });

  test('a real build through it still inlines the helper and CSS', async () => {
    const abs = join(designRoot, 'ui', 'pin.tsx');
    writeFileSync(helper, "export const WORD = 'PINNED_HELPER_OK';\n");
    writeFileSync(join(designRoot, 'ui', 'pin.css'), '.pin { color: red }\n');
    const src =
      "import { WORD } from './helper.ts';\nimport './pin.css';\nexport default function P() { return <p className=\"pin\">{WORD}</p>; }\n";
    writeFileSync(abs, src);
    const r = await buildCanvasModule(abs, src, { designRoot, restrictImportsTo: designRoot });
    expect(r.js).toContain('PINNED_HELPER_OK');
    expect(r.js).toContain('.pin');
  });
});

describe('the sandbox worker — `transpile` is the class, never the name', () => {
  test('an error that only carries the name TranspileError is not a transpile failure', async () => {
    const { root } = makeSandbox();
    const fake = join(root, 'fake-studio');
    mkdirSync(fake, { recursive: true });
    writeFileSync(
      join(fake, 'canvas-pipeline.ts'),
      "export class TranspileError extends Error { constructor(m: string) { super(m); this.name = 'TranspileError'; } }\n"
    );
    writeFileSync(
      join(fake, 'canvas-build.ts'),
      "export async function buildCanvasModule() { const e = new Error('spoofed'); e.name = 'TranspileError'; throw e; }\n"
    );
    const run = async () => {
      const p = Bun.spawn(
        ['bun', join(import.meta.dir, '..', 'canvas-build-worker.ts'), root, join(root, 'x.tsx')],
        { env: { PATH: process.env.PATH ?? '', MAUDE_STUDIO_SRC: fake }, stdout: 'pipe' }
      );
      await p.exited;
      return JSON.parse(await new Response(p.stdout).text()) as {
        ok: boolean;
        transpile?: boolean;
      };
    };
    writeFileSync(join(root, 'x.tsx'), 'export default 1;\n');
    const out = await run();
    expect(out.ok).toBe(false);
    expect(out.transpile).toBe(false);
  });

  test('the pipeline’s own TranspileError still is one', async () => {
    const { root } = makeSandbox();
    const fake = join(root, 'fake-studio');
    mkdirSync(fake, { recursive: true });
    writeFileSync(
      join(fake, 'canvas-pipeline.ts'),
      "export class TranspileError extends Error { constructor(m: string) { super(m); this.name = 'TranspileError'; } }\n"
    );
    writeFileSync(
      join(fake, 'canvas-build.ts'),
      "import { TranspileError } from './canvas-pipeline.ts';\nexport async function buildCanvasModule() { throw new TranspileError('real'); }\n"
    );
    writeFileSync(join(root, 'x.tsx'), 'export default 1;\n');
    const p = Bun.spawn(
      ['bun', join(import.meta.dir, '..', 'canvas-build-worker.ts'), root, join(root, 'x.tsx')],
      { env: { PATH: process.env.PATH ?? '', MAUDE_STUDIO_SRC: fake }, stdout: 'pipe' }
    );
    await p.exited;
    const out = JSON.parse(await new Response(p.stdout).text()) as { transpile?: boolean };
    expect(out.transpile).toBe(true);
  });
});
