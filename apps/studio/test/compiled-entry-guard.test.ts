// A bin helper the SERVER imports runs inside the `bun --compile` binary, where every bundled module's
// `import.meta.url` collapses to the binary's own path. The classic "am I the entry?" compare
// (`import.meta.url === pathToFileURL(process.argv[1]).href`) is then TRUE for each of them and hijacks
// the process before Bun.serve runs — the v0.38.0 "Starting…" hang, and again after the brand import
// (S8.18) pulled `_fetch-asset.mjs` into http.ts: the compiled binary printed that verb's usage and
// exited 2 (binary-smoke). `import.meta.main` is the reliable flag; the argv compare may only be its
// fallback. This walks what http.ts / server.ts import, so it needs no built binary.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const IMPORT =
  /(?:import|export)\s[^'"`;]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function reachable(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = entries.map((e) => resolve(ROOT, e));
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    if (!/\.(m?[jt]sx?)$/.test(file)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT)) {
      const rel = (m[1] ?? m[2]) as string;
      const base = resolve(dirname(file), rel);
      for (const cand of [
        base,
        `${base}.ts`,
        `${base}.mjs`,
        `${base}.js`,
        join(base, 'index.ts'),
      ]) {
        if (existsSync(cand) && !seen.has(cand) && /\.(m?[jt]sx?)$/.test(cand)) {
          queue.push(cand);
          break;
        }
      }
    }
  }
  return seen;
}

describe('a module the compiled server bundles never uses the bare argv entry guard', () => {
  const files = [...reachable(['http.ts', 'server.ts'])].filter((f) => !f.includes('node_modules'));

  test('the walk reaches the bin helpers the server imports (it is not vacuous)', () => {
    expect(files.some((f) => f.endsWith('bin/_brand-site.mjs'))).toBe(true);
    expect(files.some((f) => f.endsWith('bin/_fetch-asset.mjs'))).toBe(true);
  });

  test('no reachable module compares import.meta.url with argv[1] without import.meta.main', () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return (
        /import\.meta\.url\s*===\s*pathToFileURL\(process\.argv\[1\]\)\.href/.test(src) &&
        !/import\.meta\.main\s*\?\?/.test(src)
      );
    });
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
