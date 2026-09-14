import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
if (!process.env.MAUDE_MINIFLARE_ENTRY)
  throw new Error('Set MAUDE_MINIFLARE_ENTRY to an installed Miniflare 5 entry');
const { Miniflare, convertV4MiniflareOptions } = require(process.env.MAUDE_MINIFLARE_ENTRY);
const options = convertV4MiniflareOptions({
  modules: true,
  scriptPath: fileURLToPath(new URL('./cloud-worker.mjs', import.meta.url)),
  compatibilityDate: '2026-07-01',
  durableObjects: { PROJECTS: { className: 'ProjectStoreProbe', useSQLite: true } },
  serviceBindings: {
    CHECKPOINT: () => {
      process.send({ type: 'committed' });
      return new Response('ok');
    },
  },
  host: '127.0.0.1',
  port: 0,
});
const mf = new Miniflare({
  ...options,
  resourcePersistencePath: process.argv[2],
  telemetry: { enabled: false },
});
const url = await mf.ready;
process.send({ type: 'ready', url: String(url), pid: process.pid });
process.on('message', async (message) => {
  if (message === 'stop') {
    await mf.dispose();
    process.exit(0);
  }
});
