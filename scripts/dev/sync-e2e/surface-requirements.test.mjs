// The requirement map has to stay true to two documents it does not own:
// the contract (`local-e2e.md`, which declares the actions) and the harness
// (which emits the rows). A map that drifts from either is worse than no map —
// it reads as coverage and points at nothing.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  mappedRowIds,
  REQUIREMENT_COVERAGE,
  unresolvedRequirements,
} from './surface-requirements.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTRACT = join(ROOT, '.ai/scenarios/reliable-project-multiplayer/local-e2e.md');

/** The contract's own table: surface id → its declared actions. */
function declared() {
  const out = {};
  for (const line of readFileSync(CONTRACT, 'utf8').split('\n')) {
    if (!/^\| L\d\d \|/.test(line)) continue;
    const parts = line.split('|').map((s) => s.trim());
    out[parts[1]] = parts[3]
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return out;
}

test('every surface the contract declares is in the map, and no other', () => {
  const contract = declared();
  assert.equal(Object.keys(contract).length, 24, 'the contract still declares 24 surfaces');
  assert.deepEqual(Object.keys(REQUIREMENT_COVERAGE).sort(), Object.keys(contract).sort());
});

test('every declared action is answered — by rows or by a stated reason', () => {
  const contract = declared();
  const missing = [];
  const extra = [];
  for (const [surface, actions] of Object.entries(contract)) {
    const mapped = REQUIREMENT_COVERAGE[surface] ?? {};
    for (const action of actions) if (!(action in mapped)) missing.push(`${surface}: ${action}`);
    for (const action of Object.keys(mapped))
      if (!actions.includes(action)) extra.push(`${surface}: ${action}`);
  }
  assert.deepEqual(missing, [], 'declared actions with no entry');
  assert.deepEqual(extra, [], 'entries for actions the contract does not declare');
});

test('an answer is either a non-empty list of rows or a reason, never an empty gesture', () => {
  for (const [surface, actions] of Object.entries(REQUIREMENT_COVERAGE)) {
    for (const [action, value] of Object.entries(actions)) {
      const where = `${surface} / ${action}`;
      if (Array.isArray(value)) {
        assert.ok(value.length > 0, `${where}: an empty row list claims coverage it has none of`);
        for (const id of value)
          assert.match(id, /^L\d\d\.[a-z0-9]/i, `${where}: ${id} is not a row id`);
      } else {
        assert.equal(typeof value.unresolved, 'string', `${where}: unresolved needs a reason`);
        assert.ok(
          value.unresolved.length > 40,
          `${where}: "${value.unresolved}" does not say enough to act on`
        );
      }
    }
  }
});

test('the same row is never asked to answer two different actions of one surface', () => {
  // Except across surfaces, which is deliberate (L05 points at L04's rows).
  for (const [surface, actions] of Object.entries(REQUIREMENT_COVERAGE)) {
    const seen = new Map();
    for (const [action, value] of Object.entries(actions)) {
      if (!Array.isArray(value)) continue;
      for (const id of value) {
        // A row may legitimately serve two actions when the action names
        // overlap by design ("gesture group" and "one action" are the same
        // drag); those are listed explicitly and few.
        const prior = seen.get(id);
        if (prior && !/gesture|undo|redo|create|play/.test(action))
          assert.notEqual(
            prior,
            action,
            `${surface}: ${id} answers both "${prior}" and "${action}"`
          );
        seen.set(id, action);
      }
    }
  }
});

test('the remainder is small, named, and each one says why', () => {
  const open = unresolvedRequirements();
  // Not a budget to spend — a tripwire. If this grows, something was mapped to
  // nothing rather than built.
  assert.ok(open.length <= 8, `${open.length} unresolved actions: ${JSON.stringify(open)}`);
  for (const o of open) assert.ok(o.reason.length > 40, JSON.stringify(o));
});

test('every mapped row id was actually emitted by a real run', () => {
  // The run this repository keeps as its certification evidence. A typo here
  // is a map that points at nothing, which is the failure this whole file
  // exists to prevent.
  const run = join(
    ROOT,
    '.ai/device/scenario-runs/reliable-project-multiplayer/2026-09-16T01-50-54.345Z/surface-results.json'
  );
  let rows;
  try {
    rows = JSON.parse(readFileSync(run, 'utf8')).rows;
  } catch {
    // Evidence directories are not committed; skip rather than fail on a clone.
    return;
  }
  const emitted = new Set(rows.map((r) => r.id));
  const dangling = [...mappedRowIds()].filter((id) => !emitted.has(id)).sort();
  assert.deepEqual(dangling, [], 'mapped row ids that no run emitted');
});
