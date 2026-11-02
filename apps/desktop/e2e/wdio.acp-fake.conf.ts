/**
 * WebdriverIO config for the AI panel's own contracts, on a FAKE signed-in Claude (P8 e2e live lanes):
 *
 *   acp-capability-picker  the "Ask before" picker is LIVE (sourced from the session, not a hardcoded list) and a
 *                          pick round-trips with no respawn
 *   acp-write-scope        the bridge's write-path gate end to end: an in-project write asks nothing, a write outside
 *                          the project raises the card naming the resolved path, Reject writes nothing
 *
 * Both used to need a real, signed-in `claude` and a model that decided to call Write. What they prove is MAUDE's
 * side — the mode roster, the gate, the card — so a scripted ACP agent (fixtures/fake-acp/scripted-agent.mjs, proven
 * against the real AcpBridge by apps/studio/test/e2e-scripted-agent.test.ts) speaks the adapter's wire and does a
 * fixed thing per prompt. Nothing here reaches a real provider; the config home is a throwaway (wdio.conf.ts), the
 * stub `claude` is first on PATH (helpers/fake-ai.ts).
 *
 * Judging what a REAL model writes is not this lane's job: that is the V2-8.16 live journeys' (ai-write-in-project,
 * ai-write-outside-asks).
 *
 * Run: `pnpm --filter @maude/desktop-e2e e2e:acp-fake` (needs the debug app and an unlocked screen).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useFakeAi } from './helpers/fake-ai';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

useFakeAi();

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/acp-fake', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [
    resolve(HERE, 'scenarios', 'acp-capability-picker.e2e.ts'),
    resolve(HERE, 'scenarios', 'acp-write-scope.e2e.ts'),
  ],
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
