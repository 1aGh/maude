// Runs the store fixture in local workerd (Miniflare) with DO SQLite and
// persistence, as a forked child so a test can SIGKILL it mid-write.
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const { Miniflare } = require(process.env.MAUDE_MINIFLARE_ENTRY);
const [script, persist] = process.argv.slice(2);
const mf = new Miniflare({
  modules: true,
  scriptPath: script,
  modulesRoot: dirname(script),
  compatibilityDate: '2026-07-01',
  durableObjects: {
    MAUDE_CELL: { className: 'Cell', useSQLite: true },
    PROJECT_STORE: { className: 'ProjectStore', useSQLite: true },
  },
  host: '127.0.0.1',
  port: 0,
  durableObjectsPersist: persist,
});
const url = await mf.ready;
process.send({ type: 'ready', url: String(url) });
process.on('message', async (m) => {
  if (m === 'stop') {
    await mf.dispose();
    process.exit(0);
  }
});
