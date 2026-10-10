// agent-evals/lib/judge.mjs — model-based grader, used LAST (K §3.4 / A9: deterministic first,
// LLM-as-judge least robust). Read-only tools, structured verdict with an explicit "unknown" exit.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'score', 'why'],
  properties: {
    verdict: { enum: ['pass', 'fail', 'unknown'] },
    score: { type: 'integer', minimum: 1, maximum: 5 },
    why: { type: 'string', maxLength: 800 },
  },
};

function listRuns(project) {
  const out = [];
  const walk = (d) => {
    let ents = [];
    try {
      ents = readdirSync(d);
    } catch {
      return;
    }
    for (const f of ents) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) {
        if (f !== 'snap' && f !== 'base') walk(p);
      } else if (!/hooklog|touched|agents|run\.json|stop-last|shots\.jsonl/.test(f))
        out.push(relative(project, p));
    }
  };
  walk(join(project, '.design', '_runs'));
  return out.slice(0, 40);
}

function listTrash(project) {
  const out = [];
  const walk = (d) => {
    let ents = [];
    try {
      ents = readdirSync(d);
    } catch {
      return;
    }
    for (const f of ents) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(project, p));
    }
  };
  walk(join(project, '.design', '_trash'));
  return out.slice(0, 40);
}

export function judge({
  task,
  project,
  finalText,
  diff,
  shots,
  model = 'sonnet',
  budgetUsd = 1.5,
  env,
}) {
  const shotList =
    shots
      .filter((s) => s.path)
      .map(
        (s) => `- ${s.canvas} › ${s.artboard}: ${s.path}${s.stats?.blank ? ' (looks blank)' : ''}`
      )
      .join('\n') || '(none)';
  const prompt = `You are grading one run of an AI design assistant against a rubric. Be strict and literal; do not reward effort.

TASK the person gave: ${JSON.stringify(task.prompt)}

RUBRIC (what a pass looks like): ${task.rubric}

The project is the current directory (a git repo; HEAD is the state before the run). You may Read files, including new files and the run folder.

The assistant's final message:
<<<
${String(finalText).slice(0, 5000)}
>>>

git diff against the state before the run (may be truncated):
<<<
${diff}
>>>

Run-folder files (hand-offs, proposals, drafts): ${listRuns(project).join(', ') || '(none)'}

Maude's trash (.design/_trash/ — runtime state, gitignored, so git status does not show it; it is how Maude keeps a removed canvas restorable): ${listTrash(project).join(', ') || '(empty)'}

Screenshots of the result (Read each PNG to look at it):
${shotList}

Decide: "pass" if the result meets the rubric, "fail" if it clearly does not, "unknown" if you cannot tell from what you can see (e.g. screenshots missing or blank for a visual rubric). Score 1–5 for quality. "why" in at most three sentences.`;
  const args = [
    '-p',
    prompt,
    '--model',
    model,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(SCHEMA),
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--tools',
    'Read,Glob,Grep',
    '--allowedTools',
    'Read Glob Grep',
    '--permission-prompts',
    'none',
    '--no-session-persistence',
    '--max-budget-usd',
    String(budgetUsd),
  ];
  const r = spawnSync('claude', args, {
    cwd: project,
    env,
    encoding: 'utf8',
    timeout: 8 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    const j = JSON.parse(r.stdout);
    const v =
      j.structured_output ??
      (typeof j.result === 'string'
        ? JSON.parse(j.result.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
        : j.result);
    return {
      verdict: v.verdict ?? 'unknown',
      score: v.score ?? null,
      why: v.why ?? '',
      costUsd: j.total_cost_usd ?? null,
      model,
    };
  } catch (e) {
    return {
      verdict: 'unknown',
      score: null,
      why: `judge failed: ${String(r.stderr || e.message).slice(0, 300)}`,
      costUsd: null,
      model,
    };
  }
}
