// node index-d7.mjs <tip> — run from the repo root (worktree) after mkpairs/pair.mjs.
// Appends "## FINAL (D7, <tip>)" to INDEX.md of 01 / 03 / 04 and a last "final (D7, <tip>):" line to full-size-path.txt.
// re-shot = the full-size pair PNG exists in .scr/pairs/<NN>; unreachable rows reuse the D6 reason (same ids, same boards).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const R = process.env.D5_REPO || process.cwd();
const TIP = process.argv[2];
const FID = join(R, '.ai/plans/notes/v2-evidence/phase8-fidelity');
const dirs = { '01': '01-create-flow', '03': '03-ai-chat', '04': '04-modes' };
const UNREACH01 = { 'cf-busy': 'needs other people on the canvas (presence, two AI chats, a second person): a hub / collab peers; no local route' };
for (const [nn, dir] of Object.entries(dirs)) {
  const idx = join(FID, dir, 'INDEX.md');
  let md = readFileSync(idx, 'utf8').replace(/\n## FINAL \(D7[\s\S]*$/, '\n');
  const d6 = (md.match(/## FINAL \(D6[\s\S]*?(?=\n## |$)/) || [''])[0];
  const reason = {};
  for (const m of d6.matchAll(/^\| `([a-z0-9-]+)` \| ([^|]*) \| ([^|]*) \|/gm)) reason[m[1]] = [m[2].trim(), m[3].trim()];
  const ids = [...new Set([...(d6 || md).matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]))];
  if (nn === '01') for (const id of Object.keys(UNREACH01)) if (!ids.includes(id)) ids.push(id);
  let shot = 0;
  const rows = [];
  for (const id of ids) {
    const cell = (theme, i) => {
      if (existsSync(join(R, '.scr/pairs', nn, `${id}-${theme}.png`))) return 're-shot';
      const prev = reason[id]?.[i];
      if (prev && prev.startsWith('unreachable')) return prev;
      return nn === '01' && UNREACH01[id] ? `unreachable (${UNREACH01[id]})` : 'unreachable (the scenario shot no frame on this tip)';
    };
    const dk = cell('dark', 0);
    const lt = cell('light', 1);
    if (dk === 're-shot' || lt === 're-shot') shot += 1;
    rows.push(`| \`${id}\` | ${dk} | ${lt} |`);
  }
  md += `\n## FINAL (D7, ${TIP})\n\n`;
  md += `Final verification re-shoot of the IMPL side (every artboard id x light + dark) on the merged \`feat/maude-v2\` tip ${TIP} (stage C rounds 1-10 merged, release client); no product code changed. Supersedes every earlier "after" / FINAL / ROUND section, round 10 included. ${shot} of ${ids.length} artboards with pairs. Evidence only: no match / mismatch judged here.\n\n`;
  md += `- **IMPL.** \`_d7-harness-g1/${nn === '01' ? 'g1' : 'g2'}/\` (${nn === '01' ? 'the D6 G1 harness + the round-10 s01d delta (AI panel open while the render-error card shows)' : nn === '03' ? 'the D6 G2 harness + the round-10 03 deltas (s03c s03e s03h s03z, fake-agent)' : 'the D6 G2 harness + the round-10 s04a delta (md-inspect: camera <= 69 %, Advanced open)'}), shot on the Mac mini through \`scripts/remote-lane.sh\` in Google Chrome (viewport 1600 x 1000), throwaway HOME/XDG + stub claude, \`NO_OPEN=1 MAUDE_NO_AUTOBUILD=1\`, release-built client.\n`;
  md += `- **SPEC.** reused: the boards \`.design/ui/v2/${nn}*\` (.tsx / .css / .meta.json) have not changed since the D3 shoot (last board edits on 2026-10-19 / 10-24 touch other canvases); the spec PNGs are the D3 set.\n`;
  md += `- **Pairs.** full-size: \`.scr/pairs/${nn}/<id>-<theme>.png\` in the p8-d7-g1 worktree (spec left | impl right); the committed \`<id>-<theme>.jpg\` here were overwritten (<= 1100 px, q55).\n\n`;
  md += `| id | dark | light |\n|---|---|---|\n${rows.join('\n')}\n`;
  writeFileSync(idx, md);
  const abs = join(R, '.scr/pairs', nn);
  const raw = nn === '01' ? join(R, '.scr/impl-raw/01') : join(R, '.scr/d7', dir);
  appendFileSync(join(FID, dir, 'full-size-path.txt'), `final (D7, ${TIP}): ${abs} (raw impl frames: ${raw}; spec: ${nn === '01' ? join(R, '.scr/spec-raw/01') : join(R, '.scr/spec', nn)}; harness _d7-harness-g1/${nn === '01' ? 'g1' : 'g2'}/)\n`);
  console.log(nn, `${shot}/${ids.length}`);
}
