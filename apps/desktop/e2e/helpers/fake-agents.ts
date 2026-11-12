import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The universal-ACP lane's "other agents on this Mac" (wdio.agents.conf.ts).
 *
 * WHY A DROP-IN FOLDER. An e2e lane's sidecar keeps the PATH the lane was launched with (sidecar.rs
 * `sidecar_base_path`), and discovery walks that PATH (acp/agents/discover.ts). So the lane puts one EMPTY folder
 * first on PATH before the app starts; World A (Claude only) runs with it empty, and the scenario then writes the fake
 * `opencode` launcher into it and asks discovery to look again (Settings › AI agents › Look again). No product
 * switch, no relaunch: the same PATH lookup a person's Mac goes through.
 *
 * WHY THE PATH IS SCRUBBED. The lane inherits the developer's own PATH, and a developer of this feature has real
 * agents on it (codex, gemini, opencode …): World A would then not be "Claude only", and the real binaries would be
 * version-probed. Every PATH folder that holds a catalog agent's bin is dropped (`scrubAgentPath`).
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Every `detect.bins` name in apps/studio/acp/agents/catalog.ts other than claude (kept in step by hand; the
 *  scenario's World A check fails loudly if one slips through). */
export const OTHER_AGENT_BINS = ['codex', 'opencode', 'gemini', 'copilot', 'goose', 'cursor-agent'];

/** PATH without any folder that holds one of `bins` (the lane's own stub folders are never dropped: they hold none). */
export function scrubAgentPath(path: string, bins: readonly string[] = OTHER_AGENT_BINS): string {
  return path
    .split(delimiter)
    .filter((dir) => dir && !bins.some((b) => existsSync(join(dir, b))))
    .join(delimiter);
}

/** The drop-in folder (first on PATH, empty at launch). Set once by the conf; workers inherit it. */
export const agentDropDir = (): string => {
  const d = process.env.MAUDE_E2E_AGENT_DROP_DIR;
  if (!d)
    throw new Error(
      '[fake-agents] MAUDE_E2E_AGENT_DROP_DIR is not set — run through wdio.agents.conf.ts'
    );
  return d;
};

/** Make the drop-in folder, scrub the inherited PATH, put the folder first, compile the fake opencode beside it.
 *  Idempotent across launcher + workers. */
export function useAgentDropDir(): void {
  if (process.env.MAUDE_E2E_AGENT_DROP_DIR) return;
  const root = mkdtempSync(join(tmpdir(), 'maude-e2e-agents-'));
  const dir = join(root, 'bin');
  mkdirSync(dir, { recursive: true });
  process.env.MAUDE_E2E_FAKE_OPENCODE_BIN = buildFakeOpencode(join(root, 'build'));
  process.env.PATH = `${dir}${delimiter}${scrubAgentPath(process.env.PATH ?? '')}`;
  process.env.MAUDE_E2E_AGENT_DROP_DIR = dir;
}

function bunPath(): string {
  try {
    return realpathSync(execFileSync('which', ['bun'], { encoding: 'utf8' }).trim());
  } catch {
    throw new Error('[fake-agents] no `bun` on PATH: the fake opencode is compiled with it');
  }
}

/**
 * Compile fixtures/fake-acp/opencode-agent.mjs into a standalone `opencode` executable (the ACP SDK bundled in) under
 * `outDir`, once per lane (the launcher, before the app starts). A compiled binary, like a real opencode: discovery
 * sees a binary, the bridge spawns it as `opencode acp`, and its argv0 is `opencode` — a `bun <script>` would be judged
 * a studio by the prefs guard while the conformance probe runs it under the probe world's XDG_CONFIG_HOME.
 */
export function buildFakeOpencode(outDir: string): string {
  const agent = resolve(HERE, '../fixtures/fake-acp/opencode-agent.mjs');
  const sdk = resolve(HERE, '../../../studio/node_modules/@agentclientprotocol/sdk/dist/acp.js');
  for (const f of [agent, sdk]) {
    if (!existsSync(f))
      throw new Error(`[fake-agents] missing ${f} (run \`bun install\` in apps/studio)`);
  }
  mkdirSync(outDir, { recursive: true });
  const sdkShim = join(outDir, 'sdk-global.mjs');
  writeFileSync(
    sdkShim,
    `import * as acp from ${JSON.stringify(sdk)};\nglobalThis.__FAKE_ACP_SDK = acp;\n`
  );
  const entry = join(outDir, 'entry.mjs');
  writeFileSync(entry, `import ${JSON.stringify(sdkShim)};\nimport ${JSON.stringify(agent)};\n`);
  const bin = join(outDir, 'opencode');
  execFileSync(bunPath(), ['build', '--compile', entry, '--outfile', bin], { stdio: 'pipe' });
  return bin;
}

/** Put the lane's compiled fake `opencode` into the drop-in folder (World B). */
export function installFakeOpencode(dir: string = agentDropDir()): string {
  const built = process.env.MAUDE_E2E_FAKE_OPENCODE_BIN;
  if (!built || !existsSync(built)) {
    throw new Error(
      '[fake-agents] MAUDE_E2E_FAKE_OPENCODE_BIN is not built — run through wdio.agents.conf.ts'
    );
  }
  const bin = join(dir, 'opencode');
  copyFileSync(built, bin);
  chmodSync(bin, 0o755);
  return bin;
}

/** Empty the drop-in folder (World A again). */
export function clearDropDir(dir: string = agentDropDir()): void {
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true });
}
