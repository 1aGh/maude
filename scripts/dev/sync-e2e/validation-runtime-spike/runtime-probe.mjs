import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceError } from './dist/source-validator.mjs';
import { evidenceDir, own, studioRequire } from './paths.mjs';

const corpus = JSON.parse(readFileSync(join(own, 'dist/corpus.json'), 'utf8'));
const ts = studioRequire('typescript');
const results = corpus.map((c) => {
  const started = performance.now();
  const error = sourceError('canvas.tsx', c.source);
  const durationMs = performance.now() - started;
  const parseDiagnostics = ts.createSourceFile(
    'canvas.tsx',
    c.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  ).parseDiagnostics;
  return {
    ...c,
    actualValid: error === null,
    error,
    durationMs,
    tsValid: parseDiagnostics.length === 0,
    tsDiagnostics: parseDiagnostics.map((d) => d.code),
  };
});
if (results.some((r) => r.valid !== r.actualValid)) throw new Error('Production corpus failed');
if (globalThis.__T8_EXECUTED) throw new Error('Source execution escaped validator');
const oversizedError = sourceError('canvas.tsx', ' '.repeat(4 * 1024 * 1024 + 1));
if (oversizedError !== 'Source exceeds the size limit') throw new Error('Limit failed');
const sizes = [1024, 64 * 1024, 1024 * 1024, 4 * 1024 * 1024];
const timings = sizes.map((size) => {
  const prefix = 'export default ()=> <div>';
  const suffix = '</div>';
  const source = prefix + 'x'.repeat(size - prefix.length - suffix.length) + suffix;
  const values = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    if (sourceError('canvas.tsx', source)) throw new Error('Valid size rejected');
    values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  return { bytes: size, samples: 10, p50Ms: values[5], p90Ms: values[9], maxMs: values[9] };
});
const evidence = {
  node: process.version,
  bun: process.versions.bun || null,
  corpus: results,
  oversizedError,
  timings,
  executedSource: false,
};
const name = process.versions.bun ? 'bun-runtime-evidence.json' : 'node-runtime-evidence.json';
writeFileSync(join(evidenceDir, name), JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify({
    runtime: process.versions.bun ? 'Bun ' + process.versions.bun : process.version,
    corpus: results.length,
    passed: results.length,
    tsMismatches: results
      .filter((r) => r.tsValid !== r.valid)
      .map((r) => ({ name: r.name, expected: r.valid, tsValid: r.tsValid })),
    timings,
  })
);
