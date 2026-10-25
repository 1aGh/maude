// agent-evals/lib/dry.mjs — the dry run: for each task a GOOD scripted run (must grade green and leave the
// evidence the shipped hooks and registry leave) and one run per planted FAULT (must flip its grader).
// No model, no network, no spend; a real studio per trial, the released plugin's real hooks.

import { DRY } from './dry-scripts.mjs';

/** → true when every expectation held. `trial` is run.mjs's trial(); `out` is only used for the label. */
export async function runDry({ tasks, trial, log = console.log }) {
  const problems = [];
  const check = (name, found) => {
    log(`${found.length ? '✗' : '✓'} dry ${name}${found.length ? ` — ${found.join('; ')}` : ''}`);
    for (const f of found) problems.push(`${name}: ${f}`);
  };
  for (const id of tasks) {
    const d = DRY[id];
    if (!d) {
      check(`${id}`, [`no dry script (have: ${Object.keys(DRY).join(', ')})`]);
      continue;
    }
    const good = await trial(id, 'A', 0, {
      script: (trialDir, project, manifest) => d.good({ project, trialDir, manifest }),
      label: `${id}.good`,
    });
    check(
      `${id}: a good run grades green on the real state`,
      good ? d.expectGood(good) : ['skipped']
    );
    for (const f of d.faults) {
      const g = await trial(id, 'A', 0, {
        script: (trialDir, project, manifest) => f.script({ project, trialDir, manifest }),
        label: `${id}.fault-${f.name}`,
      });
      check(`${id}: planted fault "${f.name}" flips its grader`, g ? f.expect(g) : ['skipped']);
    }
  }
  log(problems.length ? `\n${problems.length} dry check(s) failed` : '\ndry run: every check held');
  return problems.length === 0;
}
