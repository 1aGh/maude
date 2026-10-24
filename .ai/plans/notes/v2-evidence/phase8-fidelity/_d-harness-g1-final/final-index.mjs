// Appends "## FINAL (stage D2, <tip>)" to the three INDEX.md files and a "final (D2):" line to full-size-path.txt.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const R = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a14cd45eae2ac5f32';
const TIP = process.argv[2];
const FID = join(R, '.ai/plans/notes/v2-evidence/phase8-fidelity');
const dirs = { '01': '01-create-flow', '02': '02-onboarding', '05': '05-empty-states' };
const NOTES = {
  '01': {
    'cf-ai-done': 'IMPL = two frames: the panel-folded frame with the result toast shot the moment `[data-fresh]` appears (the 1.8 s finish moment), and the panel reopened ~2 s later (settled: label only)',
    'cf-busy': 'unreachable — needs other people on the canvas (presence, two AI chats, a second person): a hub / collab peers; no local route',
  },
  '02': {
    'ob-first-draw': 'IMPL = the 01 fake-agent frames (drafting, tablet landed, done) — the done frame is the data-fresh one',
    'ob-sig-draw': 'the motion study has no app counterpart; the pair shows the same fake-agent frames as ob-first-draw',
    'ob-invite-page': 'unreachable — a web page on cloud.maude.sh, not part of the app',
    'ob-local-moved': 'unreachable — needs a local project actually moved to a hub; no local route',
  },
  '05': {
    'es-panels-canvas': 'harness: the Share cluster now draws the Comments icon only once the canvas has comments, so the empty Comments panel is opened by ⌘K › Comments (view.comments); the left Canvases panel is re-opened after `h.open` where the harness had folded it',
    'es-viewer': 'unreachable — a view-only / comment-only member session needs a hub / workspace cell vouching a role',
    'es-all-trashed': 'the pair shows the states the app reaches (one left, empty); the all-trashed card itself is not reached by a local route',
  },
};
const SPEC = {
  '01': 'reused (board 01 .tsx/.css unchanged: no `.design` commit since the stage-D spec shots)',
  '02': 'reused (the stage-D re-render, which already carries board 02 commit 3840271a0; no `.design` commit since)',
  '05': 'reused (board 05 .tsx/.css unchanged: no `.design` commit since the stage-D spec shots)',
};
const FAIL = {};
for (const [nn, dir] of Object.entries(dirs)) {
  const idx = join(FID, dir, 'INDEX.md');
  let md = readFileSync(idx, 'utf8').replace(/\n## FINAL \(stage D2[\s\S]*$/, '\n');
  const ids = [...new Set([...md.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]))];
  const rows = [];
  let shot = 0;
  let unr = 0;
  for (const id of ids) {
    const l = existsSync(join(FID, dir, `${id}-light.jpg`));
    const d = existsSync(join(FID, dir, `${id}-dark.jpg`));
    if (l || d) shot += 1; else unr += 1;
    const st = (v) => (v ? 're-shot' : 'unreachable');
    rows.push(`| \`${id}\` | ${st(l)} | ${st(d)} | ${NOTES[nn][id] || ''} |`);
  }
  md += `\n## FINAL (stage D2, ${TIP})\n`;
  md += `Final re-shoot of the IMPL side on the merged \`feat/maude-v2\` tip ${TIP} (stage C rounds 1-4 merged); no product code changed. This section supersedes every per-round "after" section above. ${shot} artboards with pairs (light + dark), ${unr} without a frame. Evidence only — no match / mismatch judged here.\n\n`;
  md += `- **IMPL.** Stage-D harness (\`_d-harness-g1/\`) plus the round-3 \`_c3-ai-harness/\` (fake agent writes through the design plugin's hook; panel folded for the result toast), repointed to this worktree; fresh release client, throwaway HOME/XDG + stub claude, \`NO_OPEN=1 MAUDE_NO_AUTOBUILD=1\`, Playwright Chromium 1600 x 1000. The AI finish moment (cf-ai-done, ob-first-draw's done frame) is shot while \`[data-fresh]\` is on the artboard. Undo waits 7 s for the canvas to settle. The final harness is kept in \`_d-harness-g1-final/\`.\n`;
  md += `- **SPEC.** ${SPEC[nn]}.\n`;
  md += `- **Full-size pairs.** \`full-size-path.txt\` (the last line, "final (D2)"); committed \`<id>-<theme>.jpg\` overwritten (JPEG q55, <= 1100 px).\n\n`;
  md += `| id | light | dark | note |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`;
  writeFileSync(idx, md);
  appendFileSync(join(FID, dir, 'full-size-path.txt'), `final (D2, ${TIP}): ${join(R, '.scr/pairs', nn)}\n`);
  console.log(nn, shot, unr);
}
