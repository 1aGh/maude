// The agent-eval harness's own self-test (no model, no network): fixtures build, every grader flips on
// its planted fault, and the graders read the state the SHIPPED hooks and run registry leave.
// The eval itself (`run.mjs suite`) is NOT part of any test run — it costs model usage.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSmoke } from './lib/smoke.mjs';

test('agent-eval harness smoke: graders catch planted faults and read the shipped hooks/registry state', async () => {
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

// The end-to-end half: a scripted agent through the released plugin's real hooks, a real throwaway studio
// per trial and the real run registry (busy artboard held by another session, a locked object, the trash
// route, the Stop gate). ~2 min and a studio boot per trial, so it is opt-in:
//   MAUDE_EVAL_DRY=1 scripts/v2-test-lane.sh -- bash -c 'cd apps/studio && bun test ./test/agent-evals/harness.test.ts'
// A child process, so the run's own stub `claude` on PATH (no model call is possible) stays out of this one.
test.skipIf(!process.env.MAUDE_EVAL_DRY)(
  'agent-eval dry run: a scripted agent on the real hooks, studio and registry grades as intended',
  () => {
    const out = mkdtempSync(join(tmpdir(), 'agent-evals-dry-'));
    try {
      const r = spawnSync(
        'bun',
        [join(dirname(fileURLToPath(import.meta.url)), 'run.mjs'), 'dry', '--out', out],
        { encoding: 'utf8', env: { ...process.env, NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1' } }
      );
      if (r.status !== 0) console.log(`${r.stdout}\n${r.stderr}`.slice(-4000));
      expect(r.status).toBe(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  },
  900_000
);
