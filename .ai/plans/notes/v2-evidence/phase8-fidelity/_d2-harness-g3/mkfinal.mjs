// node mkfinal.mjs <tip-sha> — appends the FINAL (stage D2) section to each INDEX.md and the final line to full-size-path.txt
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const R = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a595be579d5cc0243';
const EV = join(R, '.ai/plans/notes/v2-evidence/phase8-fidelity');
const tip = process.argv[2];
const C = [
  ['07', '07-video-editing', '07 Video Editing', ['rows-07-light.jsonl', 'rows-07-dark.jsonl']],
  ['08', '08-artboard-kinds', '08 Artboard Kinds', ['rows-08.jsonl', 'rows-08-light.jsonl', 'rows-08-dark.jsonl']],
  ['09', '09-export', '09 Export', ['rows-09.jsonl']],
];
const WHY = {
  've-ai-cut': 'AI cut needs a signed-in Claude run over 12 clips; claude is stubbed signed-out (no AI-cut stub exists in the harness)',
  've-ai-watch': 'AI cut in progress needs a live AI run',
  've-ai-scrub': 'AI cut in progress needs a live AI run',
  've-ai-proposal': 'a finished AI cut + chat recap needs a live AI run',
  've-ai-adjust': 'swapping a take after an AI cut needs a finished AI cut',
  've-together': 'two people on one video needs a second peer on a linked hub',
  've-fit-fill': 'the vertical-clip ask appears only on dropping a real vertical clip; the lane has no real file drag (synthetic drag events carry no video metadata)',
  'ak-real-about': 'a note card on the board, not an app state',
  'ex-handoff-ready': 'the Ready result with a copy command needs a finished AI handoff run (claude is stubbed signed-out)',
  'ex-edges': 'viewer-role export and "AI is changing this artboard" need a viewer session / a live AI edit',
};
for (const [nn, dir, name, rowFiles] of C) {
  const src = readFileSync(join(R, '.design/ui/v2', name + '.tsx'), 'utf8');
  const ids = [...src.matchAll(/<DCArtboard id="([^"]+)"/g)].map((m) => m[1]);
  const notes = {};
  for (const f of rowFiles) {
    const p = join(R, '.scr', f);
    if (!existsSync(p)) continue;
    for (const l of readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
      const o = JSON.parse(l);
      const id = o.name.replace(/^\d+\//, '');
      if (o.note && o.reach !== 'no') notes[id] = o.note;
    }
  }
  const lines = [`\n## FINAL (stage D2, ${tip}) — p8-d2-g3`, '',
    `Every reachable id re-shot on the merged tip (release-built client, Google Chrome channel for H.264, light + dark), IMPL side only; spec frames reused from stage D (the board .tsx files and .design are byte-identical to the stage-D copy: \`git diff 6d19daa9a HEAD -- .design\` is empty). No match/mismatch judged here. Pairs: full-size-path.txt (last line).`, '',
    '| artboard id | light | dark |', '|---|---|---|'];
  let shot = 0, unreach = 0;
  for (const id of ids) {
    const cell = (t) => {
      const has = existsSync(join(R, '.scr/impl', nn, `${id}-${t}.jpg`));
      if (has) { shot++; return 're-shot' + (notes[id] ? ` (${notes[id]})` : ''); }
      unreach++;
      return 'unreachable — ' + (WHY[id] || 'not reached by the harness');
    };
    lines.push(`| ${id} | ${cell('light')} | ${cell('dark')} |`);
  }
  lines.push('', `Totals: ${shot} id×theme re-shot, ${unreach} unreachable (spec-only frames kept from stage A/D).`);
  appendFileSync(join(EV, dir, 'INDEX.md'), lines.join('\n') + '\n');
  appendFileSync(join(EV, dir, 'full-size-path.txt'), `\nfinal (D2, ${tip}): ${R}/.scr/pairs/${nn}\n(final spec full size: ${R}/.scr/spec/${nn}/<id>-<theme>.png; impl frames: ${R}/.scr/impl/${nn}/)\n`);
  console.log(nn, shot, unreach);
}
