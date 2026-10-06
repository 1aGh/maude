// The export shim sees variables set at RUNTIME, not only the start-up
// environment (2026-10-02). Bun.spawn without `env` passes the environment the
// process started with; the render worker sets MAUDE_RENDER_SKIP_WHOLE_COMP=1
// at startup, so every cloud mp4 still burned a 90 s renderMediaOnWeb timeout.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnShim } from '../exporters/_runtime.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.MAUDE_SHIM_ENV_PROBE;
});

describe('spawnShim', () => {
  test('a variable set at runtime reaches the shim', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shim-env-'));
    dirs.push(dir);
    const script = join(dir, 'probe.mjs');
    writeFileSync(script, 'console.log("probe=" + (process.env.MAUDE_SHIM_ENV_PROBE ?? ""));\n');
    process.env.MAUDE_SHIM_ENV_PROBE = '1';
    const res = await spawnShim([script], { cwd: dir });
    expect(res.stdoutLines.join('\n')).toContain('probe=1');
  });
});
