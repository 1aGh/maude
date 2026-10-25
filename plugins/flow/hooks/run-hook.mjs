#!/usr/bin/env node
// /flow:run hooks — a plan run as a goal (generalised from the Maude v2 run harness).
//
//   node run-hook.mjs <subagent-start|subagent-stop|stop>
//
// Every hook is a NO-OP unless ALL of these hold (a downstream user can never be trapped):
//   1. FLOW_RUN_HOOKS is not "0"                       (kill switch for one shell)
//   2. .ai/workflows.config.json has run.hooks: true   (opt-in per repo, default off)
//   3. the marker .ai/state/run.json exists            (written by /flow:run, removed by --stop)
//   4. the hook input's session_id is the marker's sessionId (or in its members)
//   5. the marker has not expired                      (marker.expires, ISO time)
//
//   subagent-start  inject the context-budget rules + the "## Decisions" hand-back requirement
//   subagent-stop   ask once for a missing "## Decisions" section, then allow with a warning
//   stop            keep the lead going while the done check is red; allow the stop when
//                   .ai/state/run-waiting.md exists, after run.maxStopBlocks identical reds (it
//                   writes the waiting file itself), or past run.budget.maxRunTokens (checkpoint)
//
// Root: $FLOW_RUN_ROOT (tests) → $CLAUDE_PROJECT_DIR → input.cwd. Writes only under <root>/.ai/state.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MARKER = '.ai/state/run.json';
const WAITING = '.ai/state/run-waiting.md';
const STOPS = '.ai/state/run-stops.json';
const CONFIG = '.ai/workflows.config.json';
const KILL =
  'Kill switch: `/flow:run --pause` (or create .ai/state/run-waiting.md), `/flow:run --stop`, or start Claude with FLOW_RUN_HOOKS=0.';

// Keep in step with BUDGET_PRESETS in cli/lib/flow-usage.mjs (a test holds them equal). Inlined
// because a marketplace install of the plugin does not carry the CLI's lib folder.
export const PRESETS = {
  small: { agentTurns: 80, agentContextK: 150, handbackLines: 40, leadCheckpointPct: 60 },
  default: { agentTurns: 150, agentContextK: 300, handbackLines: 60, leadCheckpointPct: 60 },
  monorepo: { agentTurns: 150, agentContextK: 300, handbackLines: 60, leadCheckpointPct: 50 },
};

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

function budgetOf(config) {
  const b = config?.run?.budget ?? {};
  const out = { ...(PRESETS[b.preset] ?? PRESETS.default) };
  for (const k of Object.keys(out)) if (Number.isFinite(b[k])) out[k] = b[k];
  return out;
}

const HAS_DECISIONS = /^\s{0,3}#{1,4}\s*Decisions\b/im;

function rules(budget, marker) {
  return [
    `flow run (plan ${marker.plan ?? '?'}). Rules for this hand-back (skill flow:context-budget):`,
    '- Your brief carries your slice of the plan. Never read the whole plan or the run state files.',
    '- Read large files by range (search first, then offset/limit); never re-read a file you just edited.',
    `- Budget: about ${budget.agentTurns} turns and ${budget.agentContextK}k context. Near either, commit what is coherent and hand back with a \`## Continue\` section.`,
    '- Stay inside the files your brief says you own; for any other file put the exact patch under `## Patch requests`. Never `git add -A`.',
    `- Keep the hand-back under ${budget.handbackLines} lines. END it with a \`## Decisions\` section (one bullet per structural decision: what · why · rejected) or \`## Decisions: none\`.`,
  ].join('\n');
}

const out = (obj) => {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
};
const block = (reason) => out({ decision: 'block', reason: `${reason} ${KILL}` });

/** Built-in done check: the plan's Acceptance Criteria has no unticked box. */
export function planOpen(planText) {
  const i = planText.search(/^##\s+Acceptance Criteria\s*$/m);
  if (i < 0) return [];
  const rest = planText.slice(i).split('\n').slice(1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end))
    .filter((l) => /^\s*[-*]\s+\[ \]/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+\[ \]\s*/, '').trim());
}

/** Total cache read + write of a session (lead transcript + its subagents). */
export function runTokens(transcriptPath) {
  let total = 0;
  const scan = (f) => {
    const seen = new Set();
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      const m = d.message;
      if (d.type !== 'assistant' || !m?.usage || seen.has(m.id)) continue;
      seen.add(m.id);
      total += (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0);
    }
  };
  try {
    scan(transcriptPath);
    const sub = join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents');
    if (existsSync(sub))
      for (const f of readdirSync(sub)) if (f.endsWith('.jsonl')) scan(join(sub, f));
  } catch {
    /* unreadable transcript → no ceiling applied */
  }
  return total;
}

