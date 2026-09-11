// runtime-bundle.ts — Phase 3.6 Task 6. Each runtime sub-bundle should:
//   1. be self-contained for its own package (no `import "react"` left dangling
//      in the react bundle itself, for instance);
//   2. externalise the OTHER three runtime packages — so the four bundles
//      stitched together via the importmap don't ship two React copies;
//   3. expose its package's well-known named exports as real ESM bindings
//      (not the silent-empty-export shape `export * from <cjs>` produces).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { getRuntimeBundle, packageForSlug, RUNTIME_PACKAGES, slugFor } from '../runtime-bundle.ts';

describe('runtime-bundle', () => {
  test('loads every runtime bundle successfully', async () => {
    for (const p of RUNTIME_PACKAGES) {
      const b = await getRuntimeBundle(p);
      expect(b.js.length).toBeGreaterThan(0);
      expect(b.etag).toMatch(/^[0-9a-f]+$/);
    }
  });

  test('react/jsx-runtime stays small (no React/ReactDOM inlined)', async () => {
    const b = await getRuntimeBundle('react/jsx-runtime');
    // Production jsx-runtime is self-contained (~3 KB) and doesn't require an
    // explicit React import — the bundle should NOT carry a transitive copy
    // of React's hooks or ReactDOM internals. Size cap is a coarse proxy.
    expect(b.js.length).toBeLessThan(8 * 1024);
    expect(b.js).not.toContain('createRoot(');
    expect(b.js).not.toContain('useState');
  });

  test('react/jsx-runtime exposes jsx + jsxs + Fragment as ESM exports', async () => {
    const b = await getRuntimeBundle('react/jsx-runtime');
    expect(b.js).toMatch(/export\s*\{[\s\S]*\bjsx\b[\s\S]*\}/);
    expect(b.js).toMatch(/export\s*\{[\s\S]*\bjsxs\b[\s\S]*\}/);
    expect(b.js).toMatch(/export\s*\{[\s\S]*\bFragment\b[\s\S]*\}/);
  });

  test('react/jsx-dev-runtime bundle still builds (used in dev tooling)', async () => {
    const b = await getRuntimeBundle('react/jsx-dev-runtime');
    // Production-mode define(): the dev runtime still bundles (we list it in
    // the importmap as a fallback), but its source path inside the bundle
    // may be the production jsx-runtime depending on the package's own
    // env switch. Either way it should produce a non-empty ESM module.
    expect(b.js.length).toBeGreaterThan(0);
    expect(b.js).toMatch(/export\s*\{/);
  });

  test('react-dom/client exposes createRoot + hydrateRoot', async () => {
    const b = await getRuntimeBundle('react-dom/client');
    expect(b.js).toMatch(/export\s*\{[\s\S]*\bcreateRoot\b[\s\S]*\}/);
    expect(b.js).toMatch(/export\s*\{[\s\S]*\bhydrateRoot\b[\s\S]*\}/);
  });

  test('cache: second call returns same instance (no re-build)', async () => {
    const a = await getRuntimeBundle('react');
    const b = await getRuntimeBundle('react');
    expect(b).toBe(a);
  });

  test('slug ⇄ package round-trip', () => {
    for (const p of RUNTIME_PACKAGES) {
      const s = slugFor(p);
      expect(packageForSlug(s)).toBe(p);
      expect(packageForSlug(`${s}.js`)).toBe(p);
    }
    expect(packageForSlug('nope.js')).toBeNull();
  });
  test('Sonner ships as a standalone runtime with React kept external', async () => {
    const b = await getRuntimeBundle('sonner');
    expect(b.js.length).toBeGreaterThan(25000);
    expect(b.js).toMatch(/export\s*\{[\s\S]*\bToaster\b[\s\S]*\}/);
    expect(b.js).toMatch(/from\s*["']react["']/);
    expect(b.js).toMatch(/from\s*["']react-dom["']/);
  });

  test('canvas import map resolves every external runtime to its shipped bundle', () => {
    const shell = readFileSync(
      new URL('../../../plugins/design/templates/_shell.html', import.meta.url),
      'utf8'
    );
    const block = shell.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
    if (!block) throw new Error('Canvas shell importmap missing');
    const imports = JSON.parse(block).imports as Record<string, string>;
    for (const pkg of RUNTIME_PACKAGES)
      expect(imports[pkg]).toBe(`./_canvas-runtime/${slugFor(pkg)}.js`);
  });
});
