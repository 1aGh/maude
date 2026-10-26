#!/usr/bin/env bun
// agent-journeys/run.mjs — S12.15 agent journeys: one journey JSON, two lanes (terminal · AI chat),
// graded deterministically from what the run left on disk (graders.mjs). Model-driven evidence,
// NOT CI (D14). See README.md.
//
//   bun run.mjs --dry [--journey S1,S5] [--out DIR] [--evidence DIR]   grader self-test, no model
//   bun run.mjs live --lane terminal|acp|both [--journey all|S1,…] [--out DIR] [--model M]
//                    [--budget-usd N] [--timeout-min N]                  needs MAUDE_JOURNEYS_LIVE=1
//   bun run.mjs grade --dir <trial dir> --journey S1                     re-grade a finished trial
//
// Outputs default to $TMPDIR/maude-agent-journeys/<date>/ — never inside the repo (Claude Code
// reads CLAUDE.md from every parent of its cwd; the repo's must not reach the agent under test).

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chatAllowedTools } from '../../acp/bridge.ts';
import { GRADERS, gradeJourney, observe } from './graders.mjs';
import { planAcp, runAcp } from './lanes/acp.mjs';
import {
  harnessEnv,
  prepareProject,
  REPO,
  runLiveSetup,
  shellTap,
  studioDown,
  studioUp,
  writeJson,
} from './lanes/common.mjs';
import { allowRules, answerCard, lintAllow } from './lanes/consent.mjs';
import { planTerminal, runTerminal, shimDir, terminalAllowedTools } from './lanes/terminal.mjs';
import { faultRecipe, plantAll } from './plant.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(`--${name}`);
const OUT = opt(
  'out',
  join(tmpdir(), 'maude-agent-journeys', new Date().toISOString().slice(0, 10))
);

export function loadJourneys(which = 'all') {
  const dir = join(HERE, 'journeys');
  const all = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  if (which === 'all') return all;
  const want = new Set(which.split(','));
  const out = all.filter((j) => want.has(j.id));
  if (out.length !== want.size) throw new Error(`unknown journey in ${which}`);
  return out;
}

/** Shape rules a journey must keep (a typo must fail the self-test, not pass a live run). */
export function lintJourney(j) {
  const why = [];
  if (j.format !== 'maude.agent-journey/1') why.push('format is not maude.agent-journey/1');
  if (
    !Array.isArray(j.turns) ||
    !j.turns.length ||
    j.turns.some((t) => typeof t.say !== 'string' || !t.say)
  )
    why.push('turns[] of {say} is empty');
  const ids = new Set();
  for (const g of j.graders ?? []) {
    if (!GRADERS[g.grader]) why.push(`grader ${g.id}: unknown "${g.grader}"`);
    if (ids.has(g.id)) why.push(`grader id ${g.id} twice`);
    ids.add(g.id);
    if (!j.dry?.faults?.[g.id]) why.push(`grader ${g.id} has no planted fault`);
  }
  for (const k of Object.keys(j.dry?.faults ?? {}))
    if (!ids.has(k)) why.push(`fault for unknown grader ${k}`);
  if (!j.graders?.length) why.push('no graders');
  why.push(...lintAllow(j.allow));
  return why;
}

/** The lane plans are built (no spawn) and carry the shared permission model. */
function checkPlans(j, project) {
  const why = [];
  const env = harnessEnv({ PATH: process.env.PATH }, '/dev/null');
  const t = planTerminal(j, { project, trialDir: join(OUT, '_plan'), env });
  const a = planAcp(j, { project });
  const allow = JSON.stringify([...terminalAllowedTools(project), ...allowRules(j)]);
  if (t.turns.length !== j.turns.length || a.turns.length !== j.turns.length)
    why.push('a lane drops a turn');
  if (!t.turns.every((x) => x.args.includes(join(REPO, 'plugins', 'design'))))
    why.push('terminal: no --plugin-dir plugins/design');
  const allowOf = (args) => {
    const i = args.indexOf('--allowedTools');
    return JSON.stringify(args.slice(i + 1, args.indexOf('--permission-mode')));
  };
  if (!t.turns.every((x) => allowOf(x.args) === allow))
    why.push(
      'terminal: allow list ≠ the chat’s (read boundary + defaults) + the journey allow rules'
    );
  if (t.env.NO_OPEN !== '1' || t.env.MAUDE_NO_AUTOBUILD !== '1' || !t.env.MAUDE_MACHINE_FILE)
    why.push('terminal: env lacks NO_OPEN / MAUDE_NO_AUTOBUILD / MAUDE_MACHINE_FILE');
  if ('ANTHROPIC_API_KEY' in t.env) why.push('terminal: ANTHROPIC_API_KEY reaches the agent');
  if (!a.plugins.some((p) => p.path === join(REPO, 'plugins', 'design')))
    why.push('acp: the design plugin is not injected');
  const o = a.session._meta?.claudeCode?.options ?? {};
  if (JSON.stringify(o.allowedTools) !== JSON.stringify(chatAllowedTools(project, a.plugins)))
    why.push('acp: allow list ≠ the chat’s (read boundary + MAUDE_DEFAULT_ALLOWED_TOOLS)');
  if (JSON.stringify(o.settingSources) !== '["user"]')
    why.push('acp: settingSources is not ["user"]');
  if (!a.brief || a.session._meta?.systemPrompt?.append !== a.brief)
    why.push('acp: the studio brief is not appended');
  // consent: the named prompt-tier verbs get a one-time allow, any other card is refused
  if (JSON.stringify(a.allow) !== JSON.stringify(j.allow ?? []))
    why.push('acp: the plan does not carry the journey allow list');
  const card = (command) => ({
    toolCall: { toolCallId: 't', title: command, rawInput: { command } },
    options: [
      { optionId: 'ok', kind: 'allow_once', name: 'Allow' },
      { optionId: 'always', kind: 'allow_always', name: 'Always' },
      { optionId: 'no', kind: 'reject_once', name: 'Deny' },
    ],
  });
  for (const v of j.allow ?? []) {
    if (answerCard(a.allow, card(`${v} x`)).optionId !== 'ok')
      why.push(`acp: a card for "${v}" is not allowed once`);
  }
  if (answerCard(a.allow, card('maude design trash empty-everything')).allow)
    why.push('acp: a card for a verb the journey does not name was allowed');
  return why;
}

