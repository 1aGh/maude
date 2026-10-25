#!/usr/bin/env bun
// agent-evals/run.mjs — the V2-1.18 agent eval, ported to the SHIPPED build (V2-8.16b): topology A (one
// writer + skills) vs B (A + helper sub-agents), on fixture canvases, headless through
// `claude -p --plugin-dir plugins/design` — the released design plugin's own hooks, the real
// `maude design check|runs|screenshot` verbs and a throwaway studio per trial (lib/trial.mjs). NOT a CI gate.
//
//   bun apps/studio/test/agent-evals/run.mjs preflight                                       claude signed in? (no model turn)
//   bun apps/studio/test/agent-evals/run.mjs fixtures [--out DIR]
//   bun apps/studio/test/agent-evals/run.mjs trial  --task e1 --topology A [--trial 1] [--out DIR]
//   bun apps/studio/test/agent-evals/run.mjs pair   --task e1 [--trial 1] [--out DIR]       A ∥ B, symmetric load
//   bun apps/studio/test/agent-evals/run.mjs suite  --tasks pilot|all|e1,b2 [--topology A] [--trials 3] [--out DIR] [--no-lane] [--skip-done]
//   bun apps/studio/test/agent-evals/run.mjs dry    [--tasks e1,e8,x2,x3] [--out DIR]       scripted agent, REAL hooks/studio/registry; no model
//   bun apps/studio/test/agent-evals/run.mjs grade  --dir <trial dir>                        re-grade a finished trial
//   bun apps/studio/test/agent-evals/run.mjs report [--out DIR]
//   bun apps/studio/test/agent-evals/run.mjs smoke                                            no model: fixtures + graders
//
// Options: --model claude-opus-5-5 · --effort high · --budget-usd 6 (per trial) · --timeout-min 25 ·
//          --judge on|off · --judge-model sonnet · --render on|off · --rules on|off · --no-preflight
// Outputs go to --out (default $TMPDIR/maude-agent-evals/<date>/ — never inside the repo, never committed).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildStudioBrief } from '../../acp/bootstrap-brief.ts';
import { agentEnv } from './lib/agentenv.mjs';
import { DRY } from './lib/dry-scripts.mjs';
import { runFakeAgent } from './lib/fake-agent.mjs';
import { buildFixture, REPO } from './lib/fixtures.mjs';
import { gradeCode } from './lib/grade.mjs';
import { judge } from './lib/judge.mjs';
import { DESIGN_PLUGIN, HERE } from './lib/paths.mjs';
import { gitDiff, renderCheck, renderTargets, serverDown } from './lib/render.mjs';
import { readTranscript } from './lib/transcript.mjs';
import { startTrial, studioEnv } from './lib/trial.mjs';

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
const JUDGE = opt('judge', 'on') === 'on';
const RENDER = opt('render', 'on') === 'on';
const RULES = opt('rules', 'on') === 'on';
const JUDGE_MODEL = opt('judge-model', 'sonnet');

