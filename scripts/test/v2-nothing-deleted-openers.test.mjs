// The probe's state openers as data (Phase 4 gate, apps/studio/client/v2/contracts/V2-4-gate-nothing-deleted.md):
// an opener names a world, the world names canned answers, and every name resolves. No browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OPENERS,
  PALETTE,
  resolveOpener,
  ROUTE_ANSWERS,
  STATES,
  WS_PUSH,
} from '../v2-manifest/openers.mjs';

const opener = (id) => OPENERS.find((o) => o.id === id);

test('a linked-project opener folds its state into route answers and /_config keys', () => {
  const w = resolveOpener(opener('settings-advanced-linked'));
  // Settings › Advanced › This project is drawn from these two routes, and only for a linked hub
  assert.equal(w.routes['/_api/sync/settings'].settings.syncFiles, true);
  assert.equal(w.routes['/_api/sync/ownership'].linked, true);
  assert.equal(w.routes['/_sync-status'].linked, true);
  assert.equal(w.config.linkedHub.credentialed, true);
});

test('a state that extends another overrides only what it names', () => {
  const w = resolveOpener(opener('settings-advanced-detach'));
  assert.equal(w.routes['/_api/sync/ownership'].mode, 'hub-owned'); // overridden
  assert.equal(w.routes['/_api/sync/settings'].ok, true); // inherited
  assert.equal(resolveOpener(opener('diag-sync-files')).routes['/_sync-status'].aiAction.state, 'held');
});

test('the signed-in cloud state answers the account and its projects, nothing else', () => {
  const w = resolveOpener(opener('settings-cloud-in'));
  assert.deepEqual(Object.keys(w.routes).sort(), ['/_api/cloud/projects', '/_api/cloud/status']);
  assert.equal(w.routes['/_api/cloud/status'].connected, true);
  assert.deepEqual(w.config, {});
  assert.equal(resolveOpener(opener('settings-github-in')).invoke.github_is_signed_in, true);
});

test('every opener resolves, every pushed frame exists, ids are unique, ⌘K is the V2-4.6 one', () => {
  const ids = OPENERS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const o of OPENERS) {
    resolveOpener(o); // throws on an unknown state or answer name
    for (const st of o.steps) if (st.push) assert.ok(WS_PUSH[st.push], `${o.id}: ${st.push}`);
  }
  for (const [name, st] of Object.entries(STATES))
    for (const a of Object.values(st.routes ?? {})) assert.ok(a in ROUTE_ANSWERS, `${name}: ${a}`);
  assert.match(PALETTE.input, /palette-input/);
});

test('an unknown state or answer is a loud error, not a silent empty world', () => {
  assert.throws(() => resolveOpener({ id: 'x', state: 'nope', steps: [] }), /unknown state/);
  assert.throws(() => resolveOpener({ id: 'x', routes: { '/a': 'nope' }, steps: [] }), /no route answer/);
});