function pause(root, why) {
  writeFileSync(
    join(root, WAITING),
    `# Run paused by the Stop hook\n\n${why}\n\nResolve it, delete this file (or run \`/flow:run --resume\`), then continue.\n`
  );
  rmSync(join(root, STOPS), { force: true });
  process.exit(0);
}

function stop(root, marker, config, input) {
  if (existsSync(join(root, WAITING))) process.exit(0);
  const ceiling = config?.run?.budget?.maxRunTokens;
  if (Number.isFinite(ceiling) && input.transcript_path) {
    const used = runTokens(input.transcript_path);
    if (used >= ceiling)
      pause(
        root,
        `Token ceiling reached: ${used} read+write ≥ run.budget.maxRunTokens ${ceiling}. Checkpoint the Progress log before resuming.`
      );
  }
  const reasons = [];
  const plan =
    marker.plan && existsSync(join(root, marker.plan))
      ? readFileSync(join(root, marker.plan), 'utf8')
      : null;
  const open = plan ? planOpen(plan) : [];
  if (open.length)
    reasons.push(`${open.length} acceptance criteria open (first: "${open[0].slice(0, 100)}")`);
  if (!open.length && marker.doneCmd) {
    const r = spawnSync('bash', ['-c', marker.doneCmd], {
      cwd: root,
      encoding: 'utf8',
      timeout: 240_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.status !== 0) {
      const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-4).join(' | ');
      reasons.push(
        `done check \`${marker.doneCmd}\` is red (${r.error ? r.error.code : `exit ${r.status}`}: ${tail.slice(0, 300)})`
      );
    }
  }
  if (!reasons.length) {
    rmSync(join(root, STOPS), { force: true });
    process.exit(0);
  }
  const sig = reasons.join(' / ');
  const prev = readJson(join(root, STOPS));
  const count = prev?.sig === sig ? prev.count + 1 : 1;
  const max = Number.isFinite(config?.run?.maxStopBlocks) ? config.run.maxStopBlocks : 3;
  if (count > max)
    pause(root, `The same red done check repeated ${max} times without progress:\n\n${sig}`);
  writeFileSync(join(root, STOPS), JSON.stringify({ sig, count }));
  block(
    `The run's goal is not met: ${sig}. Continue from the plan's progress and the git log (block ${count}/${max}; after ${max} identical reds the run pauses itself).`
  );
}

function subagentStop(input) {
  if (!input.agent_type) process.exit(0); // Claude Code's internal agents
  if (HAS_DECISIONS.test(input.last_assistant_message ?? '')) process.exit(0);
  if (input.stop_hook_active) {
    process.stderr.write(
      `flow run: ${input.agent_type} handed back without ## Decisions (after one retry)\n`
    );
    process.exit(0);
  }
  block(
    'End your hand-back with a `## Decisions` section — one bullet per structural decision (what · why · rejected) — or `## Decisions: none`.'
  );
}

