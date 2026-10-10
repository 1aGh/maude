#!/usr/bin/env bun
// agent-evals/run.mjs — the V2-1.18 agent eval: topology A (one writer + skills) vs B (A + helper
// sub-agents), on fixture canvases, headless through `claude -p --plugin-dir`. NOT a CI gate.
//
//   bun apps/studio/test/agent-evals/run.mjs fixtures [--out DIR]
//   bun apps/studio/test/agent-evals/run.mjs trial  --task e1 --topology A [--trial 1] [--out DIR]
//   bun apps/studio/test/agent-evals/run.mjs pair   --task e1 [--trial 1] [--out DIR]       A ∥ B, symmetric load
//   bun apps/studio/test/agent-evals/run.mjs suite  --tasks pilot|all|e1,b2 [--trials 3] [--out DIR] [--no-lane]
//   bun apps/studio/test/agent-evals/run.mjs grade  --dir <trial dir>                        re-grade a finished trial
//   bun apps/studio/test/agent-evals/run.mjs report [--out DIR]
//   bun apps/studio/test/agent-evals/run.mjs smoke                                            no model: fixtures + graders + hooks
//
// Options: --model claude-opus-5-5 · --effort high · --budget-usd 6 (per trial) · --timeout-min 25 ·
//          --hooks on|off · --judge on|off · --judge-model sonnet · --render on|off
// Outputs go to --out (default $TMPDIR/maude-agent-evals/<date>/ — never inside the repo, never committed).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { primeRegistry } from './lib/check.mjs';
import { buildFixture, REPO } from './lib/fixtures.mjs';
import { gradeCode } from './lib/grade.mjs';
import { judge } from './lib/judge.mjs';
import { gitDiff, renderCheck, renderTargets, serverDown } from './lib/render.mjs';
import { readTranscript } from './lib/transcript.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(REPO, 'cli', 'bin', 'maude.mjs');
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(`--${name}`);
// Outside the repo on purpose: Claude Code loads CLAUDE.md from every parent of the cwd, and the
// repo's own CLAUDE.md must not leak into the agent under test.
const OUT = opt('out', join(tmpdir(), 'maude-agent-evals', new Date().toISOString().slice(0, 10)));
const MODEL = opt('model', 'claude-opus-5-5');
const EFFORT = opt('effort', 'high');
const BUDGET = Number(opt('budget-usd', '6'));
const TIMEOUT_MIN = Number(opt('timeout-min', '25'));
const HOOKS = opt('hooks', 'on') === 'on';
const JUDGE = opt('judge', 'on') === 'on';
const RENDER = opt('render', 'on') === 'on';
const JUDGE_MODEL = opt('judge-model', 'sonnet');

