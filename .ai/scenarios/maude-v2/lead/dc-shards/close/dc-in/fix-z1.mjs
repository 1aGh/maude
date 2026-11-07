// z1 ran before 8a69f1cfc: a stale seed it could not walk to is not redone (what the crawler now records itself)
import { readFileSync, writeFileSync } from 'node:fs';
const f = process.argv[2];
const j = JSON.parse(readFileSync(f, 'utf8'));
const failed = new Set(
  j.results
    .filter((r) => r.effect === 'unreachable' && /could not be walked to again/.test(r.note ?? ''))
    .map((r) => `${r.mode}|${r.shell}|${r.surface}`)
);
const before = j.redone.length;
j.redone = j.redone.filter((r) => !failed.has(`${r.mode}|${r.shell}|${r.surface}`));
writeFileSync(f, JSON.stringify(j, null, 2));
console.log(`redone ${before} -> ${j.redone.length}`);
