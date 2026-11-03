// The maude-render image (apps/render/Dockerfile) ships only the folders it COPYs into its runtime stage, while
// apps/render/server.ts imports the studio's exporter spine, which imports further out. 2.0.0 shipped a render service
// that exited at boot — `Cannot find module '../../cli/lib/finding-text.mjs' from '/app/apps/studio/canvas-edit.ts'` —
// because a studio module had started importing cli/lib, and nothing compared the import closure against the COPY list.
// The release workflow only read /_health's version, which comes from an env var, so it stayed green.
//
// This walks every relative import reachable from server.ts and asserts each file lands inside a copied folder, and
// that a file outside apps/studio imports no npm package (only apps/studio/node_modules is in the image).
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dir, '..', '..', '..');
const DOCKERFILE = path.join(REPO, 'apps/render/Dockerfile');
const ENTRY = path.join(REPO, 'apps/render/server.ts');
const SOURCE_RE = /\.(m?[jt]sx?|cjs)$/;
const EXTS = [
  '',
  '.ts',
  '.tsx',
  '.mjs',
  '.js',
  '.jsx',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.mjs',
];

/** The repo paths the runtime stage copies in (`COPY <src> <dst>` lines without `--from`, after the last FROM). */
function copiedSources(dockerfile: string): string[] {
  const lines = dockerfile.split('\n');
  const lastFrom = lines.findLastIndex((l) => /^FROM\s/i.test(l));
  return lines
    .slice(lastFrom + 1)
    .filter((l) => /^COPY\s/i.test(l) && !/--from=/i.test(l))
    .flatMap((l) => {
      const args = l
        .trim()
        .split(/\s+/)
        .slice(1)
        .filter((a) => !a.startsWith('--'));
      return args.slice(0, -1).map((src) => src.replace(/\/+$/, ''));
    });
}

function resolveRelative(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const ext of EXTS) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

function loaderFor(file: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (file.endsWith('.tsx')) return 'tsx';
  if (file.endsWith('.ts')) return 'ts';
  if (file.endsWith('.jsx')) return 'jsx';
  return 'js';
}

function importClosure(entry: string) {
  const files = new Set<string>();
  const unresolved: string[] = [];
  const bareOutsideStudio: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    if (!SOURCE_RE.test(file)) continue;
    const rel = path.relative(REPO, file);
    const imports = new Bun.Transpiler({ loader: loaderFor(file) }).scanImports(
      readFileSync(file, 'utf8')
    );
    for (const { path: spec } of imports) {
      if (spec.startsWith('.')) {
        const target = resolveRelative(file, spec);
        if (target) queue.push(target);
        else unresolved.push(`${rel} → ${spec}`);
      } else if (
        !spec.startsWith('node:') &&
        !spec.startsWith('bun') &&
        !rel.startsWith('apps/studio/')
      ) {
        bareOutsideStudio.push(`${rel} → ${spec}`);
      }
    }
  }
  return { files: [...files].map((f) => path.relative(REPO, f)), unresolved, bareOutsideStudio };
}

describe('the render image carries everything apps/render/server.ts imports', () => {
  const copied = copiedSources(readFileSync(DOCKERFILE, 'utf8'));
  const { files, unresolved, bareOutsideStudio } = importClosure(ENTRY);
  const inImage = (rel: string) => copied.some((src) => rel === src || rel.startsWith(`${src}/`));

  test('the Dockerfile parse finds the runtime COPY lines', () => {
    expect(copied).toContain('apps/studio');
    expect(copied).toContain('apps/render');
    expect(files.length).toBeGreaterThan(10);
  });

  test('every relative import resolves', () => {
    expect(unresolved).toEqual([]);
  });

  test('every file in the closure is copied into the runtime stage', () => {
    expect(files.filter((f) => !inImage(f))).toEqual([]);
  });

  test('no file outside apps/studio imports an npm package (only apps/studio/node_modules ships)', () => {
    expect(bareOutsideStudio).toEqual([]);
  });
});
