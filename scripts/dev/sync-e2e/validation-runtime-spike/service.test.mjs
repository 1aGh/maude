import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { evidenceDir, own } from './paths.mjs';
import { limits, startValidationService } from './service.mjs';

const hash = (source) => createHash('sha256').update(source).digest('hex');
const corpus = JSON.parse(readFileSync(join(own, 'dist/corpus.json'), 'utf8'));
async function submit(server, body, overrides = {}) {
  const response = await fetch(server.url + '/validate', {
    method: 'POST',
    body: JSON.stringify({ file: 'canvas.tsx', body, sha256: hash(body), ...overrides }),
  });
  return { status: response.status, body: await response.json() };
}
const evidence = [];
test('independent validator service preserves production corpus with missing render checkout', async () => {
  const render = mkdtempSync(join(tmpdir(), 't8-lost-render-'));
  writeFileSync(join(render, 'canvas.tsx'), 'broken checkout');
  rmSync(render, { recursive: true, force: true });
  const server = await startValidationService();
  try {
    const health = await (await fetch(server.url + '/health')).json();
    assert.equal(health.ready, true);
    for (const fixture of corpus) {
      const result = await submit(server, fixture.source);
      assert.equal(result.status, fixture.valid ? 200 : 422);
      assert.equal(result.body.valid, fixture.valid);
      assert.equal(result.body.executed, false);
      assert.equal(result.body.cwd, realpathSync(server.sandbox));
      evidence.push({ case: fixture.name, ...result });
    }
    assert.deepEqual(
      readdirSync(server.sandbox),
      [],
      'validator does not import or write candidate source'
    );
    assert.equal((await submit(server, 'x'.repeat(limits.bodyBytes + 1))).status, 413);
    assert.equal(
      (await submit(server, 'export default 1', { file: 'canvas.txt' })).status,
      400,
      'cannot bypass source parser with extension'
    );
    assert.equal((await submit(server, 'export default 1', { sha256: 'bad' })).status, 422);
    assert.equal((await submit(server, 'export default 1', { extra: true })).status, 400);
    const valid = await submit(server, 'export default 1');
    assert.equal(valid.status, 200, 'errors did not poison future validation');
    evidence.push({ serviceTimings: server.results });
  } finally {
    await server.close();
  }
});
test('capacity, hard timeout and worker crash fail closed with health available', async () => {
  const hung = join(own, 'hung-child.mjs');
  const server = await startValidationService({ workerScript: hung, timeoutMs: 250 });
  try {
    const requests = [submit(server, 'export default 1'), submit(server, 'export default 2')];
    for (let i = 0; i < 100; i++) {
      const h = await (await fetch(server.url + '/health')).json();
      if (h.active === 2) break;
      await new Promise((r) => setTimeout(r, 2));
    }
    const busy = await submit(server, 'export default 3');
    assert.equal(busy.status, 503);
    assert.equal(busy.body.valid, false);
    assert.equal(busy.body.code, 'capacity');
    const timed = await Promise.all(requests);
    for (const result of timed) {
      assert.equal(result.status, 504);
      assert.equal(result.body.valid, false);
      assert.equal(result.body.code, 'validation-timeout');
    }
    let healthy;
    for (let i = 0; i < 100; i++) {
      healthy = await (await fetch(server.url + '/health')).json();
      if (healthy.active === 0) break;
      await new Promise((r) => setTimeout(r, 2));
    }
    assert.equal(healthy.ready, true);
    assert.equal(healthy.active, 0);
    evidence.push({ busy, timed, healthy });
  } finally {
    await server.close();
  }
  const crashed = join(own, 'crash-child.mjs');
  const crash = await startValidationService({ workerScript: crashed });
  try {
    const result = await submit(crash, 'export default 1');
    assert.equal(result.status, 503);
    assert.equal(result.body.valid, false);
    assert.equal(result.body.code, 'validator-unavailable');
    evidence.push({ crash: result });
  } finally {
    await crash.close();
  }
  writeFileSync(
    join(evidenceDir, 'service-evidence.json'),
    JSON.stringify({ node: process.version, limits, evidence }, null, 2)
  );
});
