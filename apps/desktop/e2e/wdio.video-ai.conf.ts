/**
 * WebdriverIO config for the P8 test round's AI video cut, in the chat (07 · ve-ai-watch, ve-ai-cut, ve-ai-proposal,
 * ve-ai-adjust): a real chat turn on a FAKE signed-in Claude that cuts the way the design plugin teaches
 * (fixtures/fake-acp/video-cut-agent.mjs: writes the footage notes, the EDL, then `reel-place` x 14 under the plugin's
 * real hooks). No model is called; the config home is a throwaway; the stub `claude` is first on PATH.
 *
 * Run: `pnpm --filter @maude/desktop-e2e e2e:video-ai` (the debug app and an unlocked screen).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useFakeAi } from './helpers/fake-ai';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

useFakeAi();
// the cutting agent instead of the generic scripted one (set once, in the launcher; workers inherit it)
process.env.MAUDE_ACP_ADAPTER_ENTRY = resolve(HERE, 'fixtures/fake-acp/video-cut-agent.mjs');

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/video-ai', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'video-ai-chat.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
