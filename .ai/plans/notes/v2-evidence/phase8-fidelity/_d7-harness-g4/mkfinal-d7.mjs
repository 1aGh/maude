// Appends "## FINAL (D7, <tip>)" to the INDEX.md of 14 / 15 and a last "final (D7, <tip>):" line to full-size-path.txt.
// usage: cp this file to <worktree>/.scr/ and run  TIP=<sha> bun .scr/mkfinal-d7.mjs  after `bun .scr/mkpairs.mjs 14-editing 15-annotations`.
// re-shot = the raw impl frame exists in .scr/impl/<dir>; the rest are unreachable with the reason below.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dirname;
const WT = join(ROOT, '..');
const EV = join(WT, '.ai/plans/notes/v2-evidence/phase8-fidelity');
const TIP = process.env.TIP;
const notes = JSON.parse(readFileSync(join(ROOT, 'impl-notes.json'), 'utf8'));
const WHY = {
  'an-viewer': 'Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer',
};
const extra = {
  '14-editing': [
    'Chain (`_d7-harness-g4/run.sh 14`, one theme per mini call): the D6 order `s14a`/`s14b`/`s14c` (studio + Alligators fixtures), `s14e`, `s14f`, `s14g`, `s14ai` (fake agent), `s14t` (second browser) for the full id set, then the round-8/10 tail `s14b` (ed-obj-multi only), `s14h`, `s14i` (round-10 pen block), `s14j`, `s14e`, `s14g` — later runs win. Harness: `_c10-harness-g5` <- `_c10-harness-g5-edit/scr`.',
    'Not re-shot (no board pair): the side shot `ed-pen-draw`.',
  ],
  '15-annotations': [
    'Chain (`_d7-harness-g4/run.sh 15`): `s15.mjs` groups a–f and p, then `s15g.mjs` g1–g5 (round 10, `_c10ann-harness-g5`), with the round-10 print step (View > Print guides on before `an-print`, p8-c10-print) folded into `scr15/s15.mjs`.',
    'Extra impl-only shots from the same run (no spec pair): `an-today-size`, `an-today-shape`, `an-today-marker`.',
  ],
};

for (const dir of Object.keys(extra)) {
  const spec = readdirSync(join(ROOT, 'spec', dir)).filter((f) => f.endsWith('.png')).sort();
  const rows = [];
  for (const f of spec) {
    const base = f.replace(/\.png$/, '');
    const [, id, theme] = base.match(/^(.*)-(light|dark)$/);
    const hasImpl = existsSync(join(ROOT, 'impl', dir, f)) || existsSync(join(ROOT, 'impl', dir, `${base}.crop.png`));
    const status = hasImpl ? 're-shot' : `unreachable — ${WHY[id] || (notes[id] && notes[id].blocker) || 'the scenario shot no frame on this tip; the pair carries the NOT REACHABLE caption'}`;
    rows.push(`| \`${id}\` | ${theme} | ${status} | spec reused (board unchanged since the stage-A shot) |`);
  }
  const n = rows.filter((r) => r.includes('| re-shot |')).length;
  const text = [
    '',
    `## FINAL (D7, ${TIP})`,
    '',
    `Final verification re-shoot of the IMPL side (every artboard id x light + dark) on the merged \`feat/maude-v2\` tip ${TIP} (stage C rounds 1–10 merged, release client); no product code changed. Supersedes every earlier "after" / FINAL / round section, round 10 included. ${n} of ${rows.length} pairs re-shot, ${rows.length - n} unreachable. Evidence only: no match / mismatch judged here. The \`<id>-<theme>.jpg\` pairs in this folder (JPEG q55, max 1100 px wide) show the product at ${TIP}; the SPEC side is unchanged (the boards \`.design/ui/v2/${dir.slice(0, 2)}*\` have not changed since the stage-A shot), so the stage-A spec PNGs are reused. Full-size pairs: last line of \`full-size-path.txt\` ("final (D7").`,
    '',
    'Shot on the Mac mini (`scripts/remote-lane.sh`) with its installed Google Chrome (`SHOT_CHANNEL=chrome`, viewport 1600 x 1000), throwaway HOME/XDG + stub claude, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, release-built client; harness `_d7-harness-g4/` (see its README).',
    ...extra[dir].map((s) => `- ${s}`),
    '',
    '| id | theme | FINAL (D7) | spec |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  const idx = join(EV, dir, 'INDEX.md');
  writeFileSync(idx, readFileSync(idx, 'utf8').replace(/\n## FINAL \(D7[\s\S]*$/, '\n'));
  appendFileSync(idx, text);
  const p = join(EV, dir, 'full-size-path.txt');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/^final \(D7.*\n?/gm, '').replace(/\n*$/, '\n') + `final (D7, ${TIP}): ${join(WT, '.scr/pairs', dir)} (raw impl frames: ${join(WT, '.scr/impl', dir)}; spec: ${join(WT, '.scr/spec', dir)}; harness _d7-harness-g4/)\n`);
  console.log(dir, n, rows.length);
}
