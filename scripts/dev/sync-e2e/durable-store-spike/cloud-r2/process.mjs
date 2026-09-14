import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require(process.env.MAUDE_MINIFLARE_ENTRY);
const held = new Map();
let sequence = 0;
const options = convertV4MiniflareOptions({
  modules: true,
  modulesRoot: fileURLToPath(new URL('.', import.meta.url)),
  scriptPath: fileURLToPath(new URL('./dist/worker.mjs', import.meta.url)),
  compatibilityDate: '2026-07-01',
  durableObjects: { PROJECTS: { className: 'R2ProjectProbe', useSQLite: true } },
  r2Buckets: process.env.MAUDE_NO_R2 === 'true' ? {} : { PAYLOADS: 'isolated-payloads' },
  bindings: {
    PROBE_TOKEN: process.env.MAUDE_PROBE_TOKEN,
    PROBE_PREFIX: process.env.MAUDE_PROBE_PREFIX || 'probe',
    PROBE_DISPOSABLE_ONLY: process.env.MAUDE_DISPOSABLE_ONLY || 'false',
    INLINE_LIMIT_BYTES: process.env.MAUDE_INLINE_LIMIT || '33554432',
  },
  serviceBindings: {
    CHECKPOINT: async (request) => {
      const id = ++sequence;
      const gate = new Promise((resolve) => held.set(id, resolve));
      process.send({
        type: 'checkpoint',
        id,
        stage: new URL(request.url).pathname.slice(1),
        ...(await request.json()),
      });
      await gate;
      held.delete(id);
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
process.on('message', async (message) => {
  try {
    if (message.kind === 'resume') held.get(message.checkpoint)?.();
    else if (message.kind === 'r2') {
      const bucket = await mf.getR2Bucket('PAYLOADS');
      let value;
      if (message.operation === 'list')
        value = (await bucket.list({ prefix: message.prefix || 'probe/', limit: 1000 })).objects;
      else if (message.operation === 'delete') value = await bucket.delete(message.key);
      else if (message.operation === 'put') value = await bucket.put(message.key, message.body);
      else throw new Error('unknown-r2-control');
      process.send({ type: 'control', id: message.id, value });
    }
  } catch (error) {
    process.send({ type: 'control', id: message.id, error: error.message });
  }
});
await mf.ready;
process.send({ type: 'ready', url: String(await mf.ready), pid: process.pid });
