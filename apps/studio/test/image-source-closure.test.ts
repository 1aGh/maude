// Two images run studio code as SOURCE from the folders they COPY in, so a studio module that starts importing a file
// outside them breaks the image at runtime, never at build time:
//   - maude-render (apps/render/Dockerfile) runs apps/render/server.ts, which imports the exporter spine;
//   - the hub/cell image (apps/hub/Dockerfile) runs the canvas build sandbox from /maude/apps/studio
//     (canvas-build-worker.ts → canvas-pipeline.ts + canvas-build.ts, loaded by dynamic import).
// 2.0.0 shipped both broken the same way: canvas-build.ts → element-ids.ts and canvas-edit.ts import
// ../../cli/lib/finding-text.mjs, and neither image copied cli/lib. Render exited at boot (`Cannot find module`),
// and every cloud canvas failed to build ("It didn't finish loading"). render-deploy stayed green because /_health's
// version is the env var, not the running image.
//
// This walks every relative import reachable from each entry and asserts the file lands, at its repo-relative path,
// inside a folder the runtime stage copies, and that a file outside apps/studio imports no npm package (only the
// studio's own node_modules ships beside it).
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dir, '..', '..', '..');
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

interface Copy {
  src: string;
  /** Where `src` lands in the image (a directory COPY's own path; a multi-source COPY's dir + basename). */
  target: string;
  excludes: string[];
}

/** The build-context COPYs of the runtime stage (after the last FROM, without `--from`), continuations joined. */
function runtimeCopies(dockerfile: string): Copy[] {
  const lines = dockerfile.replace(/\\\n/g, ' ').split('\n');
  const lastFrom = lines.findLastIndex((l) => /^FROM\s/i.test(l));
  return lines
    .slice(lastFrom + 1)
    .filter((l) => /^COPY\s/i.test(l) && !/--from=/i.test(l))
    .flatMap((l) => {
      const words = l.trim().split(/\s+/).slice(1);
      const excludes = words
        .filter((w) => w.startsWith('--exclude='))
        .map((w) => w.slice('--exclude='.length));
      const args = words.filter((w) => !w.startsWith('--'));
      const dest = args.at(-1) as string;
      const srcs = args.slice(0, -1).map((s) => s.replace(/\/+$/, ''));
      const intoDir = srcs.length > 1 || dest.endsWith('/');
      return srcs.map((src) => ({
        src,
        target: intoDir
          ? path.posix.join(dest, path.posix.basename(src))
          : dest.replace(/\/+$/, ''),
        excludes,
      }));
    });
}

/** Where a repo file ends up in the image, or null when no COPY carries it. */
function imagePath(copies: Copy[], rel: string): string | null {
  for (const c of copies) {
    if (rel !== c.src && !rel.startsWith(`${c.src}/`)) continue;
    const rest = rel.slice(c.src.length).replace(/^\//, '');
    if (rest && c.excludes.includes(rest.split('/')[0])) continue;
    return rest ? path.posix.join(c.target, rest) : c.target;
  }
  return null;
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

function importClosure(entries: string[]) {
  const files = new Set<string>();
  const unresolved: string[] = [];
  const bareOutsideStudio: string[] = [];
  const packages = new Set<string>();
  const queue = entries.map((e) => path.join(REPO, e));
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
      } else if (!spec.startsWith('node:') && !spec.startsWith('bun')) {
        packages.add(
          spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
        );
        if (!rel.startsWith('apps/studio/')) bareOutsideStudio.push(`${rel} → ${spec}`);
      }
    }
  }
  return {
    files: [...files].map((f) => path.relative(REPO, f)),
    unresolved,
    bareOutsideStudio,
    packages: [...packages].sort(),
  };
}

/** The hub image's canvas-deps stage installs its packages from an inline package.json (`maude-canvas-sandbox`). */
function sandboxPackages(dockerfile: string): Record<string, string> {
  const m = dockerfile.match(/echo '(\{"name":"maude-canvas-sandbox".*?\})' > package\.json/);
  return m ? JSON.parse(m[1]).dependencies : {};
}

const STUDIO_DEPS: Record<string, string> = JSON.parse(
  readFileSync(path.join(REPO, 'apps/studio/package.json'), 'utf8')
).dependencies;

const IMAGES = [
  {
    name: 'maude-render (apps/render/Dockerfile)',
    dockerfile: 'apps/render/Dockerfile',
    // WORKDIR /app, repo-shaped relative destinations
    root: '',
    entries: ['apps/render/server.ts'],
  },
  {
    name: 'the hub/cell canvas build sandbox (apps/hub/Dockerfile, /maude)',
    dockerfile: 'apps/hub/Dockerfile',
    root: '/maude',
    // not the studio's node_modules: only what the canvas-deps stage installs
    ownPackages: true,
    // canvas-build-worker.ts loads these two by dynamic import from MAUDE_STUDIO_SRC
    entries: [
      'apps/studio/canvas-build-worker.ts',
      'apps/studio/canvas-pipeline.ts',
      'apps/studio/canvas-build.ts',
    ],
  },
];

for (const image of IMAGES) {
  describe(`${image.name} carries every file its source entries import`, () => {
    const copies = runtimeCopies(readFileSync(path.join(REPO, image.dockerfile), 'utf8'));
    const { files, unresolved, bareOutsideStudio, packages } = importClosure(image.entries);
    const landsInPlace = (rel: string) =>
      imagePath(copies, rel) === (image.root ? path.posix.join(image.root, rel) : rel);

    test('the Dockerfile parse finds the copy of the studio source', () => {
      expect(landsInPlace('apps/studio/canvas-build.ts')).toBe(true);
      expect(files.length).toBeGreaterThan(10);
    });

    test('every relative import resolves', () => {
      expect(unresolved).toEqual([]);
    });

    test('every file in the closure is copied to its repo-relative place', () => {
      expect(files.filter((f) => !landsInPlace(f))).toEqual([]);
    });

    test('no file outside apps/studio imports an npm package', () => {
      expect(bareOutsideStudio).toEqual([]);
    });

    if (image.ownPackages) {
      const installed = sandboxPackages(readFileSync(path.join(REPO, image.dockerfile), 'utf8'));
      test('the sandbox installs every npm package its imports need', () => {
        expect(packages.filter((p) => !(p in installed))).toEqual([]);
      });
      test("each sandbox package is pinned to the studio's own version", () => {
        for (const [name, version] of Object.entries(installed))
          expect(`${name}@${STUDIO_DEPS[name]?.replace(/^[\^~]/, '')}`).toBe(`${name}@${version}`);
      });
    }
  });
}
