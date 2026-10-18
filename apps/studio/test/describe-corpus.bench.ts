// Prints the V2-1.9 §6 C3 table for the TSX lane. Not a test (no `.test.` in the name):
//   cd apps/studio && DESCRIBE_N=6 bun run test/describe-corpus.bench.ts [--all] [--misses]
// `--all` measures every canvas under `.design/`, otherwise the v2 canvases. N = edits per kind per canvas.

import { join } from 'node:path';
import { EDIT_KINDS, listCanvases, measure, percentile } from './fixtures/describe-corpus/measure';

const root = join(import.meta.dir, '..', '..', '..', '.design');
const all = process.argv.includes('--all');
const n = Number(process.env.DESCRIBE_N ?? 6);
const files = listCanvases(root, !all);
const r = measure(files, n);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '-');
console.log(`${all ? 'all' : 'v2'} canvases: ${files.length}, edits per kind per canvas: ${n}`);
console.log('| edit | n | words right | wrong words | wrong artboard | fallback | nothing |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const k of [...EDIT_KINDS, 'all']) {
  const row = k === 'all' ? r.all : r.byKind[k];
  if (!row) continue;
  console.log(
    `| ${k} | ${row.n} | ${pct(row.right, row.n)} | ${pct(row.wrongWords, row.n)} | ${row.wrongArtboard} | ${pct(row.fallback, row.n)} | ${row.nothing} |`
  );
}
console.log(
  `describe ms: p50 ${percentile(r.ms, 50).toFixed(1)} · p95 ${percentile(r.ms, 95).toFixed(1)} · max ${Math.max(...r.ms).toFixed(1)}`
);
if (process.argv.includes('--misses'))
  for (const m of r.misses.slice(0, 60))
    console.log(m.kind, m.verdict, m.canvas.split('/.design/')[1], JSON.stringify(m.words));
