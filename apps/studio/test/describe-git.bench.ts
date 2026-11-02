// V2-1.9 §6 corpus C1 for the TSX lane: every modification of a `.design/**` canvas in this repo's git
// history, described pair by pair. No ground truth (history has none) — it measures the grade mix, the
// canvas-wide fallback rate, the time, and prints a sample for reading against the raw diff.
//   cd apps/studio && bun run test/describe-git.bench.ts [--sample 25] [--max 120]

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { type Change, describeChanges } from '../history/describe';
import { percentile } from './fixtures/describe-corpus/measure';

const repo = join(import.meta.dir, '..', '..', '..');
const git = (args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const arg = (name: string, d: number): number => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};

const files = git(['ls-files', '.design/**/*.tsx'])
  .split('\n')
  .filter((f) => f && !f.includes('/system/') && !/\/_[^/]*$/.test(f));
const pairs: Array<{ file: string; a: string; b: string; sha: string }> = [];
for (const f of files) {
  const shas = git(['log', '--format=%H', '--', f]).split('\n').filter(Boolean);
  for (let i = 0; i < shas.length - 1; i++) {
    try {
      const b = git(['show', `${shas[i]}:${f}`]);
      const a = git(['show', `${shas[i + 1]}:${f}`]);
      if (a !== b) pairs.push({ file: f, a, b, sha: (shas[i] as string).slice(0, 8) });
    } catch {
      // a rename or deletion boundary
    }
  }
}
const max = arg('--max', 400);
const used = pairs.slice(0, max);
const ms: number[] = [];
let lines = 0;
const grades = { W1: 0, W2: 0, F: 0 };
let canvasWide = 0;
let described = 0;
let none = 0;
const sample: Array<{ file: string; sha: string; changes: Change[] }> = [];
for (const p of used) {
  const r = describeChanges(p.file, { tsx: p.a }, { tsx: p.b });
  ms.push(r.ms);
  if (!r.changes.length) none++;
  else described++;
  for (const c of r.changes) {
    lines++;
    grades[c.grade]++;
  }
  if (r.changes.some((c) => c.kind === 'canvas')) canvasWide++;
  if (r.changes.length) sample.push({ file: p.file, sha: p.sha, changes: r.changes });
}
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '-');
console.log(
  `pairs: ${used.length} (of ${pairs.length}), described: ${described}, no visible change: ${none}`
);
console.log(
  `lines: ${lines} · W1 ${pct(grades.W1, lines)} · W2 ${pct(grades.W2, lines)} · F ${pct(grades.F, lines)}`
);
console.log(`versions with "Changed this canvas": ${pct(canvasWide, described)}`);
console.log(
  `describe ms: p50 ${percentile(ms, 50).toFixed(1)} · p95 ${percentile(ms, 95).toFixed(1)} · max ${Math.max(...ms).toFixed(1)}`
);
const n = arg('--sample', 0);
for (const s of sample.slice(0, n)) {
  console.log(`\n${s.file} @ ${s.sha}`);
  for (const c of s.changes.slice(0, 6))
    console.log(`  [${c.grade}/${c.kind}] ${c.artboards.join(',') || '-'} :: ${c.words}`);
  if (s.changes.length > 6) console.log(`  … ${s.changes.length - 6} more`);
}
