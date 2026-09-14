import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceDir, own, repo } from './paths.mjs';
import { hash, validatorFile } from './pool.mjs';

const files = [
  ...readdirSync(own)
    .filter((n) => n.endsWith('.mjs'))
    .map((n) => join(own, n)),
  validatorFile,
  join(repo, 'apps/studio/sync/source-validation.ts'),
  join(repo, 'scripts/dev/sync-e2e/validation-runtime-spike/service.mjs'),
  join(repo, 'scripts/dev/sync-e2e/validation-runtime-spike/validator-child.mjs'),
  join(repo, 'scripts/dev/sync-e2e/validation-runtime-spike/dist/corpus.json'),
];
writeFileSync(
  join(evidenceDir, 'source-evidence.json'),
  JSON.stringify(
    {
      node: process.version,
      files: files.map((path) => ({ path, sha256: hash(readFileSync(path)) })),
    },
    null,
    2
  )
);
