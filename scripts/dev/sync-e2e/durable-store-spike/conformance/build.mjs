import { fileURLToPath } from 'node:url';

const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL('./cloud-worker.mjs', import.meta.url))],
  outdir: fileURLToPath(new URL('./dist', import.meta.url)),
  naming: 'cloud-worker.mjs',
  target: 'browser',
  format: 'esm',
  external: ['cloudflare:workers'],
});
if (!result.success) throw new Error(result.logs.map(String).join('\n'));