/** --dry: every journey's good state grades green; each grader goes red on its own planted fault. */
export async function runDry({ out = OUT, which = 'all', log = console.log } = {}) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const cacheDir = join(out, '_fixtures');
  const report = [];
  const line = (pass, name, why = '') => {
    report.push({ name, pass, why });
    log(`${pass ? '✓' : '✗'} ${name}${pass ? '' : ` — ${why}`}`);
  };
  for (const j of loadJourneys(which)) {
    const lint = lintJourney(j);
    line(!lint.length, `${j.id} journey shape`, lint.join('; '));
    if (lint.length) continue;
    const grade = (name, ops) => {
      const trialDir = join(out, j.id, name);
      const { project, ctx } = prepareProject(j, trialDir, { cacheDir });
      plantAll(ctx, ops);
      const g = gradeJourney(j, observe({ project, trialDir }));
      writeJson(join(trialDir, 'grade.json'), g);
      rmSync(project, { recursive: true, force: true });
      return g;
    };
    try {
      const plans = checkPlans(j, join(out, j.id, 'plan-project'));
      line(!plans.length, `${j.id} lane plans (terminal + AI chat)`, plans.join('; '));
    } catch (e) {
      line(false, `${j.id} lane plans (terminal + AI chat)`, String(e?.stack ?? e));
    }
    let good;
    try {
      good = grade('good', j.dry.good);
    } catch (e) {
      line(false, `${j.id} good run`, `plant failed: ${e?.message ?? e}`);
      continue;
    }
    line(
      good.pass,
      `${j.id} good run grades green`,
      good.results
        .filter((r) => !r.pass)
        .map((r) => `${r.id}: ${r.why}`)
        .join('; ')
    );
    for (const g of j.graders) {
      let res;
      try {
        res = grade(`fault-${g.id}`, faultRecipe(j.dry.good, j.dry.faults[g.id]));
      } catch (e) {
        line(false, `${j.id} fault ${g.id}`, `plant failed: ${e?.message ?? e}`);
        continue;
      }
      const mine = res.results.find((r) => r.id === g.id);
      const others = res.results.filter((r) => r.id !== g.id && !r.pass).map((r) => r.id);
      line(
        !mine.pass,
        `${j.id} fault ${g.id} → ${g.grader} red${others.length ? ` (also red: ${others.join(', ')})` : ''}`,
        `${g.grader} stayed green on its fault`
      );
    }
  }
  const ok = report.every((r) => r.pass);
  writeJson(join(out, 'dry-results.json'), { at: new Date().toISOString(), ok, checks: report });
  return { ok, report };
}

