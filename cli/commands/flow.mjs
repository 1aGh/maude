// `maude flow <verb>` — flow plugin helpers. Verbs: usage.
//
//   maude flow usage [sessionId] [--top N] [--json] [--root <dir>]
//
// sessionId defaults to the /flow:run record of this project (~/.claude/flow-runs/). The over-budget flag uses
// run.budget.agentContextK (or its preset) from .ai/workflows.config.json.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  findTranscript,
  formatUsage,
  resolveBudget,
  runRecordPath,
  sessionUsage,
} from '../lib/flow-usage.mjs';

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

export async function run({ args }) {
  const [verb, ...rest] = args;
  if (verb !== 'usage') {
    process.stderr.write('usage: maude flow usage [sessionId] [--top N] [--json] [--root <dir>]\n');
    process.exitCode = 2;
    return;
  }
  const opt = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const own = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const root = resolve(opt('--root') ?? own);
  // An AI session (MAUDE_CHAT_ID) reads its own project's records only and never gets subagent
  // description text (other people's prompts) — this verb is auto tier, so it must not reach further
  // than a Read card would (security batch 2, A3).
  const inChat = Boolean(process.env.MAUDE_CHAT_ID);
  if (inChat && root !== own) {
    process.stderr.write('maude flow usage: --root is not available in an AI session\n');
    process.exitCode = 1;
    return;
  }
  const valued = new Set(['--top', '--root']);
  const sid =
    rest.find((a, i) => !a.startsWith('--') && !valued.has(rest[i - 1])) ??
    readJson(runRecordPath(root))?.sessionId;
  if (!sid) {
    process.stderr.write(
      'maude flow usage: no sessionId given and no /flow:run record for this project\n'
    );
    process.exitCode = 1;
    return;
  }
  const path = findTranscript(sid, { root });
  if (!path) {
    // Codex, or a transcript from another machine: report, never fail a gate.
    process.stdout.write(`usage unavailable — no Claude Code transcript for session ${sid}\n`);
    return;
  }
  const budget = resolveBudget(readJson(join(root, '.ai/workflows.config.json')));
  const usage = sessionUsage(path);
  if (inChat) for (const a of usage.agents) a.desc = '';
  if (rest.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ sessionId: sid, budget, ...usage }, null, 2)}\n`);
    return;
  }
  const top = Number(opt('--top') ?? 25);
  process.stdout.write(`${formatUsage(usage, { top, contextK: budget.agentContextK })}\n`);
}
