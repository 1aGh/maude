// Appends the "FINAL (stage D2, <tip>)" section to each canvas INDEX.md and adds the "final (D2):" line to full-size-path.txt.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dirname;
const EV = join(ROOT, '..', '.ai/plans/notes/v2-evidence/phase8-fidelity');
const TIP = process.env.TIP;
const notes = JSON.parse(readFileSync(join(ROOT, 'impl-notes.json'), 'utf8'));
const WT = join(ROOT, '..');

const extra = {
  '13-design-system': [
    'Harness: `_d3-harness-g5/` (the D2 harness + the round-5 deltas; `REPO` repointed). D3 changes: the artboard label is pressed by coordinates (`g5.mjs`), `ds` calls retry while the kernel answers "unavailable", a `system-*` board is waited for before shooting (no "Opening…" card), the ds make door is opened through Canvases › Advanced, ds-edit-instance drills 3 deep to the Buy button, ds-where-studio / ds-multi-migrate re-open the left panel so the pinned row shows with the inspector. `ds-board-*` are whole-board crops through the capture origin (top 2900 px of a 9636 px board).',
    'Also shot (no spec pair, full-size only): `ds-edit-colour-pending`, `ds-make-entry`, `ds-make-sentence`, `ds-edge-trash-board`.',
    'Unreachable in a local single-project lane: AI suggestion (`ds-edge-suggest`), team library / linked library on a hub (`ds-many-library`, `ds-many-linked`), older-schema upgrade (`ds-multi-schema`).',
    'Shot but the state is not drawn by the app in this lane: `ds-truth-outside` (a disk edit of `colors_and_type.css` on a converted system never surfaces a "Changed outside" review: `ds status` stays `outside: null` after 9 s; probe `.scr/outside-probe.mjs`) — the frame shows the board as it is.',
  ],
  '14-editing': [
    'Harness: `_d3-harness-g5/`. D3 changes: ed-comp-pick / ed-comp-instance select the artboard (label chip) before ⇧I and place the Button with the picker’s Enter (a click on empty canvas selects nothing, a row click only arms the ghost), the label press is by coordinates. The fixtures are the Studio site / Alligators brand ones, drill counts from round 3.',
    'Also shot (no spec pair): `ed-edge-huge-fit`.',
    '`ed-edge-tereza` stays unreachable: another person’s presence needs a second synced collaborator. `ed-edge-ai` is shot, but the AI is the stubbed signed-out one here (the "Connect your Claude account?" sheet shows, no run in progress) — the fake-agent harness (`_c3-ai-harness`) was not adapted to 14, so "AI is drawing the footer" is not reached.',
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
    const status = hasImpl ? (board ? 're-shot (whole-board crop through the capture origin; the in-app frame was re-shot too)' : 're-shot') : `unreachable — ${(notes[id] && notes[id].blocker) || 'not reachable'}`;
    rows.push(`| \`${id}\` | ${theme} | ${status} | ${spec.length ? 'spec reused (board unchanged since the stage-A shot)' : ''} |`);
  }
  const n = rows.filter((r) => r.includes('re-shot')).length;
  const text = [
    '',
    `## FINAL (D3, ${TIP}) — IMPL re-shot on the merged tip (stage C rounds 1–5 + bugs3)`,
    '',
    `Re-shot ${n} of ${rows.length} pairs; ${rows.length - n} unreachable. Supersedes every earlier "after" / "FINAL" section above: every pair in this folder (\`<id>-<theme>.jpg\`, JPEG q55, max 1100 px wide) now shows the merged product. The SPEC side is unchanged — the board \`.design/ui/v2/${dir.replace(/^(\d+)-(.*)$/, (_, a, b) => a + ' ' + b.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '))}.*\` has no commit after the stage-A shot, so the stage-A spec PNGs are reused. Full-size pairs: last line of \`full-size-path.txt\` ("final (D3):").`,
    '',
    ...extra[dir].map((s) => `- ${s}`),
    '',
    '| id | theme | FINAL (D3) | spec |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  appendFileSync(join(EV, dir, 'INDEX.md'), text);
  const p = join(EV, dir, 'full-size-path.txt');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\n*$/, '\n') + `final (D3): ${join(WT, '.scr/pairs', dir)}\n`);
  console.log(dir, n, rows.length);
}
