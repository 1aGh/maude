// The agent-eval harness's own self-test (no model, no network): fixtures build, every grader
// flips on its planted fault, and the prototype hooks deny / block / restore / fail open.
// The eval itself (`run.mjs suite`) is NOT part of any test run — it costs model usage.
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSmoke } from './lib/smoke.mjs';

test('agent-eval harness smoke: graders catch planted faults, hooks hold the V2-1.11 contract', async () => {
  const out = mkdtempSync(join(tmpdir(), 'agent-evals-smoke-'));
  const lines: string[] = [];
  try {
    const ok = await runSmoke({ out, log: (l: string) => lines.push(l) });
    if (!ok) console.log(lines.filter((l) => l.startsWith('✗')).join('\n'));
    expect(ok).toBe(true);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 120_000);
