import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const RAW = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a81ec5fb665864bd9/.scr/spec-raw/01';
const OUT = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-ad6307ded82bdaa41/.scr/spec/01';
mkdirSync(OUT, { recursive: true });
for (const id of ['cf-ai-drafting', 'cf-ai-done', 'cf-undo-before', 'cf-undo-ai']) {
  for (const t of ['light', 'dark']) {
    execFileSync('magick', [`${RAW}/${id}-${t}.png`, '-crop', '1440x900+1+1', '+repage', `${OUT}/${id}-${t}.png`]);
  }
}
writeFileSync(`${OUT}/meta.json`, '{}');
const map = {
  '01-create-flow': {
    nn: '01',
    dir: '01',
    ids: Object.fromEntries(['cf-ai-drafting', 'cf-ai-done', 'cf-undo-before', 'cf-undo-ai'].map((id) => [id, { impl: id }])),
  },
};
writeFileSync('/Users/iagh/git/personal/maude/.claude/worktrees/agent-ad6307ded82bdaa41/.scr/pairs-map-c6-01.json', JSON.stringify(map, null, 1));
console.log('ok');
