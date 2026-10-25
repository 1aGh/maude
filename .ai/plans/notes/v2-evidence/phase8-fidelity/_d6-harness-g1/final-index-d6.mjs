// node final-index-d6.mjs <tip> — appends "## FINAL (D6, <tip>)" to the 01/02/05 INDEX.md and a "final (D6, <tip>):" line to full-size-path.txt.
// Run from the repo root (worktree); re-shot = the pair PNG exists in .scr/pairs/<NN>.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const R = process.env.D5_REPO || process.cwd();
const TIP = process.argv[2];
const FID = join(R, '.ai/plans/notes/v2-evidence/phase8-fidelity');
const dirs = { '01': '01-create-flow', '02': '02-onboarding', '05': '05-empty-states' };
const UNREACH = {
  '01': { 'cf-busy': 'needs other people on the canvas (presence, two AI chats, a second person) — a hub / collab peers; no local route; no stage C round added one' },
  '02': {
    'ob-invite-page': 'a web page on cloud.maude.sh, not part of the app',
    'ob-local-moved': 'needs a local project actually moved to a hub; no local route',
  },
  '05': { 'es-viewer': 'a view-only / comment-only member session needs a hub / workspace cell vouching a role; no local route' },
};
const NOTES = {
  '01': {
    'cf-ai-done': 'IMPL = the finish moment (panel folded, result toast, shot when `[data-fresh]` appears) + the settled frame',
    'cf-undo-ai': 'shot after the run ended (⌘Z is refused while your own AI works), while the undo toast is up',
    'cf-add-artboard': 'IMPL = the state AFTER the pick (F, then the Laptop tile — round 7b), picker frame kept as the first sub-frame',
    'cf-open-big': 'IMPL = project opens its last canvas (Wide), ⌘0 after focusing the canvas, panels folded with ⌘\\ (round 7 / 7b)',
    'cf-render-error': 'second frame = the throwing-component variant (round 7: the Go back card)',
    'cf-big-tree': 'project opens its last canvas, Recent block in the Canvases panel (round 7b)',
  },
  '02': {
    'ob-adv-sheets': 'five sheets; Import from Figma is the round-7 link sheet (Advanced · Access token fold)',
    'ob-settings': 'two frames; Connections carries the round-7 AI — your Claude account row',
    'ob-first-draw': 'IMPL = the 01 fake-agent frames (drafting, tablet landed, done)',
    'ob-sig-draw': 'the motion study has no app counterpart; the pair shows the same fake-agent frames as ob-first-draw',
  },
  '05': {
    'es-home-local': 'Home with NO project registered, signed out, first-run flag ALREADY set (home.json firstRunSeen:true): the empty shelf "No projects on this Mac yet." + the quiet sign-in pill (round 8)',
    'es-panels-canvas': 'four frames; the Comments panel is opened via ⌘K › Comments (s05f) and the one thread resolved for "All done."',
    'es-project-new': 'ONE "New canvas" row (round 7)',
    'es-timeline': 'empty comp keeps the timeline anatomy (round 7)',
    'es-filter': 'chip on keeps word + count + ×, "Clear filter" ghost button (round 7)',
    'es-arriving': 'card centred on the free canvas (round 7)',
    'es-offline-uncached': 'card centred on the free canvas (round 7)',
    'es-all-trashed': 'two frames: one artboard trashed, then every artboard trashed',
  },
};
for (const [nn, dir] of Object.entries(dirs)) {
  const idx = join(FID, dir, 'INDEX.md');
  let md = readFileSync(idx, 'utf8').replace(/\n## FINAL \(D6[\s\S]*$/, '\n');
  const ids = [...new Set([...md.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]))];
  const rows = [];
  let shot = 0;
  for (const id of ids) {
    const l = existsSync(join(R, '.scr/pairs', nn, `${id}-light.png`));
    const d = existsSync(join(R, '.scr/pairs', nn, `${id}-dark.png`));
    if (l || d) shot += 1;
    const st = (v) => (v ? 're-shot' : `unreachable`);
    const note = [UNREACH[nn][id] ? `unreachable: ${UNREACH[nn][id]}` : '', NOTES[nn][id] || ''].filter(Boolean).join(' · ');
    rows.push(`| \`${id}\` | ${st(l)} | ${st(d)} | ${note} |`);
  }
  md += `\n## FINAL (D6, ${TIP})\n`;
  md += `Final verification re-shoot of the IMPL side on the merged \`feat/maude-v2\` tip ${TIP} (stage C rounds 1-8 merged, release client); no product code changed. Supersedes every earlier "after" / FINAL (incl. D5) section. ${shot} of ${ids.length} artboards with pairs (light + dark). Evidence only — no match / mismatch judged here.\n\n`;
  md += `- **IMPL.** \`_d6-harness-g1/\` (= _c8-harness-g1, the round-8 harness, + the Home first-run flag per scene; repo-relative), shot on the Mac mini through \`scripts/remote-lane.sh\` in Google Chrome (the mini has no Playwright chromium build; viewport 1600 × 1000), throwaway HOME/XDG + stub claude, \`NO_OPEN=1 MAUDE_NO_AUTOBUILD=1\`, release-built client. Harness deltas this round: round-8 s01b (folds before the select pick, two filled stickies, Comments closed); home2.mjs writes home.json firstRunSeen:true for es-home-local ONLY (the Mac has seen the first-run card: the quiet sign-in pill and the empty shelf) and removes it for every other scene (ob-first-launch and siblings keep the card).\n`;
  md += `- **SPEC.** reused — no board 01 / 02 / 05 file (.tsx / .css / .meta.json) changed after the D3 shoot (the last board edit, 3840271a0 = 02 chip words, precedes D3; the spec ob-first-launch frame was checked: its chip reads "a project on this Mac"); the spec PNGs are the D3 set.\n`;
  md += `- **Full-size pairs.** \`full-size-path.txt\` (last line, "final (D6)"); committed \`<id>-<theme>.jpg\` overwritten (JPEG q55, <= 1100 px).\n\n`;
  md += `| id | light | dark | note |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`;
  writeFileSync(idx, md);
  appendFileSync(join(FID, dir, 'full-size-path.txt'), `final (D6, ${TIP}): ${join(R, '.scr/pairs', nn)} (raw impl frames: ${join(R, '.scr/impl-raw', nn)})\n`);
  console.log(nn, shot, ids.length);
}
