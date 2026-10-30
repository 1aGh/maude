// The agent-eval harness's own self-test (no model, no network): fixtures build, every grader flips on
// its planted fault, and the graders read the state the SHIPPED hooks and run registry leave.
// The eval itself (`run.mjs suite`) is NOT part of any test run — it costs model usage.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FORMAT_GATE_OPTS, formatGate } from '../../format.ts';
import { buildFixture, FIXTURES } from './lib/fixtures.mjs';
import { renderCheck } from './lib/render.mjs';
import { runSmoke } from './lib/smoke.mjs';
import { CLI, startTrial, studioEnv } from './lib/trial.mjs';

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

// The studio opens a format-1 project view only (2A, FORMAT_GATE_OPTS), so a fixture that declares no
// format makes every write trial fail as "read-only — nothing written" and the eval measures nothing.
test('every eval fixture is a project this build may edit (formatVersion 2, no format gate)', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-evals-format-'));
  try {
    let built = 0;
    for (const name of Object.keys(FIXTURES)) {
      const dest = join(root, name, 'project');
      if (!buildFixture(name, dest)) continue;
      built += 1;
      const cfg = JSON.parse(readFileSync(join(dest, '.design', 'config.json'), 'utf8'));
      const gate = formatGate(
        { cfg, paths: { designRoot: join(dest, '.design') } },
        FORMAT_GATE_OPTS
      );
      expect({ name, formatVersion: cfg.formatVersion, gate }).toEqual({
        name,
        formatVersion: 2,
        gate: null,
      });
    }
    expect(built).toBeGreaterThan(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);

// p8-eval-grader: the render grader captures through the TRIAL's env. Its throwaway HOME sits under
// `$TMPDIR/maude-agent-evals/<run>/trials/<id>/home`, and agent-browser's default socket dir
// (`<HOME>/.agent-browser/default.sock`) then exceeds the 103-byte unix-socket limit: every capture died
// "Session name 'default' is too long. Socket path would be 113 bytes", the grader logged "navigation failed" and
// the judge never got a screenshot (13 of 40 v2-8.16 trials). Pins the path itself, then the whole grader path:
// a real studio on a fixture clone, the trial env, one artboard → a real, non-blank PNG. No model.
test('a trial env keeps the agent-browser socket path under the 103-byte unix limit, however deep the trial dir', () => {
  const deep = join(tmpdir(), 'maude-agent-evals', 'v2-8.16', 'trials', 'n3.A.1', 'x'.repeat(40));
  const env = studioEnv(deep, { PATH: process.env.PATH });
  expect(env.AGENT_BROWSER_SOCKET_DIR).toBeTruthy();
  expect(`${env.AGENT_BROWSER_SOCKET_DIR}/default.sock`.length).toBeLessThanOrEqual(103);
  rmSync(deep, { recursive: true, force: true });
  rmSync(env.AGENT_BROWSER_SOCKET_DIR, { recursive: true, force: true });
});

test.skipIf(!Bun.which('agent-browser'))(
  "render grader: under the trial's throwaway HOME a fixture artboard still captures non-blank",
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-evals-render-'));
    const project = join(root, 'project');
    const trialDir = join(root, 'trial');
    let trial: Awaited<ReturnType<typeof startTrial>> | null = null;
    try {
      expect(buildFixture('app5', project)).toBeTruthy();
      trial = await startTrial(project, trialDir, {});
      expect(trial.env.HOME).toBe(join(trialDir, 'home'));
      const r = renderCheck({
        cli: CLI,
        project,
        trialDir,
        // two in a row: each capture closes its agent-browser session on exit, and the next one on the same
        // name used to hit the dying daemon ("Invalid response: EOF while parsing")
        targets: [
          { canvas: 'ui/GitPanel.tsx', artboard: 'changes' },
          { canvas: 'ui/GitPanel.tsx', artboard: 'publish' },
        ],
        env: trial.env,
      });
      expect(r.error).toBeUndefined();
      expect(
        r.shots.map((s: any) => ({ err: s.err, path: !!s.path, blank: s.stats?.blank }))
      ).toEqual([
        { err: '', path: true, blank: false },
        { err: '', path: true, blank: false },
      ]);
    } finally {
      await trial?.stop();
      if (trial?.env.AGENT_BROWSER_SOCKET_DIR)
        rmSync(trial.env.AGENT_BROWSER_SOCKET_DIR, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  },
  300_000
);
