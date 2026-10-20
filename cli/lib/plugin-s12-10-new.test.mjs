// S12.10 — pins for /design:new on v2 (not just reworded: rewired).
//
// The words ratchet (plugin-v2-words.test.mjs) keeps the old strings out. These pins keep the
// behaviour that replaced them:
//   - a canvas is made by the create the app uses (POST /_api/canvas), never by a template copy
//     and a hand-written .meta.json, so the file, the name and the meta match ⌘N;
//   - the draft arrives artboard by artboard: every artboard empty with its kind and size, then
//     big before small, words last;
//   - the run, the hand-offs and the hooks replace _history/, _active.json and chat.md;
//   - artboards come from the preset catalogue (skills/design/_guide-28-artboards.md), whose
//     rows are held to apps/studio/kinds/presets.ts by apps/studio/test/artboards-guide.test.ts.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESIGN = join(ROOT, 'plugins', 'design');
const read = (rel) => readFileSync(join(DESIGN, rel), 'utf8');
const REFS = readdirSync(join(DESIGN, 'references', 'new'))
  .filter((f) => f.endsWith('.md'))
  .sort();
const refText = (prefix) => {
  const f = REFS.find((n) => n.startsWith(prefix));
  assert.ok(f, `a references/new file starts with ${prefix}`);
  return read(`references/new/${f}`);
};
const ALL_REFS = REFS.map((f) => ({ f, text: read(`references/new/${f}`) }));

test('S12.10: the command links every stage file, and every stage file is linked', () => {
  const cmd = read('commands/new.md');
  const linked = [...cmd.matchAll(/\]\(\.\.\/references\/new\/([^)]+)\)/g)].map((m) => m[1]);
  for (const f of linked) assert.ok(REFS.includes(f), `new.md links ${f}, which does not exist`);
  for (const f of REFS) assert.ok(linked.includes(f), `${f} is not in the procedure index`);
  assert.equal(new Set(linked).size, linked.length, 'no stage is linked twice');
});

