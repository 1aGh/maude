import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evidenceDir, repo } from './paths.mjs';
import { hash, ValidationPool } from './pool.mjs';

const { startValidationService } = await import(
  pathToFileURL(join(repo, 'scripts/dev/sync-e2e/validation-runtime-spike/service.mjs'))
);
function sized(bytes) {
  const prefix = 'export default ()=> <div>';
  const suffix = '</div>';
  return prefix + 'x'.repeat(bytes - prefix.length - suffix.length) + suffix;
}
const cases = [
  { name: '1KiB-text', source: sized(1024), samples: 10 },
  { name: '1MiB-text', source: sized(1024 * 1024), samples: 5 },
  { name: '4MiB-text', source: sized(4 * 1024 * 1024), samples: 5 },
  {
    name: '5000-jsx-elements',
    source:
      'export default ()=> <main>' +
      Array.from(
        { length: 5000 },
        (_, i) => `<div data-id="${i}" style={{color:"red"}}>Title ${i}</div>`
      ).join('') +
      '</main>',
    samples: 5,
  },
];
const pool = new ValidationPool();
const started = performance.now();
let warmupMs;
let cold;
let failure = null;
let current = { phase: 'warmup' };
const samples = [];
const results = [];
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    maxMs: sorted.at(-1),
    values,
  };
}
try {
  await pool.waitReady();
  warmupMs = performance.now() - started;
  current = { phase: 'cold-start' };
  cold = await startValidationService();
  const health = await (await fetch(cold.url + '/health')).json();
  assert.equal(health.validatorHash, pool.validatorHash, 'same compiled production validator');
  for (const fixture of cases) {
    const warm = [],
      coldValues = [],
      parseWarm = [],
      parseCold = [];
    for (let i = 0; i < fixture.samples; i++) {
      current = {
        name: fixture.name,
        bytes: Buffer.byteLength(fixture.source),
        index: i,
        phase: 'warm',
      };
      const value = await pool.validate(fixture.source);
      samples.push({ ...current, result: value });
      assert.equal(value.valid, true, JSON.stringify(value));
      warm.push(value.roundtripMs);
      parseWarm.push(value.parseMs);
      current = { ...current, phase: 'cold' };
      const response = await fetch(cold.url + '/validate', {
        method: 'POST',
        body: JSON.stringify({
          file: 'canvas.tsx',
          body: fixture.source,
          sha256: hash(fixture.source),
        }),
      });
      const result = await response.json();
      samples.push({ ...current, status: response.status, result, timing: cold.results.at(-1) });
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.valid, true);
      const recorded = cold.results.at(-1);
      coldValues.push(recorded.roundtripMs);
      parseCold.push(recorded.validationMs);
    }
    results.push({
      name: fixture.name,
      bytes: Buffer.byteLength(fixture.source),
      warm: stats(warm),
      cold: stats(coldValues),
      parseWarm: stats(parseWarm),
      parseCold: stats(parseCold),
    });
  }
  console.log(
    JSON.stringify({
      node: process.version,
      warmupMs,
      results: results.map((r) => ({
        name: r.name,
        bytes: r.bytes,
        warmP50: r.warm.p50Ms,
        coldP50: r.cold.p50Ms,
        warmMax: r.warm.maxMs,
        coldMax: r.cold.maxMs,
      })),
    })
  );
} catch (error) {
  failure = { ...current, error: String(error) };
  throw error;
} finally {
  writeFileSync(
    join(evidenceDir, 'benchmark-evidence.json'),
    JSON.stringify(
      {
        node: process.version,
        validatorHash: pool.validatorHash,
        warmupMs,
        status: failure ? 'failed' : 'passed',
        failure,
        samples,
        results,
        metric:
          'coordinator admission-complete to child result; IPC+parse; cold includes fork; HTTP ingress excluded; deadlines remain 2 seconds',
      },
      null,
      2
    )
  );
  await pool.drain();
  await cold?.close();
}
