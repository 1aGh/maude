// Regression test for writeCompileEntry — the per-target build helper that
// works around Bun 1.3.4+ --compile NAPI native-binding embedding (DDR-NNN-
// oxc-parser-bun-compile-workaround). The helper itself is pure (no compile,
// no spawn): given a target, it writes two files (`init-oxc-<slug>.ts` +
// `server-<slug>.ts`) under dist/.compile-entries/ and returns the entry path.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeCompileEntry } from '../build.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_ROOT = join(ROOT, '..');
const ENTRY_DIR = join(DEV_SERVER_ROOT, 'dist', '.compile-entries');

// PlatformTarget union mirrored from build.ts. Kept inline so the test fails
// loudly if build.ts adds/removes a target without updating the test.
const ALL_TARGETS = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-x64',
  'bun-linux-arm64',
  'bun-linux-x64-musl',
  'bun-linux-arm64-musl',
  'bun-windows-x64',
] as const;

// Maude-slug → @oxc-parser/binding-<X> NAPI slug. Mirrored from
// build.ts:oxcBindingSlug — kept in sync intentionally.
const EXPECTED_OXC_SLUG: Record<string, string> = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'linux-x64': 'linux-x64-gnu',
  'linux-arm64': 'linux-arm64-gnu',
  'linux-x64-musl': 'linux-x64-musl',
  'linux-arm64-musl': 'linux-arm64-musl',
  'win32-x64': 'win32-x64-msvc',
};

function maudeSlug(target: string): string {
  const s = target.replace(/^bun-/, '');
  return s === 'windows-x64' ? 'win32-x64' : s;
}

describe('writeCompileEntry', () => {
  test('produces init + entry files for every supported target', () => {
    for (const target of ALL_TARGETS) {
      const slug = maudeSlug(target);
      const initPath = join(ENTRY_DIR, `init-oxc-${slug}.ts`);
      const entryPath = join(ENTRY_DIR, `server-${slug}.ts`);

      const returned = writeCompileEntry(target);
      expect(returned).toBe(entryPath);
      expect(existsSync(initPath)).toBe(true);
      expect(existsSync(entryPath)).toBe(true);
    }
  });

  test('init file embeds the matching oxc binding via with-type-file', () => {
    for (const target of ALL_TARGETS) {
      const slug = maudeSlug(target);
      const oxcSlug = EXPECTED_OXC_SLUG[slug];
      const initPath = join(ENTRY_DIR, `init-oxc-${slug}.ts`);

      writeCompileEntry(target);
      const content = readFileSync(initPath, 'utf8');

      // Asset embed via Bun's with-type-file syntax — load-bearing for the
      // workaround. Without `with { type: 'file' }` the import resolves to
      // the .node's exports rather than its filesystem path.
      expect(content).toContain(
        `import bindingPath from "@oxc-parser/binding-${oxcSlug}/parser.${oxcSlug}.node" with { type: 'file' };`
      );
      // Env var must be set so oxc-parser's NAPI-RS loader (bindings.js)
      // skips its broken platform-detection switch.
      expect(content).toContain('process.env.NAPI_RS_NATIVE_LIBRARY_PATH = bindingPath;');
    }
  });

  test('entry file imports init BEFORE server.ts (ESM evaluation order matters)', () => {
    for (const target of ALL_TARGETS) {
      const slug = maudeSlug(target);
      const entryPath = join(ENTRY_DIR, `server-${slug}.ts`);

      writeCompileEntry(target);
      const content = readFileSync(entryPath, 'utf8');

      const initIdx = content.indexOf(`./init-oxc-${slug}.ts`);
      const serverIdx = content.indexOf('server.ts');
      expect(initIdx).toBeGreaterThanOrEqual(0);
      expect(serverIdx).toBeGreaterThanOrEqual(0);
      // If server.ts is imported before init-oxc, oxc-parser evaluates first
      // and reads NAPI_RS_NATIVE_LIBRARY_PATH before our env-var setter runs.
      expect(initIdx).toBeLessThan(serverIdx);
    }
  });

  // p8-t-video-2: the variable names a `/$bunfs/root/…` path that exists only INSIDE this binary. Every
  // child the server spawns inherits process.env — the ACP agent, its `claude`, the AI's Bash, and so
  // `maude design reel-place` → `bun _reel-place.mjs` → oxc-parser, whose loader tries ONLY that path when
  // the variable is set ("Cannot find native binding … /$bunfs/root/parser.darwin-arm64-….node"). So the
  // entry loads oxc-parser while the variable names the embedded binding, then removes it, before either
  // server mode starts and can spawn anything.
  test('entry loads oxc-parser, then removes NAPI_RS_NATIVE_LIBRARY_PATH before any server mode starts', () => {
    for (const target of ALL_TARGETS) {
      const slug = maudeSlug(target);
      writeCompileEntry(target);
      const content = readFileSync(join(ENTRY_DIR, `server-${slug}.ts`), 'utf8');
      const initIdx = content.indexOf(`./init-oxc-${slug}.ts`);
      const loadIdx = content.indexOf("await import('oxc-parser')");
      const dropIdx = content.indexOf('delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH');
      const homeIdx = content.indexOf('home/main.ts');
      const serverIdx = content.indexOf('server.ts');
      expect(loadIdx).toBeGreaterThan(initIdx);
      expect(dropIdx).toBeGreaterThan(loadIdx);
      expect(homeIdx).toBeGreaterThan(dropIdx);
      expect(serverIdx).toBeGreaterThan(dropIdx);
    }
  });

  test('entry uses POSIX path separators in the server.ts import', () => {
    writeCompileEntry('bun-windows-x64');
    const content = readFileSync(join(ENTRY_DIR, 'server-win32-x64.ts'), 'utf8');
    // Even on a Windows host the generated import specifier must use forward
    // slashes — ESM specifiers are not OS paths.
    expect(content).not.toMatch(/\\/);
  });

  test('idempotent — calling twice yields identical content', () => {
    const target = 'bun-darwin-arm64';
    const slug = maudeSlug(target);

    writeCompileEntry(target);
    const a1 = readFileSync(join(ENTRY_DIR, `init-oxc-${slug}.ts`), 'utf8');
    const e1 = readFileSync(join(ENTRY_DIR, `server-${slug}.ts`), 'utf8');

    writeCompileEntry(target);
    const a2 = readFileSync(join(ENTRY_DIR, `init-oxc-${slug}.ts`), 'utf8');
    const e2 = readFileSync(join(ENTRY_DIR, `server-${slug}.ts`), 'utf8');

    expect(a2).toBe(a1);
    expect(e2).toBe(e1);
  });

  test('cleanup — generated files live under dist/.compile-entries/', () => {
    // Sanity: the helper writes only to the expected directory; nothing
    // leaks elsewhere. Sweep a stale prior dir, regenerate, verify scope.
    rmSync(ENTRY_DIR, { recursive: true, force: true });
    writeCompileEntry('bun-darwin-arm64');
    expect(existsSync(ENTRY_DIR)).toBe(true);
    expect(existsSync(join(ENTRY_DIR, 'init-oxc-darwin-arm64.ts'))).toBe(true);
    expect(existsSync(join(ENTRY_DIR, 'server-darwin-arm64.ts'))).toBe(true);
  });
});
