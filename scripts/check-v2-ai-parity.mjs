#!/usr/bin/env node
// Maude v2 AI-parity coverage (V2-8.16; contract V2-1.11 §5.7; the gate behind scripts/v2-gates.mjs
// `V2-8.16` and the phase-8 line of scripts/v2-done.sh).
//
//   node scripts/check-v2-ai-parity.mjs            audit; exit 0 only at 100 %
//   node scripts/check-v2-ai-parity.mjs --json     the audit as JSON
//   node scripts/check-v2-ai-parity.mjs --deep     also run `maude design <verb> --help` for every
//                                                  design verb an action names (slow; the unit test
//                                                  test/ai-parity-coverage.test.ts does the same)
//
// "100 %" means every registered action (kind !== 'place') has ONE path an agent can really use:
//   file   the action's change is a edit of a documented file (format + schema + a skill section)
//   cli    a `maude` verb that exists in the tier table, is listed by `maude design help`, and whose
//          tier is NOT `human` (a verb only people at a terminal may run is not an agent path)
//   human  a recorded reason: `because` is a closed HumanReason (actions/types.ts, each with its
//          one-line why) that cites a decision in actions.parity.json; the count stays <=
//          humanMax. A per-action `note` is optional.
// and no action is `pending` (pendingMax is 0, §5.7 rule 2). The generated manifest must equal the
// registry (gen-actions --check), so a stale file cannot hide a gap.
// Exit 0 = 100 %; 1 = gaps (printed); 2 = could not run.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = join(ROOT, 'apps/studio');
const args = process.argv.slice(2);

/** Every gap found, as `{ id, why }`. */
export function auditParity({ actions, agentPaths, verbs, verbTier, parity, listedVerbs }) {
  const gaps = [];
  const gap = (id, why) => gaps.push({ id, why });
  const decisions = parity.humanDecisions ?? {};
  let humans = 0;
  const byReason = {};

  for (const def of actions) {
    if (def.kind === 'place') continue;
    const ai = agentPaths[def.id];
    if (!ai) {
      gap(def.id, 'no entry in actions/agents.ts');
      continue;
    }
    if (!ai.effect) gap(def.id, 'no effect');
    const a = ai.agent;
    if (!a) {
      gap(def.id, 'no agent path');
      continue;
    }
    if (a.path === 'pending') {
      gap(def.id, `pending (${a.package}) — pendingMax is 0`);
    } else if (a.path === 'human') {
      humans++;
      const because = a.because;
      if (!decisions[because] || !/^decision:maude\//.test(decisions[because]))
        gap(def.id, `human-only reason "${because}" cites no decision in actions.parity.json`);
      // the reason category (closed list in actions/types.ts, each with a one-line why and a
      // decision) is the recorded reason; a per-action `note` is optional colour on top of it
      if (!a.note) byReason[because] = (byReason[because] ?? 0) + 1;
    } else if (a.path === 'cli') {
      const words = a.verb.replace(/^maude /, '').split(' ');
      const design = words[0] === 'design';
      const rest = words.slice(design ? 1 : 0).filter((w) => !/^[-<]/.test(w));
      // longest match first: a sub-verb entry (`kg ingest`) before its verb (`kg`)
      const hit =
        verbs.find(
          (v) => v.scope === (design ? 'design' : 'top') && v.verb === rest.slice(0, 2).join(' ')
        ) ?? verbs.find((v) => v.scope === (design ? 'design' : 'top') && v.verb === rest[0]);
      if (!hit) gap(def.id, `cli verb "${a.verb}" is not in the tier table (actions/verbs.ts)`);
      else if (verbTier(hit) === 'human')
        gap(def.id, `cli verb "${a.verb}" is human-tier — not an agent path`);
      if (design && rest[0] && listedVerbs && !listedVerbs.has(rest[0]))
        gap(def.id, `cli verb "${a.verb}" is not listed by \`maude design help\``);
    } else if (a.path === 'file') {
      const [plugin, tail] = String(a.skill).split(':');
      const skill = (tail ?? '').split('#')[0];
      if (!existsSync(join(ROOT, 'plugins', plugin ?? '', 'skills', skill, 'SKILL.md')))
        gap(def.id, `file path names skill "${a.skill}", which does not exist`);
      if (!a.how || a.how.length < 8) gap(def.id, 'file path without a how');
    } else {
      gap(def.id, `unknown agent path "${a.path}"`);
    }
  }
  if (humans > parity.humanMax)
    gap('(human count)', `${humans} human-only actions exceed humanMax ${parity.humanMax}`);
  return { gaps, humans, humanReasonOnly: byReason };
}

function main() {
  const gen = spawnSync(process.execPath, [join(ROOT, 'scripts/gen-actions.mjs'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (gen.status !== 0) {
    console.error(`FAIL generated action manifest is stale (node scripts/gen-actions.mjs)`);
    process.exit(1);
  }
  return Promise.all([
    import('../apps/studio/actions/index.ts'),
    import('../apps/studio/actions/agents.ts'),
    import('../apps/studio/actions/verbs.ts'),
  ]).then(([{ ACTIONS }, { AGENT_PATHS }, { MAUDE_VERBS, verbTier }]) => {
    const parity = JSON.parse(readFileSync(join(STUDIO, 'actions.parity.json'), 'utf8'));
    const env = {
      ...process.env,
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_NO_UPDATE_CHECK: '1',
    };
    const maude = (a) =>
      spawnSync('node', [join(ROOT, 'cli/bin/maude.mjs'), ...a], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 30_000,
        env,
      });
    const help = maude(['design', 'help']);
    if (help.status !== 0) {
      console.error('could not run `maude design help`');
      process.exit(2);
    }
    const listedVerbs = new Set(help.stdout.split(/[\s·]+/).filter(Boolean));
    const out = auditParity({
      actions: ACTIONS,
      agentPaths: AGENT_PATHS,
      verbs: MAUDE_VERBS,
      verbTier,
      parity,
      listedVerbs,
    });
    if (args.includes('--deep')) {
      const seen = new Set();
      for (const def of ACTIONS) {
        const a = AGENT_PATHS[def.id]?.agent;
        if (a?.path !== 'cli') continue;
        const w = a.verb.replace(/^maude /, '').split(' ');
        if (w[0] !== 'design' || !w[1] || seen.has(w[1])) continue;
        seen.add(w[1]);
        if (maude(['design', w[1], '--help']).status !== 0)
          out.gaps.push({ id: def.id, why: `\`maude design ${w[1]} --help\` does not exit 0` });
      }
    }
    const total = ACTIONS.filter((a) => a.kind !== 'place').length;
    const covered = total - new Set(out.gaps.map((g) => g.id)).size;
    if (args.includes('--json')) console.log(JSON.stringify({ total, covered, ...out }, null, 2));
    else {
      for (const g of out.gaps) console.log(`FAIL ${g.id}: ${g.why}`);
      console.log(
        `AI parity: ${covered}/${total} actions have an agent path (${out.humans} human-only)${out.gaps.length ? ` — ${out.gaps.length} gap(s)` : ''}`
      );
    }
    process.exit(out.gaps.length ? 1 : 0);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
