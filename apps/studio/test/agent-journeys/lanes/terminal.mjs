// agent-journeys/lanes/terminal.mjs — the terminal lane: `claude -p --plugin-dir plugins/design`
// in the scratch project, one `claude -p` per turn on one session (`--session-id`, then `--resume`).
//
// Permissions are the AI chat's (S12.15: both lanes run under the same rules): the allow list is
// acp/bridge.ts `MAUDE_DEFAULT_ALLOWED_TOOLS`, in-project edits are accepted (`acceptEdits`, as the
// chat's write-scope gate auto-approves them), and nobody answers a prompt — anything else is
// denied. The one addition (decision v2-S12.16-lanes-allow-named-prompt-verbs): the prompt-tier
// verbs the journey JSON names in `allow` are added to the allow list as `Bash(<verb>:*)`. The design plugin's own hooks run (they ship in plugins/design/hooks/hooks.json).
// `maude` on PATH is THIS worktree's CLI (a shim written into the trial dir).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAUDE_DEFAULT_ALLOWED_TOOLS } from '../../../acp/bridge.ts';
import { CLI, logDenyIfAny, logTool, REPO } from './common.mjs';
import { allowRules } from './consent.mjs';

/** Parent-session switches that must not reach the agent under test (agent-evals' list). */
const STRIP = [
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_STOP_HOOK_BLOCK_CAP',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_CODE_REPORT_FINDINGS',
  'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES',
  'CLAUDE_CODE_TERMINAL_MCP_TOOLS',
  'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL',
  'CLAUDE_PID',
  'CLAUDECODE',
  'CLAUDE_EFFORT',
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_PLUGIN_ROOT',
  'ANTHROPIC_API_KEY',
];

export function shimDir(trialDir) {
  const dir = join(trialDir, 'bin');
  mkdirSync(dir, { recursive: true });
  const shim = join(dir, 'maude');
  writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${JSON.stringify(CLI)} "$@"\n`);
  chmodSync(shim, 0o755);
  return dir;
}

/** The exact commands this lane would run — pure; `--dry` checks it, a live run executes it. */
export function planTerminal(
  journey,
  { project, trialDir, env, model = 'claude-opus-5-5', budgetUsd = 4, sessionId = randomUUID() }
) {
  const agentEnv = { ...env };
  for (const k of STRIP) delete agentEnv[k];
  agentEnv.PATH = `${join(trialDir, 'bin')}:${env.PATH ?? ''}`;
  agentEnv.CLAUDE_CODE_DISABLE_CRON = '1';
  const common = [
    '--model',
    model,
    '--output-format',
    'stream-json',
    '--verbose',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--plugin-dir',
    join(REPO, 'plugins', 'design'),
    // one argv per rule (a variadic flag): a rule like `Bash(maude design open:*)` holds spaces
    '--allowedTools',
    ...MAUDE_DEFAULT_ALLOWED_TOOLS,
    ...allowRules(journey),
    '--permission-mode',
    'acceptEdits',
    '--max-budget-usd',
    String(budgetUsd),
  ];
  const turns = journey.turns.map((t, i) => ({
    cwd: project,
    args: [
      '-p',
      t.say,
      ...(i === 0 ? ['--session-id', sessionId] : ['--resume', sessionId]),
      ...common,
    ],
  }));
  return { lane: 'terminal', sessionId, env: agentEnv, turns };
}

/** Turn one stream-json transcript into tools.jsonl / denies.jsonl lines. */
export function digestTranscript(trialDir, text) {
  const names = new Map();
  let result = null;
  for (const l of text.split('\n')) {
    let ev;
    try {
      ev = JSON.parse(l);
    } catch {
      continue;
    }
    if (ev.type === 'assistant')
      for (const c of ev.message?.content ?? [])
        if (c.type === 'tool_use') {
          names.set(c.id, c.name);
          logTool(trialDir, 'terminal', c.name, c.input);
        }
    if (ev.type === 'user')
      for (const c of ev.message?.content ?? [])
        if (c.type === 'tool_result' && c.is_error) {
          const body = Array.isArray(c.content)
            ? c.content.map((x) => x.text ?? '').join('\n')
            : c.content;
          logDenyIfAny(trialDir, 'terminal', names.get(c.tool_use_id) ?? '?', body);
        }
    if (ev.type === 'result') result = ev;
  }
  return result;
}

export async function runTerminal(plan, trialDir, { timeoutMin = 20 } = {}) {
  const turns = [];
  for (const [i, t] of plan.turns.entries()) {
    const tr = join(trialDir, `transcript-${i + 1}.jsonl`);
    const out = createWriteStream(tr);
    const err = createWriteStream(join(trialDir, `stderr-${i + 1}.txt`));
    const child = spawn('claude', t.args, {
      cwd: t.cwd,
      env: plan.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out);
    child.stderr.pipe(err);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMin * 60_000);
    const code = await new Promise((res) => child.on('close', res));
    clearTimeout(timer);
    await new Promise((r) => out.end(r));
    await new Promise((r) => err.end(r));
    const result = digestTranscript(trialDir, readFileSync(tr, 'utf8'));
    turns.push({
      turn: i + 1,
      code,
      ok: !!result && !result.is_error,
      costUsd: result?.total_cost_usd ?? null,
      numTurns: result?.num_turns ?? null,
      // A refused start (not signed in, API down) costs nothing: that is the lane, not a grade.
      ...(result?.is_error && !result.total_cost_usd
        ? { error: String(result.result ?? 'error result').slice(0, 200) }
        : {}),
    });
    if (!result || turns.at(-1).error) break; // infra failure: no result event — the remaining turns would grade nothing
  }
  return turns;
}
