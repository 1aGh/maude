#!/usr/bin/env node
// Maude v2 reconciliation (plan "Memory and task discipline" 4 + 8; wired into v2-done.sh by V2-2.0b).
//
//   node scripts/v2-reconcile.mjs [--phase <n>] [--require-tasklist] [--doctor] [--json]
//
// 1. Every `kg: <kind>:<name>` reference in the plan's Progress log resolves in the graph.
// 2. Ledger ⇔ Progress log: every task row marked `verified` has a Progress-log line
//    "· <id> · done · <sha>", and every such done line has its ledger row verified with that commit.
// 3. (--phase n) every task of phase n is verified — the phase-gate equality check.
// 4. Native task list ⇔ ledger. A script cannot read the native list, so at every phase gate the
//    lead writes a snapshot of it to .ai/scenarios/maude-v2/tasklist.json
//    ({ taken, tasks: [{ id, status }] }, status = the native pending|in_progress|completed).
//    Every V2 task must appear; `completed` ⇔ ledger `verified`. --require-tasklist (the done
//    script) makes a missing snapshot a failure; without it a missing snapshot is only noted.
// 5. (--doctor) `maude kg doctor` reports the graph active.
// Exit 0 = consistent; 1 = drift (printed); 2 = could not run.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const phaseArg = args.includes('--phase') ? Number(args[args.indexOf('--phase') + 1]) : null;
const JSON_OUT = args.includes('--json');
const REQUIRE_TASKLIST = args.includes('--require-tasklist');
const DOCTOR = args.includes('--doctor');
const TASKLIST = join(ROOT, '.ai/scenarios/maude-v2/tasklist.json');

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

// 4 · native task list snapshot ⇔ ledger
const notes = [];
if (existsSync(TASKLIST)) {
  const snap = JSON.parse(readFileSync(TASKLIST, 'utf8'));
  const native = new Map(
    (snap.tasks ?? []).filter((t) => /^V2-\d+\.\d+[a-z]?$/.test(t.id)).map((t) => [t.id, t.status])
  );
  for (const r of tasks) {
    const st = native.get(r.id);
    if (st === undefined) problems.push(`${r.id}: missing from the native task-list snapshot`);
    else if ((st === 'completed') !== (r.status === 'verified'))
      problems.push(`${r.id}: native list says ${st}, ledger says ${r.status}`);
  }
  for (const id of native.keys())
    if (!tasks.some((r) => r.id === id))
      problems.push(`${id}: in the native list but not in the ledger`);
} else if (REQUIRE_TASKLIST) {
  problems.push('no native task-list snapshot (.ai/scenarios/maude-v2/tasklist.json)');
} else {
  notes.push('native task-list snapshot not written yet — compare by hand');
}

// 5 · kg doctor
if (DOCTOR) {
  const d = spawnSync('maude', ['kg', 'doctor'], { encoding: 'utf8' });
  if (d.status !== 0 || !/active\s+✓/.test(d.stdout))
    problems.push('maude kg doctor: graph not healthy/active');
}

const verified = tasks.filter((r) => r.status === 'verified').map((r) => r.id);
if (JSON_OUT) {
  console.log(JSON.stringify({ refs: refs.length, verified, phaseOpen, problems, notes }, null, 2));
} else {
  console.log(
    `${refs.length} kg references · ${verified.length} verified tasks · ${problems.length} problem(s)`
  );
  for (const p of problems) console.log(`FAIL ${p}`);
  for (const n of notes) console.log(`note ${n}`);
}
process.exit(problems.length ? 1 : 0);
