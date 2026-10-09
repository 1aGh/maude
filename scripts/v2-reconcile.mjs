#!/usr/bin/env node
// Maude v2 reconciliation (plan "Memory and task discipline" 4 + 8; wired into v2-done.sh by V2-2.0b).
//
//   node scripts/v2-reconcile.mjs [--phase <n>] [--json]
//
// 1. Every `kg: <kind>:<name>` reference in the plan's Progress log resolves in the graph.
// 2. Ledger ⇔ Progress log: every task row marked `verified` has a Progress-log line
//    "· <id> · done · <sha>", and every such done line has its ledger row verified with that commit.
// 3. (--phase n) every task of phase n is verified — the phase-gate equality check. The native
//    task list cannot be read from a script; the lead compares it with this output at the gate.
// Exit 0 = consistent; 1 = drift (printed); 2 = could not run.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const phaseArg = args.includes('--phase') ? Number(args[args.indexOf('--phase') + 1]) : null;
const JSON_OUT = args.includes('--json');

const plan = readFileSync(join(ROOT, '.ai/plans/feature-maude-v2-redesign.md'), 'utf8');
const log = plan.slice(plan.indexOf('## Progress log'));
const ledger = JSON.parse(readFileSync(join(ROOT, '.ai/scenarios/maude-v2/ledger.json'), 'utf8'));
const problems = [];

// 1 · kg references
const refs = [
  ...new Set([...log.matchAll(/kg: ([a-z]+:[^\s·]+)/g)].map((m) => m[1].replace(/[.,;]$/, ''))),
];
for (const ref of refs) {
  const r = spawnSync('kg', ['resolve', ref], { encoding: 'utf8' });
  let ok = false;
  try {
    ok = JSON.parse(r.stdout).existed === true;
  } catch {
    /* not JSON */
  }
  if (!ok) problems.push(`kg reference does not resolve: ${ref}`);
}

// 2 · ledger ⇔ Progress log (task rows)
const doneLines = new Map(); // id -> sha list
for (const m of log.matchAll(/^\d{4}-\d\d-\d\d · (V2-\d+\.\d+[a-z]?) · done · ([^·]+)·/gm)) {
  const shas = (m[2].match(/\b[0-9a-f]{7,40}\b/g) ?? []).map((s) => s.slice(0, 7));
  doneLines.set(m[1], [...(doneLines.get(m[1]) ?? []), ...shas]);
}
const tasks = ledger.rows.filter((r) => r.kind === 'task' && !r.orphaned);
for (const r of tasks) {
  const line = doneLines.get(r.id);
  if (r.status === 'verified' && !line)
    problems.push(`${r.id}: ledger verified but no "done" line in the Progress log`);
  if (line && r.status !== 'verified')
    problems.push(`${r.id}: Progress log says done but the ledger row is ${r.status}`);
  if (line && r.status === 'verified' && r.commit && !line.includes(String(r.commit).slice(0, 7))) {
    problems.push(
      `${r.id}: ledger commit ${r.commit} is not on its Progress-log done line (${line.join(' ')})`
    );
  }
}

// 3 · phase completeness
let phaseOpen = [];
if (phaseArg !== null) {
  phaseOpen = tasks.filter((r) => r.phase === phaseArg && r.status !== 'verified').map((r) => r.id);
  for (const id of phaseOpen) problems.push(`phase ${phaseArg}: ${id} not verified`);
}

const verified = tasks.filter((r) => r.status === 'verified').map((r) => r.id);
if (JSON_OUT) {
  console.log(JSON.stringify({ refs: refs.length, verified, phaseOpen, problems }, null, 2));
} else {
  console.log(
    `${refs.length} kg references · ${verified.length} verified tasks · ${problems.length} problem(s)`
  );
  for (const p of problems) console.log(`FAIL ${p}`);
}
process.exit(problems.length ? 1 : 0);
