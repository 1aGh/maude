import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceDir, own, repo, studioRequire } from './paths.mjs';

async function safeBuild(options) {
  try {
    return await Bun.build(options);
  } catch (error) {
    return { success: false, logs: [String(error), ...(error.errors || []).map(String)] };
  }
}
const out = join(own, 'dist');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'oxc-adapter.mjs'),
  `import {createRequire} from 'node:module';export const {parseSync}=createRequire(${JSON.stringify(join(repo, 'apps/studio/package.json'))})('oxc-parser');\n`
);
const validator = join(repo, 'apps/studio/sync/source-validation.ts');
const result = await safeBuild({
  entrypoints: [validator],
  outdir: out,
  naming: 'source-validator.mjs',
  target: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'oxc-installed',
      setup(b) {
        b.onResolve({ filter: /^oxc-parser$/ }, () => ({ path: join(out, 'oxc-adapter.mjs') }));
      },
    },
  ],
});
if (!result.success) throw new Error(result.logs.map(String).join('\n'));
const oxc = studioRequire('oxc-parser');
const original = readFileSync(join(repo, 'apps/studio/test/sync-source-safety.test.ts'), 'utf8');
const ast = oxc.parseSync('test.ts', original).program;
const clean = ast.body.find(
  (n) => n.type === 'VariableDeclaration' && n.declarations[0].id.name === 'clean'
).declarations[0].init.value;
const corpus = [{ name: 'existing-clean', source: clean, valid: true }];
function literal(n) {
  if (n?.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (
    n?.type === 'CallExpression' &&
    n.callee?.object?.name === 'clean' &&
    n.callee?.property?.name === 'repeat' &&
    n.arguments[0]?.value === 2
  )
    return clean.repeat(2);
  return null;
}
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'ForOfStatement' && node.right.type === 'ArrayExpression') {
    const sources = node.right.elements.map(literal);
    if (sources.length && sources.every((s) => s !== null)) {
      const variable = node.left.declarations?.[0]?.id?.name;
      const body = original.slice(node.body.start, node.body.end);
      const valid = variable !== 'invalid' && !body.includes('.not.toBeNull()');
      for (const source of sources)
        corpus.push({ name: 'existing-' + corpus.length, source, valid });
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child);
    else if (value && typeof value === 'object') walk(value);
  }
}
walk(ast);
if (corpus.length !== 16) throw new Error('Existing source corpus changed: ' + corpus.length);
corpus.push({
  name: 'does-not-execute',
  source:
    'import "./missing-side-effect.mjs"; globalThis.__T8_EXECUTED = true; export default () => <div/>;',
  valid: true,
});
writeFileSync(join(out, 'corpus.json'), JSON.stringify(corpus, null, 2));
const workerEntry = join(out, 'oxc-worker-entry.mjs');
writeFileSync(
  workerEntry,
  `import {sourceError} from ${JSON.stringify(validator)};export default {async fetch(request){const {source}=await request.json();return Response.json({error:sourceError('canvas.tsx',source)})}};`
);
// The actual package's browser entry chooses its optional WASI package.
const workerResult = await safeBuild({
  entrypoints: [workerEntry],
  outdir: out,
  naming: 'oxc-worker.mjs',
  target: 'browser',
  format: 'esm',
  plugins: [
    {
      name: 'actual-oxc-browser',
      setup(b) {
        b.onResolve({ filter: /^oxc-parser$/ }, () => ({
          path: join(studioRequire.resolve('oxc-parser'), '../wasm.js'),
        }));
      },
    },
  ],
});
let wasi;
try {
  wasi = studioRequire.resolve('@oxc-parser/binding-wasm32-wasi');
} catch (error) {
  wasi = error.code;
}
writeFileSync(
  join(evidenceDir, 'worker-bundle-evidence.json'),
  JSON.stringify(
    {
      oxc: studioRequire.resolve('oxc-parser'),
      wasi,
      browserBundleSuccess: workerResult.success,
      logs: workerResult.logs.map(String),
    },
    null,
    2
  )
);
// Existing pure-JS parser is an experiment, NOT production-equivalent validation.
const tsEntry = join(out, 'typescript-worker-entry.mjs');
writeFileSync(
  tsEntry,
  `import ts from ${JSON.stringify(studioRequire.resolve('typescript'))};export default {async fetch(request){const {source}=await request.json();const file=ts.createSourceFile('canvas.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);return Response.json({valid:file.parseDiagnostics.length===0,diagnostics:file.parseDiagnostics.map(d=>d.code)})}};`
);
const tsResult = await safeBuild({
  entrypoints: [tsEntry],
  outdir: out,
  naming: 'typescript-worker.mjs',
  target: 'browser',
  format: 'esm',
});
writeFileSync(
  join(evidenceDir, 'typescript-bundle-evidence.json'),
  JSON.stringify({ success: tsResult.success, logs: tsResult.logs.map(String) }, null, 2)
);
const files = [
  validator,
  join(repo, 'apps/studio/sync/limits.ts'),
  join(repo, 'apps/studio/test/sync-source-safety.test.ts'),
  studioRequire.resolve('oxc-parser'),
  studioRequire.resolve('typescript'),
  join(out, 'source-validator.mjs'),
  join(out, 'corpus.json'),
];
writeFileSync(
  join(evidenceDir, 'build-evidence.json'),
  JSON.stringify(
    {
      bun: Bun.version,
      files: files.map((path) => ({
        path,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      })),
    },
    null,
    2
  )
);
console.log(
  JSON.stringify({
    corpus: corpus.length,
    validator: true,
    oxcWorker: workerResult.success,
    typescriptWorker: tsResult.success,
  })
);
