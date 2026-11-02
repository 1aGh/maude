/**
 * WebdriverIO config for the S8.16 Generate-with-N-takes scenario (12 · ia-gen-ask, ia-gen-placed).
 *
 * The app's sidecar runs with `MAUDE_GENERATE_STUB=1`, so the only image provider is the local stub
 * (generation/adapters/stub.ts: solid PNGs, no network, billed to nobody). No scenario ever reaches a real
 * provider. Needs an unlocked screen. Not run in CI.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from './wdio.conf';

// the sidecar inherits this env when the app launches
process.env.MAUDE_GENERATE_STUB = '1';

const HERE = dirname(fileURLToPath(import.meta.url));

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'generate-takes.e2e.ts')],
};
