import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repo, versions } from './deps.mjs';
import { hash } from './candidate-kernel.mjs';
const hub = createRequire(join(repo, 'apps/hub/package.json'));
const own = fileURLToPath(new URL('.', import.meta.url));
const files = [
  ...['@hocuspocus/server', '@hocuspocus/provider', 'yjs'].map((name) => hub.resolve(name)),
  join(repo, 'apps/studio/sync/source-validation.ts'),
  ...readdirSync(own)
    .filter((p) => p.endsWith('.mjs'))
    .map((p) => join(own, p)),
];
console.log(
  JSON.stringify(
    {
      node: process.version,
      versions,
      files: files.map((path) => ({ path, sha256: hash(readFileSync(path)) })),
    },
    null,
    2
  )
);
