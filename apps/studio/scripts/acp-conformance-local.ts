#!/usr/bin/env bun
// Run the ACP conformance probe (acp/agents/conformance.ts) against the agents installed on THIS
// machine. Local only, never in CI: it needs the real codex / opencode binaries. Offline (loopback
// scripted model), scratch HOME, no credentials.
//
//   bun apps/studio/scripts/acp-conformance-local.ts [codex|opencode ...]
//       [--codex-bin <path>]     probe another codex binary (e.g. a scratch @openai/codex install)
//       [--bin <path>]           the agent binary to probe (gemini: its bundle/gemini.js, with
//                                PROBE_PATH naming a PATH that has node)
//       [--git none|project|both] opencode project outside git / its own git repo (default both)
//       [--frames <dir>]          write every frame + model request per run
//       [--keep]                  keep the scratch worlds
//       [--json]                  print the raw results
//       [--control]               POSITIVE CONTROL: undo the F6b isolation after the launch policy
//                                 (Codex: the person's own CODEX_HOME back; opencode: no MCP
//                                 disables, no OPENCODE_PURE; Copilot / Gemini: the person's own
//                                 home back, no Maude system settings) to show the planted MCP server and
//                                 hooks/plugins really run when nothing stops them. Expect FAILs.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { agentById, COPILOT_ENFORCEMENT, GEMINI_ENFORCEMENT } from '../acp/agents/catalog.ts';
import {
  type ConformanceOptions,
  type ConformanceResult,
  runConformance,
} from '../acp/agents/conformance.ts';
import type { AgentDescriptor } from '../acp/agents/descriptor.ts';
import { discoverAgents } from '../acp/agents/discover.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const valued = new Set(['--codex-bin', '--bin', '--git', '--frames']);
const ids = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1] ?? ''));
const wanted = ids.length ? ids : ['codex', 'opencode'];
const gitModes =
  (flag('--git') ?? 'both') === 'both' ? ['none', 'project'] : [flag('--git') as string];
const frames = flag('--frames');
const control: ConformanceOptions['extraEnv'] = argv.includes('--control')
  ? (w, env): Record<string, string> => {
      if (env.OPENCODE_CONFIG_CONTENT) {
        const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
        cfg.mcp = {};
        return { OPENCODE_CONFIG_CONTENT: JSON.stringify(cfg), OPENCODE_PURE: '0' };
      }
      // B8 — the person's own Copilot / Gemini home back, and no Maude system settings.
      if (env.COPILOT_HOME) return { COPILOT_HOME: join(w.home, '.copilot') };
      if (env.GEMINI_CLI_HOME) {
        return { GEMINI_CLI_HOME: w.home, GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(w.base, 'none') };
      }
      return { CODEX_HOME: w.codexHome };
    }
  : undefined;
if (frames) mkdirSync(frames, { recursive: true });

const rows = await discoverAgents({ force: true });
const results: { label: string; result: ConformanceResult }[] = [];
for (const id of wanted) {
  const found = agentById(id);
  if (!found) throw new Error(`unknown agent ${id}`);
  // B8 — an agent still 'unrestricted' in the catalog is probed with its candidate enforcement.
  const candidate = { gemini: GEMINI_ENFORCEMENT, copilot: COPILOT_ENFORCEMENT }[id];
  const d: AgentDescriptor =
    !found.enforcement && candidate ? { ...found, enforcement: candidate } : found;
  const row = rows.find((r) => r.id === id);
  const bin = (id === 'codex' ? flag('--codex-bin') : undefined) ?? flag('--bin') ?? row?.realBin;
  if (!bin) {
    console.log(`${id}: not installed`);
    continue;
  }
  const modes = id === 'codex' ? ['none'] : gitModes;
  for (const git of modes) {
    const label = `${id} ${git === 'project' ? '(project is a git repo)' : '(no git)'}${control ? ' [CONTROL: isolation undone]' : ''}`;
    const t = Date.now();
    const result = await runConformance(d, bin, {
      git: git as 'none' | 'project',
      keepScratch: argv.includes('--keep'),
      framesLog: frames ? join(frames, `${id}-${git}.ndjson`) : undefined,
      extraEnv: control,
      // A node-script agent (Gemini CLI) needs its runtime on PATH: PROBE_PATH replaces the default.
      path: process.env.PROBE_PATH,
    });
    results.push({ label, result });
    console.log(
      `\n${label} — ${bin} v${result.agentVersion ?? '?'} — ${result.pass ? 'PASS' : 'FAIL'} in ${Math.round((Date.now() - t) / 1000)} s`
    );
    for (const c of result.checks)
      console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`);
  }
}
if (argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