test('S12.10: no stage hand-rolls a canvas file or its .meta.json (reachability pin)', () => {
  for (const { f, text } of ALL_REFS) {
    assert.doesNotMatch(
      text,
      /(?:blank-canvas|brief-board|canvas)\.tsx\.template/,
      `${f} copies a template; the create makes the file`
    );
    assert.doesNotMatch(
      text,
      /\bcat\s*>[^\n]*(?:\.tsx|\.meta\.json)/,
      `${f} writes a file with cat`
    );
    assert.doesNotMatch(text, /sed -e "s\/\{\{/, `${f} fills a template with sed`);
    assert.doesNotMatch(
      text,
      /(?:Write|write|stamp|Stamp)[^\n]*`?\.meta\.json`? (?:from|with)\b|kind:\s*"canvas"|`?"created"`?|ISO timestamps/,
      `${f} scaffolds a .meta.json by hand`
    );
  }
});

test('S12.10: a canvas is made by the app’s own create, with the C4 name and the system', () => {
  const t = refText('09-');
  assert.match(t, /maude design curl-local/);
  assert.match(t, /\/_api\/canvas/);
  assert.match(t, /Untitled canvas/);
  assert.match(t, /"designSystem"|designSystem/);
  assert.match(t, /folder/i, 'the folder a canvas starts in is named');
  assert.match(t, /Nothing hand-written|never write the .tsx or its .meta.json/i);
});

test('S12.10: the draft goes artboard by artboard — empty first, big before small, words last', () => {
  const t = refText('16-');
  const empty = t.search(/every artboard empty/i);
  const big = t.search(/big before small/i);
  const words = t.search(/words last/i);
  assert.ok(empty >= 0 && big > empty && words > big, 'the three stages come in that order');
  assert.match(t, /kind/);
  assert.match(t, /_guide-28-artboards\.md/);
  assert.match(t, /Edit/, 'every piece is an Edit into the canvas the create made');
  assert.doesNotMatch(t, /Write-new|orchestrator-direct Write/);
});

test('S12.10: a blank brief canvas is made by the create too, and the seed hint is one Edit', () => {
  const t = refText('10-');
  assert.match(t, /\/_api\/canvas/);
  assert.match(t, /maude design open/);
  assert.doesNotMatch(t, /_active\.json/, 'the studio owns the active canvas');
});

test('S12.10: the run, the hand-offs and Version history replace _history/, _active.json, chat.md', () => {
  for (const { f, text } of ALL_REFS) {
    const bad = text.split('\n').filter((l) => /_history\//.test(l) && !/pre-v2|legacy/i.test(l));
    assert.deepEqual(bad, [], `${f} still writes under _history/`);
    assert.doesNotMatch(text, /chat\.md/, `${f} still writes chat.md`);
    assert.doesNotMatch(text, /000-envelope/, `${f} still writes 000-envelope.md`);
    assert.doesNotMatch(text, /jq [^\n]*\.active\s*=/, `${f} writes _active.json`);
  }
  const loop = refText('24-');
  assert.match(loop, /handoff\/<critic>-<n>\.in\.json/);
  assert.match(loop, /maude design check/);
  assert.match(refText('13-'), /handoff\/ux-research-agent-<n>\.in\.json/);
  assert.match(refText('22-'), /handoff\/draw-agent-<n>\.in\.json/);
  assert.match(refText('05-'), /Maude run folder for this conversation/);
});

test('S12.10: ingest is detected without the old kind literal and reads the brief canvas', () => {
  const t = refText('07-');
  assert.doesNotMatch(t, /brief-board/);
  assert.match(t, /IS_BRIEF/);
  assert.match(refText('17-'), /maude design place/);
});

test('S12.10: the artboards reference names the kinds, the picker groups and the presets', () => {
  const g = read('skills/design/_guide-28-artboards.md');
  for (const w of [
    'App',
    'Web page',
    'Social',
    'Print',
    'Video',
    'Fixed size',
    'Untitled canvas',
  ]) {
    assert.ok(g.includes(w), `_guide-28 names ${w}`);
  }
  for (const id of [
    'app-desktop',
    'web-desktop',
    'social-story',
    'print-a4',
    'video-landscape',
    'print-custom',
  ]) {
    assert.ok(g.includes(`\`${id}\``), `_guide-28 lists ${id}`);
  }
  assert.match(g, /layout\.artboards\[\]/);
  assert.match(g, /maude design place/);
  assert.match(
    g,
    /DCSection id="main"/,
    'the first artboard of a blank canvas goes in the main section'
  );
  assert.match(g, /default design system/i);
  assert.match(g, /folder/i);
  assert.match(read('skills/design/SKILL.md'), /_guide-28-artboards\.md/);
});

test('S12.10: ui-kit names the picker groups and points at the artboards reference', () => {
  const u = read('skills/ui-kit/SKILL.md');
  assert.match(u, /_guide-28-artboards\.md/);
  assert.match(u, /Fixed size/);
  assert.match(u, /App · Web page · Social · Print · Video/);
  assert.doesNotMatch(
    u,
    /don't add `kind="digital"` explicitly/,
    'a picked App/Social artboard writes kind="digital" fixed'
  );
});

test('S12.10: the ratchet holds 0 for /design:new, its stages and ui-kit', () => {
  const ratchet = JSON.parse(read('v2-words.ratchet.json'));
  const left = Object.keys(ratchet.files).filter(
    (k) =>
      k === 'commands/new.md' ||
      k.startsWith('references/new/') ||
      k.startsWith('skills/ui-kit/') ||
      k === 'skills/source-command-new/SKILL.md' ||
      k === 'skills/design/_guide-28-artboards.md'
  );
  assert.deepEqual(left, []);
});

test('S12.10: the stage files all exist under the names the index uses (rename sanity)', () => {
  for (const f of REFS) assert.ok(existsSync(join(DESIGN, 'references', 'new', f)));
  assert.ok(REFS.length >= 30, 'no stage was dropped');
});
