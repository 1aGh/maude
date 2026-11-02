// Appends the "after (stage D)" section to the three committed INDEX.md files and rewrites full-size-path.txt.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const R = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a1266e1495ea7588d';
const TIP = process.argv[2];
const FID = join(R, '.ai/plans/notes/v2-evidence/phase8-fidelity');
const dirs = { '01': '01-create-flow', '02': '02-onboarding', '05': '05-empty-states' };
const NOTES = {
  '01': {
    'cf-undo-ai': 'stage A reason stands: the fake agent writes the canvas file directly, not through the edit-op stack; stage C round 2 lists "undo of an AI edit through the shared stack" as still open (fix-navcreate.md) — no new state to reach',
    'cf-busy': 'needs other people on the canvas (presence, two AI chats, a second person) — a hub / collab peers; no local route; stage C did not add one',
  },
  '02': {
    'ob-sig-draw': 'the motion study has no app counterpart; the pair still shows the fake-agent drafts re-shot (same frames as cf-ai-drafting / cf-ai-done)',
    'ob-invite-page': 'a web page on cloud.maude.sh, not part of the app — no frame',
    'ob-local-moved': 'needs a local project actually moved to a hub — no local route; stage C did not add one',
  },
  '05': {
    'es-viewer': 'a view-only / comment-only member session needs a hub / workspace cell vouching a role — not attempted in the browser lane',
    'es-all-trashed': 'the all-trashed card still never mounts (fix-navcreate.md: "AllTrashed never mounted"); the pair shows the one-left and empty states re-shot',
  },
};
const SPEC = {
  '01': 'reused (board 01 .tsx/.css unchanged since stage A — git log 04c20ad74..tip empty)',
  '02': 're-rendered (board 02 .tsx changed in 3840271a0, chip words) from a scratch copy of .design',
  '05': 'reused (board 05 .tsx/.css unchanged since stage A — git log 04c20ad74..tip empty)',
};
for (const [nn, dir] of Object.entries(dirs)) {
  const idx = join(FID, dir, 'INDEX.md');
  let md = readFileSync(idx, 'utf8').replace(/\n## After \(stage D[\s\S]*$/, '\n');
  const ids = [...md.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
  const rows = [];
  let shot = 0;
  let unr = 0;
  for (const id of ids) {
    const cell = (t) => (existsSync(join(FID, dir, `${id}-${t}.jpg`)) ? 're-shot' : null);
    const l = cell('light');
    const d = cell('dark');
    if (l || d) shot += 1;
    else unr += 1;
    const note = NOTES[nn][id];
    const st = (v) => (v ? (nn && NOTES[nn][id] ? v + ' (state not reached)' : v) : 'unreachable');
    rows.push(`| \`${id}\` | ${st(l)} | ${st(d)} | ${note ? note : l || d ? 'IMPL re-shot on the current tip; SPEC ' + SPEC[nn].split(' (')[0] : ''} |`);
  }
  md += `\n## After (stage D, ${TIP})\n`;
  md += `Re-shoot of the IMPL side on \`feat/maude-v2\` tip ${TIP} (stage C round 2 merged), no product code changed. ${shot} artboards with pairs (light + dark), ${unr} without a frame. Evidence only — no match / mismatch judged here.\n\n`;
  md += `- **IMPL.** Same stage-A harness (\`_harness-g1/\`, copied and repointed; kept as \`_d-harness-g1/\`), fresh release client, throwaway HOME/XDG + stub claude, \`NO_OPEN=1 MAUDE_NO_AUTOBUILD=1\`, Playwright Chromium 1600 × 1000. Harness adaptations (the product moved; no product code touched): the What’s new notice’s dismiss is now \`.maude-notice-close\` (its first button became "See all" and opened the panel over every shot); Esc no longer closes Version history, so 05 closes it by its own button (\`vh-close\`); the right-hand panels, Settings and the sheets moved, so the impl crops of es-panels-canvas (history), es-panels-make (AI), es-canvas-three, ob-adv-sheets and ob-settings were re-fitted to the new geometry; the dark es-landing filmstrip now finds its first frame by the blue Ask AI button (stage A picked loading skeletons).\n`;
  md += `- **SPEC.** ${SPEC[nn]}; light = host dark-token rule removed, dark = host injection, as in stage A.\n`;
  md += `- **Full-size pairs.** \`full-size-path.txt\` (stage D line); committed \`<id>-<theme>.jpg\` overwritten (JPEG q55 ≤ 1100 px).\n\n`;
  md += `| id | light | dark | note |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`;
  writeFileSync(idx, md);
  const old = readFileSync(join(FID, dir, 'full-size-path.txt'), 'utf8').trim().split('\n').filter((l) => !l.startsWith('stage'));
  const stageA = old.find((l) => l.startsWith('/') && l.includes('agent-af49')) || old[0];
  writeFileSync(join(FID, dir, 'full-size-path.txt'), `stage A: ${stageA}\nstage D: ${join(R, '.scr/pairs', nn)}\n`);
  console.log(nn, 'ids', ids.length, 'shot', shot, 'unreachable', unr);
}
