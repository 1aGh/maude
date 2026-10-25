// `maude flow <verb>` — flow plugin helpers. Verbs: usage.
//
//   maude flow usage [sessionId] [--top N] [--json] [--root <dir>]
//
// sessionId defaults to the /flow:run marker (.ai/state/run.json). The over-budget flag uses
// run.budget.agentContextK (or its preset) from .ai/workflows.config.json.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findTranscript, formatUsage, resolveBudget, sessionUsage } from '../lib/flow-usage.mjs';

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
  const root = resolve(opt('--root') ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const valued = new Set(['--top', '--root']);
  const sid =
    rest.find((a, i) => !a.startsWith('--') && !valued.has(rest[i - 1])) ??
    readJson(join(root, '.ai/state/run.json'))?.sessionId;
  if (!sid) {
    process.stderr.write('maude flow usage: no sessionId given and no .ai/state/run.json marker\n');
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
  if (rest.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ sessionId: sid, budget, ...usage }, null, 2)}\n`);
    return;
  }
  const top = Number(opt('--top') ?? 25);
  process.stdout.write(`${formatUsage(usage, { top, contextK: budget.agentContextK })}\n`);
}
