#!/usr/bin/env node
// Apply the top-level moves of scripts/v2-split/modules.json in dependency order (leaves
// first), one `move.mjs top` per module. Stops at the first refusal.
//   bun scripts/v2-split/run-top.mjs [--only <module-substring>[,<substring>…]] [--dry-run]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const map = JSON.parse(readFileSync('scripts/v2-split/modules.json', 'utf8'));
const plan = spawnSync('bun', ['scripts/v2-split/plan.mjs', 'apps/studio/client/app.jsx', 'scripts/v2-split/modules.json'], {
  encoding: 'utf8',
}).stdout;
const order = [...plan.matchAll(/^\s*\d+\. (\S+)/gm)].map((m) => m[1]);
const i = process.argv.indexOf('--only');
const only = i >= 0 ? process.argv[i + 1].split(',') : null;
const dry = process.argv.includes('--dry-run');
for (const mod of order) {
  if (only && !only.some((o) => mod.includes(o))) continue;
  const names = map[mod];
  const args = ['scripts/v2-split/move.mjs', 'top', '--file', 'apps/studio/client/app.jsx', '--to', mod, '--names', names.join(',')];
  if (dry) args.push('--dry-run');
  const r = spawnSync('bun', args, { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  if (r.status !== 0) {
    process.stderr.write(r.stderr);
    process.exit(1);
  }
}
