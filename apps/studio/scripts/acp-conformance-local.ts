#!/usr/bin/env bun
// Run the ACP conformance probe (acp/agents/conformance.ts) against the agents installed on THIS
// machine. Local only, never in CI: it needs the real codex / opencode binaries. Offline (loopback
// scripted model), scratch HOME, no credentials.
//
//   bun apps/studio/scripts/acp-conformance-local.ts [codex|opencode ...]
//       [--codex-bin <path>]     probe another codex binary (e.g. a scratch @openai/codex install)
//       [--git none|project|both] opencode project outside git / its own git repo (default both)
//       [--frames <dir>]          write every frame + model request per run
//       [--keep]                  keep the scratch worlds
//       [--json]                  print the raw results
//       [--control]               POSITIVE CONTROL: undo the F6b isolation after the launch policy
//                                 (Codex: the person's own CODEX_HOME back; opencode: no MCP
//                                 disables, no OPENCODE_PURE) to show the planted MCP server and
//                                 hooks/plugins really run when nothing stops them. Expect FAILs.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { agentById } from '../acp/agents/catalog.ts';
import {
  type ConformanceOptions,
  type ConformanceResult,
  runConformance,
} from '../acp/agents/conformance.ts';
import { discoverAgents } from '../acp/agents/discover.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const valued = new Set(['--codex-bin', '--git', '--frames']);
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
      return { CODEX_HOME: w.codexHome };
    }
  : undefined;
if (frames) mkdirSync(frames, { recursive: true });

const rows = await discoverAgents({ force: true });
const results: { label: string; result: ConformanceResult }[] = [];
for (const id of wanted) {
  const d = agentById(id);
  if (!d) throw new Error(`unknown agent ${id}`);
  const row = rows.find((r) => r.id === id);
  const bin = id === 'codex' ? (flag('--codex-bin') ?? row?.realBin) : row?.realBin;
  if (!bin) {
    console.log(`${id}: not installed`);
    continue;
  }
  const modes = id === 'opencode' ? gitModes : ['none'];
  for (const git of modes) {
    const label = `${id} ${git === 'project' ? '(project is a git repo)' : '(no git)'}${control ? ' [CONTROL: isolation undone]' : ''}`;
    const t = Date.now();
    const result = await runConformance(d, bin, {
      git: git as 'none' | 'project',
      keepScratch: argv.includes('--keep'),
      framesLog: frames ? join(frames, `${id}-${git}.ndjson`) : undefined,
      extraEnv: control,
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
