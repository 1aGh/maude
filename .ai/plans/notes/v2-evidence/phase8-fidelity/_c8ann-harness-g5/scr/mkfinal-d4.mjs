// Appends the "FINAL (D4, <tip>)" section to each canvas INDEX.md and the "final (D4):" line to full-size-path.txt.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dirname;
const EV = join(ROOT, '..', '.ai/plans/notes/v2-evidence/phase8-fidelity');
const TIP = process.env.TIP;
const notes = JSON.parse(readFileSync(join(ROOT, 'impl-notes.json'), 'utf8'));
const WT = join(ROOT, '..');
const NEWLY = {
  'ds-edge-suggest': 'NEWLY REACHED — the question is not AI-driven: a canvas on a converted system with a hand-picked blue (`#3b6fe0` on the "Save two months" badge) in a git repo with the canvas uncommitted; the quiet question draws at the bottom ("A colour picked by hand isn’t in maude-v2. The closest is Accent." Use Accent · Add it to the system · Not now). Fixture canvas is a small Pricing page (`s13s.mjs`).',
  'ds-multi-schema': 'NEWLY REACHED — an UNCONVERTED second system `maude` with its core colours removed: amber dot + "Made before the schema" on its row, row ⋯ › "Bring it up to the schema…" opens "Bring maude up to the schema?" (`s13u.mjs`; a converted system is refused with "is on a Design system canvas…"). The full frame shows the sheet; `ds-multi-schema.row` is the row alone (full-size only).',
  'ed-edge-ai': 'NEWLY REACHED — signed-in AI through the fake agent edited through the design hook (`s14ai.mjs`, `h/fake-acp/g14-agent.mjs`): artboards carry "AI is working" tags and the chat shows the run with Stop (`ed-edge-ai.chat`, full-size only); the pair shows it with the headline selected. NOTE for the critic: the hold covers ALL THREE artboards of the canvas, not one footer element (the run holds whole artboards; no per-element ring drew for the footer edit), and the chat message list is squeezed to a sliver under a tall Inspector.',
  'ed-edge-tereza': 'NEWLY REACHED — a second browser named Tereza (its `/_api/git-user` answered "Tereza") on the same studio selects See pricing (`s14t.mjs`); this browser sees her avatar "T" and a purple ring + "Tereza" tag. NOTE for the critic: the ring lands on the Hero FRAME, not the button, and this browser\'s inspector shows no "Tereza is editing See pricing" line even with the same button selected here.',
};
const extra = {
  '13-design-system': [
    'Harness: `_d4-harness-g5/` = `_d-harness-g5` + `_d2` + `_d3` + `_c6-bugs4-harness` + `_d6-harness-g5` (copied over each other in that order, `REPO` repointed, release-built client, `bun mk-dsconv.mjs` first) plus the D4 scenarios `s13s.mjs` (ds-edge-suggest) and `s13u.mjs` (ds-multi-schema). Chain: `chain-d4.sh` (light, dark, then `dsboard.mjs` for the whole-board crops through the capture origin) and `chain-x.sh` for the newly reached states.',
    'Also shot (no spec pair, full-size only): `ds-edit-colour-pending`, `ds-make-entry`, `ds-make-sentence`, `ds-edge-trash-board`, `ds-multi-schema.row`.',
    'Still unreachable: `ds-many-library`, `ds-many-linked` — a team library on a hub; no real hub is booted in this lane.',
  ],
  '14-editing': [
    'Harness: `_d4-harness-g5/` (see the 13 INDEX), plus `s14ai.mjs` (+ `h/fake-acp/g14-agent.mjs`) and `s14t.mjs` for the two newly reached states. 14 ids come from `s14a`/`s14b`/`s14c` (round-6 drag + objinsp versions).',
    'Also shot (no spec pair): `ed-edge-huge-fit`, `ed-edge-ai.chat`.',
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
    let status = hasImpl ? (board ? 're-shot (whole-board crop through the capture origin; the in-app frame was re-shot too)' : 're-shot') : `unreachable — ${(notes[id] && notes[id].blocker) || 'not reachable'}`;
    if (hasImpl && NEWLY[id]) status = `re-shot — ${NEWLY[id]}`;
    rows.push(`| \`${id}\` | ${theme} | ${status} | spec reused (board unchanged since the stage-A shot) |`);
  }
  const n = rows.filter((r) => r.includes('re-shot')).length;
  const text = [
    '',
    `## FINAL (D4, ${TIP}) — IMPL re-shot on the merged tip (stage C rounds 1–6)`,
    '',
    `Re-shot ${n} of ${rows.length} pairs; ${rows.length - n} unreachable. Supersedes every earlier "after" / "FINAL" / "Round" section above: every pair in this folder (\`<id>-<theme>.jpg\`, JPEG q55, max 1100 px wide) now shows the merged product. The SPEC side is unchanged (no commit to the board \`.design/ui/v2/${dir.replace(/^(\d+)-(.*)$/, (_, a, b) => a + ' ' + b.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '))}.*\` since the stage-A shot), so the stage-A spec PNGs are reused. Full-size pairs: last line of \`full-size-path.txt\` ("final (D4):").`,
    '',
    ...extra[dir].map((s) => `- ${s}`),
    '',
    '| id | theme | FINAL (D4) | spec |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  appendFileSync(join(EV, dir, 'INDEX.md'), text);
  const p = join(EV, dir, 'full-size-path.txt');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\n*$/, '\n') + `final (D4): ${join(WT, '.scr/pairs', dir)}\n`);
  console.log(dir, n, rows.length);
}
