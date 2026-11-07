import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));
// the SHIPPED cap of the app under test: no override
delete process.env.MAUDE_E2E_RUNNING_CAP;

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'ab-five-tabs.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 600_000 },
};
