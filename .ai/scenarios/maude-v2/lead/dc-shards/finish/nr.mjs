import { readFileSync } from 'node:fs';
import { mergeShards } from '../scripts/v2-verify/dead-controls/resume.mjs';
import { explain } from '../scripts/v2-verify/dead-controls/explained.mjs';
const files = process.argv.slice(2);
const m = mergeShards(files.map((f) => JSON.parse(readFileSync(f, 'utf8'))));
const un = m.results.filter((r) => r.effect === 'unreachable' && !explain(r, m.results));
const c = {};
for (const r of un) {
  const k = `${r.mode}|${r.note.replace(/^a resumed state could not be walked to again: --replay: /, '').replace(/\(there:.*/s, '').slice(0, 100)}`;
  (c[k] ??= []).push(r.surface.split(' › ').slice(-2).join(' › '));
}
console.log(un.length);
for (const [k, v] of Object.entries(c)) console.log(v.length, k, '\n   ', v.slice(0, 3).join(' ;; '));
