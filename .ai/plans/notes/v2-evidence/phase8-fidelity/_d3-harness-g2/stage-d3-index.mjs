import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const W = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a1d011f1a56ad7ee9';
const EV = `${W}/.ai/plans/notes/v2-evidence/phase8-fidelity`;
const map = JSON.parse(readFileSync(`${W}/.scr/pairs-map-d3.json`, 'utf8'));
const TIP = '63592219a';
const FINISH = new Set(['ai-hero', 'ai-done', 'ai-copy', 'ai-history']);
const NOTES = {
  '03-ai-chat': [
    'Harness: `_d3-harness-g2/` = the D2 harness (`_d2-harness-g2/`, round-5 `s03c`, fake agent with the board\'s words) plus: **`s03e`** (the old `s03b` sequence with every artboard picked by its label chip in the canvas frame, because the camera fits to the room left of a pinned chat and the panels fold, so fixed coordinates picked "Whole canvas" and the chats queued behind the poster run), **`s03d`** (ai-needs-hidden from a clean chat: the permission ask open, then the panel hidden), **`s03n`** (the stage-A signed-out claude stub: ai-not-ready). `s03a` (open / working / two artboards / copy / list) and `s03c` (scope, attach menu, advanced, permission, failure, pinned) are unchanged apart from the repointed paths.',
    'Product state this run draws: the Canvases list ends in "+ New canvas", Trash only with trash, "Search ⌘K"; the fake agent finishes with the board\'s words; the AI scope menu is `position:fixed` over the field (ai-scope / ai-attach-menu crops 390x620 from y 280 show the whole menu); ⌘Z is not used (the finish frames wait for `[data-fresh]` only).',
    '**Finish moment (ai-hero, ai-done, ai-copy, ai-history)** is captured inside the 1.8 s `data-fresh` window (`h.fresh()`; ai-done then ai-hero are two frames of the same window; ai-history presses ⌥⌘H inside the window of a second finish; ai-copy waits for the copy run\'s finish). No "NO FRESH WINDOW" in the final runs (one miss in a first `s03a` light pass was re-run).',
    '**ai-question** is the board\'s state (a question answered in the chat, canvas stays put); the elicitation card ("Which green?") is frame `ai-choice-q` (committed as `extra-impl-ai-choice-q-<theme>.jpg`). **ai-choice-fail** is the failure card with the missing file named.',
    'Not reachable in the browser lane, unchanged: ai-queue-rule (a drawn rule), ai-other-tab / ai-needs-tab (second desktop tab), ai-needs-away (OS notification), ai-tereza (second person on a hub).',
  ],
  '04-modes': [
    'Harness: `_d3-harness-g2/` = D2 `s04a` / `s04c` / `s04v`, with two adaptations to the merged product: **md-draw** now closes the docked Comments panel, leaves Preview with one esc (re-entering Preview if the toolbar is gone), and picks the sticky tool by its testid `toolbar-slot-sticky` (the toolbar moved up, the old fixed coordinate opened the sticker palette); **md-esc** therefore shows the esc ladder without the Comments panel left open from the comment step.',
    '**md-comment** shows the Comment tool docking the Comments panel with the composer card; `extra-impl-md-comment-thread` is the thread after ⌘↵.',
    '**md-edge-ai** is the board\'s state (`s04c`: the prompt `Make it greener, keep the logo white` asked in Edit, then Preview folds the panels, shot mid change; the frame +3.5 s later is `extra-impl-md-edge-ai-after`).',
    '**md-present-video**: the base fixture\'s VideoEdit canvas, the Reel artboard selected, ⌥⌘↵, shot with Google Chrome (`SHOT_CHANNEL=chrome`, H.264). The fixture clip is 16:9 and a single artboard, not the board\'s 9:16 Reels in a 14-artboard deck, so Present shows no deck counter; `extra-impl-md-present-video-play` is the frame after the play button.',
    'Not reachable, unchanged: md-motion (a storyboard), md-presenter / md-edge-offline (second display / desktop shell), md-present-link / md-comment-only / md-edge-viewer (hub or second person).',
  ],
};
for (const [canvas, c] of Object.entries(map)) {
  const dir = `${EV}/${canvas}`;
  let s = `\n\n## FINAL (D3, ${TIP})\n\nRe-shoot of the IMPL side on the merged tip ${TIP} (stage C rounds 1-5 + bugs3 merged), both themes, **every reachable id**; this section supersedes every earlier "after" / FINAL section above. The committed \`<id>-<theme>.jpg\` pairs (SPEC left | IMPL right) are overwritten in place. SPEC side **reused** from stage A for every id (\`git log\` shows no change to \`.design/ui/v2/${c.nn} *\` since 2026-10-19, before the stage-A shot). No match / mismatch is judged here.\n\n`;
  for (const n of NOTES[canvas]) s += `- ${n}\n`;
  s += `\n| id | dark | light |\n|---|---|---|\n`;
  for (const [id, m] of Object.entries(c.ids)) {
    if (m.impl) {
      const how = FINISH.has(id) ? 're-shot (in the finish window)' : 're-shot';
      s += `| \`${id}\` | ${how} | ${how} |\n`;
    } else s += `| \`${id}\` | unreachable (${(m.reason || '').replace(/\|/g, '/')}) | unreachable (same) |\n`;
  }
  appendFileSync(`${dir}/INDEX.md`, s);
  const fp = `${dir}/full-size-path.txt`;
  const old = readFileSync(fp, 'utf8').replace(/\n+$/, '');
  writeFileSync(
    fp,
    `${old}\n\nfinal (D3, ${TIP}): ${W}/.scr/pairs/${canvas}/\n(one PNG per artboard id and theme: <id>-<dark|light>.png, spec left | impl right, same height, label strip on top)\nfinal (D3) IMPL frames alone: ${W}/.scr/impl-out/${c.dir}/\nfinal (D3) SPEC images (reused from stage A): ${W}/.scr/spec/${c.nn}/\nfinal (D3) harness: .ai/plans/notes/v2-evidence/phase8-fidelity/_d3-harness-g2/ (on top of _d2-harness-g2/)\n`
  );
}
