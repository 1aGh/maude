import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const W = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-ad6307ded82bdaa41';
const EV = `${W}/.ai/plans/notes/v2-evidence/phase8-fidelity`;
const TIP = process.argv[2] || 'p8-c6-aisurf';

const sets = {
  '03-ai-chat': {
    shot: ['ai-hero', 'ai-open', 'ai-suggest', 'ai-scope', 'ai-working', 'ai-done', 'ai-attach', 'ai-attach-menu', 'ai-question', 'ai-long', 'ai-long-pinned', 'ai-two-artboards', 'ai-same-artboard', 'ai-copy', 'ai-chat-list', 'ai-panel-closed', 'ai-quit', 'ai-needs-hidden', 'ai-permission', 'ai-choice-fail', 'ai-not-ready', 'ai-advanced', 'ai-adv-edges', 'ai-history'],
    notes: [
      'Harness: `_c6-harness-g2/` = D3 `_d3-harness-g2/` over `_d2-harness-g2/` with round-6 edits: the chat is opened BEFORE the artboard is picked (an artboard pick with the chat open is the ask scope, not an Inspector pick), `s03e` runs ai-done on ONE chat (no hung poster chat) and starts the poster chat only for ai-hero, ai-history is shot with the chat hidden (Version history alone), ai-panel-closed drives a real finish while the panel is hidden (the Done toast), `s03a` attaches photo + footage + PDF and shows the drop overlay (`dragenter` with Files), the left Canvases panel is folded at the start of `s03e`.',
      'Product (p8-c6-aisurf): no Inspector on an artboard pick with the chat open + a re-announced selection after an AI reload is not a new pick; the file-write dashed rim + wash yield to the AI ring layer while a run of yours is live; ONE follow-up row under a finish ("Same on <artboard>" + a variation of the ask), the suggestion strip and its "Because you last asked …" line yield to it; "What AI did" only folds a run of 4+ steps; the permission question is the work ("Replace 4 team photos in Uniformy-2027?" + the button "Replace 4 team photos"); the needs-you toast reads one line and its x shows on hover/focus only; the chat is titled from the ask while it runs.',
      'Still open (named in fix-c6-aisurf.md): suggestion strips of the other contexts, consent card, chip kinds column, run-list popover driven, copy caption frame, history row actions + Compare, chat-list groups / row menu, Advanced "AI may" switches (no capability behind them), 3-tab History (CONTRACT keeps Named).',
    ],
  },
  '01-create-flow': {
    shot: ['cf-ai-drafting', 'cf-ai-done', 'cf-undo-before', 'cf-undo-ai'],
    notes: [
      'Harness: `_c6-harness-g2/s01ai.mjs` (the D3 g1 script, `fake-acp` paths repointed to `.scr/impl`), run through the g2 `run.mjs` / `pairs.mjs` (impl frames are 1600x1000 jpg, spec side cropped to 1440x900).',
      'Product (p8-c6-aisurf): the camera Fits whenever an artboard lands while a run of yours draws (`cf-ai-drafting.tablet` shows Desktop + Tablet at 39 %); the finish frame shows the "Made by AI" label only (no ring, no wash); the chat is titled from the ask while it runs; one hugging island.',
      'Still open: the Mobile ghost + "AI is drawing Tablet" ring on the artboard being drawn (the ring layer has no hold for a blank-canvas run, so the file-write rim shows until the run ends); the generic follow-up row after a multi-artboard finish.',
    ],
  },
};

for (const [canvas, c] of Object.entries(sets)) {
  const dir = `${EV}/${canvas}`;
  let s = `\n\n## Round 6 (p8-c6-aisurf, ${TIP})\n\nRe-shot on the p8-c6-aisurf worktree tip, both themes, committed pairs overwritten (spec left | impl right). The critic judges; this builder does not.\n\n`;
  for (const n of c.notes) s += `- ${n}\n`;
  s += `\n| id | dark | light |\n|---|---|---|\n`;
  for (const id of c.shot) s += `| \`${id}\` | re-shot (round 6) | re-shot (round 6) |\n`;
  appendFileSync(`${dir}/INDEX.md`, s);
  const fp = `${dir}/full-size-path.txt`;
  const old = readFileSync(fp, 'utf8').replace(/\n+$/, '');
  const sub = canvas === '03-ai-chat' ? '03-ai-chat' : '01-create-flow';
  writeFileSync(
    fp,
    `${old}\n\nround 6 (p8-c6-aisurf, ${TIP}): ${W}/.scr/pairs/${sub}/\n(one PNG per artboard id and theme: <id>-<dark|light>.png, spec left | impl right, same height, label strip on top)\nround 6 IMPL frames alone: ${W}/.scr/impl-out/${canvas === '03-ai-chat' ? '03-ai-chat' : '01'}/\nround 6 harness: .ai/plans/notes/v2-evidence/phase8-fidelity/_c6-harness-g2/ (on top of _d3-harness-g2/ and _d2-harness-g2/)\n`
  );
}
console.log('index ok');
