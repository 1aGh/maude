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
    'Frames driven: scenario groups s13 a-j (Studio site / Alligators fixtures, a converted scratch copy of the in-repo `maude-v2` + `maude` systems), `dsboard.mjs` for the three whole-board frames (`ds-board-*`: crop of the top 2900 px of the board, loaded through the capture origin — the board is 9636 px tall, so the lower part is cut). Same fixtures and driving as stages A/D; harness changes: What’s-new toast dismissed through its "Dismiss notification" button, `REPO` repointed.',
    'Also shot (no spec pair, full-size only): `ds-edit-colour-pending`, `ds-make-entry`, `ds-make-sentence`.',
    'Unreachable in a local single-project lane (no stage-C change built these states, see `fix-c3-dsboard.md` / `fix-dsedit.md`): AI suggestion (`ds-edge-suggest`), team library / linked library on a hub (`ds-many-library`, `ds-many-linked`), older-schema upgrade (`ds-multi-schema`).',
  ],
  '14-editing': [
    'Frames driven: scenarios s14a/b/c on the Studio site and Alligators fixtures with the round-3 drill counts (the page is the artboard, ⌘⇧-click for several objects), same as `_d-harness-g5`. Also shot (no spec pair): `ed-edge-huge-fit`.',
    '`ed-edge-tereza` stays unreachable: another person’s presence needs a second synced collaborator, none in a local lane.',
  ],
  '15-annotations': [
    'Frames driven: scenarios s15 groups a-f (Studio site fixture, group f on the print fixture), same fixtures and driving as `_d-harness-g5`. Also shot (no spec pair): `an-place-preview`, `an-print-export`.',
    '`an-viewer` stays unreachable: the viewer role needs a share-grant session, none in a local lane.',
    'Round-4 R5 states the fixture still does not reach (open, see `fix-c4-annot.md`): snap ring + "Button · See the work" tag, dangling "Point to…" card, "0:12" pin on a video artboard, stamp row / count popover, vote running + result section.',
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
    `## FINAL (stage D2, ${TIP}) — IMPL re-shot on the merged tip (all stage C rounds 1–4)`,
    '',
    `Re-shot ${n} of ${rows.length} pairs; ${rows.length - n} unreachable. Supersedes the per-round "after" sections above: every pair in this folder (\`<id>-<theme>.jpg\`, JPEG q55, max 1100 px wide) now shows the merged product. The SPEC side is unchanged — the board \`.design/ui/v2/${dir.replace(/^(\d+)-(.*)$/, (_, a, b) => a + ' ' + b.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '))}.*\` has no commit after the stage-A shot, so the stage-A spec PNGs are reused. Full-size pairs: last line of \`full-size-path.txt\` ("final (D2):").`,
    '',
    ...extra[dir].map((s) => `- ${s}`),
    '',
    '| id | theme | FINAL (D2) | spec |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  appendFileSync(join(EV, dir, 'INDEX.md'), text);
  const p = join(EV, dir, 'full-size-path.txt');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\n*$/, '\n') + `final (D2): ${join(WT, '.scr/pairs', dir)}\n`);
  console.log(dir, n, rows.length);
}
