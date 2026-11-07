// Issue #171: a desktop e2e scenario that runs under wdio.team-project.conf.ts never signals the
// hub by its raw `hubPid`. Against a container hub the conf sets `hubPid: 0`, and
// `process.kill(0, 'SIGSTOP')` stops this whole process GROUP (wdio, the Docker gate, the test
// lane) — the SIGCONT after it never runs and the lane hangs. `helpers/hub-process.ts`
// `hubProcess()` refuses a pid that is not a real one; every signal to the hub goes through it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCENARIOS = ['team-project', 'offline-conflict'].map((n) =>
  join(ROOT, 'apps/desktop/e2e/scenarios', `${n}.e2e.ts`)
);

/** Every `process.kill(` call whose first argument is not a `hubProcess(...)` result, by line. */
export function rawHubKills(text) {
  return text
    .split('\n')
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter(
      (l) =>
        /\bprocess\.kill\s*\(/.test(l.text) && !/process\.kill\s*\(\s*hubProcess\s*\(/.test(l.text)
    );
}

test('the scan finds a raw hubPid signal and passes a hubProcess() one', () => {
  assert.equal(rawHubKills("process.kill(t().hubPid, 'SIGSTOP');").length, 1);
  assert.equal(rawHubKills("process.kill(c.hubPid, 'SIGTERM');").length, 1);
  assert.equal(rawHubKills("process.kill(hubProcess(t()), 'SIGSTOP');").length, 0);
});

test('team-project and offline-conflict signal the hub only through hubProcess()', () => {
  const hits = SCENARIOS.flatMap((f) =>
    rawHubKills(readFileSync(f, 'utf8')).map(
      (h) => `${f.split('/').pop()}:${h.line}: ${h.text.trim()}`
    )
  );
  assert.deepEqual(hits, [], 'route the signal through helpers/hub-process.ts hubProcess()');
});

test('hubProcess() refuses pid 0 (a process-group signal) and a non-integer', async () => {
  const src = readFileSync(join(ROOT, 'apps/desktop/e2e/helpers/hub-process.ts'), 'utf8');
  assert.match(src, /export function hubProcess\(/);
  assert.match(src, /hubPid <= 0/);
  assert.match(src, /Number\.isInteger/);
});
