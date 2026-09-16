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
  unsupportedRequirements,
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
        const reason = value.unresolved ?? value.noControl;
        assert.equal(
          typeof reason,
          'string',
          `${where}: an answer that is not rows must be { unresolved } or { noControl }`
        );
        assert.ok(
          !(value.unresolved && value.noControl),
          `${where}: an action is either a gap or absent from the product, not both`
        );
        assert.ok(reason.length > 40, `${where}: "${reason}" does not say enough to act on`);
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
  assert.ok(open.length <= 3, `${open.length} unresolved actions: ${JSON.stringify(open)}`);
  for (const o of open) assert.ok(o.reason.length > 40, JSON.stringify(o));
});

test('an action the product cannot perform is recorded as unsupported, not as a gap', () => {
  // The distinction the catalogue's own completeness turns on: a control that
  // does not exist cannot be built by trying harder, and folding it in with
  // the real gaps made `catalogueComplete` a flag nobody could ever clear.
  const absent = unsupportedRequirements();
  assert.ok(absent.length > 0, 'the contract does ask for at least one control we do not have');
  for (const a of absent) {
    assert.ok(a.reason.length > 40, JSON.stringify(a));
    // It has to say what is missing, not merely that something is.
    assert.match(a.reason, /control|no separate/i, JSON.stringify(a));
  }
  const both = absent.filter((a) =>
    unresolvedRequirements().some((u) => u.surface === a.surface && u.action === a.action)
  );
  assert.deepEqual(both, [], 'nothing is counted as both absent and unasserted');
});

test('every mapped row id was actually emitted by a real run', () => {
  // The run this repository keeps as its certification evidence. A typo here
  // is a map that points at nothing, which is the failure this whole file
  // exists to prevent.
  const run = join(
    ROOT,
    '.ai/device/scenario-runs/reliable-project-multiplayer/2026-09-16T20-10-34.675Z/surface-results.json'
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
