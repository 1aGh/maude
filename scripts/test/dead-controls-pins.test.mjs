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
  assert.equal(summarize(rows, []).notReached, 2);
});
