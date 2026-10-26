// reseed.mjs [seedfile]  — rig reset + wipe board + annotate seed (default seed1.json)
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const WT = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-af2a233f610c7fca6';
const SC = '/private/tmp/claude-501/sc';
const run = (c) => execSync(c, { cwd: WT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const seed = process.argv[2] || `${SC}/seed1.json`;
run(`node scripts/v2-verify/s34-rig.mjs reset ${SC}`);
const f = `${SC}/proj/.design/ui-site.annotations.json`;
const b = JSON.parse(fs.readFileSync(f, 'utf8'));
const ids = (b.elements || []).map((e) => e.id);
if (ids.length) {
  fs.writeFileSync(
    `${SC}/wipe.json`,
    JSON.stringify({ ops: ids.map((id) => ({ op: 'delete', id })) })
  );
  console.log(
    run(
      `node cli/bin/maude.mjs design annotate ui/Site.tsx --ops ${SC}/wipe.json --root ${SC}/proj`
    ).slice(0, 200)
  );
}
console.log(
  run(
    `node cli/bin/maude.mjs design annotate ui/Site.tsx --ops ${seed} --rects ${SC}/rects.json --root ${SC}/proj`
  ).slice(0, 300)
);
