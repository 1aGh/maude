// Appends "## FINAL (D4, <tip>)" to the 01 INDEX.md and a "final (D4, <tip>):" line to full-size-path.txt.
// usage: node final-index-d4.mjs <tip>
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const R = '/Users/iagh/git/personal/maude/.claude/worktrees/wf_74ac1088-f6f-9';
const TIP = process.argv[2];
const FID = join(R, '.ai/plans/notes/v2-evidence/phase8-fidelity');
const dir = '01-create-flow';
const NOTES = JSON.parse(readFileSync(join(R, '.scr/h/d4-notes.json'), 'utf8'));
const idx = join(FID, dir, 'INDEX.md');
let md = readFileSync(idx, 'utf8').replace(/\n## FINAL \(D4[\s\S]*$/, '\n');
const ids = [...new Set([...md.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]))];
const rows = [];
let shot = 0;
let unr = 0;
for (const id of ids) {
  const l = existsSync(join(R, '.scr/pairs/01', `${id}-light.png`));
  const d = existsSync(join(R, '.scr/pairs/01', `${id}-dark.png`));
  if (l || d) shot += 1; else unr += 1;
  const st = (v) => (v ? 're-shot' : 'unreachable');
  rows.push(`| \`${id}\` | ${st(l)} | ${st(d)} | ${NOTES.ids[id] || ''} |`);
}
md += `\n## FINAL (D4, ${TIP})\n`;
md += `Final re-shoot D4 of the IMPL side on the merged \`feat/maude-v2\` tip ${TIP} (stage C rounds 1-6 + bugs4 merged); no product code changed. This section supersedes every earlier "after" / FINAL section above. ${shot} artboards with pairs (light + dark), ${unr} without a frame. Evidence only — no match / mismatch judged here.\n\n`;
md += NOTES.body + '\n\n';
md += `- **SPEC.** reused: board 01 \`.tsx\` / \`.css\` unchanged since stage A (\`git log\` over \`.design/ui/v2/01*\` since 2026-10-18 is empty); the same full-size spec PNGs as D3.\n`;
md += `- **Full-size pairs.** \`full-size-path.txt\` (the last line, "final (D4)"); committed \`<id>-<theme>.jpg\` overwritten (JPEG q55, <= 1100 px).\n\n`;
md += `| id | light | dark | note |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`;
writeFileSync(idx, md);
appendFileSync(join(FID, dir, 'full-size-path.txt'), `final (D4, ${TIP}): ${join(R, '.scr/pairs/01')}\n`);
console.log(shot, unr);
