// Michal 2026-10-28 (via the lead): a format-1 project in v2 is view only and OFFERS "Update
// project"; nothing migrates it by itself — not a boot, not opening it, not Home. The engine's
// write half (`applyMigration`) is reachable from exactly two places: the studio route, behind
// `apply: true` from the Maude window (Sec-Fetch-Site), and the `maude migrate v2 --apply` CLI.
// A new caller (a boot hook, an open path, Home) is a red test here.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const STUDIO = path.join(import.meta.dir, '..');
const SKIP = new Set(['node_modules', 'dist', 'test', '.design']);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) sources(abs, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(abs);
  }
  return out;
}

describe('no path migrates a project silently', () => {
  test('applyMigration is called only by the Update project route and the CLI', () => {
    const callers = sources(STUDIO)
      .filter((f) => /\bapplyMigration\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(STUDIO, f))
      .filter((f) => f !== path.join('migrate', 'engine.ts'))
      .sort();
    expect(callers).toEqual([path.join('migrate', 'cli.ts'), path.join('routes', 'project-format.ts')]);
  });

  test('the route applies only on an explicit apply from the Maude window', () => {
    const src = readFileSync(path.join(STUDIO, 'routes', 'project-format.ts'), 'utf8');
    expect(src).toMatch(/body\.apply === true && dry\.exitCode === EXIT\.done/);
    expect(src).toMatch(/body\.apply === true && req\.headers\.get\('sec-fetch-site'\) !== 'same-origin'/);
  });

  test('the CLI applies only with --apply', () => {
    const src = readFileSync(path.join(STUDIO, 'migrate', 'cli.ts'), 'utf8');
    expect(src).toMatch(/args\.apply && dry\.exitCode === EXIT\.done \? await applyMigration/);
  });

  test('the desktop shell never stamps a format onto a project it did not create', () => {
    // write_minimal_design returns before writing when a config exists; the managed-copy
    // writer keeps the project's own keys and never sets formatVersion.
    const lib = readFileSync(
      path.join(STUDIO, '..', 'desktop', 'src-tauri', 'src', 'lib.rs'),
      'utf8'
    );
    const fn = lib.slice(lib.indexOf('fn write_minimal_design'));
    expect(fn.indexOf('if design.join("config.json").exists()')).toBeLessThan(
      fn.indexOf('std::fs::write(design.join("config.json")')
    );
    const managed = readFileSync(
      path.join(STUDIO, '..', 'desktop', 'src-tauri', 'src', 'managed.rs'),
      'utf8'
    );
    expect(managed).not.toMatch(/formatVersion/);
  });
});