const TASKS = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8')).tasks;
const taskById = (id) => {
  const t = TASKS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown task ${id}`);
  return t;
};

// Env for the agent: the host's auth/proxy stays, behaviour switches from the parent session go.
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
];
function agentEnv(_project) {
  const env = { ...process.env };
  for (const k of STRIP) delete env[k];
  Object.assign(env, {
    PATH: `${join(HERE, 'shim')}:${process.env.PATH}`,
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_FORCE_SOURCE: '1',
    MAUDE_EVAL: '1',
    CLAUDE_CODE_DISABLE_CRON: '1',
  });
  return env;
}

function fixtureProject(name) {
  const dir = join(OUT, 'fixtures', name);
  const project = join(dir, 'project');
  if (!existsSync(join(project, '.git'))) {
    const m = buildFixture(name, project);
    if (!m) return null;
  }
  return {
    project,
    manifest: JSON.parse(readFileSync(join(dir, `${name}.manifest.json`), 'utf8')),
  };
}

const ALLOWED = [
  'Read',
  'Glob',
  'Grep',
  'Bash(maude:*)',
  'Edit',
  'Write',
  'MultiEdit',
  'Skill',
  'Task',
  'Agent',
  'TodoWrite',
];
const TOOLS = 'Bash,Read,Edit,Write,MultiEdit,Glob,Grep,Skill,Task,TodoWrite,ToolSearch';

function claudeArgs(task, topology) {
  const sys = [
    readFileSync(join(HERE, 'topologies', 'contract.md'), 'utf8'),
    readFileSync(join(HERE, 'topologies', `${topology.toLowerCase()}.md`), 'utf8'),
  ].join('\n\n');
  const args = [
    '-p',
    task.prompt,
    '--model',
    MODEL,
    '--effort',
    EFFORT,
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
    '--tools',
    TOOLS,
    '--allowedTools',
    ALLOWED.join(' '),
    '--permission-mode',
    'acceptEdits',
    '--permission-prompts',
    'none',
    '--append-system-prompt',
    sys,
    '--max-budget-usd',
    String(BUDGET),
    '--no-session-persistence',
  ];
  if (HOOKS) args.push('--plugin-dir', join(HERE, 'harness', 'plugin'));
  if (topology === 'B') args.push('--plugin-dir', join(HERE, 'topologies', 'b', 'plugin'));
  return args;
}

function cloneFixture(src, dst) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dirname(dst), { recursive: true });
  const r = spawnSync('cp', ['-cR', src, dst]);
  if (r.status !== 0) spawnSync('cp', ['-R', src, dst]);
}

async function runAgent(task, topology, trialDir, project) {
  const t0 = Date.now();
  const transcript = join(trialDir, 'transcript.jsonl');
  const errf = join(trialDir, 'stderr.txt');
  const args = claudeArgs(task, topology);
  writeFileSync(
    join(trialDir, 'command.json'),
    `${JSON.stringify({ cwd: project, args: args.map((a) => (a.length > 300 ? `${a.slice(0, 80)}… (${a.length} chars)` : a)) }, null, 2)}\n`
  );
  const { createWriteStream } = await import('node:fs');
  const out = createWriteStream(transcript);
  const err = createWriteStream(errf);
  const child = spawn('claude', args, {
    cwd: project,
    env: agentEnv(project),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 10_000);
  }, TIMEOUT_MIN * 60_000);
  const code = await new Promise((res) => child.on('close', res));
  clearTimeout(timer);
  await new Promise((r) => out.end(r));
  await new Promise((r) => err.end(r));
  return { code, killed, wallMs: Date.now() - t0 };
}

async function gradeTrial(trialDir, task, topology, run, prevJudge = null) {
  await primeRegistry();
  const project = join(trialDir, 'project');
  const tr = readTranscript(join(trialDir, 'transcript.jsonl'));
  const fx = JSON.parse(
    readFileSync(join(OUT, 'fixtures', task.fixture, `${task.fixture}.manifest.json`), 'utf8')
  );
  const code = gradeCode({ task, project, transcript: tr, manifest: fx });
  let render = { ran: false, shots: [] };
  if (RENDER) {
    try {
      render = renderCheck({
        cli: CLI,
        project,
        trialDir,
        targets: renderTargets(task, code, project),
      });
    } catch (e) {
      render = { ran: true, error: String(e.message), shots: [] };
    }
  }
  const blank = render.shots.filter((s) => !s.path || s.stats?.blank);
  if (render.ran)
    code.quality['render-non-blank'] = {
      pass: !render.error && render.shots.length > 0 && blank.length === 0,
      why:
        render.error ??
        blank
          .map((s) => `${s.artboard}: ${s.path ? 'blank' : `capture failed ${s.err}`}`)
          .join('; '),
    };
  let verdict = null;
  if (prevJudge) verdict = prevJudge;
  else if (JUDGE && task.rubric)
    verdict = judge({
      task,
      project,
      finalText: tr.finalText,
      diff: gitDiff(project),
      shots: render.shots,
      model: JUDGE_MODEL,
      env: agentEnv(project),
    });
  if (verdict) {
    code.quality.judge = {
      pass: verdict.verdict === 'pass',
      why: `${verdict.verdict} (${verdict.score ?? '?'}): ${verdict.why}`,
      unknown: verdict.verdict === 'unknown',
    };
  }
  serverDown(project);
  const hookMs = code.hooklog
    .filter((h) => typeof h.ms === 'number')
    .reduce((acc, h) => {
      acc[h.event] ??= [];
      acc[h.event].push(h.ms);
      return acc;
    }, {});
  const invPass = Object.values(code.invariants).every((x) => x.pass);
  const qualPass = Object.values(code.quality)
    .filter((x) => !x.unknown)
    .every((x) => x.pass);
  // infra-failure: the run (or its judge) was cut by the network / provider, not by the agent — excluded from pass rates, re-run.
  const infraRe =
    /ENOTFOUND|ECONNRESET|ECONNREFUSED|Can't reach the API server|overloaded_error|API Error: 5\d\d|rate.?limit/i;
  const harnessFailure =
    !tr.ok ||
    !!run?.killed ||
    infraRe.test(`${readSafe(join(trialDir, 'stderr.txt'))}\n${tr.finalText}`);
  const g = {
    task: task.id,
    group: task.group,
    fixture: task.fixture,
    topology,
    delegates: task.delegates ?? null,
    run,
    metrics: tr.metrics,
    agents: tr.agents,
    invariants: code.invariants,
    quality: code.quality,
    invPass,
    qualPass,
    judge: verdict,
    render: {
      ran: render.ran,
      error: render.error ?? null,
      shots: render.shots.map((s) => ({
        canvas: s.canvas,
        artboard: s.artboard,
        blank: s.stats?.blank ?? null,
        exit: s.exit,
      })),
    },
    changed: code.changed,
    hooks: {
      events: code.hooklog.length,
      denies: code.hooklog
        .filter((h) => h.decision === 'deny')
        .map((h) => `${h.code}${h.agent ? ` (${h.agent})` : ''}`),
      blocks: code.hooklog
        .filter((h) => h.decision === 'block')
        .map(
          (h) =>
            `${h.event}:${(h.codes ?? [h.code ?? ''].filter(Boolean)).join(',') || `${h.problems ?? 0}p/${h.missing ?? 0}m`}`
        ),
      errors: code.hooklog
        .filter((h) => h.decision === 'error')
        .map((h) => h.error)
        .slice(0, 3),
      ms: Object.fromEntries(
        Object.entries(hookMs).map(([k, v]) => [
          k,
          { n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95), max: Math.max(...v) },
        ])
      ),
      checkMs: code.hooklog.filter((h) => typeof h.checkMs === 'number').map((h) => h.checkMs),
    },
    harnessFailure,
    finalText: tr.finalText.slice(0, 3000),
  };
  writeFileSync(join(trialDir, 'grade.json'), `${JSON.stringify(g, null, 2)}\n`);
  return g;
}

const readSafe = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : null;
};

async function trial(taskId, topology, n) {
  const task = taskById(taskId);
  const fx = fixtureProject(task.fixture);
  if (!fx) {
    console.log(`skip ${taskId}.${topology}: fixture ${task.fixture} unavailable on this Mac`);
    return null;
  }
  const trialDir = join(OUT, 'trials', `${taskId}.${topology}.${n}`);
  rmSync(trialDir, { recursive: true, force: true });
  mkdirSync(trialDir, { recursive: true });
  const project = join(trialDir, 'project');
  cloneFixture(fx.project, project);
  console.log(`▶ ${taskId}.${topology}.${n} (${task.fixture}) — ${task.prompt.slice(0, 70)}`);
  const run = await runAgent(task, topology, trialDir, project);
  serverDown(project);
  const g = await gradeTrial(trialDir, task, topology, run);
  const m = g.metrics ?? {};
  console.log(
    `■ ${taskId}.${topology}.${n}: inv ${g.invPass ? 'PASS' : 'FAIL'} · qual ${g.qualPass ? 'PASS' : 'FAIL'} · ${((run.wallMs ?? 0) / 1000).toFixed(0)} s · ${(m.tokens ?? 0).toLocaleString()} tok · $${(m.costUsd ?? 0).toFixed(2)} · agents ${m.subagents ?? 0}${g.harnessFailure ? ' · HARNESS FAILURE' : ''}`
  );
  for (const [k, v] of Object.entries(g.invariants))
    if (!v.pass) console.log(`    ✗ inv ${k}: ${v.why}`);
  for (const [k, v] of Object.entries(g.quality))
    if (!v.pass) console.log(`    · q ${k}: ${v.why}`);
  return g;
}

async function pair(taskId, n) {
  const [a, b] = await Promise.all([trial(taskId, 'A', n), trial(taskId, 'B', n)]);
  return [a, b];
}

async function suite() {
  const sel = opt('tasks', 'pilot');
  const ids =
    sel === 'pilot'
      ? TASKS.filter((t) => t.pilot).map((t) => t.id)
      : sel === 'all'
        ? TASKS.map((t) => t.id)
        : sel.split(',');
  const trials = Number(opt('trials', '1'));
  const start = Number(opt('first-trial', '1'));
  const lane = !flag('no-lane');
  for (let n = start; n < start + trials; n++) {
    for (const id of ids) {
      if (
        flag('skip-done') &&
        existsSync(join(OUT, 'trials', `${id}.A.${n}`, 'grade.json')) &&
        existsSync(join(OUT, 'trials', `${id}.B.${n}`, 'grade.json'))
      )
        continue;
      if (lane) {
        const r = spawnSync(
          join(REPO, 'scripts', 'v2-test-lane.sh'),
          [
            '--wait',
            '3600',
            '--',
            'bun',
            join(HERE, 'run.mjs'),
            'pair',
            '--task',
            id,
            '--trial',
            String(n),
            ...passthrough(),
          ],
          { stdio: 'inherit' }
        );
        if (r.status === 75) console.log(`lane busy for ${id}; skipped`);
        // Leave the lane free for a moment so other lane users waiting on it get their turn.
        await new Promise((res) => setTimeout(res, Number(opt('gap-s', '30')) * 1000));
      } else {
        await pair(id, n);
      }
    }
  }
  report();
}

function passthrough() {
  const keep = [
    'out',
    'model',
    'effort',
    'budget-usd',
    'timeout-min',
    'hooks',
    'judge',
    'judge-model',
    'render',
  ];
  return keep.flatMap((k) => (opt(k) !== undefined ? [`--${k}`, opt(k)] : []));
}

function report() {
  const dir = join(OUT, 'trials');
  if (!existsSync(dir)) return console.log('no trials yet');
  const grades = readdirSync(dir)
    .filter((d) => !d.endsWith('.0')) // trial 0 = ad-hoc smoke runs, never counted
    .map((d) => readSafe(join(dir, d, 'grade.json')))
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const { summarize, markdown } = REPORT;
  const s = summarize(grades);
  writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify(s, null, 2)}\n`);
  writeFileSync(join(OUT, 'summary.md'), markdown(s));
  console.log(markdown(s));
}

