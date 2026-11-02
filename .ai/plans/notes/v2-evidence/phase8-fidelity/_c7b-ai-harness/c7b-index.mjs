import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const W = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a90250e5bf24e5b43';
const EV = `${W}/.ai/plans/notes/v2-evidence/phase8-fidelity`;
const TIP = process.argv[2] || 'p8-c7-ai';
const dir = `${EV}/03-ai-chat`;
const shot = JSON.parse(readFileSync(`${W}/.scr/c7-shot.json`, 'utf8'));
const notes = [
  'Harness: `_c7b-ai-harness/` over `_c7-ai-harness/` (and its layers): new `s03h` (earlier chats seeded across Combine-kampan / Uniformy-2027 / video-hype for the chat list, the long "Combine recap" chat with a first ask from yesterday, opened in the panel and scrolled up), `s03i` (ai-needs-hidden: the question is on Uniformy-2027, the person is on Combine-kampan with the panel hidden), `s03k` (ai-question: an element of the A4 poster picked, asked about with cmd-slash, nothing picked afterwards), `s03a` (ai-two-artboards: the run list opened from the header count), `s03g` (the question moved out).',
  'Product (p8-c7-ai2): the canvas draws "Copied from <name>" under a run\'s copy and a dashed link back to the original (`ai-copies`, a new parent-gated dgn row, ids only; artboard-ai-copies.tsx); the point ring chip says the spot\'s own size in pt on a print artboard; each chat-list canvas group carries its canvas cover.',
  'Still open: sent thumbnails + Before/After pair in ai-long (need an attached-image ask and a versioned run in the seeded chat), "before <the busy chat\'s title>" in the copy caption (a prompt-derived string never crosses to the canvas), Always allowed on this canvas / Images, video and voice (no store behind them), 01 cf-ai-drafting (another builder).',
];
let s = `\n\n## Round 7b (p8-c7-ai2, ${TIP})\n\nRe-shot on the p8-c7-ai worktree tip, both themes, committed pairs overwritten (spec left | impl right). The critic judges; this builder does not.\n\n`;
for (const n of notes) s += `- ${n}\n`;
s += '\n| id | dark | light |\n|---|---|---|\n';
for (const id of shot) s += `| \`${id}\` | re-shot (round 7b) | re-shot (round 7b) |\n`;
appendFileSync(`${dir}/INDEX.md`, s);
const fp = `${dir}/full-size-path.txt`;
const old = readFileSync(fp, 'utf8').replace(/\n+$/, '');
writeFileSync(
  fp,
  `${old}\n\nround 7b (p8-c7-ai2, ${TIP}): ${W}/.scr/pairs/03-ai-chat/\n(one PNG per artboard id and theme: <id>-<dark|light>.png, spec left | impl right, same height, label strip on top)\nround 7b IMPL frames alone: ${W}/.scr/impl-out/03-ai-chat/\nround 7b harness: .ai/plans/notes/v2-evidence/phase8-fidelity/_c7b-ai-harness/ (on top of _c7-ai-harness/ -> _c6-harness-g2/ -> _d3-harness-g2/ -> _d2-harness-g2/)\n`
);
console.log('index ok');
