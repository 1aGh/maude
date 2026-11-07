// #164 F3 — "put it back" must take back the AI's own actions, never restore the whole canvas over a
// person's save that sits inside the run. Pins the guide and the skill digest.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) =>
  readFileSync(join(ROOT, 'plugins', 'design', 'skills', 'design', rel), 'utf8');

const section = (md) => {
  const a = md.indexOf('Put it back to before the change');
  const b = md.indexOf('## The Trash');
  return md.slice(a, b);
};

test('the guide points "put it back" at the per-run undo', () => {
  const s = section(read('_guide-versions-and-trash.md'));
  assert.match(s, /history undo --chat/);
  assert.match(s, /history undo --action/);
});

test('the guide never sends the AI straight to a whole-canvas restore of a run', () => {
  const s = section(read('_guide-versions-and-trash.md'));
  // the old recipe: diff --run, then restore the from-version over the canvas
  assert.doesNotMatch(s, /^\s*maude design history restore [^\n]*r6\b/m);
  assert.match(s, /ask the person/i);
  assert.match(s, /person'?s save/i);
});

test('the skill digest does not say "restore the row just below the change"', () => {
  const md = read('SKILL.md');
  assert.doesNotMatch(md, /with the row just BELOW the change/);
  assert.match(md, /history undo --chat/);
});
