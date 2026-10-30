// The dead-control crawler never clicks a destructive confirm; each one is pinned to a unit test that runs
// its action (scripts/v2-verify/dead-controls/destructive-pins.mjs). This keeps a pin from rotting: the test
// file must exist and still carry the named test. The report and the crawler's exit code do the rest — a
// skipped control with no pin exits 1.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DESTRUCTIVE_PINS } from '../v2-verify/dead-controls/destructive-pins.mjs';
import { classOf, summarize } from '../v2-verify/dead-controls/report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every destructive pin names a test that exists', () => {
  for (const [control, pin] of Object.entries(DESTRUCTIVE_PINS)) {
    const file = join(ROOT, pin.file);
    assert.ok(existsSync(file), `${control}: ${pin.file} is missing`);
    const src = readFileSync(file, 'utf8');
    assert.ok(src.includes(pin.test), `${control}: "${pin.test}" is not in ${pin.file}`);
    if (pin.also)
      assert.ok(src.includes(pin.also), `${control}: "${pin.also}" is not in ${pin.file}`);
  }
});

test('a skipped destructive control without a pin is counted, and exits the crawl non-zero', () => {
  const rows = [
    { effect: 'skipped-destructive', control: 'share-move-confirm' },
    { effect: 'skipped-destructive', control: 'some-new-confirm' },
  ];
  assert.equal(summarize(rows, []).unpinned, 1);
});

test('every row lands in exactly one class, and the classes add up to the rows found', () => {
  const rows = [
    { effect: 'aria(aria-expanded@x) popup' },
    { effect: 'DEAD' },
    { effect: 'disabled', note: 'Open a canvas first' },
    { effect: 'twin', twin: 'shell · x' },
    { effect: 'skipped-destructive', control: 'share-move-confirm' },
    { effect: 'current' },
    { effect: 'single-option' },
    { effect: 'covered' },
    { effect: 'skipped-file-picker' },
    { effect: 'vanished' },
    { effect: 'unreachable' },
  ];
  const seen = new Map();
  for (const r of rows) seen.set(classOf(r), (seen.get(classOf(r)) ?? 0) + 1);
  assert.equal(
    [...seen.values()].reduce((a, b) => a + b, 0),
    rows.length
  );
  assert.equal(classOf({ effect: 'twin' }), 'twin');
  // only an unreachable state without a named reason is 'not reached'; a vanished control is 'gone' (with its reason)
  assert.equal(summarize(rows, []).notReached, 1);
  assert.equal(classOf({ effect: 'vanished' }), 'gone');
});

test('an unreachable row is accepted only with a named reason and a clicked twin', () => {
  const row = {
    mode: 'tauri',
    effect: 'unreachable',
    surface: 'shell › New canvas › canvas-jump-toggle-ui-videomusic',
    control: '(surface)',
  };
  const twin = {
    mode: 'tauri',
    effect: 'popup',
    surface: 'canvas Landing',
    control: 'canvas-jump-toggle-ui-landing',
  };
  assert.equal(classOf(row, [row]), 'not reached');
  assert.equal(classOf(row, [row, twin]), 'gone');
  assert.equal(summarize([row, twin], []).notReached, 0);
  assert.equal(summarize([row], []).notReached, 1);
  const other = { ...row, surface: 'shell › something-else', control: '(surface)' };
  assert.equal(classOf(other, [other, twin]), 'not reached');
});