// ── state verbs (called by /flow:run, never by Claude Code) ─────────────────────────────────
//   node run-hook.mjs arm --plan <path> --session <id> [--done-cmd <cmd>] [--hours N]
//   node run-hook.mjs pause [--reason <text>] | resume --session <id> | disarm | status
// (`disarm`, not `stop`: `stop` is the Stop-hook event above.)
function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function verb(name, args, root) {
  const config = readJson(join(root, CONFIG));
  const markerPath = join(root, MARKER);
  const marker = readJson(markerPath);
  const say = (s) => process.stdout.write(`${s}\n`);
  if (name === 'arm') {
    if (config?.run?.hooks !== true) {
      say(
        'flow run: hooks are off in this repo. Turn them on with `maude config set run.hooks true` (or set "run": {"hooks": true} in .ai/workflows.config.json), then run /flow:run again.'
      );
      return 1;
    }
    const plan = flag(args, '--plan');
    const sessionId = flag(args, '--session');
    if (!plan || !existsSync(join(root, plan)) || !sessionId) {
      say('flow run: arm needs --plan <existing path> and --session <id>.');
      return 2;
    }
    const hours = Number(flag(args, '--hours') ?? config.run.expiresHours ?? 24);
    const doneCmd = flag(args, '--done-cmd');
    const m = {
      sessionId,
      plan,
      doneCmd: doneCmd || undefined,
      armedAt: new Date().toISOString(),
      expires: new Date(Date.now() + hours * 3600e3).toISOString(),
    };
    writeFileSync(markerPath, `${JSON.stringify(m, null, 2)}\n`);
    rmSync(join(root, WAITING), { force: true });
    rmSync(join(root, STOPS), { force: true });
    const b = budgetOf(config);
    say(`flow run armed: ${plan} · session ${sessionId} · expires ${m.expires}`);
    say(
      `budget: preset ${config.run.budget?.preset ?? 'default'} · ${b.agentTurns} turns / ${b.agentContextK}k per agent · lead checkpoint at ${b.leadCheckpointPct} %${config.run.budget?.maxRunTokens ? ` · run ceiling ${config.run.budget.maxRunTokens} tokens` : ''}`
    );
    say(
      `stop gate: open acceptance criteria in the plan${doneCmd ? `, then \`${doneCmd}\`` : ''}; pauses itself after ${config.run.maxStopBlocks ?? 3} identical reds.`
    );
    say(
      `GOAL: /goal Every acceptance criterion in ${plan} is ticked${doneCmd ? ` and \`${doneCmd}\` passes` : ''}`
    );
    return 0;
  }
  if (!marker) {
    say('flow run: no run is armed in this repo (.ai/state/run.json is absent).');
    return name === 'status' ? 0 : 1;
  }
  if (name === 'pause') {
    const reason = flag(args, '--reason') ?? 'Paused by the user.';
    writeFileSync(
      join(root, WAITING),
      `# Run paused\n\n${reason}\n\nThe Stop hook now lets the session end. /compact is safe now; continue with /flow:run --resume.\n`
    );
    say(
      'flow run paused — the Stop gate is open. Safe to /compact or close the session; continue with /flow:run --resume.'
    );
    return 0;
  }
  if (name === 'resume') {
    const sessionId = flag(args, '--session');
    if (!sessionId) {
      say('flow run: resume needs --session <id>.');
      return 2;
    }
    marker.sessionId = sessionId;
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    rmSync(join(root, WAITING), { force: true });
    rmSync(join(root, STOPS), { force: true });
    say(`flow run resumed in session ${sessionId}: ${marker.plan} · expires ${marker.expires}`);
    return 0;
  }
  if (name === 'disarm') {
    for (const f of [MARKER, WAITING, STOPS]) rmSync(join(root, f), { force: true });
    say('flow run stopped — marker removed; every hook is a no-op again.');
    return 0;
  }
  if (name === 'status') {
    const plan =
      marker.plan && existsSync(join(root, marker.plan))
        ? readFileSync(join(root, marker.plan), 'utf8')
        : '';
    const open = planOpen(plan);
    const stops = readJson(join(root, STOPS));
    const waiting = existsSync(join(root, WAITING))
      ? readFileSync(join(root, WAITING), 'utf8').trim()
      : null;
    say(
      `plan: ${marker.plan} · session ${marker.sessionId} · ${Date.parse(marker.expires) > Date.now() ? `expires ${marker.expires}` : 'EXPIRED'} · hooks ${config?.run?.hooks === true ? 'on' : 'off'}`
    );
    say(
      `open acceptance criteria: ${open.length}${open.length ? ` — ${open.slice(0, 5).join(' · ')}` : ''}`
    );
    say(
      `done check: ${marker.doneCmd ?? '(plan only)'}${stops ? ` · last red repeated ${stops.count}×` : ''}`
    );
    say(waiting ? `PAUSED:\n${waiting}` : 'running (no waiting file)');
    return 0;
  }
  say(`flow run: unknown verb ${name}`);
  return 2;
}

// ── dispatch ────────────────────────────────────────────────────────────────────────────────
function main() {
  const name = process.argv[2];
  if (['arm', 'pause', 'resume', 'disarm', 'status'].includes(name)) {
    const root = process.env.FLOW_RUN_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    process.exit(verb(name, process.argv.slice(3), root));
  }
  if (process.env.FLOW_RUN_HOOKS === '0') process.exit(0);
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {}
  const root =
    process.env.FLOW_RUN_ROOT || process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const config = readJson(join(root, CONFIG));
  if (config?.run?.hooks !== true) process.exit(0);
  const marker = readJson(join(root, MARKER));
  if (!marker?.sessionId) process.exit(0);
  const sid = input.session_id;
  if (sid !== marker.sessionId && !(Array.isArray(marker.members) && marker.members.includes(sid)))
    process.exit(0);
  if (!marker.expires || !(Date.parse(marker.expires) > Date.now())) process.exit(0);
  switch (process.argv[2]) {
    case 'subagent-start':
      out({
        hookSpecificOutput: {
          hookEventName: 'SubagentStart',
          additionalContext: rules(budgetOf(config), marker),
        },
      });
      break;
    case 'subagent-stop':
      subagentStop(input);
      break;
    case 'stop':
      stop(root, marker, config, input);
      break;
    default:
      process.exit(0);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
