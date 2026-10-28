// agent-evals/lib/agentenv.mjs — the environment the agent under test (the model process, or the dry
// run's scripted stand-in) and the hooks it triggers run in.

import { join } from 'node:path';

import { HERE } from './paths.mjs';

/** Parent-session switches that must not reach the agent under test. */
export const STRIP = [
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
];

/**
 * `base` is the host env (the live model process keeps the person's HOME — `claude` needs its login) or a
 * studio env (the dry run: throwaway HOME). Either way the agent's `maude` is THIS worktree's CLI (the
 * shim), nothing opens a browser, and `~/.config/maude` is out of reach: XDG_CONFIG_HOME and the machine
 * file point into the trial.
 */
export function agentEnv(base, trialDir) {
  const env = { ...base };
  for (const k of STRIP) delete env[k];
  Object.assign(env, {
    PATH: `${join(HERE, 'shim')}:${base.PATH ?? process.env.PATH}`,
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_FORCE_SOURCE: '1',
    MAUDE_PORT_BASE: base.MAUDE_PORT_BASE ?? '48399', // a studio the agent's verbs start stays out of 4399–4408
    CLAUDE_CODE_DISABLE_CRON: '1',
    XDG_CONFIG_HOME: join(trialDir, 'home', '.config'),
    MAUDE_MACHINE_FILE: join(trialDir, 'home', 'machine.json'),
  });
  return env;
}
