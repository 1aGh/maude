import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceDir, hubRequire, own, repo, studioRequire } from './paths.mjs';

const out = join(own, 'dist');
mkdirSync(out, { recursive: true });
async function build(args) {
  const result = await Bun.build(args);
  if (!result.success) throw new Error(result.logs.map(String).join('\n'));
}
writeFileSync(
  join(out, 'oxc-adapter.mjs'),
  `import {createRequire} from 'node:module';
export const {parseSync}=createRequire(${JSON.stringify(join(repo, 'apps/studio/package.json'))})('oxc-parser');\n`
);
// Import the production validator unchanged. Only its TS syntax is compiled.
await build({
  entrypoints: [join(repo, 'apps/studio/sync/source-validation.ts')],
  outdir: out,
  naming: 'source-validator.mjs',
  target: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'production-oxc',
      setup(b) {
        b.onResolve({ filter: /^oxc-parser$/ }, () => ({ path: join(out, 'oxc-adapter.mjs') }));
      },
    },
  ],
});
const serverRequire = hubRequire.resolve('@hocuspocus/server');
writeFileSync(
  join(out, 'node-deps.mjs'),
  `import {createRequire} from 'node:module';
const hub=createRequire(${JSON.stringify(join(repo, 'apps/hub/package.json'))});
const server=createRequire(${JSON.stringify(serverRequire)});
export const Y=hub('yjs');export const {Server}=hub('@hocuspocus/server');
export const encoding=server('lib0/encoding');export const decoding=server('lib0/decoding');
export {sourceError} from ${JSON.stringify('./source-validator.mjs')};\n`
);
// Reuse the integrated fixture source, replacing only its Node24-only dependency adapter.
await build({
  entrypoints: [join(repo, 'scripts/dev/sync-e2e/accepted-candidate-spike/server.mjs')],
  outdir: out,
  naming: 'fixture-server.mjs',
  target: 'node',
  format: 'esm',
  packages: 'external',
  plugins: [
    {
      name: 'portable-node-deps',
      setup(b) {
        b.onResolve({ filter: /^\.\/deps\.mjs$/ }, () => ({ path: join(out, 'node-deps.mjs') }));
      },
    },
  ],
});
// Pin both browser imports through the hub root to keep one Yjs instance.
await build({
  entrypoints: [join(own, 'browser-client.mjs')],
  outdir: out,
  naming: 'browser-client.js',
  target: 'browser',
  format: 'esm',
  plugins: [
    {
      name: 'installed-browser-sdk',
      setup(b) {
        for (const name of ['@hocuspocus/provider', 'yjs', 'lib0/encoding']) {
          const resolver = name === 'lib0/encoding' ? studioRequire : hubRequire;
          b.onResolve(
            { filter: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') },
            () => ({ path: resolver.resolve(name) })
          );
        }
      },
    },
  ],
});
console.log('Built browser SDK client and production-validator server fixture in ' + out);

const evidencePaths = [
  'apps/studio/sync/source-validation.ts',
  'apps/studio/sync/limits.ts',
  'scripts/dev/sync-e2e/accepted-candidate-spike/server.mjs',
  'scripts/dev/sync-e2e/accepted-candidate-spike/candidate-kernel.mjs',
].map((p) => join(repo, p));
evidencePaths.push(
  hubRequire.resolve('@hocuspocus/server'),
  hubRequire.resolve('@hocuspocus/provider'),
  hubRequire.resolve('yjs'),
  studioRequire.resolve('oxc-parser'),
  ...[
    'browser-client.mjs',
    'browser-candidate.test.mjs',
    'build.mjs',
    'paths.mjs',
    'dist/browser-client.js',
    'dist/fixture-server.mjs',
    'dist/source-validator.mjs',
  ].map((p) => join(own, p))
);
writeFileSync(
  join(evidenceDir, 'build-evidence.json'),
  JSON.stringify(
    {
      bun: Bun.version,
      files: evidencePaths.map((path) => ({
        path,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      })),
    },
    null,
    2
  )
);