const REPORT = await import('./lib/report.mjs');

async function smoke() {
  const { runSmoke } = await import('./lib/smoke.mjs');
  const ok = await runSmoke({ out: join(OUT, 'smoke') });
  process.exit(ok ? 0 : 1);
}

const commands = {
  fixtures: async () => {
    for (const name of (opt('names', '') || 'app5,marketing21,board300,video,multids,busy').split(
      ','
    )) {
      const fx = fixtureProject(name);
      console.log(name, fx ? fx.project : 'unavailable');
    }
  },
  trial: () => trial(opt('task'), opt('topology', 'A'), Number(opt('trial', '1'))),
  pair: () => pair(opt('task'), Number(opt('trial', '1'))),
  suite,
  grade: async () => {
    const d = opt('dir');
    const [id, topo] = d.split('/').pop().split('.');
    const prev = JSON.parse(readSafe(join(d, 'grade.json')) || '{}');
    const g = await gradeTrial(
      d,
      taskById(id),
      topo,
      prev.run ?? null,
      flag('rejudge') ? null : (prev.judge ?? null)
    );
    console.log(
      JSON.stringify(
        { invPass: g.invPass, qualPass: g.qualPass, invariants: g.invariants, quality: g.quality },
        null,
        2
      )
    );
  },
  // Re-grade every finished trial with the current graders (judge verdicts reused unless --rejudge).
  regrade: async () => {
    const dir = join(OUT, 'trials');
    for (const d of readdirSync(dir).sort()) {
      const p = join(dir, d);
      if (!existsSync(join(p, 'grade.json'))) continue;
      const [id, topo] = d.split('.');
      const prev = JSON.parse(readSafe(join(p, 'grade.json')));
      const rejudge =
        flag('rejudge') ||
        (opt('rejudge-tasks', '') || '').split(',').includes(id) ||
        /^judge failed/.test(prev.judge?.why ?? '');
      const g = await gradeTrial(
        p,
        taskById(id),
        topo,
        prev.run ?? null,
        rejudge ? null : (prev.judge ?? null)
      );
      console.log(
        `${d}: inv ${g.invPass ? 'PASS' : 'FAIL'} · qual ${g.qualPass ? 'PASS' : 'FAIL'}${Object.entries(
          g.invariants
        )
          .filter(([, v]) => !v.pass)
          .map(([k, v]) => ` · ✗ ${k}: ${v.why}`)
          .join('')}`
      );
    }
    report();
  },
  report: async () => report(),
  smoke,
};
if (!commands[cmd]) {
  console.error('usage: run.mjs fixtures|trial|pair|suite|grade|report|smoke …  (see the header)');
  process.exit(2);
}
await commands[cmd]();
