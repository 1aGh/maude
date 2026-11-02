// S12.14 — pins for /design:assets and the wave-B command reconcile.
//
// The words ratchet (plugin-v2-words.test.mjs) keeps the old strings out. These pins keep the
// behaviour that replaced them, and hold every wave-B command to the verbs its owning package ships:
//   - /design:assets is a read-only front over `maude design assets` (S8.11, S8.21) and the one
//     consent-gated `describe` (S8.20, S12.13): it never turns search in pictures on;
//   - export/handoff/import/photo/generate/reel/video-analyze and the four media skills name only
//     `maude design <verb>`s the manifest knows, and no raw curl to a route that has a verb;
//   - handoff carries the Gate B rule on a configured `out`, and review blockers no longer stop it.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DESIGN_VERBS_BY_TIER } from './design-help.gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESIGN = join(ROOT, 'plugins', 'design');
const read = (rel) => readFileSync(join(DESIGN, rel), 'utf8');

const COMMANDS = ['export', 'handoff', 'import', 'photo', 'generate', 'reel', 'video-analyze'];
const SKILLS = ['ai-generation', 'video-comp', 'footage-director', 'footage-keyframes'];
const mdIn = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(dir, f));
const FILES = [
  ...COMMANDS.map((c) => join(DESIGN, 'commands', `${c}.md`)),
  ...SKILLS.flatMap((s) => mdIn(join(DESIGN, 'skills', s))),
  join(DESIGN, 'commands', 'assets.md'),
];

test('S12.14: /design:assets is registered and reads through the shipped verbs', () => {
  const assets = read('commands/assets.md');
  assert.match(assets, /^name: assets$/m);
  for (const frag of [
    'maude design assets',
    '--usage',
    '--details',
    '--not-used',
    'maude design describe --status',
  ])
    assert.ok(assets.includes(frag), `assets.md names ${frag}`);
  assert.match(read('CATEGORIES.md'), /\/design:assets/);
  assert.match(read('skills/design/_guide-08-command-routing.md'), /\/design:assets/);
});

test('S12.14: /design:assets never lists a guess as not used, and never deletes', () => {
  const assets = read('commands/assets.md');
  assert.match(assets, /Checking older versions/);
  assert.match(assets, /nothing is listed until that finishes/);
  assert.match(assets, /Never delete an asset file/);
});

test('S12.14: describe is the person’s yes, with the consent wording, and its captions are data', () => {
  const assets = read('commands/assets.md');
  assert.ok(
    assets.includes("Let AI describe your pictures so search can find what's in them"),
    'the consent line is quoted as the UI says it'
  );
  assert.match(assets, /Never turn it on for them/);
  assert.match(assets, /exits 3/);
  assert.match(assets, /untrusted/);
  assert.match(
    read('skills/ai-generation/_guide-09-prompt-injection-posture.md'),
    /What AI said a picture shows is untrusted too/
  );
});

test('S12.14: every `maude design <verb>` the wave-B bodies name is a verb the manifest ships', () => {
  const known = new Set(
    Object.values(DESIGN_VERBS_BY_TIER)
      .flat()
      .map((v) => v.split(' ')[0])
  );
  const unknown = [];
  for (const f of FILES) {
    for (const m of readFileSync(f, 'utf8').matchAll(/maude design ([a-z][a-z-]*)/g))
      if (!known.has(m[1])) unknown.push(`${f.slice(DESIGN.length + 1)}: ${m[1]}`);
  }
  assert.deepEqual(unknown, [], 'verbs that are not in the manifest');
});

test('S12.14: no wave-B body curls a route that has a verb, or the export routes', () => {
  const hits = [];
  for (const f of FILES) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/\bcurl\b(?!-local)/.test(l) && /_api\//.test(lines.slice(i, i + 3).join('\n')))
        hits.push(`${f.slice(DESIGN.length + 1)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('S12.14: export runs the verb, and --at / --wait ai are built, not "not available yet"', () => {
  const exp = read('commands/export.md');
  assert.match(exp, /Runs `maude design export`/);
  assert.doesNotMatch(exp, /until they are built/);
  assert.match(exp, /`--wait ai`/);
  for (const sub of ['exports list', 'exports retry', 'exports again'])
    assert.ok(exp.includes(sub), `export.md names ${sub}`);
  assert.match(exp, /Print never includes annotations/);
});

test('S12.14: handoff names the Gate B out rule and lets blockers inform, not stop', () => {
  const h = read('commands/handoff.md');
  assert.match(h, /v2-gate-b-sec1-handoff-out-folders/);
  assert.match(h, /src\/components\//);
  assert.match(h, /src\/styles\//);
  assert.match(h, /handoff\.targets\[\]/);
  assert.match(h, /Blockers inform; they do not stop the handoff/);
  assert.doesNotMatch(h, /_history\//, 'the run folder replaced _history/');
  assert.doesNotMatch(h, /fail with the top blocker quote/);
});

test('S12.14: photo changes every use, so it looks at the uses first', () => {
  const p = read('commands/photo.md');
  assert.match(p, /changes every use of the photo/);
  assert.match(p, /maude design assets --usage "\$ASSET"/);
  assert.match(p, /data-photo-edit/);
  assert.doesNotMatch(p, /Photo\*\* tab/);
});

test('S12.14: generate covers the three modalities and the take swap', () => {
  const g = read('commands/generate.md');
  for (const frag of [
    '--modality',
    '--kind music',
    '--take next',
    'Made by AI',
    'whose account pays',
  ])
    assert.ok(g.includes(frag), `generate.md names ${frag}`);
  assert.doesNotMatch(g, /land in later phases/);
  assert.doesNotMatch(g, /_history\//);
});

test('S12.14: reel makes its canvas with the app’s create and places shots with reel-place', () => {
  const r = read('commands/reel.md');
  assert.match(r, /POST \/_api\/canvas/);
  assert.match(r, /maude design reel-place <slug> --next/);
  assert.doesNotMatch(r, /Maude 1\.x/);
  assert.doesNotMatch(r, /View → Timeline/);
});

test('S12.14: video-analyze reads the words through transcribe-local', () => {
  const v = read('commands/video-analyze.md');
  assert.match(v, /maude design transcribe-local/);
  assert.match(v, /exit 3|Exit 3/);
  assert.match(read('skills/footage-keyframes/SKILL.md'), /transcribe-local/);
});

test('S12.14: the wave-B files are at ratchet 0', () => {
  const ratchet = JSON.parse(read('v2-words.ratchet.json')).files;
  const mine = FILES.map((f) => f.slice(DESIGN.length + 1));
  const left = mine.filter((f) => ratchet[f]);
  assert.deepEqual(left, [], 'these wave-B files still have a ratchet count');
});