async function live() {
  if (process.env.MAUDE_JOURNEYS_LIVE !== '1') {
    console.error(
      'live journeys spend real model usage: set MAUDE_JOURNEYS_LIVE=1 (see README.md)'
    );
    process.exit(2);
  }
  const lane = opt('lane', 'both');
  const lanes = lane === 'both' ? ['terminal', 'acp'] : [lane];
  const model = opt('model', 'claude-opus-5-5');
  const budgetUsd = Number(opt('budget-usd', '4'));
  const timeoutMin = Number(opt('timeout-min', '20'));
  const cacheDir = join(OUT, '_fixtures');
  const summary = [];
  for (const j of loadJourneys(opt('journey', 'all'))) {
    for (const l of lanes) {
      const trialDir = join(OUT, j.id, l);
      const { project } = prepareProject(j, trialDir, { cacheDir });
      const env = harnessEnv(process.env);
      Object.assign(process.env, {
        NO_OPEN: env.NO_OPEN,
        MAUDE_NO_AUTOBUILD: env.MAUDE_NO_AUTOBUILD,
        MAUDE_FORCE_SOURCE: '1',
        MAUDE_MACHINE_FILE: env.MAUDE_MACHINE_FILE,
      });
      let turns = [];
      let infra = null;
      let tap = null;
      let held = [];
      try {
        shimDir(trialDir);
        // acp: the studio hosts the chat (lanes/acp.mjs), so the agent's `maude` shim rides the
        // studio's PATH (the terminal lane puts it on the agent's own PATH instead), and its prefs are the trial's own (the plugin injection never reads this
        // Mac's `ownPluginCopy`, and nothing is written to the real prefs)
        if (l === 'acp') {
          env.PATH = `${join(trialDir, 'bin')}:${env.PATH ?? ''}`;
          env.MAUDE_UI_PREFS_PATH = join(trialDir, 'prefs.json');
        }
        const port = studioUp(project, env);
        tap = await shellTap(port, trialDir);
        held = await runLiveSetup(project, j);
        if (l === 'terminal') {
          const plan = planTerminal(j, { project, trialDir, env, model, budgetUsd });
          writeJson(join(trialDir, 'plan.json'), { ...plan, env: undefined });
          turns = await runTerminal(plan, trialDir, { timeoutMin });
        } else {
          const plan = planAcp(j, { project });
          writeJson(join(trialDir, 'plan.json'), {
            ...plan,
            transport: `ws://127.0.0.1:${port}/_ws/acp`,
          });
          turns = await runAcp(plan, project, trialDir, { port, timeoutMin });
        }
      } catch (e) {
        infra = String(e?.message ?? e);
      } finally {
        for (const h of held) await h.end().catch(() => null);
        tap?.close();
        studioDown(project);
        await new Promise((r) => setTimeout(r, 1500));
      }
      const g = gradeJourney(j, observe({ project, trialDir }));
      const harnessFailure =
        !!infra || !turns.length || turns.some((t) => t.ok === false && t.error);
      const rec = {
        journey: j.id,
        lane: l,
        pass: g.pass && !harnessFailure,
        harnessFailure,
        infra,
        turns,
        results: g.results,
      };
      writeJson(join(trialDir, 'grade.json'), rec);
      summary.push(rec);
      console.log(
        `${rec.pass ? '✓' : '✗'} ${j.id} ${l}${harnessFailure ? ` (harness failure: ${infra ?? turns.find((t) => t.error)?.error ?? 'no result'})` : ''}`
      );
      for (const r of g.results) if (!r.pass) console.log(`    ✗ ${r.id}: ${r.why}`);
      // Not signed in: every remaining trial would fail the same way and grade nothing.
      if (turns.some((t) => /not logged in|\/login/i.test(t.error ?? ''))) {
        console.log(
          'stopping: the lane is not signed in (run `claude /login` for this config dir)'
        );
        writeJson(join(OUT, 'live-summary.json'), summary);
        process.exit(3);
      }
    }
  }
  writeJson(join(OUT, 'live-summary.json'), summary);
  process.exit(summary.every((r) => r.pass) ? 0 : 1);
}

function regrade() {
  const dir = opt('dir', null);
  const j = loadJourneys(opt('journey', ''))[0];
  if (!dir || !j) throw new Error('grade --dir <trial dir> --journey <id>');
  const g = gradeJourney(j, observe({ project: join(dir, 'project'), trialDir: dir }));
  console.log(JSON.stringify(g, null, 2));
  process.exit(g.pass ? 0 : 1);
}

if (import.meta.main) {
  if (flag('dry')) {
    const { ok, report } = await runDry({ which: opt('journey', 'all') });
    const ev = opt('evidence', null);
    if (ev) {
      mkdirSync(ev, { recursive: true });
      writeFileSync(
        join(ev, 'dry-results.json'),
        `${JSON.stringify({ at: new Date().toISOString(), ok, checks: report }, null, 2)}\n`
      );
      writeFileSync(
        join(ev, 'dry-results.txt'),
        `${report.map((r) => `${r.pass ? '✓' : '✗'} ${r.name}${r.pass ? '' : ` — ${r.why}`}`).join('\n')}\n`
      );
    }
    console.log(
      `${ok ? 'PASS' : 'FAIL'} — ${report.filter((r) => r.pass).length}/${report.length} checks (${OUT})`
    );
    if (!flag('keep')) rmSync(join(OUT, '_fixtures'), { recursive: true, force: true });
    process.exit(ok ? 0 : 1);
  } else if (argv[0] === 'live') await live();
  else if (argv[0] === 'grade') regrade();
  else {
    console.error(
      'usage: run.mjs --dry | live --lane terminal|acp|both | grade --dir <trial> --journey <id>'
    );
    process.exit(2);
  }
}