const TASKS = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8')).tasks;
const taskById = (id) => {
  const t = TASKS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown task ${id}`);
  return t;
};

// The model process keeps the person's HOME (its login lives there); everything the studio side runs
// (studio, the hooks' studio calls, check, runs, screenshots) gets the trial's throwaway one (lib/trial.mjs).
const liveEnv = (trialDir) => agentEnv(process.env, trialDir);

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
  // What the AI chat carries (the real studio brief), then — unless `--rules off` — the eval's task rules
  // (topologies/contract.md: what the skills and hooks teach, spelt out as the Phase 1 pilot had them, so the
  // new run compares with it), then the topology.
  const sys = [
    buildStudioBrief({
      designRel: '.design',
      projectLabel: 'eval project',
      commandsAvailable: true,
    }),
    ...(RULES ? [readFileSync(join(HERE, 'topologies', 'contract.md'), 'utf8')] : []),
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
    DESIGN_PLUGIN,
    '--include-hook-events',
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
  if (topology === 'B') args.push('--plugin-dir', join(HERE, 'topologies', 'b', 'plugin'));
  return args;
}

function cloneFixture(src, dst) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(join(dst, '..'), { recursive: true });
  const r = spawnSync('cp', ['-cR', src, dst]);
  if (r.status !== 0) spawnSync('cp', ['-R', src, dst]);
}

async function runAgent(task, topology, trialDir, project) {
  // (--dry never gets here: trial() hands the scripted agent the same trial instead)
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
    env: liveEnv(trialDir),
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

async function gradeTrial(
  trialDir,
  task,
  topology,
  run,
  prevJudge = null,
  live = null,
  dry = false
) {
  const project = join(trialDir, 'project');
  const tr = readTranscript(join(trialDir, 'transcript.jsonl'));
  const fx = JSON.parse(
    readFileSync(join(OUT, 'fixtures', task.fixture, `${task.fixture}.manifest.json`), 'utf8')
  );
  // `live` = the trial's own studio (lib/trial.mjs): its registry answer, taken before it stops, is the
  // evidence the hold was still in force; a re-grade of a finished trial has none.
  const registry = live ? { view: live.view() } : null;
  const code = gradeCode({ task, project, transcript: tr, manifest: fx, registry });
  let render = { ran: false, shots: [] };
  // a dry run never calls a model, so no judge; screenshots only when asked for (--render on)
  if (dry ? opt('render', 'off') === 'on' : RENDER) {
    try {
      render = renderCheck({
        cli: CLI,
        project,
        trialDir,
        targets: renderTargets(task, code, project),
        env: live?.env ?? null,
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
  else if (JUDGE && task.rubric && !dry)
    verdict = judge({
      task,
      project,
      finalText: tr.finalText,
      diff: gitDiff(project),
      shots: render.shots,
      model: JUDGE_MODEL,
      env: liveEnv(trialDir),
    });
  if (verdict) {
    code.quality.judge = {
      pass: verdict.verdict === 'pass',
      why: `${verdict.verdict} (${verdict.score ?? '?'}): ${verdict.why}`,
      unknown: verdict.verdict === 'unknown',
    };
  }
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
  // a busy fixture whose hold vanished from the registry measured nothing: re-run, don't grade
  const holdLost = code.invariants['hold-in-force']?.pass === false;
  const harnessFailure =
    holdLost ||
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
    runState: code.runState,
    hooks: {
      events: code.hooklog.length,
      denies: code.hooklog
        .filter((h) => h.decision === 'deny')
        .map((h) => `${h.code}${h.agent ? ` (${h.agent})` : ''}`),
      blocks: code.hooklog
        .filter((h) => h.decision === 'block')
        .map((h) => `${h.event}:${h.code ?? ''}`),
      errors: code.hooklog
        .filter((h) => h.decision === 'error')
        .map((h) => h.error)
        .slice(0, 3),
      // the released hooks keep no latency log; their budget is pinned by their own tests
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

/**
 * One trial: clone the fixture, boot the trial's own studio (lib/trial.mjs), make the fixture's world real
 * (the busy artboard is held through the registry), run the agent — `claude -p` with the released plugin, or,
 * with `opts.script`, the scripted stand-in (lib/fake-agent.mjs) — grade, and ALWAYS stop the studio.
 */
async function trial(taskId, topology, n, opts = {}) {
  const task = taskById(taskId);
  const fx = fixtureProject(task.fixture);
  if (!fx) {
    console.log(`skip ${taskId}.${topology}: fixture ${task.fixture} unavailable on this Mac`);
    return null;
  }
  if (!opts.script && !flag('no-preflight')) preflight();
  const label = opts.label ?? `${taskId}.${topology}.${n}`;
  const trialDir = join(OUT, opts.script ? 'dry' : 'trials', label);
  rmSync(trialDir, { recursive: true, force: true });
  mkdirSync(trialDir, { recursive: true });
  const project = join(trialDir, 'project');
  cloneFixture(fx.project, project);
  console.log(`▶ ${label} (${task.fixture}) — ${task.prompt.slice(0, 70)}`);
  let live = null;
  let run;
  let g;
  try {
    live = await startTrial(project, trialDir, fx.manifest);
    run = opts.script
      ? await runFakeAgent({
          script: opts.script(trialDir, project, fx.manifest),
          prompt: task.prompt,
          project,
          trialDir,
          env: agentEnv(studioEnv(trialDir), trialDir),
        })
      : await runAgent(task, topology, trialDir, project);
    g = await gradeTrial(trialDir, task, topology, run, null, live, !!opts.script);
  } finally {
    await live?.stop();
    serverDown(project);
  }
  const m = g.metrics ?? {};
  console.log(
    `■ ${label}: inv ${g.invPass ? 'PASS' : 'FAIL'} · qual ${g.qualPass ? 'PASS' : 'FAIL'} · ${((run.wallMs ?? 0) / 1000).toFixed(0)} s · ${(m.tokens ?? 0).toLocaleString()} tok · $${(m.costUsd ?? 0).toFixed(2)} · agents ${m.subagents ?? 0}${g.harnessFailure ? ' · HARNESS FAILURE' : ''}`
  );
  for (const [k, v] of Object.entries(g.invariants))
    if (!v.pass) console.log(`    ✗ inv ${k}: ${v.why}`);
  for (const [k, v] of Object.entries(g.quality))
    if (!v.pass) console.log(`    · q ${k}: ${v.why}`);
  return g;
}

/** `claude auth status` — a local read, no model turn. Exits 2 with a plain message when not signed in. */
function preflight() {
  const r = spawnSync('claude', ['auth', 'status', '--json'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  let st = null;
  try {
    st = JSON.parse(r.stdout);
  } catch {}
  if (r.error?.code === 'ENOENT')
    fail('preflight: `claude` is not on PATH — install Claude Code first.');
  if (!st?.loggedIn)
    fail(
      'preflight: `claude` is not signed in. Run `claude auth login`, then start the eval again. Nothing was run, nothing was spent.'
    );
  console.log(
    `preflight: claude signed in (${st.authMethod ?? '?'}${st.subscriptionType ? `, ${st.subscriptionType}` : ''}) — no model turn was made`
  );
}
function fail(msg) {
  console.error(msg);
  process.exit(2);
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
  // `--topology A` (or B): one side only, one `trial` per slot instead of an A ∥ B `pair`.
  const topo = opt('topology', 'A,B').toUpperCase().split(',');
  if (!topo.every((x) => x === 'A' || x === 'B')) fail('--topology is A, B or A,B');
  if (!flag('no-preflight')) preflight();
  for (let n = start; n < start + trials; n++) {
    for (const id of ids) {
      if (
        flag('skip-done') &&
        topo.every((t) => existsSync(join(OUT, 'trials', `${id}.${t}.${n}`, 'grade.json')))
      )
        continue;
      const verb = topo.length === 1 ? ['trial', '--topology', topo[0]] : ['pair'];
      if (lane) {
        const r = spawnSync(
          join(REPO, 'scripts', 'v2-test-lane.sh'),
          [
            '--wait',
            '3600',
            '--max',
            '3600',
            '--',
            'bun',
            join(HERE, 'run.mjs'),
            ...verb,
            '--task',
            id,
            '--trial',
            String(n),
            '--no-preflight',
            ...passthrough(),
          ],
          { stdio: 'inherit' }
        );
        if (r.status === 75) console.log(`lane busy for ${id}; skipped`);
        // Leave the lane free for a moment so other lane users waiting on it get their turn.
        await new Promise((res) => setTimeout(res, Number(opt('gap-s', '30')) * 1000));
      } else if (topo.length === 1) {
        await trial(id, topo[0], n);
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
    'judge',
    'rules',
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

/** The dry run: a scripted agent through the REAL hooks, studio and registry; every fault must flip its grader. */
async function dry() {
  // Belt and braces: nothing in this process may reach the real `claude` (no model call, no spend) —
  // a stub that answers "signed out" goes first on PATH for the whole run.
  const { stubClaudeEnv } = await import('../../../../scripts/lib/stub-claude.mjs');
  const stubHome = join(OUT, 'dry-stub');
  mkdirSync(stubHome, { recursive: true });
  process.env.PATH = stubClaudeEnv(stubHome).PATH;
  const { runDry } = await import('./lib/dry.mjs');
  const ok = await runDry({
    out: OUT,
    tasks: (opt('tasks', '') || Object.keys(DRY).join(',')).split(','),
    trial,
    log: console.log,
  });
  process.exit(ok ? 0 : 1);
}

const commands = {
  preflight: async () => preflight(),
  dry,
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
  console.error(
    'usage: run.mjs preflight|fixtures|trial|pair|suite|dry|grade|report|smoke …  (see the header)'
  );
  process.exit(2);
}
await commands[cmd]();
