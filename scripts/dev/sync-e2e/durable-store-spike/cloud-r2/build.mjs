import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { createSchemas } from '../../contracts/schemas.mjs';

const directory = fileURLToPath(new URL('./dist/', import.meta.url));
mkdirSync(directory, { recursive: true });
const ajv = new Ajv2020({
  strict: true,
  allErrors: false,
  validateFormats: false,
  code: { source: true, esm: true },
});
const schemas = createSchemas();
const names = ['proposal', 'accepted', 'result', 'event', 'operation', 'limitsSchema'];
for (const name of names) ajv.addSchema(schemas[name]);
writeFileSync(
  new URL('./dist/validators.mjs', import.meta.url),
  standaloneCode(ajv, Object.fromEntries(names.map((name) => [name, schemas[name].$id])))
);
const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL('./worker.mjs', import.meta.url))],
  outdir: directory,
  naming: 'worker.mjs',
  target: 'browser',
  format: 'esm',
  external: ['cloudflare:workers'],
  minify: true,
});
if (!result.success) throw new Error(result.logs.map(String).join('\n'));
console.log(`Worker bundle: ${result.outputs[0].size} bytes`);
