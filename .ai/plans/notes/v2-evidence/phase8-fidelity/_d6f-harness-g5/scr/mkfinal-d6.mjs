// Appends the "FINAL (D6, <tip>)" section to each canvas INDEX.md and the "final (D6):" line to full-size-path.txt.
// usage: TIP=<sha> bun .scr/mkfinal-d6.mjs   (run from the worktree root after `bun .scr/mkpairs.mjs 13-design-system 14-editing 15-annotations`)
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dirname;
const EV = join(ROOT, '..', '.ai/plans/notes/v2-evidence/phase8-fidelity');
const TIP = process.env.TIP;
const WT = join(ROOT, '..');
const notes = JSON.parse(readFileSync(join(ROOT, 'impl-notes.json'), 'utf8'));
const WHY = {
  'ds-many-library': 'a team library lives on a hub; no real hub is booted in this lane (safety rule), so the library rows cannot be drawn',
  'ds-many-linked': 'a linked team library needs a hub; no real hub is booted in this lane',
  'an-viewer': 'Can comment (viewer role: Hand + Comment only) needs a share-grant session; no local way to open the app as a viewer',
};
const extra = {
  '13-design-system': [
    'Scenarios: `s13.mjs` groups a–k (where, board, edit, truth, make, many-switch, multi-menu/-switch, edge-contrast/-trash, migrate, advanced), `s13p.mjs` (ds-multi-panel), `s13s.mjs` (ds-edge-suggest), `s13u.mjs` (ds-multi-schema), `dsboard.mjs` (the three whole-board crops through the capture origin, both themes). ds-multi-panel light re-run alone (a random port collided once).',
    'Also shot (no spec pair, full-size only): `ds-edit-colour-pending`, `ds-make-entry`, `ds-make-sentence`, `ds-edge-trash-board`, `ds-multi-schema.row`.',
  ],
  '14-editing': [
    'Scenarios: `s14a`/`s14b`/`s14c` (studio + Alligators fixtures), then `s14e` (ed-edge-keys, ed-edge-paste), `s14f` (ed-obj-order + side shots), `s14g` (ed-inspector, Advanced open), `s14ai` (ed-edge-ai through the fake agent), `s14t` (ed-edge-tereza, a second browser) — later runs win. The fixture Homepage is the flat one of round 7 (edit3).',
    'Also shot (no spec pair): `ed-edge-huge-fit`, `ed-edge-ai.chat`, `ed-obj-order-nudge`, `ed-obj-order-locked`.',
  ],
  '15-annotations': [
    'Scenarios: `s15.mjs` groups a–f, then `s15g.mjs` gesture groups g1–g5 (later runs win: an-arrow-bind, an-arrow-kinds, an-convert, an-visibility, an-video, an-vote, an-stamps).',
  ],
};

for (const dir of Object.keys(extra)) {
  const spec = readdirSync(join(ROOT, 'spec', dir)).filter((f) => f.endsWith('.png')).sort();
  const rows = [];
  for (const f of spec) {
    const base = f.replace(/\.png$/, '');
    const m = base.match(/^(.*)-(light|dark)$/);
    const [id, theme] = [m[1], m[2]];
    const hasImpl = existsSync(join(ROOT, 'impl', dir, f)) || existsSync(join(ROOT, 'impl', dir, `${base}.crop.png`));
    const board = id.startsWith('ds-board-');
    const status = hasImpl
      ? board ? 're-shot (whole-board crop through the capture origin; the in-app frame was re-shot too)' : 're-shot'
      : `unreachable — ${WHY[id] || (notes[id] && notes[id].blocker) || 'not reachable'}`;
    rows.push(`| \`${id}\` | ${theme} | ${status} | spec reused (board unchanged since the stage-A shot) |`);
  }
  const n = rows.filter((r) => r.includes('re-shot')).length;
  const text = [
    '',
    `## FINAL (D6, ${TIP}) — IMPL re-shot on the merged tip (stage C rounds 1–8)`,
    '',
    `Re-shot ${n} of ${rows.length} pairs; ${rows.length - n} unreachable. Supersedes every earlier "after" / "FINAL" / "Round" section above: every pair in this folder (\`<id>-<theme>.jpg\`, JPEG q55, max 1100 px wide) shows the merged product at ${TIP}. The SPEC side is unchanged (no commit to the board since the stage-A shot), so the stage-A spec PNGs are reused. Full-size pairs: last line of \`full-size-path.txt\` ("final (D6):").`,
    '',
    'Shot on the Mac mini (`scripts/remote-lane.sh`) with its installed Google Chrome (no Playwright browser there; `SHOT_CHANNEL=chrome`), harness `_d6f-harness-g5/` = the newest layers per canvas flattened (see its README).',
    ...extra[dir].map((s) => `- ${s}`),
    '',
    '| id | theme | FINAL (D6) | spec |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  appendFileSync(join(EV, dir, 'INDEX.md'), text);
  const p = join(EV, dir, 'full-size-path.txt');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\n*$/, '\n') + `final (D6): ${join(WT, '.scr/pairs', dir)}\n`);
  console.log(dir, n, rows.length);
}
