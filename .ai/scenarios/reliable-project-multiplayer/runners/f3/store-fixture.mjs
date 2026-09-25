// A cloud-shaped accepted-revision store for the self-host fixture: the
// ProjectStore host (scripts/dev/local-project-store.mjs) in a `node:24-slim`
// container on the fixture network, a round trip away from the hub like a
// cell's Durable Object. The hub uses it through MAUDE_PROJECT_STORE_URL/_TOKEN.
//
//   import { ensureStore } from './store-fixture.mjs';
//   const s = await ensureStore({ latencyMs: 40 });
//   // s.containerUrl (for the hub), s.hostUrl (stats from this machine), s.token
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureNetwork, NETWORK } from './s3-fixture.mjs';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const NAME = 'maude-f3-store';
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export async function ensureStore({ latencyMs = 40, token = 'f3-local-store', port = 8788, fresh = false } = {}) {
  ensureNetwork();
  const data = join(homedir(), '.cache', 'maude-f3', 'store-data');
  mkdirSync(data, { recursive: true });
  let running = '';
  try {
    running = docker('inspect', '-f', '{{.State.Running}}', NAME);
  } catch {
    /* absent */
  }
  if (fresh || running !== 'true') {
    try {
      docker('rm', '-f', NAME);
    } catch {
      /* none */
    }
    if (fresh) execFileSync('rm', ['-rf', data]), mkdirSync(data, { recursive: true });
    docker(
      'run', '-d', '--name', NAME, '--network', NETWORK,
      '-p', `127.0.0.1:${port}:${port}`,
      '-v', `${REPO}:/repo:ro`, '-v', `${data}:/data`,
      'node:24-slim',
      'node', '/repo/scripts/dev/local-project-store.mjs',
      '--dir', '/data', '--host', '0.0.0.0', '--port', String(port),
      '--latency-ms', String(latencyMs), '--token', token
    );
  }
  const hostUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${hostUrl}/stats`, { signal: AbortSignal.timeout(2000) })).ok)
        return { containerUrl: `http://${NAME}:${port}`, hostUrl, token, latencyMs };
    } catch {
      /* booting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the local project store did not come up');
}
