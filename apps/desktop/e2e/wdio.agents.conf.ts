/**
 * WebdriverIO config for the UNIVERSAL-ACP agents UI (feature-universal-acp-and-codex, Design Decisions (UI) 1–6):
 * the one-line offer in the AI panel's empty state, Settings › Connections › AI agents, the composer's agent picker,
 * the vendor badge, the per-call permission card and "<label> reported: …" — against a FAKE opencode that Maude
 * finds on PATH and connects through the REAL conformance probe (never bypassed).
 *
 * The world it sets up (before the app starts; the app and every sidecar inherit it):
 *   • Claude is connected: the signed-in claude stub + the scripted ACP agent (helpers/fake-ai.ts).
 *   • PATH is scrubbed of every folder holding a catalog agent (codex, opencode, gemini …) and gets one EMPTY drop-in
 *     folder first (helpers/fake-agents.ts). World A = that folder empty; the scenario then writes the fake
 *     `opencode` launcher into it and presses Look again (World B). An e2e sidecar keeps the lane's PATH
 *     (sidecar.rs `sidecar_base_path`), so this is the same lookup a person's Mac goes through.
 *   • MAUDE_E2E_OPENCODE_HOME — an empty folder the opencode person-config check reads `~/.opencode` & co. under
 *     (acp/policy/opencode-user-config.ts; e2e sidecar builds only, a release build ignores it), so a developer's own
 *     opencode plugins do not make Maude refuse the lane's fake opencode. The project's `.opencode` chain is unmoved.
 *   • The agents' connected / dismissed record is `$XDG_CONFIG_HOME/maude/agents.json` — the lane's throwaway config
 *     home (wdio.conf.ts), never the person's.
 *
 * Needs the e2e sidecar (`bun run build.ts --release --e2e`) and the debug app; an unlocked, awake screen.
 * Run: `pnpm test:e2e:desktop:agents`.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useAgentDropDir } from './helpers/fake-agents';
import { useFakeAi } from './helpers/fake-ai';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

useFakeAi();
useAgentDropDir();
process.env.MAUDE_E2E_OPENCODE_HOME ??= mkdtempSync(join(tmpdir(), 'maude-e2e-opencode-home-'));

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/universal-acp-agents-desktop',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'agents.e2e.ts')],
  // a relaunch, the connect probe (≤ 60 s) and three chat turns
  mochaOpts: { ...base.mochaOpts, timeout: 420_000 },
};
