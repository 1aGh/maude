import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Step = { name?: string; run?: string; 'timeout-minutes'?: number };
const workflow = Bun.YAML.parse(
  readFileSync(new URL('../../../.github/workflows/render-deploy.yml', import.meta.url), 'utf8')
) as { jobs: { deploy: { steps: Step[] } } };
const step = workflow.jobs.deploy.steps.find((s) =>
  s.name?.startsWith('Verify the service answers')
);
if (!step?.run) throw new Error('release verification step missing');
// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression in the pre-fix workflow, not JS interpolation.
const verification = step.run.replaceAll('${{ github.ref_name }}', 'v-test');
const worker = readFileSync(new URL('../worker.mjs', import.meta.url), 'utf8');
const sleepAfterSeconds = Number(worker.match(/sleepAfter\s*=\s*'(\d+)m'/)?.[1]) * 60;

// Execute the actual workflow shell with a virtual clock and a container whose
// idle timer resets on EVERY health request. No Cloudflare calls or real sleeps.
// Replacing only curl/sleep also exercises jq, retry exhaustion and shell exits.
function runVerification(mode: string) {
  const dir = mkdtempSync(join(tmpdir(), 'render-verify-'));
  try {
    writeFileSync(join(dir, 'clock.json'), JSON.stringify({ now: 0, requests: [], sleeps: [] }));
    const shim = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.env.VERIFY_FIXTURE, 'clock.json');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
if (path.basename(process.argv[1]) === 'sleep') {
  const seconds = Number(process.argv[2]);
  state.now += seconds;
  state.sleeps.push(seconds);
} else {
  const previous = state.requests.at(-1) ?? 0;
  const fresh = process.env.VERIFY_MODE === 'current' || state.now - previous > Number(process.env.IDLE_SECONDS);
  state.requests.push(state.now);
  const mode = process.env.VERIFY_MODE;
  if (mode === 'unavailable') process.exitCode = 22;
  else if (mode === 'malformed') console.log('not json');
  else console.log(JSON.stringify({ok: mode !== 'unhealthy', version: fresh && mode !== 'wrong' ? 'v-test' : 'v-old'}));
}
fs.writeFileSync(file, JSON.stringify(state));
`;
    for (const name of ['curl', 'sleep']) {
      writeFileSync(join(dir, name), shim);
      chmodSync(join(dir, name), 0o755);
    }
    const result = spawnSync('bash', ['-e', '-c', verification], {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        VERIFY_FIXTURE: dir,
        VERIFY_MODE: mode,
        IDLE_SECONDS: String(sleepAfterSeconds),
        RELEASE_VERSION: 'v-test',
      },
    });
    const clock = JSON.parse(readFileSync(join(dir, 'clock.json'), 'utf8')) as {
      now: number;
      requests: number[];
      sleeps: number[];
    };
    return { ...result, clock };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an old environment can sleep before the next release-version probe', () => {
  expect(sleepAfterSeconds).toBeGreaterThan(0);
  const result = runVerification('idle');
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.clock.requests).toHaveLength(2);
  expect(result.clock.sleeps[0]).toBeGreaterThan(sleepAfterSeconds);
});

test('an already current healthy release needs no idle wait', () => {
  const result = runVerification('current');
  expect(result.status).toBe(0);
  expect(result.clock.requests).toEqual([0]);
  expect(result.clock.sleeps).toEqual([]);
});

test.each([
  'wrong',
  'unavailable',
  'malformed',
  'unhealthy',
])('%s never passes and stops after bounded attempts without a final sleep', (mode) => {
  const result = runVerification(mode);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.clock.requests).toHaveLength(3);
  expect(result.clock.sleeps).toHaveLength(2);
  // Also leave time for each bounded request, not only the idle intervals.
  expect(result.clock.now + 3 * 60).toBeLessThan((step?.['timeout-minutes'] ?? 0) * 60);
});
