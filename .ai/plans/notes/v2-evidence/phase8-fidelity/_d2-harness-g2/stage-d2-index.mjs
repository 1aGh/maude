import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const W = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a948527cf7721a4d9';
const EV = `${W}/.ai/plans/notes/v2-evidence/phase8-fidelity`;
const map = JSON.parse(readFileSync(`${W}/.scr/pairs-map.json`, 'utf8'));
const TIP = 'd3881fe41';
const FINISH = new Set(['ai-hero', 'ai-done', 'ai-copy', 'ai-history']);
const NOTES = {
  '03-ai-chat': [
    'Harness: the stage-D scripts plus the round-3 additions. The fake ACP agent writes the canvas through the design plugin\'s hook code (so rings / "Made by AI" attribute like a real run) and now takes its behaviour from a one-shot `next-mode` file, so the chat shows the board\'s own words as the prompt (`Make it greener, keep the logo white`, `Translate the poster to English, keep the layout`, `Headline in one word`, `Swap the 2025 team photos for the new ones in Assets › Foto 2026`, `Cut the hype reel to 15 s from the training footage`, the long-chat questions) and the board\'s own tool step lines ("Background done · badge next"). No trigger words ("hang", "permission") show any more.',
    '**Finish moment (ai-hero, ai-done, ai-copy, ai-history)** is captured inside the 1.8 s `data-fresh` window: the shot waits for `.dc-ai-ring[data-fresh]` in the canvas frame and fires at once (ai-done then ai-hero are two frames of the same window; ai-history presses ⌥⌘H inside the window of a second finish; ai-copy waits for the copy run\'s finish).',
    '**ai-question** is the board\'s state (a question answered in the chat, canvas stays put: `Is the A4 poster readable from three metres?`); the elicitation card ("Which green?") that stage A/D showed as ai-question is now frame `ai-choice-q` (committed as `extra-impl-ai-choice-q-<theme>.jpg`). **ai-choice-fail** is the failure card (`Couldn\'t finish - the footage file is missing`) as before; the board draws the question and the failure side by side, the app draws them in two chats.',
    '**Menus**: ai-scope and ai-attach-menu are cropped 390x620 from the panel foot, so the whole menu is in the crop. **Finding for the lead: the scope menu is clipped by the app itself** - its DOM menu is 128 px tall (Whole canvas / Post 1:1 · Combine 2026 / Choose artboards… / No canvas - just ask, top 662 px) but the chat card cuts it at y 728, so only the last two rows show. Not a crop artefact (a probe frame of the bare page shows the same). The attach menu shows all four rows.',
    'Panel-detail crops use x 1050 / w 390 (the chat is a floating island).',
    'Not reachable in the browser lane, unchanged: ai-queue-rule (a drawn rule), ai-other-tab / ai-needs-tab (second desktop tab), ai-needs-away (OS notification), ai-tereza (second person on a hub).',
  ],
  '04-modes': [
    'Harness: stage-D scripts with the product\'s new camera / panel behaviour handled: selecting an artboard folds the left panel (md-edit-image first opens it from its corner icon); in Preview the camera is Desktop 81 % or Tablet 65 % depending on the run, so Preview clicks use the bounding box of whichever of the Desktop / Tablet element is on screen (md-inspect = ⌘-click with the real mouse on "Book a call"; md-preview-follow = a click event on "See pricing →", the link cannot be hit by the mouse at that camera); the toolbar slots are clicked by their position.',
    '**md-edge-ai** is the board\'s state (`s04c`: the prompt `Make it greener, keep the logo white` asked in Edit, then Preview folds the panels, shot mid change; the frame +3.5 s later is `extra-impl-md-edge-ai-after`).',
    '**md-present-video is newly reached**: the base fixture\'s VideoEdit canvas, the Reel artboard selected, ⌥⌘↵, the play button pressed, shot with Google Chrome (`SHOT_CHANNEL=chrome`: the bundled Chromium cannot decode H.264). The fixture clip is 16:9 and a single artboard, not the board\'s 9:16 Reels in a 14-artboard deck, so Present shows no deck counter; the pair compares the video-in-Present surface, not the exact scene.',
    'Not reachable, unchanged: md-motion (a storyboard), md-presenter / md-edge-offline (second display / desktop shell), md-present-link / md-comment-only / md-edge-viewer (hub or second person).',
  ],
  '06-advanced': [
    'Harness: stage-D scripts; Canvases / Layers > Advanced first opens the left panel from its corner icon (it folds when an artboard is selected). **ad-share** keeps the `window.__TAURI__` stub removed just before the Share click (in the desktop shell a local project\'s Share opens "Move to the cloud?" and hides Share > Advanced). **ad-diag / ad-syncd** show the one Diagnostics sheet (no tabs; Logs, Server, AI setup at once; a local project has no Sync card), taken after the Logs frame.',
    '**ad-ds is newly reached**: the converted-system project fixture (the g5 `ds-converted`), the pinned Design system row opened, nothing selected, the right panel opened from its corner icon: the system panel (Modes, Check the system, Advanced with the tokens CSS / JSON and the files, Hand off tokens). Cropped to the panel (x 1050 / w 390 / h 760). The board draws the same panel beside a "how you get here" step; the app has no such step.',
    '**ad-timeline** is the VideoEdit canvas, Reel selected, timeline expanded, its Advanced row open (S7.18); reached since stage D.',
    'Not reachable, unchanged: ad-map, ad-why, ad-trace (explanation boards), ad-menus (native menu bar), ad-edge-sync / ad-edge-hub (hub), ad-edge-where, ad-edge-remember (multi-context stories).',
  ],
};
for (const [canvas, c] of Object.entries(map)) {
  const dir = `${EV}/${canvas}`;
  let s = `\n\n## FINAL (stage D2, ${TIP})\n\nRe-shoot of the IMPL side on the merged tip ${TIP} (stage C rounds 1-4 all merged), both themes, **every reachable id**, so the critic re-check compares the board with what the app draws now; this section supersedes the per-round "after" sections above. The committed \`<id>-<theme>.jpg\` pairs (SPEC left | IMPL right) are overwritten in place. SPEC side **reused** from stage A for every id (\`git log\` shows no change to \`.design/ui/v2/${c.nn} *\` after the stage-A shot). No match / mismatch is judged here.\n\n`;
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
    `${old}\n\nfinal (D2, ${TIP}): ${W}/.scr/pairs/${canvas}/\n(one PNG per artboard id and theme: <id>-<dark|light>.png, spec left | impl right, same height, label strip on top)\nfinal (D2) IMPL frames alone: ${W}/.scr/impl-out/${c.dir}/\nfinal (D2) SPEC images (reused from stage A): ${W}/.scr/spec/${c.nn}/\nfinal (D2) harness: .ai/plans/notes/v2-evidence/phase8-fidelity/_d-harness-g2/ (D2 changes under _d2-harness-g2/)\n`
  );
}
