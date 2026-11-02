// Regression tests for exporters/_runtime.ts — the shared shim-path + runtime
// resolver behind the desktop-export fix (RCA issue-desktop-export-failures).
//
// Guards the two defects the render exporters shipped with:
//   1. shim paths must derive from DEV_SERVER_ROOT (paths.ts), NEVER a virtual
//      `/$bunfs/root` (DDR-045).
//   2. the JS runtime must be resolved (not a hardcoded `'node'`): override → node →
//      bun → the compiled sidecar itself under BUN_BE_BUN=1 (DDR-177, p8-export-runtime)
//      → an actionable throw (a source checkout with no node/bun).

import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EXPORT_SHIM_DIR, exportShimPath, resolveExportRuntime } from '../../exporters/_runtime.ts';
import { DEV_SERVER_ROOT } from '../../paths.ts';

const ORIGINAL_PATH = process.env.PATH;
const ORIGINAL_RUNTIME = process.env.MAUDE_EXPORT_RUNTIME;

afterEach(() => {
  // Restore any env mutated by a test (each bun:test file is its own process,
  // but tests within it share env — keep them isolated).
  if (ORIGINAL_PATH === undefined) delete process.env.PATH;
  else process.env.PATH = ORIGINAL_PATH;
  if (ORIGINAL_RUNTIME === undefined) delete process.env.MAUDE_EXPORT_RUNTIME;
  else process.env.MAUDE_EXPORT_RUNTIME = ORIGINAL_RUNTIME;
});

describe('exporters/_runtime — shim paths (DDR-045)', () => {
  test('EXPORT_SHIM_DIR is <DEV_SERVER_ROOT>/bin and never virtual /$bunfs', () => {
    expect(EXPORT_SHIM_DIR).toBe(`${DEV_SERVER_ROOT}/bin`);
    expect(EXPORT_SHIM_DIR).not.toContain('$bunfs');
    expect(EXPORT_SHIM_DIR).not.toContain('~BUN');
  });

  test('exportShimPath resolves a real disk path under the shim dir', () => {
    const p = exportShimPath('_png-playwright.mjs');
    expect(p).toBe(`${DEV_SERVER_ROOT}/bin/_png-playwright.mjs`);
    expect(p).not.toContain('$bunfs');
  });
});

describe('exporters/_runtime — runtime ladder (DDR-177)', () => {
  // `resolveExportRuntime` returns the command AND the child env together, so no
  // spawn site can pick the runtime without the env it needs (BUN_BE_BUN).
  const self = {
    compiled: false,
    execPath: '/Applications/Maude.app/Contents/MacOS/maude-server',
  };

  test('rung 1: honors the MAUDE_EXPORT_RUNTIME override', () => {
    process.env.MAUDE_EXPORT_RUNTIME = '/opt/custom/bin/node';
    const rt = resolveExportRuntime({ ...self, compiled: true });
    expect(rt.cmd).toBe('/opt/custom/bin/node');
    expect(rt.env.BUN_BE_BUN).toBeUndefined();
  });

  test('rung 2: a node on PATH wins over bun', () => {
    delete process.env.MAUDE_EXPORT_RUNTIME;
    const dir = fakeBinDir(['node', 'bun']);
    process.env.PATH = dir;
    const rt = resolveExportRuntime({ ...self, compiled: true });
    expect(rt.cmd).toBe(`${dir}/node`);
    expect(rt.env.BUN_BE_BUN).toBeUndefined();
  });

  test('rung 3: a bun on PATH when there is no node', () => {
    delete process.env.MAUDE_EXPORT_RUNTIME;
    const dir = fakeBinDir(['bun']);
    process.env.PATH = dir;
    const rt = resolveExportRuntime({ ...self, compiled: true });
    expect(rt.cmd).toBe(`${dir}/bun`);
    expect(rt.env.BUN_BE_BUN).toBeUndefined();
  });

  test('rung 4: no node/bun on PATH in a compiled sidecar → the sidecar itself, as bun', () => {
    delete process.env.MAUDE_EXPORT_RUNTIME;
    process.env.PATH = '/nonexistent-maude-export-runtime-probe';
    const rt = resolveExportRuntime({ ...self, compiled: true });
    expect(rt.cmd).toBe(self.execPath);
    // Without it a `bun --compile` binary re-runs its own embedded server, not the shim.
    expect(rt.env.BUN_BE_BUN).toBe('1');
    // The child env is the full env (spawn sites pass it as-is), not a delta.
    expect(rt.env.PATH).toBe('/nonexistent-maude-export-runtime-probe');
  });

  test('rung 5: a source checkout with no node/bun → an actionable error', () => {
    delete process.env.MAUDE_EXPORT_RUNTIME;
    process.env.PATH = '/nonexistent-maude-export-runtime-probe';
    expect(() => resolveExportRuntime(self)).toThrow(/render export needs a JS runtime/i);
    expect(() => resolveExportRuntime(self)).toThrow(/MAUDE_EXPORT_RUNTIME/);
  });

  test('a BUN_BE_BUN the server inherited never leaks into a node/bun child', () => {
    delete process.env.MAUDE_EXPORT_RUNTIME;
    const dir = fakeBinDir(['node']);
    process.env.PATH = dir;
    process.env.BUN_BE_BUN = '1';
    try {
      expect(resolveExportRuntime(self).env.BUN_BE_BUN).toBeUndefined();
    } finally {
      delete process.env.BUN_BE_BUN;
    }
  });

  test('defaults: no options resolves against the real process (bun on the test host)', () => {
    delete process.env.MAUDE_EXPORT_RUNTIME;
    const rt = resolveExportRuntime();
    expect(rt.cmd).toBeTruthy();
    expect(rt.cmd).not.toBe('node'); // an absolute path, not the bare name
    expect(rt.env.BUN_BE_BUN).toBeUndefined(); // the test host is not a compiled binary
  });
});

// No spawn site may build its own runtime argv: each one uses the resolver's `{ cmd, env }`,
// so the compiled-self rung can never lose its BUN_BE_BUN.
describe('exporters/_runtime — every shim spawn site takes the env with the runtime', () => {
  const SITES = ['exporters/_runtime.ts', 'thumbs/service.ts', 'video/decode-webaudio.ts'];
  for (const rel of SITES) {
    test(rel, () => {
      const src = readFileSync(path.join(DEV_SERVER_ROOT, rel), 'utf8');
      // booleans, not toMatch: a failure must not dump the whole source file
      expect({ rel, callsResolver: /resolveExportRuntime\(\)/.test(src) }).toEqual({
        rel,
        callsResolver: true,
      });
      // never the old shape: the runtime string spliced straight into the argv,
      // nor a child env rebuilt from process.env next to it
      expect({
        rel,
        runtimeInArgv: /\[resolveExportRuntime\(\),/.test(src),
        envFromProcess: /env: \{ \.\.\.process\.env/.test(src),
      }).toEqual({ rel, runtimeInArgv: false, envFromProcess: false });
    });
  }
});

function fakeBinDir(names: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'maude-export-rt-'));
  for (const n of names) {
    const f = path.join(dir, n);
    writeFileSync(f, '#!/bin/sh\n');
    chmodSync(f, 0o755);
  }
  return dir;
}
