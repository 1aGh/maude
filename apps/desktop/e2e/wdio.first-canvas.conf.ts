/**
 * WebdriverIO config for the FIRST-CANVAS journey (S6.16, 01 Create Flow): Home sentence → canvas → select →
 * F → duplicate at Laptop → text in place → sticky → comment → status words.
 *
 * Same world as wdio.home.conf.ts — a first-run-clean app-state (so the boot opens Home), two seeded fixture
 * projects in a fresh MAUDE_INDEX_DIR, a loopback stub for the control plane, throwaway cloud/hubs files — plus a
 * FAKE ACP agent, so the sentence "draws" without a model:
 *   MAUDE_ACP_ADAPTER_ENTRY  fixtures/fake-acp/first-canvas-agent.mjs  (three web artboards, one fixed draft)
 *   MAUDE_ACP_RUNTIME        the `bun` on PATH (the adapter override rung of acp/probe.ts)
 *   MAUDE_CLAUDE_BIN         fixtures/fake-acp/claude-stub.sh  (`claude auth status` → signed in; nothing else)
 *   FAKE_ACP_SDK             the studio's @agentclientprotocol/sdk, imported by the agent by absolute path
 * Nothing here reaches a real provider. The app and every sidecar it spawns inherit this env.
 *
 * Importing wdio.home.conf.ts runs its (launcher-only, once) seeding; the env below is then added before the app
 * starts. Run: `pnpm --filter @maude/desktop-e2e e2e:first-canvas` (needs the debug app, an unlocked screen and
 * the machine's e2e lock).
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as home } from './wdio.home.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

process.env.MAUDE_ACP_ADAPTER_ENTRY = resolve(HERE, 'fixtures/fake-acp/first-canvas-agent.mjs');
process.env.MAUDE_ACP_RUNTIME = execFileSync('which', ['bun'], { encoding: 'utf8' }).trim();
process.env.MAUDE_CLAUDE_BIN = resolve(HERE, 'fixtures/fake-acp/claude-stub.sh');
process.env.FAKE_ACP_SDK = resolve(
  HERE,
  '../../studio/node_modules/@agentclientprotocol/sdk/dist/acp.js'
);

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/first-canvas',
  stamp
);

export const config: WebdriverIO.Config = {
  ...home,
  specs: [resolve(HERE, 'scenarios', 'first-canvas.e2e.ts')],
  // Two cold project servers, the Home server, an adapter spawn, then a dozen gestures.
  mochaOpts: { ...home.mochaOpts, timeout: 600_000 },
};
