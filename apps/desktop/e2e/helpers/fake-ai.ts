import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A signed-in "Claude" that is nobody: the AI lanes of the desktop e2e run against this instead of a real `claude`.
 *
 * WHAT IT SETS (all before the app starts; the app and every sidecar it spawns inherit it):
 *   MAUDE_CLAUDE_BIN         a stub `claude` that answers `auth status` "signed in" and nothing else — and the SAME
 *                            stub is first on PATH as `claude`, so nothing that looks `claude` up by name reaches the
 *                            person's real CLI (the keychain dialog, memory maude-fake-home-real-claude-keychain)
 *   MAUDE_ACP_ADAPTER_ENTRY  fixtures/fake-acp/scripted-agent.mjs — the scripted ACP agent (modes, write gate, shell
 *                            ask, long turns); proven against the real AcpBridge by apps/studio/test/e2e-scripted-agent.test.ts
 *   MAUDE_ACP_RUNTIME        the `bun` on PATH (the adapter override rung of acp/probe.ts)
 *   FAKE_ACP_SDK             the studio's @agentclientprotocol/sdk, imported by the agent by absolute path
 *   MAUDE_E2E_FAKE_AI=1      the specs' marker: "not connected" is then a FAILURE, never a quiet skip (a lane on the
 *                            stub that skipped itself would be green and prove nothing)
 *
 * It refuses to run unless the config home is a throwaway (`XDG_CONFIG_HOME` set by wdio.conf.ts to a
 * `maude-e2e-*` dir): the person's own ~/.config/maude is never read or written by an AI lane.
 *
 * A lane that must judge what a REAL model says does not belong on this stub — it is on the V2-8.16 live
 * journeys list (see the lane's conf header).
 */
const HERE = dirname(fileURLToPath(import.meta.url));

export function useFakeAi(): void {
  if (process.env.MAUDE_E2E_FAKE_AI === '1') return; // the worker re-evaluates the conf: set up once
  const xdg = process.env.XDG_CONFIG_HOME ?? '';
  if (!xdg.includes('maude-e2e-')) {
    throw new Error(
      `[fake-ai] refusing to run: XDG_CONFIG_HOME (${xdg || 'unset'}) is not a throwaway maude-e2e-* dir — import wdio.conf first`
    );
  }
  const agent = resolve(HERE, '../fixtures/fake-acp/scripted-agent.mjs');
  const sdk = resolve(HERE, '../../../studio/node_modules/@agentclientprotocol/sdk/dist/acp.js');
  for (const f of [agent, sdk]) {
    if (!existsSync(f))
      throw new Error(`[fake-ai] missing ${f} (run \`bun install\` in apps/studio)`);
  }
  const bin = join(mkdtempSync(join(tmpdir(), 'maude-e2e-fake-ai-')), 'bin');
  mkdirSync(bin, { recursive: true });
  const claude = join(bin, 'claude');
  copyFileSync(resolve(HERE, '../fixtures/fake-acp/claude-stub.sh'), claude);
  chmodSync(claude, 0o755);

  let runtime: string;
  try {
    runtime = execFileSync('which', ['bun'], { encoding: 'utf8' }).trim();
  } catch {
    runtime = process.execPath;
  }
  process.env.MAUDE_CLAUDE_BIN = claude;
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`;
  process.env.MAUDE_ACP_ADAPTER_ENTRY = agent;
  process.env.MAUDE_ACP_RUNTIME = runtime;
  process.env.FAKE_ACP_SDK = sdk;
  process.env.MAUDE_E2E_FAKE_AI = '1';
}

/** True in a lane that runs on the fake agent. */
export const onFakeAi = (): boolean => process.env.MAUDE_E2E_FAKE_AI === '1';

/**
 * A `claude` that is signed OUT, first on PATH, for the lanes that boot a studio but never use AI (cloud, cell-tab,
 * team-project): the studio's readiness probe runs `claude auth status`, and the person's real CLI would read the real
 * keychain (a system dialog over the test window). Same stub the throwaway-HOME harnesses use
 * (scripts/lib/stub-claude.mjs). Idempotent across the launcher and its workers.
 */
export function useStubClaude(): void {
  if (process.env.MAUDE_E2E_STUB_CLAUDE === '1') return;
  const bin = join(mkdtempSync(join(tmpdir(), 'maude-e2e-stub-claude-')), 'bin');
  mkdirSync(bin, { recursive: true });
  const claude = join(bin, 'claude');
  writeFileSync(claude, `#!/bin/sh\necho '{"loggedIn":false}'\n`, { mode: 0o755 });
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`;
  process.env.MAUDE_E2E_STUB_CLAUDE = '1';
}
