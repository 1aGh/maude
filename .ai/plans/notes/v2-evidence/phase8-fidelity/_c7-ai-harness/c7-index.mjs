import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const W = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-abc3d018bba1d4c49';
const EV = `${W}/.ai/plans/notes/v2-evidence/phase8-fidelity`;
const TIP = process.argv[2] || 'p8-c7-ai';
const dir = `${EV}/03-ai-chat`;
const shot = JSON.parse(readFileSync(`${W}/.scr/c7-shot.json`, 'utf8'));
const notes = [
  'Harness: `_c7-ai-harness/` over `_c6-harness-g2/` (layers as that README): new `s03g.mjs` (comments seeded for the lead strip, Canvases + Inspector as the board for ai-open, photo/footage/PDF chips + the drop overlay, the second ask on POST 1:1 for ai-same-artboard / ai-copy, Uniformy-2027 with the four photo artboards picked for ai-permission, an element picked for ai-question), `s03e` (the history row selected, so its Undo this chat / Restore show), `s03c` (ai-scope with nothing picked = Whole canvas), `fake-agent` (an "Agent persona" option), real fixtures for the footage (42 s mov), photo and 12-page PDF.',
  'Product (p8-c7-ai): the chat title is the first clause of the ask (`shownChatTitle`); Advanced › AI may = Change canvases (the ask-before mode) · Use Assets and footage · Search the web (told to the agent with every ask, `[maude-may …]`) · Write outside (Asks every time), Ask before after Fast mode; the panel-closed done toast quotes both sentences and offers Show for an ask about named artboards (Undo stays for a whole-canvas draft).',
  'Still open (fix-c7-ai.md): the "Copied from …" caption + dashed link, the point ring chip text ("9 pt"), Always-allowed + Reset, Images/video/voice group, day divider / jump pill / sent thumbnails on ai-long, the run-list popover, 01 cf-ai-drafting (stacked tags, Tablet/Mobile ghost: needs a dgn hold for a run on a blank canvas), 01 not re-shot this round.',
];
let s = `\n\n## Round 7 (p8-c7-ai, ${TIP})\n\nRe-shot on the p8-c7-ai worktree tip, both themes, committed pairs overwritten (spec left | impl right). The critic judges; this builder does not.\n\n`;
for (const n of notes) s += `- ${n}\n`;
s += '\n| id | dark | light |\n|---|---|---|\n';
for (const id of shot) s += `| \`${id}\` | re-shot (round 7) | re-shot (round 7) |\n`;
appendFileSync(`${dir}/INDEX.md`, s);
const fp = `${dir}/full-size-path.txt`;
const old = readFileSync(fp, 'utf8').replace(/\n+$/, '');
writeFileSync(
  fp,
  `${old}\n\nround 7 (p8-c7-ai, ${TIP}): ${W}/.scr/pairs/03-ai-chat/\n(one PNG per artboard id and theme: <id>-<dark|light>.png, spec left | impl right, same height, label strip on top)\nround 7 IMPL frames alone: ${W}/.scr/impl-out/03-ai-chat/\nround 7 harness: .ai/plans/notes/v2-evidence/phase8-fidelity/_c7-ai-harness/ (on top of _c6-harness-g2/ -> _d3-harness-g2/ -> _d2-harness-g2/)\n`
);
console.log('index ok');
