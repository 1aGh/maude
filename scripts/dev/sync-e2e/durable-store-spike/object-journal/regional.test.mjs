import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { objectFixture } from './http-fixture.mjs';

test('cold standalone bundle executes both payload sizes from empty cwd without installed dependencies', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'maude-regional-bundle-'));
  const fixture = await objectFixture(join(directory, 'store'));
  t.after(() => fixture.close());
  const bundle = fileURLToPath(new URL('./dist/regional-probe.mjs', import.meta.url));
  const child = spawn(process.execPath, [bundle], {
    cwd: directory,
    env: {},
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (v) => {
    stdout += v;
  });
  child.stderr.on('data', (v) => {
    stderr += v;
  });
  const done = once(child, 'close');
  child.stdin.end(
    JSON.stringify({
      cfg: fixture.cfg,
      prefix: `maude-sync-conformance/${randomUUID()}`,
      samples: 2,
    })
  );
  const [code] = await done;
  assert.equal(code, 0, stderr);
  const report = JSON.parse(stdout);
  assert.equal(report.status, 'passed');
  assert.equal(report.results.length, 2);
  assert.deepEqual(
    report.results.map((r) => r.revision),
    [2, 2]
  );
  assert.deepEqual(fixture.violations, []);
  assert.equal(stdout.includes(fixture.cfg.secretAccessKey), false);
  writeFileSync(
    join(directory, 'evidence.json'),
    JSON.stringify(
      {
        report,
        build: JSON.parse(
          readFileSync(
            fileURLToPath(new URL('./dist/regional-build.json', import.meta.url)),
            'utf8'
          )
        ),
      },
      null,
      2
    )
  );
  console.log(`Regional bundle evidence: ${directory}`);
});
