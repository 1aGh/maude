// Appends the "after (stage D)" section to each canvas INDEX.md and rewrites full-size-path.txt.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dirname;
const EV = join(ROOT, '..', '.ai/plans/notes/v2-evidence/phase8-fidelity');
const TIP = process.env.TIP || '6d19daa9a';
const notes = JSON.parse(readFileSync(join(ROOT, 'impl-notes.json'), 'utf8'));
const WT = join(ROOT, '..');

const extra = {
  '13-design-system': [
    'Shot with the stage-A harness (scenario scripts s13 groups a-j, `dsboard.mjs` for the three whole-board frames), same fixtures (a converted scratch copy of the in-repo `maude-v2` + `maude` systems + Homepage / Landing / Pricing / Combine-kampaň canvases), on the stage-C-round-2 tip.',
    'Harness fix only: the one-time What’s-new toast now has "See all (3)" as its FIRST button, so the old dismiss click opened the What’s-new panel over the app; the harness now clicks the "Dismiss notification" button. No product code changed.',
    '**Gate from stage A is gone:** the two showcase specimens (`ui_kits-desktop-index/-showcase`) that made the converted board answer 403 in stage A were NOT removed from the scratch copy this time and the board renders; the three whole-board frames (`ds-board-*`) therefore now show the real Desktop index / Desktop showcase artboards (stage A: "This specimen is not loaded"). The crop is the top 2900 px of the board as in stage A (the board is now 9636 px tall, so the lower part is cut).',
    'Still unreachable (no product path in a local single-project lane, as in stage A and confirmed in `fix-dsedit.md`): the AI suggestion, the team library / linked library (hub) and the older-schema upgrade.',
    '`ds-make-*`, `ds-edit-instance`, `ds-edit-master` are re-shot with the same verb sequence as stage A; `fix-dsedit.md` RC6 says the make verbs still open the legacy folder view, so those frames show what the app draws now, not necessarily the board state.',
  ],
  '14-editing': [
    'Shot with the stage-A harness (scenarios s14a/b/c on the Studio site and Alligators fixtures), same fixtures and driving as stage A, on the stage-C-round-2 tip. Harness fix only: the What’s-new toast dismiss (the toast’s first button is now "See all (3)" and opened the panel) — no product code changed.',
    '`ed-edge-tereza` stays unreachable: another person’s presence needs a second synced collaborator, none in a local lane.',
  ],
  '15-annotations': [
    'Shot with the stage-A harness (scenarios s15 groups a-f on the Studio site fixture, group f on the print fixture), same fixtures and driving as stage A, on the stage-C-round-2 tip. Harness fix only: the What’s-new toast dismiss (its first button is now "See all (3)" and opened the panel) — no product code changed.',
    '`an-figjam` is now shot in both themes (stage A had light only): ⌘K › Import from Figma… opens the import dialog, which says Figma is not connected — the connected state needs Figma sign-in and stays unreachable.',
    '`an-viewer` stays unreachable: the viewer role needs a share-grant session, none in a local lane.',
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
    let status;
    if (hasImpl) status = board ? 're-shot (whole-board crop through the capture origin; the plain in-app frame was re-shot too)' : 're-shot';
    else status = `unreachable — ${(notes[id] && notes[id].blocker) || 'not reachable'}`;
    rows.push(`| \`${id}\` | ${theme} | ${status} | spec reused (board unchanged since stage A) |`);
  }
  const n = rows.filter((r) => r.includes('re-shot')).length;
  const text = [
    '',
    `## After (stage D, ${TIP}) — IMPL re-shot on the stage-C-round-2 tip`,
    '',
    `Re-shot ${n} of ${rows.length} pairs; ${rows.length - n} unreachable. SPEC side: \`.design/ui/v2/${dir.replace(/^(\d+)-(.*)$/, (_, a, b) => a + ' ' + b.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '))}.*\` is unchanged since the stage-A shot, so the stage-A spec PNGs are reused. The committed JPEG pairs in this folder are overwritten with the stage-D pairs (same format and size as stage A); the stage-A IMPL frames are in the first section of this file (their pairs are in git history, commit 902d112ac).`,
    '',
    ...extra[dir].map((s) => `- ${s}`),
    '',
    '| id | theme | after (stage D) | spec |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  appendFileSync(join(EV, dir, 'INDEX.md'), text);
  const p = join(EV, dir, 'full-size-path.txt');
  const old = readFileSync(p, 'utf8').trim();
  const oldPath = old.replace(/^stage A:\s*/, '').split('\n')[0];
  writeFileSync(p, `stage A: ${oldPath}\nstage D: ${join(WT, '.scr/pairs', dir)}\n`);
  console.log(dir, n, rows.length);
}
